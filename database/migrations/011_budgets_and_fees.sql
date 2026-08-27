-- Presupuestos y emisión de cuotas explicables por unidad.
CREATE TABLE finance_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  name text NOT NULL,
  fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2200),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','closed')),
  approved_at timestamptz,
  approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id,fiscal_year,name)
);
CREATE TABLE finance_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  budget_id uuid NOT NULL REFERENCES finance_budgets(id) ON DELETE RESTRICT,
  category text NOT NULL,
  description text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fee_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  budget_id uuid REFERENCES finance_budgets(id) ON DELETE RESTRICT,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ordinary','assessment')),
  calculation_method text NOT NULL CHECK (calculation_method IN ('unit_settings','coefficient','equal')),
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','cancelled')),
  issued_at timestamptz,
  issued_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fee_issue_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  issue_id uuid NOT NULL REFERENCES fee_issues(id) ON DELETE RESTRICT,
  private_unit_id uuid NOT NULL REFERENCES private_units(id) ON DELETE RESTRICT,
  owner_name text,
  owner_email citext,
  coefficient numeric(9,6) NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  financial_record_id uuid REFERENCES financial_records(id) ON DELETE RESTRICT,
  calculation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issue_id,private_unit_id)
);
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['finance_budgets','finance_budget_lines','fee_issues','fee_issue_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO comunidad_conecta_app USING (community_id=current_app_community_id()) WITH CHECK (community_id=current_app_community_id())',table_name);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO comunidad_conecta_app',table_name);
  END LOOP;
END $$;
CREATE INDEX finance_budgets_year_idx ON finance_budgets(community_id,fiscal_year,status);
CREATE INDEX fee_issues_due_idx ON fee_issues(community_id,due_date,status);
CREATE INDEX fee_issue_lines_unit_idx ON fee_issue_lines(community_id,private_unit_id,issue_id);
