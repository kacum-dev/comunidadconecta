export interface ParsedBankRow {
  date: string;
  description: string;
  amountCents: number;
  reference: string;
  contact: string;
}

export interface BankStatementResult {
  rows: ParsedBankRow[];
  errors: Array<{ row: number; message: string }>;
  format?: "csv" | "norma43";
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      cells.push(value.trim());
      value = "";
    } else value += character;
  }
  cells.push(value.trim());
  return cells;
}

function normalizeHeader(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const headerAliases = {
  date: ["fecha", "fechavalor", "date", "valuedate"],
  description: ["concepto", "descripcion", "description", "detalle", "memo"],
  amount: ["importe", "amount", "cantidad"],
  reference: ["referencia", "reference", "ref", "identificador"],
  contact: ["ordenante", "beneficiario", "contacto", "contact", "tercero"]
} as const;

function headerIndex(headers: string[], aliases: readonly string[], required: boolean) {
  const index = headers.findIndex((header) => aliases.includes(header));
  if (required && index < 0) throw new Error(`Falta la columna ${aliases[0]}.`);
  return index;
}

export function moneyToCents(value: string) {
  let normalized = value.replace(/[€\s]/g, "").replace(/[^0-9,.-]/g, "");
  if (!normalized) throw new Error("El importe está vacío.");
  const negativeByParentheses = /^\(.*\)$/.test(value.trim());
  if (normalized.includes(",")) normalized = normalized.replace(/\./g, "").replace(",", ".");
  else if ((normalized.match(/\./g) ?? []).length > 1) normalized = normalized.replace(/\./g, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || Math.abs(amount) > 999_999_999) throw new Error("El importe no es válido.");
  return Math.round((negativeByParentheses ? -Math.abs(amount) : amount) * 100);
}

export function normalizeBankDate(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return assertDate(trimmed);
  const match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(trimmed);
  if (!match) throw new Error("La fecha no tiene un formato válido.");
  return assertDate(`${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`);
}

function assertDate(value: string) {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("La fecha no existe.");
  return value;
}

export function parseBankCsv(content: string): BankStatementResult {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("El CSV debe incluir una cabecera y al menos un movimiento.");
  const delimiter = (lines[0].match(/;/g) ?? []).length >= (lines[0].match(/,/g) ?? []).length ? ";" : ",";
  const headers = splitDelimitedLine(lines[0], delimiter).map(normalizeHeader);
  const indexes = {
    date: headerIndex(headers, headerAliases.date, true),
    description: headerIndex(headers, headerAliases.description, true),
    amount: headerIndex(headers, headerAliases.amount, true),
    reference: headerIndex(headers, headerAliases.reference, false),
    contact: headerIndex(headers, headerAliases.contact, false)
  };
  const rows: ParsedBankRow[] = [];
  const errors: BankStatementResult["errors"] = [];
  lines.slice(1).forEach((line, offset) => {
    try {
      const cells = splitDelimitedLine(line, delimiter);
      const description = String(cells[indexes.description] ?? "").trim();
      if (description.length < 2) throw new Error("El concepto está vacío.");
      rows.push({
        date: normalizeBankDate(cells[indexes.date] ?? ""),
        description: description.slice(0, 500),
        amountCents: moneyToCents(cells[indexes.amount] ?? ""),
        reference: indexes.reference >= 0 ? String(cells[indexes.reference] ?? "").trim().slice(0, 160) : "",
        contact: indexes.contact >= 0 ? String(cells[indexes.contact] ?? "").trim().slice(0, 200) : ""
      });
    } catch (error) {
      errors.push({ row: offset + 2, message: error instanceof Error ? error.message : "Fila no válida." });
    }
  });
  if (!rows.length) throw new Error("Ningún movimiento del CSV es válido.");
  return { rows, errors, format: "csv" };
}

const commonConcepts: Record<string, string> = {
  "01": "Reintegro", "02": "Ingreso", "03": "Recibo o domiciliación", "04": "Transferencia",
  "05": "Amortización", "06": "Remesa", "07": "Talón", "08": "Tarjeta", "09": "Valores",
  "10": "Exterior", "11": "Divisas", "12": "Comisión", "13": "Intereses", "14": "Anulación",
  "15": "Abono", "16": "Cheque", "17": "Cajero", "98": "Operación no estandarizada", "99": "Otros"
};

function norma43Date(value: string) {
  if (!/^\d{6}$/.test(value)) throw new Error("La fecha del movimiento no es válida.");
  const year = Number(value.slice(0, 2));
  return assertDate(`${year <= 79 ? 2000 + year : 1900 + year}-${value.slice(2, 4)}-${value.slice(4, 6)}`);
}

export function parseNorma43(content: string): BankStatementResult {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length || !lines.some((line) => line.startsWith("11"))) throw new Error("El archivo no contiene una cabecera Norma 43.");
  const rows: ParsedBankRow[] = [];
  const errors: BankStatementResult["errors"] = [];
  let accountReference = "";
  let current: ParsedBankRow | null = null;
  const flush = () => { if (current) rows.push({ ...current, description: current.description.trim().slice(0, 500) }); current = null; };

  lines.forEach((rawLine, index) => {
    const line = rawLine.padEnd(80, " ");
    const code = line.slice(0, 2);
    try {
      if (code === "11") {
        accountReference = `${line.slice(2, 6)}-${line.slice(6, 10)}-${line.slice(10, 20)}`.replace(/\s+/g, "");
      } else if (code === "22") {
        flush();
        const sign = line.slice(27, 28);
        const amount = line.slice(28, 42);
        if (!/^[12]$/.test(sign) || !/^\d{14}$/.test(amount)) throw new Error("El signo o importe del movimiento no es válido.");
        const commonConcept = line.slice(22, 24);
        const reference = [line.slice(42, 52), line.slice(52, 64), line.slice(64, 80)].map((value) => value.trim()).filter(Boolean).join(" ");
        current = {
          date: norma43Date(line.slice(10, 16)),
          description: commonConcepts[commonConcept] ?? `Movimiento bancario ${commonConcept}`,
          amountCents: Number(amount) * (sign === "1" ? -1 : 1),
          reference: reference.slice(0, 160),
          contact: accountReference.slice(0, 200)
        };
      } else if (code === "23" && current) {
        const detail = `${line.slice(4, 42)} ${line.slice(42, 80)}`.replace(/\s+/g, " ").trim();
        if (detail) current.description = `${current.description} · ${detail}`;
      } else if (code === "33" || code === "88") flush();
    } catch (error) {
      if (code === "22") current = null;
      errors.push({ row: index + 1, message: error instanceof Error ? error.message : "Registro Norma 43 no válido." });
    }
  });
  flush();
  if (!rows.length) throw new Error("Ningún movimiento Norma 43 es válido.");
  return { rows, errors, format: "norma43" };
}

