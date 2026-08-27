CREATE TABLE IF NOT EXISTS product_control_installation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
  installation_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  product_code text NOT NULL DEFAULT 'comunidad-conecta',
  usage_type text NOT NULL DEFAULT 'community'
    CHECK (usage_type IN ('community', 'nonprofit', 'demo', 'development', 'commercial')),
  telemetry_level text NOT NULL DEFAULT 'disabled'
    CHECK (telemetry_level IN ('disabled', 'basic', 'product')),
  license_id text,
  license_certificate text,
  license_public_key text,
  license_major_version integer,
  activated_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text NOT NULL DEFAULT 'never'
    CHECK (last_sync_status IN ('never', 'ok', 'error')),
  last_sync_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO product_control_installation (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TRIGGER product_control_installation_set_updated_at
BEFORE UPDATE ON product_control_installation
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE product_control_installation IS
  'Identidad técnica de esta instalación. No contiene datos de propietarios ni contenido comunitario.';
