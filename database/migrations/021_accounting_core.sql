-- Núcleo contable de doble partida, aislado por comunidad y con trazabilidad.
CREATE TABLE accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closing','closed')),
  locked_through date,
  closed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, starts_on, ends_on),
  CHECK (starts_on <= ends_on),
  CHECK (locked_through IS NULL OR locked_through BETWEEN starts_on AND ends_on)
);

CREATE TABLE accounting_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense','off_balance')),
  normal_side text NOT NULL CHECK (normal_side IN ('debit','credit')),
  parent_id uuid REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 8),
  accepts_entries boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  system_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, code)
);
CREATE UNIQUE INDEX accounting_accounts_system_key_uidx ON accounting_accounts (community_id, system_key) WHERE system_key IS NOT NULL;

CREATE TABLE accounting_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'general' CHECK (kind IN ('general','purchases','fees','bank','cash','opening','closing')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, code)
);

CREATE TABLE accounting_cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  structure_node_id uuid REFERENCES structure_nodes(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, code)
);

-- 015_digital_services_foundation.sql ya creo accounting_entries y
-- accounting_entry_lines. Evolucionamos esas tablas en sitio para conservar
-- asientos y referencias como invoice_processing_jobs.proposed_entry_id.
ALTER TABLE accounting_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_entry_lines DISABLE ROW LEVEL SECURITY;

ALTER TABLE accounting_entries RENAME COLUMN reversal_of TO reversal_of_id;
ALTER TABLE accounting_entries
  ADD COLUMN period_id uuid REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  ADD COLUMN journal_id uuid REFERENCES accounting_journals(id) ON DELETE RESTRICT,
  ADD COLUMN document_date date,
  ADD COLUMN reference text,
  ADD COLUMN reversed_by_entry_id uuid REFERENCES accounting_entries(id) ON DELETE RESTRICT,
  ADD COLUMN submitted_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN submitted_at timestamptz;

INSERT INTO accounting_periods (community_id, name, starts_on, ends_on)
SELECT DISTINCT
  community_id,
  'Ejercicio ' || extract(year FROM entry_date)::integer,
  make_date(extract(year FROM entry_date)::integer, 1, 1),
  make_date(extract(year FROM entry_date)::integer, 12, 31)
FROM accounting_entries
ON CONFLICT (community_id, starts_on, ends_on) DO NOTHING;

INSERT INTO accounting_journals (community_id, code, name, kind)
SELECT DISTINCT
  community_id,
  'LEGACY_' || upper(substr(md5(journal), 1, 12)),
  journal,
  'general'
FROM accounting_entries
ON CONFLICT (community_id, code) DO NOTHING;

UPDATE accounting_entries entry
SET period_id = period.id,
    journal_id = journal.id,
    document_date = entry.entry_date
FROM accounting_periods period, accounting_journals journal
WHERE period.community_id = entry.community_id
  AND entry.entry_date BETWEEN period.starts_on AND period.ends_on
  AND journal.community_id = entry.community_id
  AND journal.code = 'LEGACY_' || upper(substr(md5(entry.journal), 1, 12));

UPDATE accounting_entries
SET status = 'posted',
    posted_at = COALESCE(posted_at, updated_at, created_at, now())
WHERE status IN ('posted', 'reversed');

UPDATE accounting_entries
SET submitted_by = COALESCE(updated_by, created_by),
    submitted_at = COALESCE(updated_at, created_at)
WHERE status = 'review';

UPDATE accounting_entries original
SET reversed_by_entry_id = reversal.id
FROM (
  SELECT DISTINCT ON (reversal_of_id) id, reversal_of_id
  FROM accounting_entries
  WHERE reversal_of_id IS NOT NULL
  ORDER BY reversal_of_id, created_at DESC, id DESC
) reversal
WHERE original.id = reversal.reversal_of_id;

ALTER TABLE accounting_entries
  DROP CONSTRAINT accounting_entries_community_id_entry_number_key,
  DROP CONSTRAINT accounting_entries_status_check,
  ALTER COLUMN entry_number DROP NOT NULL,
  ALTER COLUMN journal DROP NOT NULL,
  ALTER COLUMN period_id SET NOT NULL,
  ALTER COLUMN journal_id SET NOT NULL,
  ADD CONSTRAINT accounting_entries_status_check CHECK (status IN ('draft','review','posted')),
  ADD CONSTRAINT accounting_entries_posted_check CHECK (
    (status = 'posted' AND entry_number IS NOT NULL AND posted_at IS NOT NULL)
    OR status <> 'posted'
  );

