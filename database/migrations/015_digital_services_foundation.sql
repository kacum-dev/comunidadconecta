-- Servicios digitales: finanzas conectadas, evidencias, firma, OCR, Copilot, importaciones y push.

ALTER TABLE community_integrations
  DROP CONSTRAINT IF EXISTS community_integrations_kind_check;

ALTER TABLE community_integrations
  ADD CONSTRAINT community_integrations_kind_check
  CHECK (kind IN (
    'accounting','banking','storage','calendar','email','weather','payments','signature',
    'ai','ocr','import','push','webhook','other'
  ));

CREATE TABLE sepa_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  mandate_reference text NOT NULL,
  debtor_name text NOT NULL,
  debtor_reference text,
  iban_ciphertext bytea NOT NULL,
  iban_iv bytea NOT NULL,
  iban_tag bytea NOT NULL,
  iban_last4 char(4) NOT NULL,
  sequence_type text NOT NULL DEFAULT 'recurrent' CHECK (sequence_type IN ('one_off','recurrent')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','revoked','expired')),
  signed_at timestamptz,
  revoked_at timestamptz,
  evidence_document_version_id uuid REFERENCES document_versions(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, mandate_reference)
);

CREATE TABLE sepa_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  message_id text NOT NULL,
  payment_info_id text NOT NULL,
  requested_collection_date date NOT NULL,
  transaction_count integer NOT NULL CHECK (transaction_count > 0),
  total_amount_cents bigint NOT NULL CHECK (total_amount_cents > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','generated','submitted','settled','partially_returned','returned','cancelled')),
  pain008_document_version_id uuid REFERENCES document_versions(id) ON DELETE RESTRICT,
  provider_reference text,
  approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  submitted_at timestamptz,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, message_id),
  UNIQUE (community_id, payment_info_id)
);

CREATE TABLE sepa_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES sepa_batches(id) ON DELETE RESTRICT,
  mandate_id uuid NOT NULL REFERENCES sepa_mandates(id) ON DELETE RESTRICT,
  financial_record_id uuid REFERENCES financial_records(id) ON DELETE RESTRICT,
  end_to_end_id text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','settled','returned','cancelled')),
  return_code text,
  return_reason text,
  settled_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, end_to_end_id)
);

CREATE TABLE payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  financial_record_id uuid NOT NULL REFERENCES financial_records(id) ON DELETE RESTRICT,
  payer_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  method text NOT NULL CHECK (method IN ('card','bizum')),
  provider text NOT NULL,
  provider_reference text,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency_code char(3) NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','requires_action','processing','paid','failed','cancelled','refunded','partially_refunded')),
  idempotency_key text NOT NULL,
  checkout_expires_at timestamptz,
  paid_at timestamptz,
  failure_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, idempotency_key),
  UNIQUE (community_id, provider, provider_reference)
);

CREATE TABLE ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  document_version_id uuid NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  kind text NOT NULL DEFAULT 'evidence' CHECK (kind IN ('photo','video','document','quote','invoice','evidence')),
  caption text,
  visible_to_resident boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, document_version_id)
);

CREATE TABLE signature_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  document_version_id uuid NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_reference text,
  signature_level text NOT NULL CHECK (signature_level IN ('simple','advanced','qualified')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','signed','declined','expired','cancelled','failed')),
  signer_name text NOT NULL,
  signer_email citext NOT NULL,
  document_sha256 char(64) NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  initiated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  initiated_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, provider, provider_reference)
);

CREATE TABLE accounting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  entry_number bigint NOT NULL,
  entry_date date NOT NULL,
  journal text NOT NULL DEFAULT 'general',
  concept text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','posted','reversed')),
  source_type text,
  source_id uuid,
  posted_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  posted_at timestamptz,
  reversal_of uuid REFERENCES accounting_entries(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, entry_number)
);

CREATE TABLE accounting_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  entry_id uuid NOT NULL REFERENCES accounting_entries(id) ON DELETE RESTRICT,
  line_number smallint NOT NULL CHECK (line_number > 0),
  account_code text NOT NULL CHECK (account_code ~ '^[1-9][0-9]{2,9}$'),
  description text,
  debit_cents bigint NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents bigint NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  cost_center text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0)),
  UNIQUE (entry_id, line_number)
);

