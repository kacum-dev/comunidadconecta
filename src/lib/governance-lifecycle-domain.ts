import { defaultTemporalPreferences, toDateTimeLocal, zonedLocalDateTimeToIso, type TemporalPrecision } from "./temporal";

export const legalMilestoneKeys = [
  "call_issued",
  "notices_completed",
  "meeting_held",
  "minutes_closed",
  "minutes_notified",
  "records_archived"
] as const;

export type LegalMilestoneKey = typeof legalMilestoneKeys[number];
export type LifecycleStatus = "complete" | "pending" | "attention" | "blocked" | "not_applicable";

export interface LegalEventFact {
  key: LegalMilestoneKey;
  occurredAt: string;
  timePrecision: "minute" | "second";
  evidenceReference: string;
  note: string | null;
  version: number;
}

export interface MeetingLifecycleFacts {
  meetingId: string;
  kind: string;
  meetingStatus: string;
  eventAt: string | null;
  eventTimePrecision: TemporalPrecision | null;
  location: string | null;
  legalRuleset: string;
  convenerName: string | null;
  sessionCall: "first" | "second" | "universal";
  secondCallAt: string | null;
  secondCallTimePrecision: "minute" | "second" | null;
  activeUnits: number;
  agendaCount: number;
  finalAgendaCount: number;
  approvedAgendaCount: number;
  attendanceCount: number;
  agreementCount: number;
  completedAgreementCount: number;
  events: LegalEventFact[];
  timeZone: string;
  now?: string;
}

export interface MeetingLifecycleMilestone {
  key: string;
  title: string;
  description: string;
  legalSource: string;
  status: LifecycleStatus;
  automatic: boolean;
  completedAt: string | null;
  completedTimePrecision: TemporalPrecision | null;
  dueAt: string | null;
  dueTimePrecision: "second" | null;
  evidenceReference: string | null;
  note: string | null;
  version: number;
  actionKey: LegalMilestoneKey | null;
}

export interface MeetingLifecycleResult {
  ruleset: string;
  phase: "preparation" | "notice" | "meeting" | "minutes" | "communication" | "complete";
  phaseLabel: string;
  overallStatus: "pending" | "attention" | "complete";
  completed: number;
  total: number;
  progress: number;
  nextTitle: string | null;
  configuration: {
    convenerName: string;
    sessionCall: "first" | "second" | "universal";
    secondCallAt: string | null;
    secondCallTimePrecision: "minute" | "second" | null;
    complete: boolean;
  };
  milestones: MeetingLifecycleMilestone[];
}

function shiftCalendarDays(value: string, days: number, timeZone: string) {
  const local = toDateTimeLocal(value, { ...defaultTemporalPreferences, timeZone });
  if (!local) return null;
  const match = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const shifted = new Date(Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days,
    Number(match[4]), Number(match[5]), Number(match[6])
  ));
  const localShifted = `${shifted.getUTCFullYear().toString().padStart(4, "0")}-${(shifted.getUTCMonth() + 1).toString().padStart(2, "0")}-${shifted.getUTCDate().toString().padStart(2, "0")}T${shifted.getUTCHours().toString().padStart(2, "0")}:${shifted.getUTCMinutes().toString().padStart(2, "0")}:${shifted.getUTCSeconds().toString().padStart(2, "0")}`;
  return zonedLocalDateTimeToIso(localShifted, timeZone);
}

function eventMap(events: LegalEventFact[]) {
  return new Map(events.map((event) => [event.key, event]));
}

function manualMilestone(
  key: LegalMilestoneKey,
  title: string,
  description: string,
  legalSource: string,
  event: LegalEventFact | undefined,
  options: { dueAt?: string | null; blocked?: boolean; attention?: boolean; notApplicable?: boolean; now?: string } = {}
): MeetingLifecycleMilestone {
  const status: LifecycleStatus = options.notApplicable ? "not_applicable"
    : options.blocked && !event ? "blocked"
      : event ? options.attention ? "attention" : "complete"
        : options.dueAt && new Date(options.dueAt).getTime() < new Date(options.now ?? Date.now()).getTime() ? "attention" : "pending";
  return {
    key, title, description, legalSource, status, automatic: false,
    completedAt: event?.occurredAt ?? null,
    completedTimePrecision: event?.timePrecision ?? null,
    dueAt: options.dueAt ?? null,
    dueTimePrecision: options.dueAt ? "second" : null,
    evidenceReference: event?.evidenceReference ?? null,
    note: event?.note ?? null,
    version: event?.version ?? 0,
    actionKey: options.notApplicable ? null : key
  };
}