CREATE UNIQUE INDEX accounting_entries_number_uidx ON accounting_entries (period_id, entry_number) WHERE entry_number IS NOT NULL;
CREATE UNIQUE INDEX accounting_entries_source_uidx ON accounting_entries (community_id, source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND reversal_of_id IS NULL;

ALTER TABLE accounting_entry_lines
  ADD COLUMN account_id uuid REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN third_party_name text,
  ADD COLUMN third_party_tax_id text,
  ADD COLUMN cost_center_id uuid REFERENCES accounting_cost_centers(id) ON DELETE RESTRICT,
  ADD COLUMN private_unit_id uuid REFERENCES private_units(id) ON DELETE RESTRICT,
  ADD COLUMN financial_record_id uuid REFERENCES financial_records(id) ON DELETE RESTRICT,
  ADD COLUMN bank_transaction_id uuid REFERENCES bank_transactions(id) ON DELETE RESTRICT,
  ADD COLUMN due_date date;

INSERT INTO accounting_accounts (community_id, code, name, account_type, normal_side)
SELECT DISTINCT
  community_id,
  account_code,
  'Cuenta migrada ' || account_code,
  CASE left(account_code, 1)
    WHEN '1' THEN 'equity'
    WHEN '6' THEN 'expense'
    WHEN '7' THEN 'income'
    WHEN '8' THEN 'off_balance'
    WHEN '9' THEN 'off_balance'
    ELSE 'asset'
  END,
  CASE WHEN left(account_code, 1) IN ('1', '7', '9') THEN 'credit' ELSE 'debit' END
FROM accounting_entry_lines
ON CONFLICT (community_id, code) DO NOTHING;

INSERT INTO accounting_cost_centers (community_id, code, name)
SELECT DISTINCT
  community_id,
  'LEGACY_' || upper(substr(md5(cost_center), 1, 12)),
  cost_center
FROM accounting_entry_lines
WHERE cost_center IS NOT NULL AND btrim(cost_center) <> ''
ON CONFLICT (community_id, code) DO NOTHING;

UPDATE accounting_entry_lines line
SET account_id = account.id
FROM accounting_accounts account
WHERE account.community_id = line.community_id
  AND account.code = line.account_code;

UPDATE accounting_entry_lines line
SET cost_center_id = center.id
FROM accounting_cost_centers center
WHERE center.community_id = line.community_id
  AND center.code = 'LEGACY_' || upper(substr(md5(line.cost_center), 1, 12));

ALTER TABLE accounting_entry_lines
  DROP CONSTRAINT accounting_entry_lines_entry_id_fkey,
  ALTER COLUMN line_number TYPE integer,
  ALTER COLUMN account_code DROP NOT NULL,
  ALTER COLUMN account_id SET NOT NULL,
  ADD CONSTRAINT accounting_entry_lines_entry_id_fkey
    FOREIGN KEY (entry_id) REFERENCES accounting_entries(id) ON DELETE CASCADE;

DROP INDEX accounting_entry_lines_account_idx;

CREATE INDEX accounting_periods_lookup_idx ON accounting_periods (community_id, status, starts_on DESC);
CREATE INDEX accounting_accounts_lookup_idx ON accounting_accounts (community_id, active, code);
CREATE INDEX accounting_entries_diary_idx ON accounting_entries (community_id, entry_date DESC, created_at DESC);
CREATE INDEX accounting_entry_lines_account_idx ON accounting_entry_lines (community_id, account_id, entry_id);

CREATE OR REPLACE FUNCTION validate_accounting_entry_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE totals record;
BEGIN
  IF NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
    IF EXISTS (SELECT 1 FROM accounting_periods WHERE id = NEW.period_id AND (status <> 'open' OR NEW.entry_date < starts_on OR NEW.entry_date > ends_on OR (locked_through IS NOT NULL AND NEW.entry_date <= locked_through))) THEN
      RAISE EXCEPTION 'El periodo no admite asientos en esa fecha';
    END IF;
    SELECT count(*) AS lines, COALESCE(sum(debit_cents),0) AS debit, COALESCE(sum(credit_cents),0) AS credit INTO totals FROM accounting_entry_lines WHERE entry_id = NEW.id;
    IF totals.lines < 2 OR totals.debit = 0 OR totals.debit <> totals.credit THEN RAISE EXCEPTION 'El asiento debe tener al menos dos líneas y estar cuadrado'; END IF;
    IF NEW.entry_number IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext(NEW.period_id::text));
      SELECT COALESCE(max(entry_number),0)+1 INTO NEW.entry_number FROM accounting_entries WHERE period_id = NEW.period_id AND status = 'posted';
    END IF;
    NEW.posted_at := COALESCE(NEW.posted_at, now());
  ELSIF OLD.status = 'posted' AND (NEW.period_id, NEW.journal_id, NEW.entry_date, NEW.concept, NEW.reference, NEW.status, NEW.source_type, NEW.source_id, NEW.reversal_of_id) IS DISTINCT FROM (OLD.period_id, OLD.journal_id, OLD.entry_date, OLD.concept, OLD.reference, OLD.status, OLD.source_type, OLD.source_id, OLD.reversal_of_id) THEN
    RAISE EXCEPTION 'Un asiento contabilizado es inmutable; crea una reversión';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION protect_posted_accounting_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounting_entries WHERE id = COALESCE(OLD.entry_id, NEW.entry_id) AND status = 'posted') THEN
    RAISE EXCEPTION 'Las líneas de un asiento contabilizado son inmutables';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER accounting_entries_set_updated_at ON accounting_entries;
CREATE TRIGGER accounting_entries_validate_posting BEFORE UPDATE ON accounting_entries FOR EACH ROW EXECUTE FUNCTION validate_accounting_entry_posting();
CREATE TRIGGER accounting_entries_set_updated_at BEFORE UPDATE ON accounting_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER accounting_lines_protect_update BEFORE UPDATE OR DELETE ON accounting_entry_lines FOR EACH ROW EXECUTE FUNCTION protect_posted_accounting_lines();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['accounting_periods','accounting_accounts','accounting_journals','accounting_cost_centers','accounting_entries','accounting_entry_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO comunidad_conecta_app USING (community_id = current_app_community_id()) WITH CHECK (community_id = current_app_community_id())', table_name);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON accounting_periods, accounting_accounts, accounting_journals, accounting_cost_centers, accounting_entries, accounting_entry_lines TO comunidad_conecta_app;
