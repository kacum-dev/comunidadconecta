import { describe, expect, it } from "vitest";
import {
  allocationStatus,
  financialStatusAfterReversal,
  moneyToCents,
  normalizeBankDate,
  parseBankCsv,
  parseBankStatement,
  parseNorma43,
  reconciliationScore
} from "../finance-domain";

function fixedRecord(code: string, parts: Array<[number, string]>) {
  const characters = Array.from({ length: 80 }, () => " ");
  characters[0] = code[0];
  characters[1] = code[1];
  for (const [start, value] of parts) value.split("").forEach((character, offset) => { characters[start] = characters[start] ?? " "; characters[start + offset] = character; });
  return characters.join("");
}

describe("finance domain", () => {
  it("reads Spanish and international monetary formats", () => {
    expect(moneyToCents("1.234,56 €")).toBe(123456);
    expect(moneyToCents("-42,10")).toBe(-4210);
    expect(moneyToCents("42.10")).toBe(4210);
  });

  it("normalizes real calendar dates", () => {
    expect(normalizeBankDate("13/08/2026")).toBe("2026-08-13");
    expect(() => normalizeBankDate("31/02/2026")).toThrow();
  });

  it("parses semicolon CSV and reports invalid rows without losing valid ones", () => {
    const result = parseBankCsv([
      "Fecha;Concepto;Importe;Referencia;Ordenante",
      "13/08/2026;Cuota 1 A;86,50;REC-081;Ana Torres",
      "fecha rota;Otro;10,00;;"
    ].join("\n"));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ amountCents: 8650, reference: "REC-081" });
    expect(result.errors).toEqual([{ row: 3, message: "La fecha no tiene un formato válido." }]);
  });

  it("parses fixed-width Norma 43 movements and complementary concepts", () => {
    const content = [
      fixedRecord("11", [[2, "1234"], [6, "5678"], [10, "0000000123"], [20, "260801"], [26, "260831"]]),
      fixedRecord("22", [[10, "260813"], [16, "260813"], [22, "03"], [24, "001"], [27, "2"], [28, "00000000008650"], [42, "0000000081"], [52, "REC081      "], [64, "ANA TORRES      "]]),
      fixedRecord("23", [[2, "01"], [4, "CUOTA AGOSTO 1 A"], [42, "COMUNIDAD MIRADOR"]]),
      fixedRecord("33", [])
    ].join("\n");
    const result = parseNorma43(content);
    expect(result.format).toBe("norma43");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ date: "2026-08-13", amountCents: 8650 });
    expect(result.rows[0].description).toContain("CUOTA AGOSTO 1 A");
    expect(result.rows[0].reference).toContain("REC081");
  });

  it("detects Norma 43 in a txt export", () => {
    const header = fixedRecord("11", [[2, "1234"], [6, "5678"], [10, "0000000123"]]);
    const movement = fixedRecord("22", [[10, "260813"], [16, "260813"], [22, "04"], [24, "001"], [27, "1"], [28, "00000000001000"]]);
    expect(parseBankStatement("extracto.txt", `${header}\n${movement}\n${fixedRecord("33", [])}`).rows[0].amountCents).toBe(-1000);
  });

  it("scores exact amount, nearby date and shared reference highly", () => {
    const match = reconciliationScore({ bankAmountCents: 8650, bankDate: "2026-08-10", bankText: "Ingreso REC 081 Ana Torres", recordAmountCents: 8650, recordDate: "2026-08-08", recordText: "Recibo REC 081 Ana Torres" });
    expect(match.score).toBeGreaterThanOrEqual(90);
    expect(match.reasons).toContain("importe exacto");
  });

  it("distinguishes partial and complete allocations", () => {
    expect(allocationStatus(10000, 0)).toBe("unmatched");
    expect(allocationStatus(10000, 5000)).toBe("suggested");
    expect(allocationStatus(-10000, 10000)).toBe("matched");
  });

  it("keeps a receipt paid if other reconciliations still cover it", () => {
    expect(financialStatusAfterReversal(10_000, 10_000, "issued")).toBe("paid");
    expect(financialStatusAfterReversal(10_000, 7_500, "issued")).toBe("issued");
  });
});
