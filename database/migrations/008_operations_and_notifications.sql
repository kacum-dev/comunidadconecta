-- Operaciones conectadas y notificaciones transaccionales.

CREATE TABLE ticket_work_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
 ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
 supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,title text NOT NULL,description text NOT NULL,status text NOT NULL DEFAULT 'draft'
 CHECK(status IN('draft','awaiting_approval','approved','scheduled','in_progress','completed','cancelled')),
 scheduled_date date,estimated_cost_cents bigint CHECK(estimated_cost_cents IS NULL OR estimated_cost_cents>=0),
 actual_cost_cents bigint CHECK(actual_cost_cents IS NULL OR actual_cost_cents>=0),created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
 updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ticket_updates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
 ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,work_order_id uuid REFERENCES ticket_work_orders(id) ON DELETE SET NULL,
 kind text NOT NULL CHECK(kind IN('comment','status','visit','evidence','cost')),message text NOT NULL,
 visible_to_resident boolean NOT NULL DEFAULT true,created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,type text NOT NULL,title text NOT NULL,body text NOT NULL,
 href text,read_at timestamptz,source_type text NOT NULL,source_id uuid NOT NULL,idempotency_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(community_id,user_id,idempotency_key)
);
CREATE TABLE notification_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
 notification_id uuid NOT NULL REFERENCES user_notifications(id) ON DELETE CASCADE,channel text NOT NULL CHECK(channel IN('email','push')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','sent','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,UNIQUE(notification_id,channel)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['ticket_work_orders','ticket_updates','user_notifications','notification_outbox'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO comunidad_conecta_app USING(community_id=current_app_community_id()) WITH CHECK(community_id=current_app_community_id())',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO comunidad_conecta_app',t);END LOOP;END $$;
CREATE INDEX ticket_work_orders_ticket_idx ON ticket_work_orders(community_id,ticket_id,status);
CREATE INDEX ticket_updates_ticket_idx ON ticket_updates(community_id,ticket_id,created_at);
CREATE INDEX user_notifications_user_idx ON user_notifications(community_id,user_id,read_at,created_at DESC);
CREATE INDEX notification_outbox_pending_idx ON notification_outbox(status,next_attempt_at) WHERE status IN('pending','failed');
