-- Flujos financieros conectados: importación bancaria y conciliación trazable.

CREATE TABLE bank_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  original_name text NOT NULL,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bank_transactions
  ADD COLUMN import_batch_id uuid REFERENCES bank_import_batches(id) ON DELETE SET NULL,
  ADD COLUMN import_fingerprint char(64);

CREATE UNIQUE INDEX bank_transactions_import_fingerprint_uidx
  ON bank_transactions (community_id, import_fingerprint)
  WHERE import_fingerprint IS NOT NULL;

CREATE TABLE financial_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  bank_transaction_id uuid NOT NULL REFERENCES bank_transactions(id) ON DELETE RESTRICT,
  financial_record_id uuid NOT NULL REFERENCES financial_records(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  note text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  previous_financial_status text NOT NULL,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reversed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'active' AND reversed_by IS NULL AND reversed_at IS NULL)
    OR (status = 'reversed' AND reversed_at IS NOT NULL)
  )
);

CREATE INDEX financial_reconciliations_bank_idx
  ON financial_reconciliations (community_id, bank_transaction_id, status);
CREATE INDEX financial_reconciliations_record_idx
  ON financial_reconciliations (community_id, financial_record_id, status);

ALTER TABLE bank_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bank_import_batches FOR ALL TO comunidad_conecta_app
  USING (community_id = current_app_community_id())
  WITH CHECK (community_id = current_app_community_id());

ALTER TABLE financial_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_reconciliations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON financial_reconciliations FOR ALL TO comunidad_conecta_app
  USING (community_id = current_app_community_id())
  WITH CHECK (community_id = current_app_community_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON bank_import_batches, financial_reconciliations TO comunidad_conecta_app;

COMMENT ON TABLE bank_import_batches IS 'Evidencia de cada importación bancaria, incluidos duplicados y errores.';
COMMENT ON TABLE financial_reconciliations IS 'Asignaciones reversibles entre movimientos bancarios y registros económicos.';
