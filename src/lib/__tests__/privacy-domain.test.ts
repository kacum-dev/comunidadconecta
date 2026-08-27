import { describe, expect, it } from "vitest";
import { breachDeadline, breachRequiresAuthority, breachRequiresSubjects, rightsDeadline } from "../privacy-domain";

describe("privacy deadlines", () => {
  it("calcula un mes para derechos", () => expect(rightsDeadline(new Date("2026-01-15T10:00:00Z")).toISOString()).toBe("2026-02-15T10:00:00.000Z"));
  it("ajusta el fin de mes sin saltar a marzo", () => expect(rightsDeadline(new Date("2026-01-31T10:00:00Z")).toISOString()).toBe("2026-02-28T10:00:00.000Z"));
  it("calcula 72 horas desde conocimiento", () => expect(breachDeadline(new Date("2026-08-10T10:00:00Z")).toISOString()).toBe("2026-08-13T10:00:00.000Z"));
  it("distingue notificación a autoridad y afectados", () => {
    expect(breachRequiresAuthority("risk")).toBe(true);
    expect(breachRequiresSubjects("risk")).toBe(false);
    expect(breachRequiresSubjects("high_risk")).toBe(true);
  });
});
