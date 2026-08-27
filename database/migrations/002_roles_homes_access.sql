ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships
  ADD CONSTRAINT memberships_role_check
  CHECK (role IN (
    'owner', 'resident', 'president', 'vice_president', 'secretary', 'treasurer',
    'administrator', 'supplier', 'auditor', 'support', 'platform_admin'
  ));

CREATE TABLE private_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  structure_node_id uuid REFERENCES structure_nodes(id) ON DELETE SET NULL,
  code text NOT NULL,
  unit_type text NOT NULL DEFAULT 'home' CHECK (unit_type IN ('home', 'commercial', 'office', 'garage', 'storage', 'other')),
  floor text,
  door text,
  cadastral_reference text,
  participation_coefficient numeric(9,6) NOT NULL DEFAULT 0 CHECK (participation_coefficient >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'merged', 'divided')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, code)
);

CREATE TABLE unit_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES private_units(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email citext,
  relation_type text NOT NULL CHECK (relation_type IN ('owner', 'co_owner', 'tenant', 'authorized_resident')),
  ownership_percentage numeric(7,4) CHECK (ownership_percentage IS NULL OR (ownership_percentage > 0 AND ownership_percentage <= 100)),
  is_primary boolean NOT NULL DEFAULT false,
  can_vote boolean NOT NULL DEFAULT false,
  valid_from date NOT NULL,
  valid_to date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'ended', 'rejected')),
  source text NOT NULL DEFAULT 'administration' CHECK (source IN ('administration', 'owner_declaration', 'invitation', 'import')),
  declared_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  verified_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (
    (relation_type IN ('owner', 'co_owner') AND ownership_percentage IS NOT NULL)
    OR (relation_type IN ('tenant', 'authorized_resident') AND ownership_percentage IS NULL)
  )
);

CREATE UNIQUE INDEX unit_relations_active_user_type_uidx
  ON unit_relations (community_id, unit_id, user_id, relation_type)
  WHERE status IN ('pending', 'active') AND user_id IS NOT NULL;
CREATE INDEX unit_relations_user_active_idx
  ON unit_relations (community_id, user_id, status, valid_to);
CREATE INDEX unit_relations_unit_active_idx
  ON unit_relations (community_id, unit_id, status, valid_to);

CREATE TABLE access_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  email citext NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN (
    'owner', 'resident', 'president', 'vice_president', 'secretary', 'treasurer',
    'administrator', 'supplier', 'auditor'
  )),
  unit_id uuid REFERENCES private_units(id) ON DELETE RESTRICT,
  relation_type text CHECK (relation_type IN ('owner', 'co_owner', 'tenant', 'authorized_resident')),
  token_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  accepted_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (role IN ('owner', 'resident') AND unit_id IS NOT NULL AND relation_type IS NOT NULL)
    OR (role NOT IN ('owner', 'resident') AND unit_id IS NULL AND relation_type IS NULL)
  )
);

CREATE INDEX access_invitations_tenant_status_idx
  ON access_invitations (community_id, status, expires_at DESC);

ALTER TABLE financial_records ADD COLUMN private_unit_id uuid REFERENCES private_units(id) ON DELETE RESTRICT;
ALTER TABLE tickets ADD COLUMN private_unit_id uuid REFERENCES private_units(id) ON DELETE RESTRICT;
ALTER TABLE reservations ADD COLUMN private_unit_id uuid REFERENCES private_units(id) ON DELETE RESTRICT;
ALTER TABLE documents ADD COLUMN private_unit_id uuid REFERENCES private_units(id) ON DELETE RESTRICT;

CREATE INDEX financial_records_unit_idx ON financial_records (community_id, private_unit_id, updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX tickets_unit_idx ON tickets (community_id, private_unit_id, updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX reservations_unit_idx ON reservations (community_id, private_unit_id, updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX documents_unit_idx ON documents (community_id, private_unit_id, updated_at DESC) WHERE archived_at IS NULL;

CREATE TRIGGER private_units_set_updated_at
BEFORE UPDATE ON private_units
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER unit_relations_set_updated_at
BEFORE UPDATE ON unit_relations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE private_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_units FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON private_units FOR ALL TO comunidad_conecta_app
  USING (community_id = current_app_community_id())
  WITH CHECK (community_id = current_app_community_id());

ALTER TABLE unit_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_relations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON unit_relations FOR ALL TO comunidad_conecta_app
  USING (community_id = current_app_community_id())
  WITH CHECK (community_id = current_app_community_id());

ALTER TABLE access_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON access_invitations FOR ALL TO comunidad_conecta_app
  USING (community_id = current_app_community_id())
  WITH CHECK (community_id = current_app_community_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON private_units, unit_relations, access_invitations TO comunidad_conecta_app;

