ALTER TABLE community_integrations
  DROP CONSTRAINT IF EXISTS community_integrations_kind_check;

ALTER TABLE community_integrations
  ADD CONSTRAINT community_integrations_kind_check
  CHECK (kind IN ('accounting', 'banking', 'storage', 'calendar', 'email', 'weather', 'webhook', 'other'));

COMMENT ON COLUMN community_integrations.kind IS 'Tipo funcional de la conexión, incluida meteorología para proveedores como AEMET.';
