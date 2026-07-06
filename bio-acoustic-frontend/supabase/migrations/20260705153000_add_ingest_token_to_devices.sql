-- Fase 0-A · Migración 1/3
-- Añade columna para autenticación IoT a `devices`.
-- Nullable + IF NOT EXISTS para idempotencia y para no romper filas existentes ni a `main`.
--
-- Ajuste 2026-07-06 (post-audit): NO se añade `last_seen` — la tabla ya tiene
-- `last_heartbeat TIMESTAMPTZ` con la misma semántica. Reusamos esa columna.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS ingest_token TEXT UNIQUE;

COMMENT ON COLUMN devices.ingest_token IS 'Token opaco por dispositivo, usado por el firmware en header X-Device-Token contra /api/ingest. NULL = dispositivo no reclamado aún.';
