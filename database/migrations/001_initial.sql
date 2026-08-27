CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'comunidad_conecta_app') THEN
    CREATE ROLE comunidad_conecta_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

CREATE TABLE communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug citext NOT NULL UNIQUE,
  tax_id text,
  address text NOT NULL,
  postal_code text,
  city text,
  province text,
  country_code char(2) NOT NULL DEFAULT 'ES',
  timezone text NOT NULL DEFAULT 'Europe/Madrid',
  locale text NOT NULL DEFAULT 'es-ES',
  legal_profile text NOT NULL DEFAULT 'LPH_ESTATAL',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('onboarding', 'active', 'transition', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  password_params jsonb NOT NULL DEFAULT '{"N":32768,"r":8,"p":1,"keyLength":64}'::jsonb,
  locale text NOT NULL DEFAULT 'es-ES',
  simple_mode boolean NOT NULL DEFAULT false,
  mfa_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'blocked', 'anonymized')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'resident', 'president', 'vice_president', 'secretary', 'administrator', 'supplier', 'auditor', 'support', 'platform_admin')),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'revoked', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, user_id, role)
);

CREATE INDEX memberships_user_active_idx ON memberships (user_id, status, valid_to);
CREATE INDEX memberships_community_role_idx ON memberships (community_id, role, status);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  user_agent text,
  ip_hash char(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text
);

CREATE INDEX user_sessions_active_idx ON user_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE auth_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_hash char(64) NOT NULL,
  ip_hash char(64),
  succeeded boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_attempts_recent_idx ON auth_attempts (email_hash, attempted_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION current_app_community_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.community_id', true), '')::uuid
$$;

CREATE TABLE structure_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  parent_id uuid REFERENCES structure_nodes(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'active',
  kind text NOT NULL DEFAULT 'building',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE people_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'active',
  kind text NOT NULL DEFAULT 'owner',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE financial_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'pending',
  kind text NOT NULL DEFAULT 'charge',
  amount_cents bigint NOT NULL DEFAULT 0,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'unmatched',
  kind text NOT NULL DEFAULT 'debit',
  amount_cents bigint NOT NULL,
  event_date date NOT NULL DEFAULT current_date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'draft',
  kind text NOT NULL DEFAULT 'ordinary',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'draft',
  kind text NOT NULL DEFAULT 'notice',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'received',
  kind text NOT NULL DEFAULT 'maintenance',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text NOT NULL DEFAULT 'normal',
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'active',
  kind text NOT NULL DEFAULT 'maintenance',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'current',
  kind text NOT NULL DEFAULT 'other',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  version_number integer NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256 char(64) NOT NULL,
  content bytea NOT NULL,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number),
  UNIQUE (document_id, sha256)
);

CREATE TABLE transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'initiated',
  kind text NOT NULL DEFAULT 'administrator_change',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE privacy_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'received',
  kind text NOT NULL DEFAULT 'access',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'pending',
  kind text NOT NULL DEFAULT 'general',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text NOT NULL DEFAULT 'normal',
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'active',
  kind text NOT NULL DEFAULT 'common_element',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'requested',
  kind text NOT NULL DEFAULT 'resource',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE configuration_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  title text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'active',
  kind text NOT NULL DEFAULT 'general',
  amount_cents bigint,
  event_date date,
  due_date date,
  contact text,
  location text,
  priority text,
  assigned_to text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  result text NOT NULL DEFAULT 'success',
  reason text,
  before_state jsonb,
  after_state jsonb,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ip_hash char(64),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_tenant_time_idx ON audit_events (community_id, created_at DESC);

DO $$
DECLARE
  table_name text;
  scoped_tables text[] := ARRAY[
    'structure_nodes', 'people_relations', 'financial_records', 'bank_transactions',
    'meetings', 'communications', 'tickets', 'suppliers', 'documents',
    'document_versions', 'transitions', 'privacy_cases', 'approvals', 'assets',
    'reservations', 'configuration_records', 'audit_events'
  ];
BEGIN
  FOREACH table_name IN ARRAY scoped_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO comunidad_conecta_app USING (community_id = current_app_community_id()) WITH CHECK (community_id = current_app_community_id())',
      table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO comunidad_conecta_app', table_name);
  END LOOP;
END
$$;

REVOKE UPDATE, DELETE ON audit_events FROM comunidad_conecta_app;
REVOKE UPDATE, DELETE ON document_versions FROM comunidad_conecta_app;
GRANT USAGE ON SCHEMA public TO comunidad_conecta_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO comunidad_conecta_app;
GRANT SELECT ON communities, app_users, memberships TO comunidad_conecta_app;

CREATE UNIQUE INDEX structure_nodes_active_code_uidx
  ON structure_nodes (community_id, code)
  WHERE archived_at IS NULL AND code IS NOT NULL;
CREATE UNIQUE INDEX bank_transactions_active_code_uidx
  ON bank_transactions (community_id, code)
  WHERE archived_at IS NULL AND code IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable_record';
END
$$;

CREATE TRIGGER document_versions_immutable
BEFORE UPDATE OR DELETE ON document_versions
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_change();

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_change();

DO $$
DECLARE
  table_name text;
  mutable_tables text[] := ARRAY[
    'communities', 'app_users', 'memberships', 'structure_nodes', 'people_relations',
    'financial_records', 'bank_transactions', 'meetings', 'communications', 'tickets',
    'suppliers', 'documents', 'transitions', 'privacy_cases', 'approvals', 'assets',
    'reservations', 'configuration_records'
  ];
BEGIN
  FOREACH table_name IN ARRAY mutable_tables LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      table_name,
      table_name
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  table_name text;
  indexed_tables text[] := ARRAY[
    'structure_nodes', 'people_relations', 'financial_records', 'bank_transactions',
    'meetings', 'communications', 'tickets', 'suppliers', 'documents', 'transitions',
    'privacy_cases', 'approvals', 'assets', 'reservations', 'configuration_records'
  ];
BEGIN
  FOREACH table_name IN ARRAY indexed_tables LOOP
    EXECUTE format('CREATE INDEX %I ON %I (community_id, updated_at DESC) WHERE archived_at IS NULL', table_name || '_tenant_updated_idx', table_name);
    EXECUTE format('CREATE INDEX %I ON %I (community_id, status) WHERE archived_at IS NULL', table_name || '_tenant_status_idx', table_name);
  END LOOP;
END
$$;
