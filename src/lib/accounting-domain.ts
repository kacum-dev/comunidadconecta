export type AccountingAccountType = "asset" | "liability" | "equity" | "income" | "expense" | "off_balance";
export type AccountingNormalSide = "debit" | "credit";

export interface AccountingLineDraft {
  accountId: string;
  description: string | null;
  debitCents: number;
  creditCents: number;
}

export interface AccountingEntryDraft {
  periodId: string;
  journalId: string;
  entryDate: string;
  concept: string;
  reference: string | null;
  lines: AccountingLineDraft[];
  debitCents: number;
  creditCents: number;
}

export type AccountingCommand =
  | { action: "create_period"; name: string; startsOn: string; endsOn: string }
  | { action: "create_account"; code: string; name: string; accountType: AccountingAccountType; normalSide: AccountingNormalSide; parentId: string | null }
  | { action: "set_account_active"; id: string; active: boolean }
  | ({ action: "create_entry" } & AccountingEntryDraft)
  | ({ action: "update_entry"; id: string } & AccountingEntryDraft)
  | { action: "delete_entry" | "submit_entry" | "return_entry" | "post_entry" | "reverse_entry" | "close_period"; id: string };

export interface AccountingAccountSeed {
  code: string;
  name: string;
  accountType: AccountingAccountType;
  normalSide: AccountingNormalSide;
  systemKey: string | null;
}

export interface AutomaticPostingRule {
  direction: "income" | "expense";
  debitCode: string;
  creditCode: string;
  label: string;
}

export function automaticPostingRule(kind: string): AutomaticPostingRule | null {
  if (kind === "assessment") {
    return { direction: "income", debitCode: "572", creditCode: "706", label: "Cobro de derrama" };
  }
  if (kind === "charge" || kind === "receipt") {
    return { direction: "income", debitCode: "572", creditCode: "705", label: "Cobro de cuota o recibo" };
  }
  if (kind === "credit") {
    return { direction: "income", debitCode: "572", creditCode: "759", label: "Cobro de otro ingreso" };
  }
  if (kind === "invoice" || kind === "debit") {
    return { direction: "expense", debitCode: "629", creditCode: "572", label: "Pago de factura o gasto" };
  }
  return null;
}

