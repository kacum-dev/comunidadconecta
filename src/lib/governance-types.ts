export interface GovernanceAgendaItem {
  id: string; position: number; title: string; proposal: string; votingRule: string;
  qualifiedThreshold: number | null; status: string; result: unknown;
}
export interface GovernanceAttendance {
  id: string; unitId: string; unitCode: string; ownerName: string; attendanceType: string; coefficient: number;
}
export interface GovernanceVote {
  id: string; agendaItemId: string; unitId: string; choice: "yes"|"no"|"abstain"; coefficient: number;
}
export interface GovernanceAgreement {
  id: string; agendaItemId: string; title: string; description: string; responsible: string;
  dueDate: string|null; dueTimePrecision: "day"|"minute"|"second"|null; dueInclusive: boolean; status: string;
}
export interface GovernanceMeeting {
  id: string; title: string; code: string; status: string; kind: string; eventDate: string|null;
  eventTimePrecision: "day"|"minute"|"second"|null; location: string; description: string; version: number;
  lifecycleSummary: MeetingLifecycleSummary;
}
export interface MeetingLifecycleSummary {
  phaseLabel: string; overallStatus: "pending"|"attention"|"complete";
  completed: number; total: number; progress: number; nextTitle: string|null;
}
export interface MeetingLifecycleMilestoneDTO {
  key: string; title: string; description: string; legalSource: string;
  status: "complete"|"pending"|"attention"|"blocked"|"not_applicable";
  automatic: boolean; completedAt: string|null; completedTimePrecision: "day"|"minute"|"second"|null;
  dueAt: string|null; dueTimePrecision: "second"|null; evidenceReference: string|null; note: string|null;
  version: number; actionKey: "call_issued"|"notices_completed"|"meeting_held"|"minutes_closed"|"minutes_notified"|"records_archived"|null;
}
export interface MeetingLifecycleDTO extends MeetingLifecycleSummary {
  ruleset: string; phase: "preparation"|"notice"|"meeting"|"minutes"|"communication"|"complete";
  configuration: { convenerName:string; sessionCall:"first"|"second"|"universal"; secondCallAt:string|null; secondCallTimePrecision:"minute"|"second"|null; complete:boolean };
  milestones: MeetingLifecycleMilestoneDTO[];
}
export interface GovernanceWorkspaceDTO {
  meetings: GovernanceMeeting[];
  selected: GovernanceMeeting|null;
  agenda: GovernanceAgendaItem[];
  attendance: GovernanceAttendance[];
  votes: GovernanceVote[];
  agreements: GovernanceAgreement[];
  quorum: {units:number;coefficient:number};
  lifecycle: MeetingLifecycleDTO|null;
}
