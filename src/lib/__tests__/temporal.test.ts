import { describe, expect, it } from "vitest";
import {
  defaultTemporalPreferences,
  formatBusinessMoment,
  formatDateTime,
  precisionForLocalDateTime,
  toDateTimeLocal,
  zonedLocalDateTimeToIso
} from "../temporal";

const preferences = { ...defaultTemporalPreferences, timeZone: "Europe/Madrid" };

describe("business date and time semantics", () => {
  it("converts community-local winter and summer times to exact instants", () => {
    expect(zonedLocalDateTimeToIso("2026-01-21T23:59:59", "Europe/Madrid")).toBe("2026-01-21T22:59:59.000Z");
    expect(zonedLocalDateTimeToIso("2026-08-21T23:59:59", "Europe/Madrid")).toBe("2026-08-21T21:59:59.000Z");
  });

  it("rejects a local time that does not exist during the DST jump", () => {
    expect(zonedLocalDateTimeToIso("2026-03-29T02:30:00", "Europe/Madrid")).toBeNull();
  });

  it("round-trips an exact instant using the configured community timezone", () => {
    const instant = zonedLocalDateTimeToIso("2026-08-21T23:59:59", preferences.timeZone);
    expect(toDateTimeLocal(instant, preferences)).toBe("2026-08-21T23:59:59");
    expect(formatDateTime(instant!, preferences)).toBe("21/08/2026, 23:59:59");
  });

  it("does not invent a historical event time and explains inclusive day deadlines", () => {
    expect(formatBusinessMoment("2026-08-21T22:00:00.000Z", "day", preferences)).toBe("22/08/2026 · hora no registrada");
    expect(formatBusinessMoment("2026-08-21T21:59:59.000Z", "day", preferences, { deadline: true, inclusive: true })).toBe("21/08/2026 · hasta las 23:59:59 (incluido)");
  });

  it("retains second precision only when the user supplied meaningful seconds", () => {
    expect(precisionForLocalDateTime("2026-08-21T10:20:00")).toBe("minute");
    expect(precisionForLocalDateTime("2026-08-21T10:20:01")).toBe("second");
  });
});
