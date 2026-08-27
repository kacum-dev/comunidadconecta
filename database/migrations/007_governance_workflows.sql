-- Gobierno de la comunidad: orden del día, asistencia, representación, voto y acuerdos.

CREATE TABLE meeting_agenda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position > 0),
  title text NOT NULL,
  proposal text NOT NULL,
  voting_rule text NOT NULL DEFAULT 'simple_majority'
    CHECK (voting_rule IN ('simple_majority','qualified_majority','unanimity')),
  qualified_threshold numeric(5,2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','open','approved','rejected','tied')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, position),
  CHECK (voting_rule <> 'qualified_majority' OR qualified_threshold BETWEEN 50 AND 100)
);

CREATE TABLE meeting_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES private_units(id) ON DELETE RESTRICT,
  relation_id uuid REFERENCES unit_relations(id) ON DELETE SET NULL,
  represented_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  attendance_type text NOT NULL CHECK (attendance_type IN ('present','represented','absent')),
  coefficient_snapshot numeric(9,6) NOT NULL CHECK (coefficient_snapshot >= 0),
  representation_note text,
  verified_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, unit_id)
);

CREATE TABLE meeting_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  agenda_item_id uuid NOT NULL REFERENCES meeting_agenda_items(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES private_units(id) ON DELETE RESTRICT,
  choice text NOT NULL CHECK (choice IN ('yes','no','abstain')),
  coefficient_snapshot numeric(9,6) NOT NULL CHECK (coefficient_snapshot >= 0),
  cast_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agenda_item_id, unit_id)
);

CREATE TABLE meeting_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE RESTRICT,
  agenda_item_id uuid NOT NULL REFERENCES meeting_agenda_items(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text NOT NULL,
  responsible text NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','blocked')),
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agenda_item_id)
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['meeting_agenda_items','meeting_attendance','meeting_votes','meeting_agreements']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO comunidad_conecta_app USING (community_id=current_app_community_id()) WITH CHECK (community_id=current_app_community_id())',table_name);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO comunidad_conecta_app',table_name);
  END LOOP;
END $$;

CREATE INDEX meeting_agenda_items_meeting_idx ON meeting_agenda_items(community_id,meeting_id,position);
CREATE INDEX meeting_votes_item_idx ON meeting_votes(community_id,agenda_item_id,choice);
CREATE INDEX meeting_agreements_status_idx ON meeting_agreements(community_id,status,due_date);
