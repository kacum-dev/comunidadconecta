ALTER TABLE communities
  ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

ALTER TABLE app_users
  ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

ALTER TABLE user_sessions
  ADD COLUMN session_kind text NOT NULL DEFAULT 'standard',
  ADD COLUMN demo_community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
  ADD COLUMN demo_role text;

ALTER TABLE user_sessions
  ADD CONSTRAINT user_sessions_kind_check
    CHECK (session_kind IN ('standard', 'demo')),
  ADD CONSTRAINT user_sessions_demo_context_check
    CHECK (
      (session_kind = 'standard' AND demo_community_id IS NULL AND demo_role IS NULL)
      OR
      (session_kind = 'demo' AND demo_community_id IS NOT NULL AND demo_role IN (
        'owner', 'resident', 'president', 'vice_president', 'secretary', 'treasurer', 'administrator'
      ))
    );

CREATE TABLE community_demo_settings (
  community_id uuid PRIMARY KEY REFERENCES communities(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  public_title text NOT NULL DEFAULT 'Explora Comunidad Conecta',
  public_description text NOT NULL DEFAULT 'Descubre cómo se gestiona una comunidad desde cada perfil.',
  enabled_roles text[] NOT NULL DEFAULT ARRAY[
    'president', 'vice_president', 'secretary', 'treasurer', 'administrator', 'owner', 'resident'
  ]::text[],
  access_code_hash text,
  access_code_salt text,
  access_code_params jsonb,
  session_duration_minutes integer NOT NULL DEFAULT 60 CHECK (session_duration_minutes BETWEEN 15 AND 240),
  expires_at timestamptz,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(enabled_roles) > 0),
  CHECK (enabled_roles <@ ARRAY[
    'owner', 'resident', 'president', 'vice_president', 'secretary', 'treasurer', 'administrator'
  ]::text[]),
  CHECK (
    (access_code_hash IS NULL AND access_code_salt IS NULL AND access_code_params IS NULL)
    OR
    (access_code_hash IS NOT NULL AND access_code_salt IS NOT NULL AND access_code_params IS NOT NULL)
  )
);

CREATE UNIQUE INDEX community_demo_one_enabled_idx
  ON community_demo_settings (enabled)
  WHERE enabled = true;

CREATE TABLE demo_auth_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint_hash char(64) NOT NULL,
  requested_role text,
  succeeded boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX demo_auth_attempts_recent_idx
  ON demo_auth_attempts (fingerprint_hash, attempted_at DESC);

CREATE INDEX user_sessions_demo_active_idx
  ON user_sessions (demo_community_id, expires_at)
  WHERE session_kind = 'demo' AND revoked_at IS NULL;

CREATE TRIGGER community_demo_settings_set_updated_at
BEFORE UPDATE ON community_demo_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
