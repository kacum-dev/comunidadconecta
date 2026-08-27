import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCOUNTING_ACCOUNTS,
  accountingAmountToCents,
  automaticPostingRule,
  calculateAccountingMetrics,
  isAccountingDate,
  parseAccountingCommand,
} from "../accounting-domain";

const ids = {
  period: "16b1d6f8-2b42-4ddd-9c23-1d61a35eb8dc",
  journal: "31be58b3-bc63-435b-a874-b8b2571bfb92",
  debit: "f16d8d38-fcab-4bfa-b143-0327eced440c",
  credit: "67dce304-5734-459c-8937-b26a8c6093bc",
};

describe("catálogo contable adaptado", () => {
  it("incluye un catálogo amplio sin códigos ni claves de sistema duplicados", () => {
    const codes = DEFAULT_ACCOUNTING_ACCOUNTS.map((account) => account.code);
    const systemKeys = DEFAULT_ACCOUNTING_ACCOUNTS.map((account) => account.systemKey).filter(Boolean);
    expect(DEFAULT_ACCOUNTING_ACCOUNTS.length).toBeGreaterThanOrEqual(80);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(systemKeys).size).toBe(systemKeys.length);
    expect(codes).toEqual(expect.arrayContaining(["1141", "430", "572", "622", "705", "706"]));
  });
});

describe("contabilización automática", () => {
  it("asigna cobros, derramas y facturas a cuentas previsibles", () => {
    expect(automaticPostingRule("charge")).toMatchObject({ debitCode: "572", creditCode: "705" });
    expect(automaticPostingRule("assessment")).toMatchObject({ debitCode: "572", creditCode: "706" });
    expect(automaticPostingRule("invoice")).toMatchObject({ debitCode: "629", creditCode: "572" });
    expect(automaticPostingRule("budget")).toBeNull();
  });
});

describe("validación de comandos contables", () => {
  it("normaliza un asiento cuadrado a céntimos", () => {
    const command = parseAccountingCommand({
      action: "create_entry",
      periodId: ids.period,
      journalId: ids.journal,
      entryDate: "2026-08-16",
      concept: "Factura de mantenimiento",
      reference: "F-2026-18",
      lines: [
        { accountId: ids.debit, description: "Conservación", debit: 121, credit: 0 },
        { accountId: ids.credit, description: "Proveedor", debit: 0, credit: 121 },
      ],
    });
    expect(command.action).toBe("create_entry");
    if (command.action !== "create_entry") throw new Error("Comando inesperado");
    expect(command.debitCents).toBe(12_100);
    expect(command.creditCents).toBe(12_100);
    expect(command.lines[0].debitCents).toBe(12_100);
  });

  it("rechaza asientos descuadrados, fechas imposibles e importes con más de dos decimales", () => {
    expect(() => parseAccountingCommand({
      action: "create_entry",
      periodId: ids.period,
      journalId: ids.journal,
      entryDate: "2026-02-30",
      concept: "Asiento incorrecto",
      lines: [
        { accountId: ids.debit, debit: 10, credit: 0 },
        { accountId: ids.credit, debit: 0, credit: 9 },
      ],
    })).toThrow();
    expect(() => accountingAmountToCents(10.123)).toThrow(/dos decimales/);
    expect(isAccountingDate("2028-02-29")).toBe(true);
    expect(isAccountingDate("2027-02-29")).toBe(false);
  });

  it("impide ejercicios invertidos y códigos que empiezan por cero", () => {
    expect(() => parseAccountingCommand({ action: "create_period", name: "Ejercicio", startsOn: "2027-12-31", endsOn: "2027-01-01" })).toThrow(/posterior/);
    expect(() => parseAccountingCommand({ action: "create_account", code: "0622", name: "Cuenta", accountType: "expense", normalSide: "debit" })).toThrow(/empezar por cero/);
  });
});

describe("métricas contables", () => {
  it("presenta ingresos, gastos, cobros pendientes y proveedores con signo comprensible", () => {
    const metrics = calculateAccountingMetrics([
      { code: "572", accountType: "asset", balance: 2_500 },
      { code: "430", accountType: "asset", balance: 800 },
      { code: "400", accountType: "liability", balance: -300 },
      { code: "622", accountType: "expense", balance: 1_200 },
      { code: "705", accountType: "income", balance: -2_000 },
    ]);
    expect(metrics).toEqual({ bank: 2_500, receivables: 800, payables: 300, income: 2_000, expenses: 1_200, result: 800 });
  });
});
