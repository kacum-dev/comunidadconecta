import { describe, expect, it } from "vitest";
import {
  detectImportFormat,
  digitalCapabilities,
  isValidPgcAccount,
  isValidSpanishIban,
  resolveCapabilityState
} from "../digital-services-domain";

describe("digital services catalog", () => {
  it("keeps the eight roadmap capabilities explicit and unique", () => {
    expect(digitalCapabilities).toHaveLength(8);
    expect(new Set(digitalCapabilities.map((capability) => capability.key)).size).toBe(8);
  });

  it("only marks a provider-backed capability active when its connector is enabled", () => {
    const payments = digitalCapabilities.find((capability) => capability.key === "payments");
    expect(payments).toBeDefined();
    expect(resolveCapabilityState(payments!, [{ kind: "payments", status: "draft" }])).toBe("ready");
    expect(resolveCapabilityState(payments!, [{ kind: "payments", status: "enabled" }])).toBe("active");
  });

  it("keeps the native notification layer visibly planned", () => {
    const push = digitalCapabilities.find((capability) => capability.key === "push");
    expect(resolveCapabilityState(push!, [])).toBe("planned");
  });
});

describe("migration intake", () => {
  it("detects the supported source formats", () => {
    expect(detectImportFormat("propietarios.xlsx")).toBe("excel");
    expect(detectImportFormat("extracto.txt", "1120250814")).toBe("norma43");
    expect(detectImportFormat("exportacion-gesfincas.csv")).toBe("gesfincas");
    expect(detectImportFormat("remesa.xml", "<?xml version=\"1.0\"?><Document />")).toBe("sepa_xml");
  });

  it("validates PGC accounts and Spanish IBANs before importing", () => {
    expect(isValidPgcAccount("4300001")).toBe(true);
    expect(isValidPgcAccount("04-30")).toBe(false);
    expect(isValidSpanishIban("ES91 2100 0418 4502 0005 1332")).toBe(true);
    expect(isValidSpanishIban("ES00 2100 0418 4502 0005 1332")).toBe(false);
  });
});
