# Integración con Supabase

## 📋 Configuración Inicial

### 1. Crear la Tabla en Supabase

1. Ve a tu proyecto de Supabase: https://uaecpeaefqwjpxgjbfye.supabase.co
2. Navega a **SQL Editor**
3. Copia y pega el contenido del archivo `docs/supabase_schema.sql`
4. Ejecuta el script (botón **Run**)

Esto creará:
- ✅ Tabla `events` con todos los campos necesarios
- ✅ Índices para consultas rápidas
- ✅ Políticas de seguridad (RLS)

### 2. Configurar Storage Bucket para los Archivos de Audio

1. En tu proyecto de Supabase, ve a **Storage**
2. Click en **New bucket**
3. Nombre del bucket: `alerts`
4. **IMPORTANTE**: Marca "Public bucket" ✅
   - Esto permite obtener URLs públicas de los archivos
5. Click en **Create bucket**

#### Configurar Políticas de Acceso

Una vez creado el bucket:

1. Click en el bucket `alerts`
2. Ve a la pestaña **Policies**
3. Crea dos políticas:

**Política de Inserción (Upload):**
```sql
-- Política: Permitir subida pública
CREATE POLICY "Permitir subida pública"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'alerts');
```

**Política de Lectura (Download):**
```sql
-- Política: Permitir lectura pública
CREATE POLICY "Permitir lectura pública"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'alerts');
```

O simplemente marca las opciones:
- ✅ **INSERT**: Public
- ✅ **SELECT**: Public

### 3. Verificar la Configuración

El archivo `.env` ya está configurado con tus credenciales:

```env
SUPABASE_URL=https://uaecpeaefqwjpxgjbfye.supabase.co
SUPABASE_KEY=eyJhbGc...
DEVICE_ID=mac-dev-01
```

⚠️ **IMPORTANTE**: El archivo `.env` está en el `.gitignore` para proteger tus credenciales.

---

## 🚀 Cómo Funciona

### Flujo de Datos

```
1. Micrófono detecta audio alto
2. Sistema analiza (RMS + ZCR)
3. ¿Supera umbrales?
   ├─ SÍ → Graba 3 segundos de audio
   │       └─ Guarda archivo WAV localmente
   │       └─ [Thread asíncrono - NO bloquea]
   │           ├─ Sube archivo a Supabase Storage (bucket 'alerts')
   │           ├─ Obtiene URL pública del archivo
   │           └─ Registra evento en base de datos con la URL
   └─ NO → Continua monitoreando
```

**✨ Ventaja:** La subida a la nube NO bloquea el monitoreo. El sistema puede detectar nuevas alertas mientras sube archivos anteriores en segundo plano.

### Estructura del Evento Enviado

```json
{
  "created_at": "2026-01-27T15:30:45.123Z",
  "device_id": "mac-dev-01",
  "alert_type": "noise_threshold",
  "confidence": 0.65,
  "metadata": {
    "rms": 651.0,
    "zcr": 120.0,
    "audio_file_local": "./grabaciones/alerta_2026-01-27_15-30-45_vol651_freq120.wav",
    "audio_url": "https://uaecpeaefqwjpxgjbfye.supabase.co/storage/v1/object/public/alerts/mac-dev-01/2026-01-27_15-30-45.wav",
    "storage_path": "mac-dev-01/2026-01-27_15-30-45.wav"
  }
}
```

**Campos del metadata:**
- `audio_file_local`: Ruta del archivo guardado localmente (backup)
- `audio_url`: URL pública para reproducir el audio desde la nube ⭐
- `storage_path`: Ruta del archivo en el Storage Bucket (organizado por device_id)

### Campos de la Tabla `events`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | ID único generado automáticamente |
| `created_at` | TIMESTAMP | Fecha y hora del evento |
| `device_id` | TEXT | Identificador del dispositivo (ej: `mac-dev-01`, `rpi-sala-04`) |
| `alert_type` | TEXT | Tipo de alerta (`noise_threshold`, `high_pitch`, `ml_prediction`) |
| `confidence` | FLOAT | Nivel de confianza (0.0 - 1.0) |
| `metadata` | JSONB | Datos adicionales en JSON (RMS, ZCR, ruta del audio, etc.) |

---

## 🔍 Consultas Útiles en Supabase

### Ver todas las alertas recientes