function automaticMilestone(
  key: string,
  title: string,
  description: string,
  legalSource: string,
  status: LifecycleStatus
): MeetingLifecycleMilestone {
  return {
    key, title, description, legalSource, status, automatic: true,
    completedAt: null, completedTimePrecision: null, dueAt: null, dueTimePrecision: null,
    evidenceReference: null, note: null, version: 0, actionKey: null
  };
}

export function buildMeetingLifecycle(facts: MeetingLifecycleFacts): MeetingLifecycleResult {
  const now = facts.now ?? new Date().toISOString();
  const events = eventMap(facts.events);
  const universal = facts.sessionCall === "universal";
  const scheduledAt = facts.sessionCall === "second" ? facts.secondCallAt
    : facts.eventTimePrecision && facts.eventTimePrecision !== "day" ? facts.eventAt : null;
  const configurationComplete = Boolean(
    facts.eventAt && facts.eventTimePrecision && facts.eventTimePrecision !== "day"
      && facts.location?.trim() && facts.convenerName?.trim()
      && (facts.sessionCall !== "second" || facts.secondCallAt)
  );
  const detailsStatus: LifecycleStatus = configurationComplete ? "complete" : "pending";
  const agendaStatus: LifecycleStatus = facts.agendaCount > 0 ? "complete" : "pending";
  const call = events.get("call_issued");
  const callDueAt = !universal && facts.kind === "ordinary" && scheduledAt
    ? shiftCalendarDays(scheduledAt, -6, facts.timeZone)
    : null;
  const callLate = Boolean(call && ((callDueAt && new Date(call.occurredAt).getTime() > new Date(callDueAt).getTime())
    || (scheduledAt && new Date(call.occurredAt).getTime() > new Date(scheduledAt).getTime())));
  const notices = events.get("notices_completed");
  const noticesLate = Boolean(notices && ((scheduledAt && new Date(notices.occurredAt).getTime() > new Date(scheduledAt).getTime())
    || (call && new Date(notices.occurredAt).getTime() < new Date(call.occurredAt).getTime())));
  const held = events.get("meeting_held");
  const heldInvalid = Boolean(held && !universal && notices && new Date(held.occurredAt).getTime() < new Date(notices.occurredAt).getTime());
  const attendanceComplete = Boolean(held && facts.activeUnits > 0 && facts.attendanceCount === facts.activeUnits);
  const resultsComplete = facts.agendaCount > 0
    && facts.finalAgendaCount === facts.agendaCount
    && facts.agreementCount >= facts.approvedAgendaCount;
  const minutes = events.get("minutes_closed");
  const minutesDueAt = held ? shiftCalendarDays(held.occurredAt, 10, facts.timeZone) : null;
  const minutesLate = Boolean(minutes && ((minutesDueAt && new Date(minutes.occurredAt).getTime() > new Date(minutesDueAt).getTime())
    || (held && new Date(minutes.occurredAt).getTime() < new Date(held.occurredAt).getTime())));
  const minutesNotice = events.get("minutes_notified");
  const minutesNoticeInvalid = Boolean(minutesNotice && minutes && new Date(minutesNotice.occurredAt).getTime() < new Date(minutes.occurredAt).getTime());
  const archived = events.get("records_archived");
  const archivedInvalid = Boolean(archived && minutesNotice && new Date(archived.occurredAt).getTime() < new Date(minutesNotice.occurredAt).getTime());
  const executionStatus: LifecycleStatus = facts.agreementCount === 0 ? "not_applicable"
    : facts.completedAgreementCount === facts.agreementCount ? "complete" : "pending";

  const milestones: MeetingLifecycleMilestone[] = [
    automaticMilestone(
      "meeting_defined", "Datos legales de la reunión",
      "Fecha, hora, lugar o modalidad, autor de la convocatoria y convocatoria de celebración.",
      "LPH art. 16.2 y 19.2", detailsStatus
    ),
    automaticMilestone(
      "agenda_ready", "Orden del día preparado",
      "Todos los asuntos que se someterán a deliberación deben quedar identificados antes de emitir la convocatoria.",
      "LPH art. 16.2", agendaStatus
    ),
    manualMilestone(
      "call_issued", "Convocatoria emitida",
      universal ? "No se exige convocatoria previa si asiste la totalidad de propietarios y así lo decide."
        : facts.kind === "ordinary" ? "La referencia automática exige al menos seis días naturales de antelación."
          : "En una junta extraordinaria debe existir tiempo suficiente para que llegue a conocimiento de todos.",
      "LPH art. 16.2 y 16.3", call,
      { dueAt: callDueAt, blocked: !configurationComplete || facts.agendaCount === 0, attention: callLate, notApplicable: universal, now }
    ),
    manualMilestone(
      "notices_completed", "Citaciones practicadas",
      universal ? "Hito no aplicable a una junta universal."
        : "Registra la entrega o el intento y la evidencia del canal utilizado para convocar a los propietarios.",
      "LPH art. 9.1.h y 16.2", notices,
      { blocked: !call, attention: noticesLate, notApplicable: universal, now }
    ),
    manualMilestone(
      "meeting_held", "Junta celebrada",
      "Confirma el instante real de celebración y si tuvo lugar en primera, segunda o convocatoria universal.",
      "LPH art. 16", held,
      { blocked: universal ? !configurationComplete : !notices, attention: heldInvalid, now }
    ),
    automaticMilestone(
      "attendance_recorded", "Asistencia y representación registradas",
      "El censo conserva unidades presentes, representadas y ausentes con su coeficiente.",
      "LPH art. 15 y 19.2.d", held ? attendanceComplete ? "complete" : "attention" : "blocked"
    ),
    automaticMilestone(
      "resolutions_recorded", "Votaciones y acuerdos documentados",
      "Cada punto debe tener un resultado definitivo y cada aprobación, un acuerdo trazable.",
      "LPH art. 17 y 19.2.f", held ? resultsComplete ? "complete" : "attention" : "blocked"
    ),
    manualMilestone(
      "minutes_closed", "Acta firmada y cerrada",
      "Debe cerrarse con las firmas de presidencia y secretaría al terminar o dentro de los diez días naturales siguientes.",
      "LPH art. 19.2 y 19.3", minutes,
      { dueAt: minutesDueAt, blocked: !held || !attendanceComplete || !resultsComplete, attention: minutesLate, now }
    ),
    manualMilestone(
      "minutes_notified", "Acta comunicada a propietarios",
      "Registra la remisión del acta y la referencia que acredita la comunicación.",
      "LPH art. 19.3 en relación con el art. 9", minutesNotice,
      { blocked: !minutes, attention: minutesNoticeInvalid, now }
    ),
    manualMilestone(
      "records_archived", "Expediente preservado",
      "Convocatorias, comunicaciones, apoderamientos y documentos relevantes deben conservarse durante cinco años.",
      "LPH art. 19.4", archived,
      { blocked: !minutesNotice, attention: archivedInvalid, now }
    ),
    automaticMilestone(
      "agreements_execution", "Ejecución de acuerdos",
      facts.agreementCount === 0 ? "No hay acuerdos ejecutables asociados."
        : `${facts.completedAgreementCount} de ${facts.agreementCount} acuerdos constan completados.`,
      "Seguimiento operativo posterior", executionStatus
    )
  ];

  const counted = milestones.filter((item) => item.status !== "not_applicable");
  const completed = counted.filter((item) => item.status === "complete").length;
  const attention = counted.some((item) => item.status === "attention");
  const next = milestones.find((item) => item.status === "attention" || item.status === "pending" || item.status === "blocked");
  const phase = !call && !universal ? "preparation"
    : !notices && !universal ? "notice"
      : !held ? "meeting"
        : !minutes ? "minutes"
          : !minutesNotice ? "communication"
            : "complete";
  const labels = {
    preparation: "Preparación", notice: "Convocatoria y citaciones", meeting: "Celebración",
    minutes: "Acta", communication: "Comunicación", complete: "Expediente completado"
  } as const;
  return {
    ruleset: facts.legalRuleset,
    phase,
    phaseLabel: labels[phase],
    overallStatus: attention ? "attention" : completed === counted.length ? "complete" : "pending",
    completed,
    total: counted.length,
    progress: counted.length ? Math.round((completed / counted.length) * 100) : 0,
    nextTitle: next?.title ?? null,
    configuration: {
      convenerName: facts.convenerName ?? "",
      sessionCall: facts.sessionCall,
      secondCallAt: facts.secondCallAt,
      secondCallTimePrecision: facts.secondCallTimePrecision,
      complete: configurationComplete
    },
    milestones
  };
}
