import { describe, expect, it } from "vitest";
import { can, canManageSettings, needsResidentUnitScope, type Role } from "../permissions";
import { moduleKeys } from "../modules";

describe("permissions", () => {
  it("denies unknown combinations by default", () => {
    expect(can("resident", "bancos", "read")).toBe(false);
    expect(can("supplier", "censo", "read")).toBe(false);
    expect(can("support", "economia", "read")).toBe(false);
  });

  it("does not let residents archive shared records", () => {
    expect(can("resident", "incidencias", "write")).toBe(true);
    expect(can("resident", "incidencias", "archive")).toBe(false);
  });

  it("keeps audit events immutable for every business role", () => {
    const roles: Role[] = ["president", "vice_president", "secretary", "treasurer", "administrator", "platform_admin", "auditor"];
    for (const role of roles) {
      expect(can(role, "auditoria", "write")).toBe(false);
      expect(can(role, "auditoria", "archive")).toBe(false);
    }
  });

  it("gives administrators explicit access to every module", () => {
    for (const moduleKey of moduleKeys) expect(can("administrator", moduleKey, "read")).toBe(true);
  });

  it("separates governance, treasury and administration decisions", () => {
    expect(can("president", "aprobaciones", "approve")).toBe(true);
    expect(can("vice_president", "aprobaciones", "approve")).toBe(false);
    expect(can("administrator", "aprobaciones", "approve")).toBe(false);
    expect(can("treasurer", "economia", "write")).toBe(true);
    expect(can("treasurer", "censo", "write")).toBe(false);
  });

  it("keeps tenant finances private while owners can read their scoped economy", () => {
    expect(can("owner", "economia", "read")).toBe(true);
    expect(can("resident", "economia", "read")).toBe(false);
  });

  it("reserves application settings for administrators", () => {
    expect(canManageSettings("administrator")).toBe(true);
    expect(canManageSettings("platform_admin")).toBe(true);
    expect(canManageSettings("president")).toBe(false);
    expect(canManageSettings("treasurer")).toBe(false);
  });

  it("only adds unit-scoping parameters to resident queries that use them", () => {
    expect(needsResidentUnitScope("owner", "economia")).toBe(true);
    expect(needsResidentUnitScope("resident", "incidencias")).toBe(true);
    expect(needsResidentUnitScope("resident", "documentos")).toBe(true);
    expect(needsResidentUnitScope("resident", "reservas")).toBe(true);
    expect(needsResidentUnitScope("owner", "avisos")).toBe(false);
    expect(needsResidentUnitScope("owner", "juntas")).toBe(false);
    expect(needsResidentUnitScope("resident", "activos")).toBe(false);
  });
});