```sql
SELECT 
  created_at,
  device_id,
  alert_type,
  confidence,
  metadata->>'rms' as rms_value,
  metadata->>'zcr' as zcr_value
FROM events
ORDER BY created_at DESC
LIMIT 50;
```

### Contar alertas por día

```sql
SELECT 
  DATE(created_at) as fecha,
  COUNT(*) as total_alertas,
  AVG(confidence) as confianza_promedio
FROM events
GROUP BY DATE(created_at)
ORDER BY fecha DESC;
```

### Alertas por dispositivo

```sql
SELECT 
  device_id,
  COUNT(*) as total_alertas,
  MAX(created_at) as ultima_alerta
FROM events
GROUP BY device_id
ORDER BY total_alertas DESC;
```

---

## 🧪 Probar la Integración

Ejecuta el programa:

```bash
cd /Users/alejandropacheco/Projects/granja
source venv/bin/activate
python main.py
```

**Cuando veas:**
```
✓ Cliente de Supabase inicializado correctamente
```

Significa que la conexión está lista. Cuando se detecte una alerta, verás:

```
>>> ALERTA DETECTADA (Vol:651, Freq:120)
Grabando 3 segundos...
...............................
[OK] Archivo guardado: ./grabaciones/alerta_2026-01-27_15-30-45_vol651_freq120.wav
✓ Evento enviado a Supabase (ID: 123e4567-e89b-12d3-a456-426614174000)
Reanudando monitoreo...
```

---

## ⚡ Características de la Integración

### ✅ Envío Asíncrono
- El envío a Supabase se ejecuta en un **thread separado**
- **NO bloquea** la grabación de audio
- La captura continúa sin interrupciones

### ✅ Manejo de Errores
- Si Supabase no está disponible, el programa continúa funcionando
- Los archivos de audio se guardan localmente siempre
- Logs claros de éxito/error

### ✅ Flexible
- Puedes cambiar `DEVICE_ID` en el `.env` según el dispositivo
- El campo `metadata` (JSONB) permite agregar más datos en el futuro sin modificar la tabla

---

## 🔧 Personalización

### Cambiar el ID del Dispositivo

Edita el archivo `.env`:

```env
DEVICE_ID=rpi-sala-04  # Para Raspberry Pi en sala 4
```

### Agregar Más Datos al Evento

Modifica el método `_send_alert_to_supabase_async` en `main.py`:

```python
event_data = {
    "created_at": datetime.now().isoformat(),
    "device_id": DEVICE_ID,
    "alert_type": "noise_threshold",
    "confidence": float(confidence),
    "metadata": {
        "rms": float(volume),
        "zcr": float(frequency),
        "audio_file": filepath,
        # Agregar más campos aquí:
        "temperature": 25.5,  # Ejemplo
        "humidity": 60.0,     # Ejemplo
    }
}
```

---

## 📊 Dashboard en Supabase (Opcional)

Puedes crear gráficos en tiempo real usando la tabla `events`:

1. Ve a **Charts** en Supabase
2. Crea visualizaciones:
   - Alertas por hora/día
   - Distribución de confidence
   - Dispositivos más activos

---

## 🆘 Solución de Problemas

### Error: "No se pudo conectar a Supabase"

1. Verifica que `.env` existe y tiene las variables correctas
2. Revisa que la `SUPABASE_URL` y `SUPABASE_KEY` sean válidas
3. Prueba la conexión manualmente:

```python
from supabase import create_client
client = create_client("TU_URL", "TU_KEY")
print(client.table("events").select("*").limit(1).execute())
```

### Error: "Permission denied" al insertar

1. Ve a **Authentication > Policies** en Supabase
2. Verifica que existe la política "Permitir inserts públicos"
3. Si no existe, ejecuta de nuevo el script `supabase_schema.sql`

### El programa funciona pero no se envían eventos

1. Revisa los logs en la consola
2. Verifica que `✓ Cliente de Supabase inicializado` aparezca al inicio
3. Revisa la tabla `events` en Supabase para ver si hay datos

---

## 📚 Próximos Pasos

Una vez funcionando la integración:

1. **Análisis de Datos**: Usa los datos para entrenar tu modelo de ML
2. **Alertas en Tiempo Real**: Configura webhooks en Supabase
3. **Dashboard Web**: Crea una interfaz para visualizar alertas
4. **Integración con Storage**: Sube los archivos WAV a Supabase Storage

---

¿Necesitas ayuda? Revisa los logs del programa y la consola de Supabase.

