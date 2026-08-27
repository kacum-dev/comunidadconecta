ALTER TABLE community_app_settings
  ADD COLUMN communications_enabled boolean NOT NULL DEFAULT false;

UPDATE community_app_settings settings
   SET communications_enabled = true
  FROM communities community
 WHERE community.id = settings.community_id
   AND community.is_demo = true;

COMMENT ON COLUMN community_app_settings.communications_enabled IS
  'Activa por comunidad el centro omnicanal. Desactivado por defecto para evitar consumo y costes externos no solicitados.';
