-- Integridad transversal del núcleo contable y protección de libros cerrados.

ALTER TABLE accounting_periods
  ADD CONSTRAINT accounting_periods_tenant_id_key UNIQUE (community_id, id);
ALTER TABLE accounting_accounts
  ADD CONSTRAINT accounting_accounts_tenant_id_key UNIQUE (community_id, id),
  ADD CONSTRAINT accounting_accounts_code_check CHECK (code ~ '^[1-9][0-9]{2,9}$');
ALTER TABLE accounting_journals
  ADD CONSTRAINT accounting_journals_tenant_id_key UNIQUE (community_id, id);
ALTER TABLE accounting_cost_centers
  ADD CONSTRAINT accounting_cost_centers_tenant_id_key UNIQUE (community_id, id);
ALTER TABLE accounting_entries
  ADD CONSTRAINT accounting_entries_tenant_id_key UNIQUE (community_id, id),
  ADD CONSTRAINT accounting_entries_period_tenant_fkey
    FOREIGN KEY (community_id, period_id)
    REFERENCES accounting_periods (community_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT accounting_entries_journal_tenant_fkey
    FOREIGN KEY (community_id, journal_id)
    REFERENCES accounting_journals (community_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT accounting_entries_reversal_tenant_fkey
    FOREIGN KEY (community_id, reversal_of_id)
    REFERENCES accounting_entries (community_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT accounting_entries_reversed_by_tenant_fkey
    FOREIGN KEY (community_id, reversed_by_entry_id)
    REFERENCES accounting_entries (community_id, id) ON DELETE RESTRICT;
ALTER TABLE accounting_entry_lines
  ADD CONSTRAINT accounting_entry_lines_entry_tenant_fkey
    FOREIGN KEY (community_id, entry_id)
    REFERENCES accounting_entries (community_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT accounting_entry_lines_account_tenant_fkey
    FOREIGN KEY (community_id, account_id)
    REFERENCES accounting_accounts (community_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT accounting_entry_lines_cost_center_tenant_fkey
    FOREIGN KEY (community_id, cost_center_id)
    REFERENCES accounting_cost_centers (community_id, id) ON DELETE RESTRICT;
ALTER TABLE accounting_accounts
  ADD CONSTRAINT accounting_accounts_parent_tenant_fkey
    FOREIGN KEY (community_id, parent_id)
    REFERENCES accounting_accounts (community_id, id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION validate_accounting_period_dates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.starts_on > NEW.ends_on THEN
    RAISE EXCEPTION 'La fecha final del ejercicio debe ser posterior a la inicial';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM accounting_periods period
     WHERE period.community_id = NEW.community_id
       AND period.id <> NEW.id
       AND daterange(period.starts_on, period.ends_on, '[]')
           && daterange(NEW.starts_on, NEW.ends_on, '[]')
  ) THEN
    RAISE EXCEPTION 'Las fechas del ejercicio se solapan con otro ejercicio';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER accounting_periods_validate_dates
BEFORE INSERT OR UPDATE OF starts_on, ends_on ON accounting_periods
FOR EACH ROW EXECUTE FUNCTION validate_accounting_period_dates();

CREATE OR REPLACE FUNCTION protect_closed_accounting_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Un ejercicio cerrado es inmutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER accounting_periods_protect_closed
BEFORE UPDATE OR DELETE ON accounting_periods
FOR EACH ROW EXECUTE FUNCTION protect_closed_accounting_period();

CREATE OR REPLACE FUNCTION protect_posted_accounting_entry_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Un asiento contabilizado no se puede eliminar; crea una reversión';
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER accounting_entries_protect_posted_delete
BEFORE DELETE ON accounting_entries
FOR EACH ROW EXECUTE FUNCTION protect_posted_accounting_entry_delete();

CREATE OR REPLACE FUNCTION protect_posted_accounting_lines()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_entry_id uuid;
BEGIN
  target_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;
  IF EXISTS (SELECT 1 FROM accounting_entries WHERE id = target_entry_id AND status = 'posted') THEN
    RAISE EXCEPTION 'Las líneas de un asiento contabilizado son inmutables';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

DROP TRIGGER accounting_lines_protect_update ON accounting_entry_lines;
CREATE TRIGGER accounting_lines_protect_posted
BEFORE INSERT OR UPDATE OR DELETE ON accounting_entry_lines
FOR EACH ROW EXECUTE FUNCTION protect_posted_accounting_lines();

CREATE INDEX accounting_entries_period_status_idx
  ON accounting_entries (community_id, period_id, status, entry_date DESC);
CREATE INDEX accounting_entry_lines_entry_order_idx
  ON accounting_entry_lines (community_id, entry_id, line_number);

COMMENT ON TABLE accounting_accounts IS
  'Plan de gestión basado en la estructura decimal del PGC y adaptado a comunidades de propietarios; admite cuentas propias.';
