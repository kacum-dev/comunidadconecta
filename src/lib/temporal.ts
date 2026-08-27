export type TemporalPrecision = "day" | "minute" | "second";

export interface TemporalPreferences {
  locale: string;
  timeZone: string;
  dateFormat: "DD/MM/YYYY" | "YYYY-MM-DD";
  timeFormat: "24h" | "12h";
}

export const defaultTemporalPreferences: TemporalPreferences = {
  locale: "es-ES",
  timeZone: "Europe/Madrid",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h"
};

function validDate(value: string | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function partsFor(value: Date, preferences: TemporalPreferences) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: preferences.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
}

export function formatCalendarDate(value: string | Date, preferences: TemporalPreferences) {
  const parsed = validDate(value);
  if (!parsed) return "Fecha no válida";
  const parts = partsFor(parsed, preferences);
  return preferences.dateFormat === "YYYY-MM-DD"
    ? `${parts.year}-${parts.month}-${parts.day}`
    : `${parts.day}/${parts.month}/${parts.year}`;
}

export function formatDateTime(value: string | Date, preferences: TemporalPreferences, includeSeconds = true) {
  const parsed = validDate(value);
  if (!parsed) return "Fecha y hora no válidas";
  const date = formatCalendarDate(parsed, preferences);
  const time = new Intl.DateTimeFormat(preferences.locale || "es-ES", {
    timeZone: preferences.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
    hour12: preferences.timeFormat === "12h"
  }).format(parsed);
  return `${date}, ${time}`;
}

export function formatBusinessMoment(
  value: string | null | undefined,
  precision: TemporalPrecision | null | undefined,
  preferences: TemporalPreferences,
  options: { deadline?: boolean; inclusive?: boolean } = {}
) {
  if (!value) return "No especificada";
  if (precision === "day") {
    const date = formatCalendarDate(value, preferences);
    if (options.deadline && options.inclusive === false) return `${date} · hora límite no registrada · excluido`;
    if (options.deadline) return `${date} · hasta las 23:59:59 (incluido)`;
    return `${date} · hora no registrada`;
  }
  const formatted = formatDateTime(value, preferences, options.deadline || precision === "second");
  if (options.deadline) return `${formatted} · ${options.inclusive === false ? "excluido" : "incluido"}`;
  return formatted;
}

export function temporalZoneNote(preferences: TemporalPreferences) {
  return `Horas expresadas en ${preferences.timeZone}`;
}

export function toDateTimeLocal(value: string | Date | null | undefined, preferences: TemporalPreferences) {
  if (!value) return "";
  const parsed = validDate(value);
  if (!parsed) return "";
  const parts = partsFor(parsed, preferences);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function zonedLocalDateTimeToIso(value: string, timeZone: string) {
  const match = value.match(localDateTimePattern);
  if (!match) return null;
  const desired = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? "0")
  };
  if (desired.month < 1 || desired.month > 12 || desired.day < 1 || desired.day > 31 || desired.hour > 23 || desired.minute > 59 || desired.second > 59) return null;
  const desiredUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute, desired.second);
  let candidate = desiredUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = partsFor(new Date(candidate), { ...defaultTemporalPreferences, timeZone });
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const difference = desiredUtc - represented;
    candidate += difference;
    if (difference === 0) break;
  }
  const verified = partsFor(new Date(candidate), { ...defaultTemporalPreferences, timeZone });
  if (
    Number(verified.year) !== desired.year || Number(verified.month) !== desired.month || Number(verified.day) !== desired.day ||
    Number(verified.hour) !== desired.hour || Number(verified.minute) !== desired.minute || Number(verified.second) !== desired.second
  ) return null;
  return new Date(candidate).toISOString();
}

export function precisionForLocalDateTime(value: string): TemporalPrecision {
  return /:\d{2}:\d{2}$/.test(value) && !value.endsWith(":00") ? "second" : "minute";
}
