import "server-only";

import type { PoolClient } from "pg";
import {
  buildMeetingLifecycle,
  type LegalEventFact,
  type LegalMilestoneKey,
  type MeetingLifecycleFacts,
  type MeetingLifecycleResult
} from "./governance-lifecycle-domain";
import type { MeetingLifecycleDTO, MeetingLifecycleSummary } from "./governance-types";

interface MeetingFactRow {
  id: string;
  kind: string;
  status: string;
  event_at: Date | null;
  event_time_precision: "day" | "minute" | "second" | null;
  location: string | null;
  legal_ruleset: string;
  convener_name: string | null;
  session_call: "first" | "second" | "universal";
  second_call_at: Date | null;
  second_call_time_precision: "minute" | "second" | null;
  active_units: number;
  agenda_count: number;
  final_agenda_count: number;
  approved_agenda_count: number;
  attendance_count: number;
  agreement_count: number;
  completed_agreement_count: number;
}

interface EventRow {
  meeting_id: string;
  milestone_key: LegalMilestoneKey;
  occurred_at: Date;
  time_precision: "minute" | "second";
  evidence_reference: string;
  note: string | null;
  version: number;
}

const iso = (value: Date | null) => value ? value.toISOString() : null;

export function lifecycleSummary(lifecycle: MeetingLifecycleResult): MeetingLifecycleSummary {
  return {
    phaseLabel: lifecycle.phaseLabel,
    overallStatus: lifecycle.overallStatus,
    completed: lifecycle.completed,
    total: lifecycle.total,
    progress: lifecycle.progress,
    nextTitle: lifecycle.nextTitle
  };
}

export async function getMeetingLifecycleBatch(
  client: PoolClient,
  communityId: string,
  meetingIds: string[],
  timeZone: string
) {
  if (!meetingIds.length) return new Map<string, MeetingLifecycleDTO>();
  const meetings = await client.query<MeetingFactRow>(
    `SELECT m.id::text,m.kind,m.status,m.event_at,m.event_time_precision,m.location,
            m.legal_ruleset,m.convener_name,m.session_call,m.second_call_at,m.second_call_time_precision,
            (SELECT count(*)::int FROM private_units u WHERE u.community_id=m.community_id AND u.status='active') AS active_units,
            (SELECT count(*)::int FROM meeting_agenda_items i WHERE i.community_id=m.community_id AND i.meeting_id=m.id) AS agenda_count,
            (SELECT count(*)::int FROM meeting_agenda_items i WHERE i.community_id=m.community_id AND i.meeting_id=m.id AND i.status IN('approved','rejected')) AS final_agenda_count,
            (SELECT count(*)::int FROM meeting_agenda_items i WHERE i.community_id=m.community_id AND i.meeting_id=m.id AND i.status='approved') AS approved_agenda_count,
            (SELECT count(*)::int FROM meeting_attendance a WHERE a.community_id=m.community_id AND a.meeting_id=m.id) AS attendance_count,
            (SELECT count(*)::int FROM meeting_agreements a WHERE a.community_id=m.community_id AND a.meeting_id=m.id) AS agreement_count,
            (SELECT count(*)::int FROM meeting_agreements a WHERE a.community_id=m.community_id AND a.meeting_id=m.id AND a.status='completed') AS completed_agreement_count
       FROM meetings m
      WHERE m.community_id=$1 AND m.id=ANY($2::uuid[]) AND m.archived_at IS NULL`,
    [communityId, meetingIds]
  );
  const eventRows = await client.query<EventRow>(
    `SELECT meeting_id::text,milestone_key,occurred_at,time_precision,evidence_reference,note,version
       FROM meeting_legal_events
      WHERE community_id=$1 AND meeting_id=ANY($2::uuid[])
      ORDER BY occurred_at`,
    [communityId, meetingIds]
  );
  const events = new Map<string, LegalEventFact[]>();
  for (const row of eventRows.rows) {
    const list = events.get(row.meeting_id) ?? [];
    list.push({
      key: row.milestone_key,
      occurredAt: row.occurred_at.toISOString(),
      timePrecision: row.time_precision,
      evidenceReference: row.evidence_reference,
      note: row.note,
      version: row.version
    });
    events.set(row.meeting_id, list);
  }
  return new Map(meetings.rows.map((row) => {
    const facts: MeetingLifecycleFacts = {
      meetingId: row.id,
      kind: row.kind,
      meetingStatus: row.status,
      eventAt: iso(row.event_at),
      eventTimePrecision: row.event_time_precision,
      location: row.location,
      legalRuleset: row.legal_ruleset,
      convenerName: row.convener_name,
      sessionCall: row.session_call,
      secondCallAt: iso(row.second_call_at),
      secondCallTimePrecision: row.second_call_time_precision,
      activeUnits: Number(row.active_units),
      agendaCount: Number(row.agenda_count),
      finalAgendaCount: Number(row.final_agenda_count),
      approvedAgendaCount: Number(row.approved_agenda_count),
      attendanceCount: Number(row.attendance_count),
      agreementCount: Number(row.agreement_count),
      completedAgreementCount: Number(row.completed_agreement_count),
      events: events.get(row.id) ?? [],
      timeZone
    };
    return [row.id, buildMeetingLifecycle(facts) as MeetingLifecycleDTO];
  }));
}

export function residentSafeLifecycle(lifecycle: MeetingLifecycleDTO): MeetingLifecycleDTO {
  return {
    ...lifecycle,
    milestones: lifecycle.milestones.map((item) => ({
      ...item,
      evidenceReference: item.evidenceReference ? "Evidencia registrada por la administración" : null,
      note: null
    }))
  };
}
