-- Centro omnicanal: una sola conversación aunque la información llegue por canales distintos.

CREATE TABLE communication_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  participant_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  private_unit_id uuid REFERENCES private_units(id) ON DELETE SET NULL,
  related_ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
  assigned_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 300),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  source_channel text NOT NULL CHECK (source_channel IN ('app','email','phone','whatsapp','in_person','other')),
  last_channel text NOT NULL CHECK (last_channel IN ('app','email','phone','whatsapp','in_person','other')),
  external_thread_key text,
  contact_name text,
  contact_address text,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE communication_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  thread_id uuid NOT NULL REFERENCES communication_threads(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound','internal','system')),
  channel text NOT NULL CHECK (channel IN ('app','email','phone','whatsapp','in_person','other')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  sender_name text,
  sender_address text,
  external_message_id text,
  visible_to_resident boolean NOT NULL DEFAULT true,
  delivery_status text NOT NULL DEFAULT 'recorded' CHECK (delivery_status IN ('recorded','queued','sent','delivered','failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['communication_threads','communication_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO comunidad_conecta_app USING (community_id=current_app_community_id()) WITH CHECK (community_id=current_app_community_id())',
      table_name
    );
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO comunidad_conecta_app', table_name);
  END LOOP;
END $$;

CREATE TRIGGER communication_threads_set_updated_at
  BEFORE UPDATE ON communication_threads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX communication_threads_inbox_idx
  ON communication_threads (community_id, status, last_activity_at DESC);
CREATE INDEX communication_threads_participant_idx
  ON communication_threads (community_id, participant_user_id, last_activity_at DESC)
  WHERE participant_user_id IS NOT NULL;
CREATE INDEX communication_threads_ticket_idx
  ON communication_threads (community_id, related_ticket_id, last_activity_at DESC)
  WHERE related_ticket_id IS NOT NULL;
CREATE UNIQUE INDEX communication_threads_external_key_uidx
  ON communication_threads (community_id, source_channel, external_thread_key)
  WHERE external_thread_key IS NOT NULL;
CREATE INDEX communication_messages_thread_idx
  ON communication_messages (community_id, thread_id, occurred_at, created_at);
CREATE UNIQUE INDEX communication_messages_external_id_uidx
  ON communication_messages (community_id, channel, external_message_id)
  WHERE external_message_id IS NOT NULL;

COMMENT ON TABLE communication_threads IS 'Conversaciones unificadas de la comunidad, independientes del canal de entrada o salida.';
COMMENT ON TABLE communication_messages IS 'Interacciones cronológicas de una conversación: app, correo, teléfono, WhatsApp, presencial u otros canales.';
COMMENT ON COLUMN communication_messages.delivery_status IS 'Estado técnico conocido; recorded no implica que un canal externo haya entregado el mensaje.';
