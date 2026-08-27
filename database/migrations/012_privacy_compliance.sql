-- Cumplimiento RGPD: derechos, RAT, encargados y brechas documentadas.
CREATE TABLE privacy_request_details(
 privacy_case_id uuid PRIMARY KEY REFERENCES privacy_cases(id) ON DELETE RESTRICT,
 community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
 requester_email citext NOT NULL, identity_status text NOT NULL DEFAULT 'pending' CHECK(identity_status IN('pending','verified','rejected')),
 received_at timestamptz NOT NULL, legal_due_at timestamptz NOT NULL, extended_due_at timestamptz,
 response_summary text, verified_by uuid REFERENCES app_users(id) ON DELETE SET NULL, verified_at timestamptz, closed_at timestamptz
);
CREATE TABLE processing_activities(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
 name text NOT NULL,purpose text NOT NULL,legal_basis text NOT NULL,data_subjects text NOT NULL,data_categories text NOT NULL,
 recipients text NOT NULL,international_transfers text,retention_period text NOT NULL,security_measures text NOT NULL,
 processor_name text,status text NOT NULL DEFAULT 'active' CHECK(status IN('draft','active','review','ended')),
 reviewed_at timestamptz,created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE data_breaches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
 title text NOT NULL,discovered_at timestamptz NOT NULL,description text NOT NULL,affected_data text NOT NULL,affected_people integer CHECK(affected_people IS NULL OR affected_people>=0),
 risk_level text NOT NULL CHECK(risk_level IN('unlikely','risk','high_risk')),effects text,measures text NOT NULL,
 authority_due_at timestamptz NOT NULL,authority_notified_at timestamptz,subjects_notified_at timestamptz,
 decision_reason text,status text NOT NULL DEFAULT 'investigating' CHECK(status IN('investigating','contained','notified','closed')),
 created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['privacy_request_details','processing_activities','data_breaches']LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO comunidad_conecta_app USING(community_id=current_app_community_id())WITH CHECK(community_id=current_app_community_id())',t);EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO comunidad_conecta_app',t);END LOOP;END$$;
CREATE INDEX privacy_requests_due_idx ON privacy_request_details(community_id,legal_due_at,identity_status);
CREATE INDEX processing_activities_idx ON processing_activities(community_id,status,name);
CREATE INDEX data_breaches_due_idx ON data_breaches(community_id,status,authority_due_at);
