-- Esquema de Base de Datos para Sistema de Monitoreo Bioacústico
-- Ejecutar en el SQL Editor de Supabase

-- Crear tabla de eventos (alertas)
CREATE TABLE IF NOT EXISTS events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    device_id TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Crear índices para mejorar el rendimiento de consultas
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_device_id ON events(device_id);
CREATE INDEX IF NOT EXISTS idx_events_alert_type ON events(alert_type);

-- Habilitar Row Level Security (RLS)
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Política para permitir inserts desde el cliente (usando anon key)
CREATE POLICY "Permitir inserts públicos" ON events
    FOR INSERT
    TO anon
    WITH CHECK (true);

-- Política para permitir lectura a usuarios autenticados
CREATE POLICY "Permitir lectura pública" ON events
    FOR SELECT
    TO anon
    USING (true);

-- Comentarios para documentación
COMMENT ON TABLE events IS 'Registro de alertas del sistema de monitoreo bioacústico';
COMMENT ON COLUMN events.id IS 'Identificador único del evento';
COMMENT ON COLUMN events.created_at IS 'Timestamp de cuando ocurrió la alerta';
COMMENT ON COLUMN events.device_id IS 'ID del dispositivo que detectó la alerta (ej: mac-dev-01, rpi-sala-04)';
COMMENT ON COLUMN events.alert_type IS 'Tipo de alerta (ej: noise_threshold, high_pitch, ml_prediction)';
COMMENT ON COLUMN events.confidence IS 'Nivel de confianza de la alerta (0.0 - 1.0)';
COMMENT ON COLUMN events.metadata IS 'Datos adicionales en formato JSON (rms, zcr, audio_file, etc)';

