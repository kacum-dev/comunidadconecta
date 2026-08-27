import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).default("");
const optionalEmail = z.union([z.literal(""), z.email("El correo electrónico no es válido.")]);
const optionalHttpsUrl = z.union([
  z.literal(""),
  z.url("La dirección web no es válida.").refine((value) => new URL(value).protocol === "https:", "La dirección debe comenzar por https://")
]);

export const communitySettingsSchema = z.object({
  name: z.string().trim().min(2, "Indica el nombre de la comunidad.").max(160),
  taxId: optionalText(40),
  address: z.string().trim().min(3, "Indica la dirección.").max(240),
  postalCode: optionalText(20),
  city: optionalText(120),
  province: optionalText(120),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "El país debe usar un código de dos letras."),
  phone: optionalText(40),
  contactEmail: optionalEmail,
  websiteUrl: optionalHttpsUrl,
  timezone: z.string().trim().min(1).max(80),
  locale: z.enum(["es-ES", "ca-ES", "eu-ES", "gl-ES", "en-GB"]),
  legalProfile: z.enum(["LPH_ESTATAL"])
}).superRefine((value, context) => {
  try {
    new Intl.DateTimeFormat("es-ES", { timeZone: value.timezone }).format();
  } catch {
    context.addIssue({ code: "custom", path: ["timezone"], message: "La zona horaria no es válida." });
  }
});

export const operationalSettingsSchema = z.object({
  officeHours: optionalText(300),
  timeFormat: z.enum(["24h", "12h"]),
  dateFormat: z.enum(["DD/MM/YYYY", "YYYY-MM-DD"]),
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "La moneda debe tener tres letras."),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  defaultDueDay: z.coerce.number().int().min(1).max(31),
  notificationsEmail: z.boolean(),
  notificationsPush: z.boolean(),
  accountingEnabled: z.boolean(),
  backupProvider: z.enum(["hosting", "s3", "disabled"]),
  backupFrequency: z.enum(["daily", "weekly", "monthly"]),
  backupTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "La hora no es válida."),
  backupRetentionDays: z.coerce.number().int().min(1).max(3650),
  backupNotificationEmail: optionalEmail
});

export const settingsUpdateSchema = z.object({
  community: communitySettingsSchema,
  preferences: operationalSettingsSchema
});

export const integrationInputSchema = z.object({
  name: z.string().trim().min(2, "Indica un nombre para la conexión.").max(120),
  kind: z.enum(["accounting", "banking", "storage", "calendar", "email", "weather", "payments", "signature", "ai", "ocr", "import", "push", "webhook", "other"]),
  provider: z.string().trim().min(2, "Indica el proveedor.").max(120),
  endpointUrl: optionalHttpsUrl,
  accountReference: optionalText(160),
  status: z.enum(["draft", "enabled", "paused"]),
  credential: z.string().trim().max(4096).optional()
});

export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
export type IntegrationInput = z.infer<typeof integrationInputSchema>;
