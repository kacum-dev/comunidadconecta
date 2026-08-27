-- Preserve the original date-only fields for backwards compatibility while
-- adding exact instants for every shared record type. Historical values keep
-- an explicit `day` precision so the UI never presents an invented hour.

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'structure_nodes', 'people_relations', 'financial_records',
    'bank_transactions', 'meetings', 'communications', 'tickets',
    'suppliers', 'documents', 'transitions', 'privacy_cases',
    'approvals', 'assets', 'reservations', 'configuration_records'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN event_at timestamptz', table_name);
    EXECUTE format('ALTER TABLE %I ADD COLUMN due_at timestamptz', table_name);
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN event_time_precision text CHECK (event_time_precision IN (''day'',''minute'',''second''))',
      table_name
    );
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN due_time_precision text CHECK (due_time_precision IN (''day'',''minute'',''second''))',
      table_name
    );
    EXECUTE format('ALTER TABLE %I ADD COLUMN due_inclusive boolean NOT NULL DEFAULT true', table_name);

    EXECUTE format(
      'UPDATE %I record
          SET event_at = record.event_date::timestamp AT TIME ZONE COALESCE(community.timezone, ''Europe/Madrid''),
              event_time_precision = ''day''
         FROM communities community
        WHERE record.community_id = community.id AND record.event_date IS NOT NULL',
      table_name
    );
    EXECUTE format(
      'UPDATE %I record
          SET due_at = ((record.due_date + 1)::timestamp AT TIME ZONE COALESCE(community.timezone, ''Europe/Madrid'')) - interval ''1 second'',
              due_time_precision = ''day''
         FROM communities community
        WHERE record.community_id = community.id AND record.due_date IS NOT NULL',
      table_name
    );

    EXECUTE format(
      'CREATE INDEX %I ON %I (community_id, event_at DESC) WHERE archived_at IS NULL',
      table_name || '_tenant_event_at_idx', table_name
    );
    EXECUTE format(
      'CREATE INDEX %I ON %I (community_id, due_at) WHERE archived_at IS NULL AND due_at IS NOT NULL',
      table_name || '_tenant_due_at_idx', table_name
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION sync_shared_record_moments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  community_timezone text;
BEGIN
  SELECT COALESCE(timezone, 'Europe/Madrid')
    INTO community_timezone
    FROM communities
   WHERE id = NEW.community_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.event_at IS NOT NULL THEN
      NEW.event_date := (NEW.event_at AT TIME ZONE community_timezone)::date;
      NEW.event_time_precision := COALESCE(NEW.event_time_precision, 'minute');
    ELSIF NEW.event_date IS NOT NULL THEN
      NEW.event_at := NEW.event_date::timestamp AT TIME ZONE community_timezone;
      NEW.event_time_precision := 'day';
    END IF;
  ELSIF NEW.event_at IS DISTINCT FROM OLD.event_at THEN
    IF NEW.event_at IS NULL THEN
      NEW.event_date := NULL;
      NEW.event_time_precision := NULL;
    ELSE
      NEW.event_date := (NEW.event_at AT TIME ZONE community_timezone)::date;
      NEW.event_time_precision := COALESCE(NEW.event_time_precision, 'minute');
    END IF;
  ELSIF NEW.event_date IS DISTINCT FROM OLD.event_date THEN
    IF NEW.event_date IS NULL THEN
      NEW.event_at := NULL;
      NEW.event_time_precision := NULL;
    ELSE
      NEW.event_at := NEW.event_date::timestamp AT TIME ZONE community_timezone;
      NEW.event_time_precision := 'day';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.due_at IS NOT NULL THEN
      NEW.due_date := (NEW.due_at AT TIME ZONE community_timezone)::date;
      NEW.due_time_precision := COALESCE(NEW.due_time_precision, 'minute');
    ELSIF NEW.due_date IS NOT NULL THEN
      NEW.due_at := ((NEW.due_date + 1)::timestamp AT TIME ZONE community_timezone) - interval '1 second';
      NEW.due_time_precision := 'day';
    END IF;
  ELSIF NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    IF NEW.due_at IS NULL THEN
      NEW.due_date := NULL;
      NEW.due_time_precision := NULL;
    ELSE
      NEW.due_date := (NEW.due_at AT TIME ZONE community_timezone)::date;
      NEW.due_time_precision := COALESCE(NEW.due_time_precision, 'minute');
    END IF;
  ELSIF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    IF NEW.due_date IS NULL THEN
      NEW.due_at := NULL;
      NEW.due_time_precision := NULL;
    ELSE
      NEW.due_at := ((NEW.due_date + 1)::timestamp AT TIME ZONE community_timezone) - interval '1 second';
      NEW.due_time_precision := 'day';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'structure_nodes', 'people_relations', 'financial_records',
    'bank_transactions', 'meetings', 'communications', 'tickets',
    'suppliers', 'documents', 'transitions', 'privacy_cases',
    'approvals', 'assets', 'reservations', 'configuration_records'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF event_date,due_date,event_at,due_at ON %I
       FOR EACH ROW EXECUTE FUNCTION sync_shared_record_moments()',
      table_name || '_sync_moments', table_name
    );
  END LOOP;
END
$$;

COMMENT ON FUNCTION sync_shared_record_moments() IS
  'Keeps legacy date fields aligned with exact instants using the community timezone; date-only deadlines are inclusive through 23:59:59.';

ALTER TABLE financial_records
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN paid_time_precision text CHECK (paid_time_precision IN ('minute','second'));

COMMENT ON COLUMN financial_records.paid_at IS
  'Exact confirmed payment instant. Kept null for legacy paid rows when the actual payment time is unknown.';

