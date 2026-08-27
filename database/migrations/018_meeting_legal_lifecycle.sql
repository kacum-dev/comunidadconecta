-- Expediente legal de juntas: configuracion, hitos acreditados y precision temporal.

ALTER TABLE meetings
  ADD COLUMN legal_ruleset text NOT NULL DEFAULT 'LPH_ES_2026_03',
  ADD COLUMN convener_name text,
  ADD COLUMN session_call text NOT NULL DEFAULT 'first'
    CHECK (session_call IN ('first','second','universal')),
  ADD COLUMN second_call_at timestamptz,
  ADD COLUMN second_call_time_precision text
    CHECK (second_call_time_precision IS NULL OR second_call_time_precision IN ('minute','second'));

CREATE TABLE meeting_legal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE RESTRICT,
  milestone_key text NOT NULL CHECK (milestone_key IN (
    'call_issued','notices_completed','meeting_held','minutes_closed','minutes_notified','records_archived'
  )),
  occurred_at timestamptz NOT NULL,
  time_precision text NOT NULL DEFAULT 'second' CHECK (time_precision IN ('minute','second')),
  evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 2 AND 200),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  confirmed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, milestone_key)
);

ALTER TABLE meeting_legal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_legal_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meeting_legal_events
  FOR ALL TO comunidad_conecta_app
  USING (community_id = current_app_community_id())
  WITH CHECK (community_id = current_app_community_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_legal_events TO comunidad_conecta_app;

CREATE INDEX meeting_legal_events_meeting_idx
  ON meeting_legal_events (community_id, meeting_id, milestone_key);
CREATE INDEX meeting_legal_events_occurred_idx
  ON meeting_legal_events (community_id, occurred_at DESC);
