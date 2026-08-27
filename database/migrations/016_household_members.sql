-- Familia privada del residente, separada de las declaraciones formales de inquilinos.
CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE TABLE household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES private_units(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (char_length(trim(full_name)) BETWEEN 2 AND 180),
  relationship_type text NOT NULL CHECK (relationship_type IN (
    'partner', 'child', 'parent', 'sibling', 'other_relative', 'dependent', 'other'
  )),
  shared_with_community boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX household_members_creator_idx
  ON household_members (community_id, created_by, unit_id, status, created_at DESC);
CREATE INDEX household_members_shared_idx
  ON household_members (community_id, unit_id, status, updated_at DESC)
  WHERE shared_with_community = true;

CREATE TRIGGER household_members_set_updated_at
BEFORE UPDATE ON household_members
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members FORCE ROW LEVEL SECURITY;

-- La familia es privada por defecto. Compartir significa compartir con los cargos
-- autorizados de la comunidad, nunca con el resto de vecinos.
CREATE POLICY household_members_select ON household_members
FOR SELECT TO comunidad_conecta_app
USING (
  community_id = current_app_community_id()
  AND (
    created_by = current_app_user_id()
    OR (
      shared_with_community = true
      AND EXISTS (
        SELECT 1
          FROM memberships membership
         WHERE membership.community_id = household_members.community_id
           AND membership.user_id = current_app_user_id()
           AND membership.status = 'active'
           AND membership.valid_from <= now()
           AND (membership.valid_to IS NULL OR membership.valid_to > now())
           AND membership.role IN ('president', 'vice_president', 'secretary', 'administrator', 'platform_admin')
      )
    )
  )
);

CREATE POLICY household_members_insert ON household_members
FOR INSERT TO comunidad_conecta_app
WITH CHECK (
  community_id = current_app_community_id()
  AND created_by = current_app_user_id()
  AND EXISTS (
    SELECT 1
      FROM unit_relations relation
     WHERE relation.community_id = household_members.community_id
       AND relation.unit_id = household_members.unit_id
       AND relation.user_id = current_app_user_id()
       AND relation.status = 'active'
       AND relation.valid_from <= current_date
       AND (relation.valid_to IS NULL OR relation.valid_to >= current_date)
  )
);

CREATE POLICY household_members_update ON household_members
FOR UPDATE TO comunidad_conecta_app
USING (
  community_id = current_app_community_id()
  AND created_by = current_app_user_id()
)
WITH CHECK (
  community_id = current_app_community_id()
  AND created_by = current_app_user_id()
);

CREATE POLICY household_members_delete ON household_members
FOR DELETE TO comunidad_conecta_app
USING (
  community_id = current_app_community_id()
  AND created_by = current_app_user_id()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON household_members TO comunidad_conecta_app;

COMMENT ON TABLE household_members IS 'Familia declarada por cada residente, privada salvo consentimiento expreso para administracion.';
COMMENT ON COLUMN household_members.shared_with_community IS 'Consentimiento revocable para mostrar este registro a cargos autorizados de la comunidad.';
