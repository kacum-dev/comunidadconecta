-- Activación del módulo contable por comunidad.
-- Las comunidades que ya han utilizado el libro conservan el módulo activo;
-- las nuevas empiezan con él desactivado hasta que Administración lo habilite.

ALTER TABLE community_app_settings
  ADD COLUMN accounting_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN accounting_enabled_at timestamptz,
  ADD COLUMN accounting_enabled_by uuid REFERENCES app_users(id) ON DELETE SET NULL;

UPDATE community_app_settings settings
   SET accounting_enabled = true,
       accounting_enabled_at = now()
 WHERE EXISTS (
   SELECT 1
     FROM accounting_entries entry
    WHERE entry.community_id = settings.community_id
 );

CREATE INDEX community_app_settings_accounting_idx
  ON community_app_settings (community_id)
  WHERE accounting_enabled = true;

COMMENT ON COLUMN community_app_settings.accounting_enabled IS
  'Activa el libro contable y la contabilización automática de cobros, pagos y sus reversiones para esta comunidad.';
COMMENT ON COLUMN community_app_settings.accounting_enabled_at IS
  'Última fecha en que Administración activó el módulo contable.';

