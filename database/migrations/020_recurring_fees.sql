CREATE TABLE fee_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  budget_id uuid REFERENCES finance_budgets(id) ON DELETE RESTRICT,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'ordinary' CHECK (kind IN ('ordinary','assessment')),
  calculation_method text NOT NULL CHECK (calculation_method IN ('unit_settings','coefficient','equal')),
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  frequency text NOT NULL CHECK (frequency IN ('monthly','quarterly','yearly')),
  first_due_at timestamptz NOT NULL,
  first_due_local text NOT NULL,
  issue_lead_days integer NOT NULL DEFAULT 10 CHECK (issue_lead_days BETWEEN 0 AND 90),
  ends_on date,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended','cancelled')),
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fee_schedule_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id) ON DELETE RESTRICT,
  occurrence_number integer NOT NULL CHECK (occurrence_number > 0),
  scheduled_issue_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  due_time_precision text NOT NULL DEFAULT 'second' CHECK (due_time_precision IN ('minute','second')),
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','issued','skipped','failed')),
  fee_issue_id uuid REFERENCES fee_issues(id) ON DELETE RESTRICT,
  issued_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, occurrence_number),
  UNIQUE (schedule_id, due_at),
  CHECK (
    (status = 'issued' AND fee_issue_id IS NOT NULL AND issued_at IS NOT NULL)
    OR status <> 'issued'
  )
);

ALTER TABLE fee_issues
  ADD COLUMN schedule_id uuid REFERENCES fee_schedules(id) ON DELETE RESTRICT,
  ADD COLUMN schedule_occurrence_id uuid REFERENCES fee_schedule_occurrences(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX fee_issues_schedule_occurrence_uidx
  ON fee_issues (schedule_occurrence_id)
  WHERE schedule_occurrence_id IS NOT NULL;

CREATE INDEX fee_schedules_active_idx
  ON fee_schedules (community_id, status, created_at DESC);
CREATE INDEX fee_schedule_occurrences_run_idx
  ON fee_schedule_occurrences (community_id, status, scheduled_issue_at)
  WHERE status = 'planned';
CREATE INDEX fee_schedule_occurrences_forecast_idx
  ON fee_schedule_occurrences (community_id, due_at, status);

CREATE TRIGGER fee_schedules_set_updated_at
BEFORE UPDATE ON fee_schedules
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER fee_schedule_occurrences_set_updated_at
BEFORE UPDATE ON fee_schedule_occurrences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE fee_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fee_schedules FOR ALL TO comunidad_conecta_app
  USING (community_id = current_app_community_id())
  WITH CHECK (community_id = current_app_community_id());

ALTER TABLE fee_schedule_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_schedule_occurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fee_schedule_occurrences FOR ALL TO comunidad_conecta_app
  USING (community_id = current_app_community_id())
  WITH CHECK (community_id = current_app_community_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON fee_schedules, fee_schedule_occurrences TO comunidad_conecta_app;
