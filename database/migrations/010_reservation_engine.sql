-- Motor de reservas con recursos, reglas, bloqueos y prevención transaccional de solapes.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE reservation_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('community_room','pool','sports','moving','barbecue','parking','other')),
  location text,
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity > 0),
  opening_time time NOT NULL DEFAULT '08:00',
  closing_time time NOT NULL DEFAULT '22:00',
  slot_minutes integer NOT NULL DEFAULT 60 CHECK (slot_minutes BETWEEN 15 AND 1440),
  min_notice_hours integer NOT NULL DEFAULT 2 CHECK (min_notice_hours >= 0),
  advance_days integer NOT NULL DEFAULT 30 CHECK (advance_days BETWEEN 1 AND 365),
  cancellation_hours integer NOT NULL DEFAULT 12 CHECK (cancellation_hours >= 0),
  max_active_per_user integer NOT NULL DEFAULT 3 CHECK (max_active_per_user > 0),
  requires_approval boolean NOT NULL DEFAULT false,
  deposit_cents bigint NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  rules text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive')),
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id,name)
);

CREATE TABLE reservation_blackouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  resource_id uuid NOT NULL REFERENCES reservation_resources(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE reservation_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  resource_id uuid NOT NULL REFERENCES reservation_resources(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  title text NOT NULL,
  attendees integer NOT NULL DEFAULT 1 CHECK (attendees > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','rejected','cancelled','completed')),
  deposit_status text NOT NULL DEFAULT 'not_required' CHECK (deposit_status IN ('not_required','pending','held','returned','retained')),
  notes text,
  decision_note text,
  decided_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  cancelled_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  EXCLUDE USING gist (resource_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
    WHERE (status IN ('requested','confirmed'))
);

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['reservation_resources','reservation_blackouts','reservation_bookings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO comunidad_conecta_app USING (community_id=current_app_community_id()) WITH CHECK (community_id=current_app_community_id())',table_name);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO comunidad_conecta_app',table_name);
  END LOOP;
END $$;

CREATE INDEX reservation_resources_active_idx ON reservation_resources(community_id,status,name);
CREATE INDEX reservation_bookings_calendar_idx ON reservation_bookings(community_id,starts_at,ends_at,status);
CREATE INDEX reservation_bookings_user_idx ON reservation_bookings(community_id,user_id,status,starts_at);
CREATE INDEX reservation_blackouts_calendar_idx ON reservation_blackouts(community_id,resource_id,starts_at,ends_at);