export function parseBankStatement(fileName: string, content: string) {
  const normalized = fileName.trim().toLowerCase();
  if (/\.(n43|norma43)$/.test(normalized)) return parseNorma43(content);
  if (/\.txt$/.test(normalized) && /^(11|22|23|24|33|88)/m.test(content)) return parseNorma43(content);
  if (/\.csv$/.test(normalized)) return parseBankCsv(content);
  throw new Error("Formato no admitido. Usa CSV o Norma 43 (.n43, .norma43 o .txt).");
}

function normalizedWords(value: string) {
  return new Set(value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
}

export function reconciliationScore(input: { bankAmountCents: number; bankDate: string; bankText: string; recordAmountCents: number; recordDate: string | null; recordText: string }) {
  const reasons: string[] = [];
  let score = 0;
  if (Math.abs(input.bankAmountCents) === Math.abs(input.recordAmountCents)) { score += 60; reasons.push("importe exacto"); }
  if (input.recordDate) {
    const days = Math.abs((new Date(input.bankDate).getTime() - new Date(input.recordDate).getTime()) / 86_400_000);
    if (days <= 3) { score += 20; reasons.push("fecha próxima"); }
    else if (days <= 15) { score += 10; reasons.push("fecha compatible"); }
  }
  const bankWords = normalizedWords(input.bankText);
  const recordWords = normalizedWords(input.recordText);
  const shared = [...bankWords].filter((word) => recordWords.has(word));
  if (shared.length) { score += Math.min(20, shared.length * 8); reasons.push("referencia coincidente"); }
  return { score: Math.min(100, score), reasons };
}

export function allocationStatus(totalCents: number, allocatedCents: number) {
  if (allocatedCents <= 0) return "unmatched";
  return allocatedCents >= Math.abs(totalCents) ? "matched" : "suggested";
}

export function financialStatusAfterReversal(totalCents: number, allocatedCents: number, previousStatus: string) {
  return allocatedCents >= Math.abs(totalCents) ? "paid" : previousStatus;
}