ALTER TABLE fee_issues
  ADD COLUMN due_at timestamptz,
  ADD COLUMN due_time_precision text CHECK (due_time_precision IN ('day','minute','second')),
  ADD COLUMN due_inclusive boolean NOT NULL DEFAULT true;
ALTER TABLE meeting_agreements
  ADD COLUMN due_at timestamptz,
  ADD COLUMN due_time_precision text CHECK (due_time_precision IN ('day','minute','second')),
  ADD COLUMN due_inclusive boolean NOT NULL DEFAULT true;
ALTER TABLE ticket_work_orders
  ADD COLUMN scheduled_at timestamptz,
  ADD COLUMN scheduled_time_precision text CHECK (scheduled_time_precision IN ('day','minute','second'));

UPDATE fee_issues item
   SET due_at = ((item.due_date + 1)::timestamp AT TIME ZONE COALESCE(community.timezone, 'Europe/Madrid')) - interval '1 second',
       due_time_precision = 'day'
  FROM communities community
 WHERE item.community_id = community.id;
UPDATE meeting_agreements item
   SET due_at = ((item.due_date + 1)::timestamp AT TIME ZONE COALESCE(community.timezone, 'Europe/Madrid')) - interval '1 second',
       due_time_precision = 'day'
  FROM communities community
 WHERE item.community_id = community.id AND item.due_date IS NOT NULL;
UPDATE ticket_work_orders item
   SET scheduled_at = item.scheduled_date::timestamp AT TIME ZONE COALESCE(community.timezone, 'Europe/Madrid'),
       scheduled_time_precision = 'day'
  FROM communities community
 WHERE item.community_id = community.id AND item.scheduled_date IS NOT NULL;

CREATE OR REPLACE FUNCTION sync_specialized_deadline()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE community_timezone text;
BEGIN
  SELECT COALESCE(timezone, 'Europe/Madrid') INTO community_timezone FROM communities WHERE id=NEW.community_id;
  IF TG_OP='INSERT' THEN
    IF NEW.due_at IS NOT NULL THEN
      NEW.due_date := (NEW.due_at AT TIME ZONE community_timezone)::date;
      NEW.due_time_precision := COALESCE(NEW.due_time_precision,'minute');
    ELSIF NEW.due_date IS NOT NULL THEN
      NEW.due_at := ((NEW.due_date + 1)::timestamp AT TIME ZONE community_timezone) - interval '1 second';
      NEW.due_time_precision := 'day';
    END IF;
  ELSIF NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    NEW.due_date := CASE WHEN NEW.due_at IS NULL THEN NULL ELSE (NEW.due_at AT TIME ZONE community_timezone)::date END;
    NEW.due_time_precision := CASE WHEN NEW.due_at IS NULL THEN NULL ELSE COALESCE(NEW.due_time_precision,'minute') END;
  ELSIF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    NEW.due_at := CASE WHEN NEW.due_date IS NULL THEN NULL ELSE ((NEW.due_date + 1)::timestamp AT TIME ZONE community_timezone) - interval '1 second' END;
    NEW.due_time_precision := CASE WHEN NEW.due_date IS NULL THEN NULL ELSE 'day' END;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER fee_issues_sync_deadline BEFORE INSERT OR UPDATE OF due_date,due_at ON fee_issues
FOR EACH ROW EXECUTE FUNCTION sync_specialized_deadline();
CREATE TRIGGER meeting_agreements_sync_deadline BEFORE INSERT OR UPDATE OF due_date,due_at ON meeting_agreements
FOR EACH ROW EXECUTE FUNCTION sync_specialized_deadline();

CREATE OR REPLACE FUNCTION sync_work_order_schedule()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE community_timezone text;
BEGIN
  SELECT COALESCE(timezone, 'Europe/Madrid') INTO community_timezone FROM communities WHERE id=NEW.community_id;
  IF TG_OP='INSERT' THEN
    IF NEW.scheduled_at IS NOT NULL THEN
      NEW.scheduled_date := (NEW.scheduled_at AT TIME ZONE community_timezone)::date;
      NEW.scheduled_time_precision := COALESCE(NEW.scheduled_time_precision,'minute');
    ELSIF NEW.scheduled_date IS NOT NULL THEN
      NEW.scheduled_at := NEW.scheduled_date::timestamp AT TIME ZONE community_timezone;
      NEW.scheduled_time_precision := 'day';
    END IF;
  ELSIF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
    NEW.scheduled_date := CASE WHEN NEW.scheduled_at IS NULL THEN NULL ELSE (NEW.scheduled_at AT TIME ZONE community_timezone)::date END;
    NEW.scheduled_time_precision := CASE WHEN NEW.scheduled_at IS NULL THEN NULL ELSE COALESCE(NEW.scheduled_time_precision,'minute') END;
  ELSIF NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date THEN
    NEW.scheduled_at := CASE WHEN NEW.scheduled_date IS NULL THEN NULL ELSE NEW.scheduled_date::timestamp AT TIME ZONE community_timezone END;
    NEW.scheduled_time_precision := CASE WHEN NEW.scheduled_date IS NULL THEN NULL ELSE 'day' END;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER ticket_work_orders_sync_schedule BEFORE INSERT OR UPDATE OF scheduled_date,scheduled_at ON ticket_work_orders
FOR EACH ROW EXECUTE FUNCTION sync_work_order_schedule();

CREATE INDEX fee_issues_due_at_idx ON fee_issues(community_id,due_at,status);
CREATE INDEX meeting_agreements_due_at_idx ON meeting_agreements(community_id,status,due_at);
CREATE INDEX ticket_work_orders_scheduled_at_idx ON ticket_work_orders(community_id,scheduled_at,status);
CREATE INDEX financial_records_paid_at_idx ON financial_records(community_id,paid_at) WHERE paid_at IS NOT NULL;
