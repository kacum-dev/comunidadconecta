ALTER TABLE communities
  ADD COLUMN phone text,
  ADD COLUMN contact_email citext,
  ADD COLUMN website_url text;

CREATE OR REPLACE FUNCTION update_current_community_profile(
  profile_name text,
  profile_tax_id text,
  profile_address text,
  profile_postal_code text,
  profile_city text,
  profile_province text,
  profile_country_code char(2),
  profile_phone text,
  profile_contact_email citext,
  profile_website_url text,
  profile_timezone text,
  profile_locale text,
  profile_legal_profile text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE communities
     SET name = profile_name,
         tax_id = nullif(profile_tax_id, ''),
         address = profile_address,
         postal_code = nullif(profile_postal_code, ''),
         city = nullif(profile_city, ''),
         province = nullif(profile_province, ''),
         country_code = profile_country_code,
         phone = nullif(profile_phone, ''),
         contact_email = nullif(profile_contact_email, ''),
         website_url = nullif(profile_website_url, ''),
         timezone = profile_timezone,
         locale = profile_locale,
         legal_profile = profile_legal_profile,
         updated_at = now()
   WHERE id = current_app_community_id()
$$;

REVOKE ALL ON FUNCTION update_current_community_profile(text,text,text,text,text,text,char(2),text,citext,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_current_community_profile(text,text,text,text,text,text,char(2),text,citext,text,text,text,text) TO comunidad_conecta_app;

CREATE TABLE community_app_settings (
  community_id uuid PRIMARY KEY REFERENCES communities(id) ON DELETE CASCADE,
  office_hours text,
  time_format text NOT NULL DEFAULT '24h' CHECK (time_format IN ('24h', '12h')),
  date_format text NOT NULL DEFAULT 'DD/MM/YYYY' CHECK (date_format IN ('DD/MM/YYYY', 'YYYY-MM-DD')),
  currency_code char(3) NOT NULL DEFAULT 'EUR',
  fiscal_year_start_month smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  default_due_day smallint NOT NULL DEFAULT 10 CHECK (default_due_day BETWEEN 1 AND 31),
  notifications_email boolean NOT NULL DEFAULT true,
  notifications_push boolean NOT NULL DEFAULT true,
  backup_provider text NOT NULL DEFAULT 'hosting' CHECK (backup_provider IN ('hosting', 's3', 'disabled')),
  backup_frequency text NOT NULL DEFAULT 'daily' CHECK (backup_frequency IN ('daily', 'weekly', 'monthly')),
  backup_time time NOT NULL DEFAULT '02:00',
  backup_retention_days smallint NOT NULL DEFAULT 30 CHECK (backup_retention_days BETWEEN 1 AND 3650),
  backup_notification_email citext,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE community_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('accounting', 'banking', 'storage', 'calendar', 'email', 'webhook', 'other')),
  provider text NOT NULL,
  endpoint_url text,
  account_reference text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'enabled', 'paused')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_ciphertext bytea,
  credential_iv bytea,
  credential_tag bytea,
  credential_hint text,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (
    (credential_ciphertext IS NULL AND credential_iv IS NULL AND credential_tag IS NULL)
    OR (credential_ciphertext IS NOT NULL AND credential_iv IS NOT NULL AND credential_tag IS NOT NULL)
  )
);

CREATE INDEX community_integrations_status_idx
  ON community_integrations (community_id, status, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER community_app_settings_set_updated_at
BEFORE UPDATE ON community_app_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER community_integrations_set_updated_at
BEFORE UPDATE ON community_integrations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO community_app_settings (community_id)
SELECT id FROM communities
ON CONFLICT (community_id) DO NOTHING;

ALTER TABLE community_app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_app_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON community_app_settings FOR ALL TO comunidad_conecta_app
  USING (community_id = current_app_community_id())
  WITH CHECK (community_id = current_app_community_id());

ALTER TABLE community_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_integrations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON community_integrations FOR ALL TO comunidad_conecta_app
  USING (community_id = current_app_community_id())
  WITH CHECK (community_id = current_app_community_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON community_app_settings, community_integrations TO comunidad_conecta_app;

COMMENT ON TABLE community_app_settings IS 'Preferencias operativas de cada comunidad. La politica de copias no ejecuta por si misma los backups del proveedor de alojamiento.';
COMMENT ON TABLE community_integrations IS 'Conexiones externas por comunidad. Las credenciales se almacenan cifradas y nunca se devuelven al cliente.';
COMMENT ON COLUMN community_integrations.credential_hint IS 'Pista no sensible para identificar la credencial sin exponerla';