// Catálogo operativo para comunidades de propietarios. Mantiene la estructura
// decimal del PGC, pero sus denominaciones se adaptan a la gestión comunitaria.
export const DEFAULT_ACCOUNTING_ACCOUNTS: readonly AccountingAccountSeed[] = [
  { code: "101", name: "Fondo comunitario", accountType: "equity", normalSide: "credit", systemKey: "community_fund" },
  { code: "1141", name: "Fondo de reserva", accountType: "equity", normalSide: "credit", systemKey: "reserve_fund" },
  { code: "120", name: "Remanente acumulado", accountType: "equity", normalSide: "credit", systemKey: "retained_earnings" },
  { code: "121", name: "Resultados negativos de ejercicios anteriores", accountType: "equity", normalSide: "debit", systemKey: "prior_losses" },
  { code: "129", name: "Resultado del ejercicio", accountType: "equity", normalSide: "credit", systemKey: "current_result" },
  { code: "206", name: "Aplicaciones informáticas", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "210", name: "Terrenos y bienes naturales", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "211", name: "Construcciones de titularidad comunitaria", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "212", name: "Instalaciones técnicas", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "213", name: "Maquinaria", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "214", name: "Utillaje", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "215", name: "Otras instalaciones", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "216", name: "Mobiliario", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "217", name: "Equipos informáticos", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "218", name: "Elementos de transporte", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "2806", name: "Amortización acumulada de aplicaciones informáticas", accountType: "asset", normalSide: "credit", systemKey: null },
  { code: "2811", name: "Amortización acumulada de construcciones", accountType: "asset", normalSide: "credit", systemKey: null },
  { code: "2812", name: "Amortización acumulada de instalaciones técnicas", accountType: "asset", normalSide: "credit", systemKey: null },
  { code: "2813", name: "Amortización acumulada de maquinaria", accountType: "asset", normalSide: "credit", systemKey: null },
  { code: "2814", name: "Amortización acumulada de utillaje", accountType: "asset", normalSide: "credit", systemKey: null },
  { code: "2815", name: "Amortización acumulada de otras instalaciones", accountType: "asset", normalSide: "credit", systemKey: null },
  { code: "2816", name: "Amortización acumulada de mobiliario", accountType: "asset", normalSide: "credit", systemKey: null },
  { code: "2817", name: "Amortización acumulada de equipos informáticos", accountType: "asset", normalSide: "credit", systemKey: null },
  { code: "2818", name: "Amortización acumulada de elementos de transporte", accountType: "asset", normalSide: "credit", systemKey: null },
  { code: "400", name: "Proveedores", accountType: "liability", normalSide: "credit", systemKey: "suppliers" },
  { code: "410", name: "Acreedores por servicios", accountType: "liability", normalSide: "credit", systemKey: "service_creditors" },
  { code: "430", name: "Propietarios, cuotas pendientes", accountType: "asset", normalSide: "debit", systemKey: "owner_receivables" },
  { code: "431", name: "Propietarios, derramas pendientes", accountType: "asset", normalSide: "debit", systemKey: "assessment_receivables" },
  { code: "436", name: "Saldos de propietarios de dudoso cobro", accountType: "asset", normalSide: "debit", systemKey: "doubtful_receivables" },
  { code: "440", name: "Otros deudores", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "465", name: "Remuneraciones pendientes de pago", accountType: "liability", normalSide: "credit", systemKey: null },
  { code: "470", name: "Hacienda Pública deudora", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "472", name: "Hacienda Pública, IVA soportado", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "4750", name: "Hacienda Pública, acreedora por IVA", accountType: "liability", normalSide: "credit", systemKey: null },
  { code: "4751", name: "Hacienda Pública, acreedora por retenciones", accountType: "liability", normalSide: "credit", systemKey: null },
  { code: "4752", name: "Hacienda Pública, acreedora por impuesto sobre sociedades", accountType: "liability", normalSide: "credit", systemKey: null },
  { code: "476", name: "Seguridad Social acreedora", accountType: "liability", normalSide: "credit", systemKey: null },
  { code: "477", name: "Hacienda Pública, IVA repercutido", accountType: "liability", normalSide: "credit", systemKey: null },
  { code: "490", name: "Deterioro de créditos por operaciones", accountType: "asset", normalSide: "credit", systemKey: null },
  { code: "520", name: "Deudas a corto plazo", accountType: "liability", normalSide: "credit", systemKey: null },
  { code: "523", name: "Proveedores de inmovilizado a corto plazo", accountType: "liability", normalSide: "credit", systemKey: null },
  { code: "542", name: "Créditos a corto plazo", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "548", name: "Imposiciones a corto plazo", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "551", name: "Cuenta corriente con propietarios", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "555", name: "Partidas pendientes de aplicación", accountType: "liability", normalSide: "credit", systemKey: "suspense" },
  { code: "560", name: "Fianzas recibidas a corto plazo", accountType: "liability", normalSide: "credit", systemKey: null },
  { code: "565", name: "Fianzas constituidas a corto plazo", accountType: "asset", normalSide: "debit", systemKey: null },
  { code: "570", name: "Caja", accountType: "asset", normalSide: "debit", systemKey: "cash" },
  { code: "572", name: "Bancos", accountType: "asset", normalSide: "debit", systemKey: "bank" },
  { code: "600", name: "Compras", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "602", name: "Compras de otros aprovisionamientos", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "607", name: "Trabajos realizados por otras empresas", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "621", name: "Arrendamientos y cánones", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "622", name: "Reparaciones y conservación", accountType: "expense", normalSide: "debit", systemKey: "repairs" },
  { code: "623", name: "Servicios profesionales", accountType: "expense", normalSide: "debit", systemKey: "professional_services" },
  { code: "624", name: "Transportes", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "625", name: "Primas de seguros", accountType: "expense", normalSide: "debit", systemKey: "insurance" },
  { code: "626", name: "Servicios bancarios", accountType: "expense", normalSide: "debit", systemKey: "bank_fees" },
  { code: "627", name: "Publicidad y comunicación", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "628", name: "Suministros", accountType: "expense", normalSide: "debit", systemKey: "utilities" },
  { code: "6280", name: "Electricidad", accountType: "expense", normalSide: "debit", systemKey: "electricity" },
  { code: "6281", name: "Agua", accountType: "expense", normalSide: "debit", systemKey: "water" },
  { code: "6282", name: "Gas y combustibles", accountType: "expense", normalSide: "debit", systemKey: "fuel" },
  { code: "6283", name: "Telecomunicaciones", accountType: "expense", normalSide: "debit", systemKey: "telecommunications" },
  { code: "6284", name: "Residuos y saneamiento", accountType: "expense", normalSide: "debit", systemKey: "waste" },
  { code: "629", name: "Otros servicios", accountType: "expense", normalSide: "debit", systemKey: "other_services" },
  { code: "631", name: "Otros tributos", accountType: "expense", normalSide: "debit", systemKey: "taxes" },
  { code: "634", name: "Ajustes negativos en imposición indirecta", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "640", name: "Sueldos y salarios", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "642", name: "Seguridad Social a cargo de la comunidad", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "649", name: "Otros gastos sociales", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "650", name: "Pérdidas de créditos incobrables", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "659", name: "Otras pérdidas de gestión", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "662", name: "Intereses de deudas", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "669", name: "Otros gastos financieros", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "678", name: "Gastos excepcionales", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "680", name: "Amortización del inmovilizado intangible", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "681", name: "Amortización del inmovilizado material", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "694", name: "Pérdidas por deterioro de créditos", accountType: "expense", normalSide: "debit", systemKey: null },
  { code: "705", name: "Cuotas ordinarias", accountType: "income", normalSide: "credit", systemKey: "ordinary_fees" },
  { code: "706", name: "Derramas", accountType: "income", normalSide: "credit", systemKey: "assessments" },
  { code: "740", name: "Subvenciones a la actividad", accountType: "income", normalSide: "credit", systemKey: "grants" },
  { code: "752", name: "Ingresos por arrendamientos", accountType: "income", normalSide: "credit", systemKey: "rental_income" },
  { code: "759", name: "Otros ingresos de gestión", accountType: "income", normalSide: "credit", systemKey: "other_income" },
  { code: "762", name: "Ingresos de créditos", accountType: "income", normalSide: "credit", systemKey: null },
  { code: "769", name: "Otros ingresos financieros", accountType: "income", normalSide: "credit", systemKey: null },
  { code: "778", name: "Ingresos excepcionales", accountType: "income", normalSide: "credit", systemKey: null },
  { code: "794", name: "Reversión del deterioro de créditos", accountType: "income", normalSide: "credit", systemKey: null },
] as const;

