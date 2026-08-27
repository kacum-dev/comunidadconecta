import { describe, expect, it } from "vitest";
import { buildMeetingLifecycle, type LegalEventFact, type MeetingLifecycleFacts } from "../governance-lifecycle-domain";

const event = (key: LegalEventFact["key"], occurredAt: string, version = 1): LegalEventFact => ({
  key, occurredAt, timePrecision: "second", evidenceReference: `EVID-${key}`, note: null, version
});

function facts(overrides: Partial<MeetingLifecycleFacts> = {}): MeetingLifecycleFacts {
  return {
    meetingId: "meeting-1",
    kind: "ordinary",
    meetingStatus: "called",
    eventAt: "2026-09-18T16:00:00.000Z",
    eventTimePrecision: "second",
    location: "Sala comunitaria",
    legalRuleset: "LPH_ES_2026_03",
    convenerName: "Presidencia",
    sessionCall: "first",
    secondCallAt: null,
    secondCallTimePrecision: null,
    activeUnits: 10,
    agendaCount: 2,
    finalAgendaCount: 2,
    approvedAgendaCount: 1,
    attendanceCount: 10,
    agreementCount: 1,
    completedAgreementCount: 1,
    events: [
      event("call_issued", "2026-09-12T15:59:59.000Z"),
      event("notices_completed", "2026-09-12T16:30:00.000Z"),
      event("meeting_held", "2026-09-18T16:05:00.000Z"),
      event("minutes_closed", "2026-09-25T10:00:00.000Z"),
      event("minutes_notified", "2026-09-25T12:00:00.000Z"),
      event("records_archived", "2026-09-25T12:05:00.000Z")
    ],
    timeZone: "Europe/Madrid",
    now: "2026-09-26T10:00:00.000Z",
    ...overrides
  };
}

describe("ciclo legal de juntas", () => {
  it("completa automáticamente los hitos respaldados por datos y evidencias", () => {
    const lifecycle = buildMeetingLifecycle(facts());
    expect(lifecycle.overallStatus).toBe("complete");
    expect(lifecycle.progress).toBe(100);
    expect(lifecycle.nextTitle).toBeNull();
    expect(lifecycle.milestones.find((item) => item.key === "attendance_recorded")?.automatic).toBe(true);
  });

  it("señala una convocatoria ordinaria emitida después del límite exacto", () => {
    const lifecycle = buildMeetingLifecycle(facts({
      events: [event("call_issued", "2026-09-12T16:00:01.000Z")]
    }));
    const call = lifecycle.milestones.find((item) => item.key === "call_issued");
    expect(call?.dueAt).toBe("2026-09-12T16:00:00.000Z");
    expect(call?.status).toBe("attention");
    expect(lifecycle.overallStatus).toBe("attention");
  });

  it("no inventa una hora límite cuando la celebración solo conserva una fecha", () => {
    const lifecycle = buildMeetingLifecycle(facts({
      eventTimePrecision: "day",
      events: []
    }));
    const call = lifecycle.milestones.find((item) => item.key === "call_issued");
    expect(lifecycle.configuration.complete).toBe(false);
    expect(call?.dueAt).toBeNull();
    expect(call?.status).toBe("blocked");
  });

  it("marca convocatoria y citaciones como no aplicables en una junta universal", () => {
    const lifecycle = buildMeetingLifecycle(facts({
      sessionCall: "universal",
      events: [event("meeting_held", "2026-09-18T16:05:00.000Z")]
    }));
    expect(lifecycle.milestones.find((item) => item.key === "call_issued")?.status).toBe("not_applicable");
    expect(lifecycle.milestones.find((item) => item.key === "notices_completed")?.status).toBe("not_applicable");
    expect(lifecycle.phase).toBe("minutes");
  });

  it("avisa si vence el plazo de diez días naturales sin cerrar el acta", () => {
    const lifecycle = buildMeetingLifecycle(facts({
      events: [
        event("call_issued", "2026-09-12T15:00:00.000Z"),
        event("notices_completed", "2026-09-12T16:30:00.000Z"),
        event("meeting_held", "2026-09-18T16:05:00.000Z")
      ],
      now: "2026-09-29T16:06:00.000Z"
    }));
    const minutes = lifecycle.milestones.find((item) => item.key === "minutes_closed");
    expect(minutes?.dueAt).toBe("2026-09-28T16:05:00.000Z");
    expect(minutes?.status).toBe("attention");
  });
});
