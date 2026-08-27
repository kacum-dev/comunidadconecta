import { describe, expect, it } from "vitest";
import { integrationInputSchema, settingsUpdateSchema } from "../settings-input";

const validSettings = {
  community: {
    name: "Residencial Mirador", taxId: "H12345678", address: "Calle Mayor, 1",
    postalCode: "30001", city: "Murcia", province: "Murcia", countryCode: "es",
    phone: "+34 968 000 000", contactEmail: "administracion@example.test",
    websiteUrl: "https://example.test", timezone: "Europe/Madrid", locale: "es-ES",
    legalProfile: "LPH_ESTATAL"
  },
  preferences: {
    officeHours: "Lunes a viernes, de 09:00 a 14:00", timeFormat: "24h",
    dateFormat: "DD/MM/YYYY", currencyCode: "eur", fiscalYearStartMonth: 1,
    defaultDueDay: 10, notificationsEmail: true, notificationsPush: true, accountingEnabled: false,
    backupProvider: "hosting", backupFrequency: "daily", backupTime: "02:30",
    backupRetentionDays: 30, backupNotificationEmail: ""
  }
};

describe("settings input", () => {
  it("normalizes country and currency codes", () => {
    const parsed = settingsUpdateSchema.parse(validSettings);
    expect(parsed.community.countryCode).toBe("ES");
    expect(parsed.preferences.currencyCode).toBe("EUR");
  });

  it("rejects invalid timezones and backup times", () => {
    expect(settingsUpdateSchema.safeParse({
      ...validSettings,
      community: { ...validSettings.community, timezone: "Europe/Nowhere" }
    }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({
      ...validSettings,
      preferences: { ...validSettings.preferences, backupTime: "27:90" }
    }).success).toBe(false);
  });

  it("only accepts secure integration endpoints", () => {
    const base = { name: "Contabilidad", kind: "accounting", provider: "Proveedor", accountReference: "", status: "draft" };
    expect(integrationInputSchema.safeParse({ ...base, endpointUrl: "https://api.example.test" }).success).toBe(true);
    expect(integrationInputSchema.safeParse({ ...base, endpointUrl: "http://api.example.test" }).success).toBe(false);
  });

  it("accepts an AEMET weather integration", () => {
    expect(integrationInputSchema.safeParse({
      name: "Avisos oficiales",
      kind: "weather",
      provider: "AEMET",
      endpointUrl: "https://opendata.aemet.es",
      accountReference: "Murcia",
      status: "enabled",
      credential: "test-api-key"
    }).success).toBe(true);
  });
});