export const DEFAULT_ACCOUNTING_JOURNALS = [
  ["GENERAL", "Diario general", "general"],
  ["COMPRAS", "Facturas y proveedores", "purchases"],
  ["CUOTAS", "Cuotas y derramas", "fees"],
  ["BANCO", "Bancos", "bank"],
  ["CAJA", "Caja", "cash"],
  ["APERTURA", "Apertura", "opening"],
  ["CIERRE", "Cierre", "closing"],
] as const;

export class AccountingInputError extends Error {}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accountTypes = new Set<AccountingAccountType>(["asset", "liability", "equity", "income", "expense", "off_balance"]);
const normalSides = new Set<AccountingNormalSide>(["debit", "credit"]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountingInputError("Los datos contables enviados no son válidos.");
  return value as Record<string, unknown>;
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new AccountingInputError(`${label} no es válido.`);
  return value;
}

function optionalUuid(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  return uuid(value, label);
}

function text(value: unknown, label: string, minimum: number, maximum: number, optional = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result && optional) return null;
  if (result.length < minimum || result.length > maximum) throw new AccountingInputError(`${label} debe tener entre ${minimum} y ${maximum} caracteres.`);
  return result;
}

export function isAccountingDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function date(value: unknown, label: string) {
  if (!isAccountingDate(value)) throw new AccountingInputError(`${label} no contiene una fecha válida.`);
  return value;
}

export function accountingAmountToCents(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 999_999_999.99) {
    throw new AccountingInputError("Los importes deben ser positivos y estar dentro del límite permitido.");
  }
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-6) throw new AccountingInputError("Los importes solo pueden tener dos decimales.");
  return cents;
}

