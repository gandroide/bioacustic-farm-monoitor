-- ============================================================================
-- Snapshot documental del schema Supabase — bio-acoustic-farm v2
-- ============================================================================
-- Este archivo NO se ejecuta. Es una referencia rápida del estado del schema
-- tras aplicar las migraciones de `bio-acoustic-frontend/supabase/migrations/`.
--
-- Fuente de verdad ejecutable:
--   - bio-acoustic-frontend/supabase/migrations/*.sql (aplicadas vía `supabase db push`)
--   - Estado real en el proyecto Supabase productivo `uaecpeaefqwjpxgjbfye`.
--
-- Actualizado: 2026-07-06 (Fase 0-A aplicada).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Jerarquía multi-tenant (pre-existente, no modificada por Fase 0-A)
-- ----------------------------------------------------------------------------

-- organizations: cliente enterprise (ej: "Grupo Porcícola Brivex")
-- sites:         granja física dentro de una organization (ej: "Granja Jalisco Norte")
-- buildings:     nave/edificio dentro de un site
-- rooms:         sala/área dentro de un building
-- profiles:      usuarios vinculados a una organization (roles DB reales: super_admin | org_admin | site_admin)
-- devices:       ESP32-S3 IoT vinculado a una room (mac_address VARCHAR(17), UUID PK)

-- ----------------------------------------------------------------------------
-- devices (Fase 0-A: 1 columna nueva)
-- ----------------------------------------------------------------------------

-- Columnas pre-existentes:
--   id UUID, room_id UUID, mac_address VARCHAR(17) UNIQUE, name TEXT,
--   status TEXT DEFAULT 'active', last_heartbeat TIMESTAMPTZ,
--   created_at TIMESTAMPTZ, is_active BOOLEAN DEFAULT true, updated_at TIMESTAMPTZ, uid TEXT

-- Columna nueva:
--   ingest_token TEXT UNIQUE   -- token opaco por dispositivo (header X-Device-Token en /api/ingest)

-- NOTA: NO se añadió `last_seen` — la tabla ya tiene `last_heartbeat` con la misma semántica.

-- ----------------------------------------------------------------------------
-- acoustic_events (Fase 0-A: 7 columnas nuevas + 2 índices)
-- ----------------------------------------------------------------------------

-- ⚠️ id es INTEGER SERIAL, no UUID.

-- Columnas pre-existentes:
--   id INTEGER SERIAL PRIMARY KEY, device_id UUID REFERENCES devices(id),
--   "time" TIMESTAMPTZ, rms_level NUMERIC NOT NULL, battery_percentage INTEGER,
--   event_type TEXT, audio_url TEXT, metadata JSONB, room_id UUID,
--   created_at TIMESTAMPTZ, confidence NUMERIC DEFAULT 0.90

-- Columnas nuevas:
--   site_id           UUID REFERENCES sites(id)  -- tenant, se rellena server-side en /api/ingest
--   baseline_rms      FLOAT                      -- RMS ambiental antes de la alerta
--   peak_rms          FLOAT                      -- RMS pico durante la alerta
--   dominant_freq_hz  FLOAT                      -- frecuencia dominante (Hz)
--   temp_c            FLOAT                      -- temperatura del nodo (°C)
--   uptime_ms         BIGINT                     -- uptime en ms
--   operator_label    TEXT                       -- NULL | 'crushing' (BTN_LABEL)

-- Índices nuevos:
--   idx_acoustic_events_site_id
--   idx_acoustic_events_operator_label (parcial: WHERE operator_label IS NOT NULL)

-- NOTA: NO se añadió `metadata` — ya existe (jsonb sin default).

-- ----------------------------------------------------------------------------
-- pairing_codes (Fase 0-A: tabla nueva)
-- ----------------------------------------------------------------------------

-- CREATE TABLE pairing_codes (
--   code TEXT PRIMARY KEY,                        -- 6 dígitos numéricos
--   site_id UUID REFERENCES sites(id) NOT NULL,
--   room_id UUID REFERENCES rooms(id) NOT NULL,
--   expires_at TIMESTAMPTZ NOT NULL,
--   used_at TIMESTAMPTZ,
--   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- );

-- Índices: idx_pairing_codes_site_id, idx_pairing_codes_expires_at (parcial: WHERE used_at IS NULL)
-- RLS: ENABLED, sin policies → sólo service_role tiene acceso.

-- ----------------------------------------------------------------------------
-- Storage bucket `alerts` (Fase 0-A: NO se tocó)
-- ----------------------------------------------------------------------------

-- Estado actual (2026-07-06): PÚBLICO con policies `acceso_total 1bmm1ef_{0,1,2,3}` a rol `anon`
--   → SELECT / INSERT / UPDATE / DELETE sin restricción de path ni bucket.
-- Es deuda de seguridad conocida. Ver memoria `project-security-debt-pending`.
-- Se endurece en Fase 0-D o cutover.

-- Path del bucket cuando /api/ingest lo empiece a poblar (Fase 5):
--   alerts/<site_id>/<mac_address>/<yyyy-mm>/<filename>.wav

-- ----------------------------------------------------------------------------
-- Row Level Security (Fase 0-A: NO se modificó)
-- ----------------------------------------------------------------------------

-- Estado verificado el 2026-07-06:
--   acoustic_events, buildings, devices, inventory_stock, products, rooms, sites → RLS enabled.
--   organizations, profiles                                                       → RLS OFF.

-- Policies pre-existentes en acoustic_events (que cubren tenant vía join a organizations):
--   - "Super Admin ve todo" (ALL): role = 'super_admin'
--   - "Users can view events of their rooms" (SELECT): room_id → building → site → organization = user.organization_id
--   - "Usuarios ven eventos de su organizacion" (SELECT): device_id → room → building → site → organization = user.organization_id

-- Función helper pre-existente:
--   public.get_auth_org_id() RETURNS uuid  -- SELECT organization_id FROM profiles WHERE id = auth.uid()

-- ============================================================================
-- Próximas fases (fuera del alcance de Fase 0-A):
--   - Fase 0-B: reorganizar lib/supabase.ts en lib/supabase/{client,server}, lib/db/*, lib/services/, lib/validation/. Añadir zod.
--   - Fase 0-C: middleware.ts (auth SSR), quitar ignoreBuildErrors, eliminar app/api/v1/telemetry/route.ts, archivar docs/skill_backend_nestjs.md.
--   - Fase 0-D (nueva): endurecer bucket alerts + activar RLS en organizations/profiles + resolver drift de roles TS↔DB. Requiere cutover coordinado con main.
--   - Fase 5: /api/ingest, /api/pairing-code (Route Handlers) — `event_id` será INTEGER, no UUID.
-- ============================================================================
