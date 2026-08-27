import { describe, expect, it } from "vitest";
import { demoSessionInputSchema, demoSettingsInputSchema } from "./demo-input";

describe("demoSessionInputSchema", () => {
  it("acepta únicamente perfiles demo publicados", () => {
    expect(demoSessionInputSchema.parse({ role: "president" })).toEqual({ role: "president", accessCode: "" });
    expect(demoSessionInputSchema.safeParse({ role: "platform_admin" }).success).toBe(false);
  });

  it("limita el código compartido", () => {
    expect(demoSessionInputSchema.safeParse({ role: "owner", accessCode: "a".repeat(129) }).success).toBe(false);
  });
});

describe("demoSettingsInputSchema", () => {
  const valid = {
    enabled: true,
    title: "Explora Comunidad Conecta",
    description: "Prueba la aplicación con una comunidad completamente ficticia.",
    enabledRoles: ["president", "owner"] as const,
    sessionDurationMinutes: 60,
    expiresAt: "2026-09-01T10:00:00.000Z",
    accessCode: "demo-2026"
  };

  it("valida vigencia, perfiles y duración", () => {
    expect(demoSettingsInputSchema.safeParse(valid).success).toBe(true);
    expect(demoSettingsInputSchema.safeParse({ ...valid, enabledRoles: [] }).success).toBe(false);
    expect(demoSettingsInputSchema.safeParse({ ...valid, sessionDurationMinutes: 10 }).success).toBe(false);
  });

  it("permite retirar el código de acceso", () => {
    expect(demoSettingsInputSchema.safeParse({ ...valid, accessCode: null }).success).toBe(true);
  });
});
