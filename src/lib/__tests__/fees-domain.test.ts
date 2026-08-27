import { describe, expect, it } from "vitest";
import { allocateFees, buildFeeOccurrencePlan } from "../fees-domain";
const units = [{ id: "a", code: "1A", coefficient: 40, fixedCents: null }, { id: "b", code: "1B", coefficient: 60, fixedCents: null }];
describe("fee allocation", () => {
  it("mantiene exactamente el total y explica el cálculo", () => {
    const result = allocateFees(10_001, units, "coefficient");
    expect(result.map((line) => line.amountCents)).toEqual([4000, 6001]);
    expect(result.reduce((sum, line) => sum + line.amountCents, 0)).toBe(10_001);
    expect(result[0].explanation).toMatch(/Coeficiente/);
  });
  it("reparte por partes iguales con redondeo determinista", () => {
    const result = allocateFees(100, [...units, { id: "c", code: "1C", coefficient: 0, fixedCents: null }], "equal");
    expect(result.map((line) => line.amountCents)).toEqual([34, 33, 33]);
  });
  it("respeta las cuotas fijas y reparte solo el resto por coeficiente", () => {
    const result = allocateFees(30_000, [
      { id: "a", code: "1A", coefficient: 10, fixedCents: 8_650 },
      { id: "b", code: "1B", coefficient: 60, fixedCents: null },
      { id: "c", code: "1C", coefficient: 40, fixedCents: null },
    ], "unit_settings");
    expect(result.map((line) => line.amountCents)).toEqual([8_650, 12_810, 8_540]);
    expect(result.reduce((sum, line) => sum + line.amountCents, 0)).toBe(30_000);
  });
  it("rechaza cuotas fijas que superan el total", () => {
    expect(() => allocateFees(5_000, [{ id: "a", code: "1A", coefficient: 10, fixedCents: 5_001 }], "unit_settings")).toThrow(/superan/);
  });
});

describe("fee recurrence", () => {
  it("mantiene el día original cuando un mes corto obliga a ajustarlo", () => {
    const plan = buildFeeOccurrencePlan("2027-01-31T23:59:59", "monthly", 10, null, 3);
    expect(plan.map((item) => item.dueLocal)).toEqual([
      "2027-01-31T23:59:59",
      "2027-02-28T23:59:59",
      "2027-03-31T23:59:59"
    ]);
    expect(plan[1].issueLocal).toBe("2027-02-18T23:59:59");
  });

  it("respeta la fecha final y las frecuencias trimestrales", () => {
    const plan = buildFeeOccurrencePlan("2026-01-15T10:30:00", "quarterly", 5, "2026-08-01", 12);
    expect(plan.map((item) => item.dueLocal.slice(0, 10))).toEqual(["2026-01-15", "2026-04-15", "2026-07-15"]);
  });
});
