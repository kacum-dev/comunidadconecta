import { describe, expect, it } from "vitest";
import { validateReservationRules } from "../reservation-domain";

const base = {
  now: new Date("2026-08-10T10:00:00"),
  startsAt: new Date("2026-08-11T10:00:00"),
  endsAt: new Date("2026-08-11T11:00:00"),
  openingMinutes: 8 * 60,
  closingMinutes: 22 * 60,
  startMinutes: 10 * 60,
  endMinutes: 11 * 60,
  slotMinutes: 60,
  minNoticeHours: 2,
  advanceDays: 30,
  capacity: 10,
  attendees: 4,
};

describe("reservation rules", () => {
  it("acepta una franja válida", () => expect(validateReservationRules(base)).toBeNull());
  it("bloquea exceso de aforo", () => expect(validateReservationRules({ ...base, attendees: 11 })).toMatch(/aforo/));
  it("bloquea duraciones fuera de bloque", () => expect(validateReservationRules({ ...base, endsAt: new Date("2026-08-11T10:30:00") })).toMatch(/bloques/));
  it("bloquea reservas sin preaviso", () => expect(validateReservationRules({ ...base, startsAt: new Date("2026-08-10T11:00:00"), endsAt: new Date("2026-08-10T12:00:00") })).toMatch(/preaviso/));
  it("bloquea inicios fuera de la cuadrícula de bloques", () => expect(validateReservationRules({ ...base, startMinutes: 10 * 60 + 30, endMinutes: 11 * 60 + 30 })).toMatch(/inicio/));
  it("exige un número entero de asistentes", () => expect(validateReservationRules({ ...base, attendees: 1.5 })).toMatch(/aforo/));
  it("impide que una reserva atraviese la medianoche", () => expect(validateReservationRules({ ...base, startMinutes: 21 * 60, endMinutes: 9 * 60 })).toMatch(/mismo día/));
});