CREATE TABLE invoice_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  document_version_id uuid NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','needs_review','approved','rejected','failed')),
  extracted_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  proposed_entry_id uuid REFERENCES accounting_entries(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  failure_reason text,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE copilot_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('incident','email','document','delinquency')),
  context_type text NOT NULL,
  context_id uuid,
  provider text NOT NULL,
  model text NOT NULL,
  input_sha256 char(64) NOT NULL,
  suggestion jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','accepted','edited','rejected','expired')),
  reviewed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  source_format text NOT NULL CHECK (source_format IN ('excel','csv','norma43','sepa_xml','pragma','gesfincas','fynkus','other')),
  original_name text NOT NULL,
  source_sha256 char(64) NOT NULL,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','validating','ready','importing','completed','completed_with_errors','failed','reverted')),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  accepted_rows integer NOT NULL DEFAULT 0 CHECK (accepted_rows >= 0),
  rejected_rows integer NOT NULL DEFAULT 0 CHECK (rejected_rows >= 0),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reverted_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reverted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, source_sha256)
);

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  device_kind text NOT NULL CHECK (device_kind IN ('pwa','ios','android')),
  provider text NOT NULL,
  endpoint_sha256 char(64) NOT NULL,
  subscription_ciphertext bytea NOT NULL,
  subscription_iv bytea NOT NULL,
  subscription_tag bytea NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','expired','revoked')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, endpoint_sha256)
);

CREATE TABLE push_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  outbox_id uuid NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('processing','delivered','retry','failed','expired')),
  provider_status integer,
  error_code text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (outbox_id, subscription_id, attempted_at)
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sepa_mandates','sepa_batches','sepa_batch_items','payment_intents','ticket_attachments',
    'signature_envelopes','accounting_entries','accounting_entry_lines','invoice_processing_jobs',
    'copilot_suggestions','import_runs','push_subscriptions','push_delivery_attempts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO comunidad_conecta_app USING (community_id=current_app_community_id()) WITH CHECK (community_id=current_app_community_id())',
      table_name
    );
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO comunidad_conecta_app', table_name);
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sepa_mandates','sepa_batches','payment_intents','signature_envelopes','accounting_entries',
    'invoice_processing_jobs','import_runs','push_subscriptions'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', table_name || '_set_updated_at', table_name);
  END LOOP;
END $$;

CREATE INDEX sepa_mandates_status_idx ON sepa_mandates (community_id, status, updated_at DESC);
CREATE INDEX sepa_batches_status_idx ON sepa_batches (community_id, status, requested_collection_date DESC);
CREATE INDEX sepa_batch_items_batch_idx ON sepa_batch_items (community_id, batch_id, status);
CREATE INDEX payment_intents_record_idx ON payment_intents (community_id, financial_record_id, status, created_at DESC);
CREATE INDEX ticket_attachments_ticket_idx ON ticket_attachments (community_id, ticket_id, created_at DESC);
CREATE INDEX signature_envelopes_status_idx ON signature_envelopes (community_id, status, updated_at DESC);
CREATE INDEX accounting_entries_date_idx ON accounting_entries (community_id, entry_date DESC, entry_number DESC);
CREATE INDEX accounting_entry_lines_account_idx ON accounting_entry_lines (community_id, account_code, entry_id);
CREATE INDEX invoice_processing_status_idx ON invoice_processing_jobs (community_id, status, created_at DESC);
CREATE INDEX copilot_suggestions_review_idx ON copilot_suggestions (community_id, status, created_at DESC);
CREATE INDEX import_runs_status_idx ON import_runs (community_id, status, created_at DESC);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (community_id, user_id, status);
CREATE INDEX push_delivery_retry_idx ON push_delivery_attempts (community_id, status, attempted_at) WHERE status IN ('retry','failed');

COMMENT ON TABLE sepa_mandates IS 'Mandatos de domiciliación con IBAN cifrado y evidencia verificable.';
COMMENT ON TABLE payment_intents IS 'Intentos de pago tokenizado; nunca almacena datos de tarjeta.';
COMMENT ON TABLE ticket_attachments IS 'Relación entre incidencias y versiones documentales inmutables.';
COMMENT ON TABLE signature_envelopes IS 'Orquestación y evidencia de firma; la cualificación corresponde al prestador eIDAS.';
COMMENT ON TABLE copilot_suggestions IS 'Sugerencias sujetas a revisión humana, nunca decisiones autónomas.';
COMMENT ON TABLE push_subscriptions IS 'Suscripciones cifradas reutilizables por PWA y futuras aplicaciones nativas.';
