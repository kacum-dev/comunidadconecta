export interface ReservationRuleInput {
  now: Date;
  startsAt: Date;
  endsAt: Date;
  openingMinutes: number;
  closingMinutes: number;
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
  minNoticeHours: number;
  advanceDays: number;
  capacity: number;
  attendees: number;
}

export function validateReservationRules(input: ReservationRuleInput) {
  if (!Number.isInteger(input.attendees) || input.attendees < 1 || input.attendees > input.capacity) return "El aforo solicitado no es válido.";
  if (input.endsAt <= input.startsAt) return "La hora de fin debe ser posterior al inicio.";
  const noticeMs = input.startsAt.getTime() - input.now.getTime();
  if (noticeMs < input.minNoticeHours * 3_600_000) return "La reserva no cumple el preaviso mínimo.";
  if (noticeMs > input.advanceDays * 86_400_000) return "La reserva supera la antelación permitida.";
  const durationMinutes = (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000;
  if (durationMinutes < input.slotMinutes || durationMinutes % input.slotMinutes !== 0) return "La duración debe respetar los bloques del recurso.";
  if (input.endMinutes <= input.startMinutes) return "La reserva debe comenzar y terminar el mismo día.";
  if (input.startMinutes < input.openingMinutes || input.endMinutes > input.closingMinutes) return "La franja está fuera del horario disponible.";
  if ((input.startMinutes - input.openingMinutes) % input.slotMinutes !== 0) return "La hora de inicio debe coincidir con un bloque del recurso.";
  return null;
}