function entryDraft(source: Record<string, unknown>): AccountingEntryDraft {
  const rawLines = source.lines;
  if (!Array.isArray(rawLines) || rawLines.length < 2 || rawLines.length > 200) {
    throw new AccountingInputError("El asiento debe contener entre 2 y 200 apuntes.");
  }
  const lines = rawLines.map((rawLine) => {
    const line = object(rawLine);
    const debitCents = accountingAmountToCents(line.debit);
    const creditCents = accountingAmountToCents(line.credit);
    if ((debitCents > 0) === (creditCents > 0)) {
      throw new AccountingInputError("Cada apunte debe tener un único importe en Debe o Haber.");
    }
    return {
      accountId: uuid(line.accountId, "La cuenta"),
      description: text(line.description, "La descripción", 0, 300, true),
      debitCents,
      creditCents,
    };
  });
  const debitCents = lines.reduce((total, line) => total + line.debitCents, 0);
  const creditCents = lines.reduce((total, line) => total + line.creditCents, 0);
  if (!Number.isSafeInteger(debitCents) || !Number.isSafeInteger(creditCents) || debitCents <= 0 || debitCents !== creditCents) {
    throw new AccountingInputError("El Debe y el Haber deben coincidir y ser mayores que cero.");
  }
  return {
    periodId: uuid(source.periodId, "El ejercicio"),
    journalId: uuid(source.journalId, "El diario"),
    entryDate: date(source.entryDate, "La fecha del asiento"),
    concept: text(source.concept, "El concepto", 2, 240) as string,
    reference: text(source.reference, "La referencia", 0, 120, true),
    lines,
    debitCents,
    creditCents,
  };
}

export function parseAccountingCommand(input: unknown): AccountingCommand {
  const source = object(input);
  const action = source.action;
  if (typeof action !== "string") throw new AccountingInputError("Falta la operación contable.");

  if (action === "create_period") {
    const startsOn = date(source.startsOn, "La fecha inicial");
    const endsOn = date(source.endsOn, "La fecha final");
    if (startsOn > endsOn) throw new AccountingInputError("La fecha final debe ser posterior a la inicial.");
    return { action, name: text(source.name, "El nombre", 2, 120) as string, startsOn, endsOn };
  }
  if (action === "create_account") {
    const accountType = source.accountType as AccountingAccountType;
    const normalSide = source.normalSide as AccountingNormalSide;
    if (!accountTypes.has(accountType) || !normalSides.has(normalSide)) throw new AccountingInputError("El tipo o la naturaleza de la cuenta no son válidos.");
    const code = typeof source.code === "string" ? source.code.trim() : "";
    if (!/^[1-9][0-9]{2,9}$/.test(code)) throw new AccountingInputError("El código debe tener entre 3 y 10 cifras y no puede empezar por cero.");
    return { action, code, name: text(source.name, "El nombre", 2, 180) as string, accountType, normalSide, parentId: optionalUuid(source.parentId, "La cuenta superior") };
  }
  if (action === "set_account_active") {
    if (typeof source.active !== "boolean") throw new AccountingInputError("El estado de la cuenta no es válido.");
    return { action, id: uuid(source.id, "La cuenta"), active: source.active };
  }
  if (action === "create_entry") return { action, ...entryDraft(source) };
  if (action === "update_entry") return { action, id: uuid(source.id, "El asiento"), ...entryDraft(source) };
  if (["delete_entry", "submit_entry", "return_entry", "post_entry", "reverse_entry", "close_period"].includes(action)) {
    return { action: action as "delete_entry" | "submit_entry" | "return_entry" | "post_entry" | "reverse_entry" | "close_period", id: uuid(source.id, "El registro") };
  }
  throw new AccountingInputError("La operación contable solicitada no existe.");
}

export function accountingGroupLabel(code: string) {
  return ({
    "1": "Financiación y fondos",
    "2": "Bienes e inversiones",
    "3": "Existencias",
    "4": "Propietarios, proveedores y administraciones",
    "5": "Tesorería y financiación",
    "6": "Gastos",
    "7": "Ingresos",
    "8": "Gastos imputados al patrimonio",
    "9": "Ingresos imputados al patrimonio",
  } as Record<string, string>)[code.charAt(0)] ?? "Otras cuentas";
}

export function calculateAccountingMetrics(rows: Array<{ code: string; accountType: string; balance: string | number }>) {
  const balance = (predicate: (row: typeof rows[number]) => boolean) => rows.filter(predicate).reduce((total, row) => total + Number(row.balance), 0);
  const expenses = balance((row) => row.accountType === "expense");
  const income = -balance((row) => row.accountType === "income");
  return {
    bank: balance((row) => row.code === "570" || row.code === "572"),
    receivables: balance((row) => row.code === "430" || row.code === "431" || row.code === "436"),
    payables: -balance((row) => row.code === "400" || row.code === "410"),
    income,
    expenses,
    result: income - expenses,
  };
}
