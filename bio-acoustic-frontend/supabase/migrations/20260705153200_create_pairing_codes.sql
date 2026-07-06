-- Fase 0-A · Migración 3/4
-- Nueva tabla para el flujo de comisionado (Farm Admin genera código de 6 dígitos, firmware lo consume vía captive portal).
-- RLS: SELECT/INSERT sólo con service role — el frontend usa la Route Handler /api/pairing-code para todo.

CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,                                     -- 6 dígitos numéricos
  site_id UUID REFERENCES sites(id) NOT NULL,
  room_id UUID REFERENCES rooms(id) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pairing_codes_site_id ON pairing_codes(site_id);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires_at ON pairing_codes(expires_at) WHERE used_at IS NULL;

ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;

-- Sin policies para anon/authenticated → deny by default.
-- Todo el acceso a esta tabla va vía service_role desde Route Handlers en app/api/*.

COMMENT ON TABLE pairing_codes IS 'Códigos de 6 dígitos de un solo uso para vincular un ESP32 a un site+room. TTL corto (10 min típico). Acceso: sólo service_role.';
COMMENT ON COLUMN pairing_codes.code IS 'Código de 6 dígitos que ve el Farm Admin y teclea el instalador en el captive portal del ESP32.';
COMMENT ON COLUMN pairing_codes.used_at IS 'NULL = disponible. Timestamp = ya reclamado, no reutilizable.';
