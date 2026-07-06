-- Fase 0-A · Migración 2/3
-- Extiende `acoustic_events` con columnas necesarias para v2 (tenant explícito + telemetría + label operador).
-- Todas nullables + IF NOT EXISTS. NO se toca RLS, policies ni columnas existentes.
--
-- Columnas ya existentes en el remoto (verificadas 2026-07-06 vía pg_dump):
--   id (integer SERIAL), device_id (uuid), "time" (timestamptz), rms_level (numeric NOT NULL),
--   battery_percentage (integer), event_type (text), audio_url (text), metadata (jsonb sin default),
--   room_id (uuid), created_at (timestamptz), confidence (numeric DEFAULT 0.90).
--
-- Ajustes 2026-07-06 (post-audit):
--   - NO se añade `metadata` — ya existe.
--   - `id` es INTEGER SERIAL (no UUID) → el `event_id` que devolverá /api/ingest será entero.

ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id);
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS baseline_rms FLOAT;
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS peak_rms FLOAT;
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS dominant_freq_hz FLOAT;
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS temp_c FLOAT;
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS uptime_ms BIGINT;
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS operator_label TEXT;

CREATE INDEX IF NOT EXISTS idx_acoustic_events_site_id ON acoustic_events(site_id);
CREATE INDEX IF NOT EXISTS idx_acoustic_events_operator_label ON acoustic_events(operator_label) WHERE operator_label IS NOT NULL;

COMMENT ON COLUMN acoustic_events.site_id IS 'Tenant del evento. Se rellena server-side en /api/ingest desde devices.mac_address -> devices.room_id -> rooms.building_id -> buildings.site_id. Denormalizado para acelerar queries y para el path del bucket alerts/<site_id>/<mac>/<yyyy-mm>/<file>.wav (curación offline sin JOIN).';
COMMENT ON COLUMN acoustic_events.baseline_rms IS 'RMS de baseline ambiental medido por el firmware antes de la alerta.';
COMMENT ON COLUMN acoustic_events.peak_rms IS 'RMS pico durante la ventana de alerta. `rms_level` legacy queda para compatibilidad.';
COMMENT ON COLUMN acoustic_events.dominant_freq_hz IS 'Frecuencia dominante en la ventana de alerta (Hz).';
COMMENT ON COLUMN acoustic_events.temp_c IS 'Temperatura interna del nodo (°C) al momento del evento.';
COMMENT ON COLUMN acoustic_events.uptime_ms IS 'Uptime del nodo en ms al momento del evento.';
COMMENT ON COLUMN acoustic_events.operator_label IS 'Etiqueta humana capturada con BTN_LABEL en el borde. NULL = sin etiqueta, "crushing" = aplastamiento confirmado.';
