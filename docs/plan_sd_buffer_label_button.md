# Plan de Acción — SD como buffer + botón de etiqueta (bio-acoustic-health)

**Rama destino:** `feature/sd-buffer-and-label-button` (creada desde `main`)
**Estado:** Documento para revisión. NO ejecutar. La implementación se decidirá en otra sesión.
**Origen:** Sesión `ultraplan` del 2026-07-04 (`cryptic-forging-newell`), refinado 2026-07-05.
**Versión del nodo objetivo:** iteración v2 del nodo `bio-acoustic-health`. La versión productiva de `main` (v1, sólo SD + análisis local) se conserva intacta hasta que esta rama pase QA en campo.

---

## Arquitectura del sistema (confirmada 2026-07-05, revisión final tras 3 iteraciones)

Dos capas, comunicadas por HTTPS. Sin backend separado en Fase 1 (dataset builder). Los endpoints IoT y admin viven como Next.js Route Handlers hasta que el volumen fuerce una extracción.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CAPA 1 — EDGE (dentro de cada granja)                                  │
│   ESP32-S3 N16R8 · WiFi local · HTTPS con X-Device-Token                 │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │  POST /api/ingest, /api/claim, /api/heartbeat
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CAPA 2 — CLOUD                                                         │
│                                                                          │
│  ┌───────────────────────────────────────┐   ┌───────────────────────┐  │
│  │ bio-acoustic-frontend (Next.js 14)    │──▶│ Supabase              │  │
│  │ Vercel                                │   │  Postgres             │  │
│  │                                       │   │  Auth (JWT)           │  │
│  │  app/api/*  Route Handlers            │   │  Storage (alerts)     │  │
│  │  ├─ /api/ingest       (IoT)           │   │  Realtime (WebSocket) │  │
│  │  ├─ /api/claim        (IoT)           │   └───────────────────────┘  │
│  │  ├─ /api/heartbeat    (IoT)           │            ▲                  │
│  │  ├─ /api/pairing-code (admin)         │            │                  │
│  │  ├─ /api/admin/invite-user (existe)   │            │ reads RLS +      │
│  │  └─ /api/... writes admin             │            │ Realtime         │
│  │                                       │            │                  │
│  │  lib/services/*   lógica testeable    │            │                  │
│  │  lib/db/*         queries por dominio │            │                  │
│  │  lib/validation/* zod schemas         │            │                  │
│  │                                       │            │                  │
│  │  app/dashboard, app/admin, app/login  │────────────┘                  │
│  │  (SUPABASE_SERVICE_ROLE_KEY solo      │                                │
│  │   accesible desde /api/*, server-only)│                                │
│  └────────────────────┬──────────────────┘                                │
└───────────────────────┼─────────────────────────────────────────────────┘
                        │  HTTPS
                        ▼
             Granjero (Farm Admin) / Super Admin (Ontiveros)
```

**Ownership por pieza:**

| Pieza | Stack | Hosting | Ownership |
|---|---|---|---|
| Nodos (edge) | C++ / PlatformIO | Hardware físico | 100% propia |
| SaaS (frontend + API) | Next.js 14 App Router (RSC + Route Handlers) | Vercel | 100% propio |
| Base de datos | Postgres | **Supabase** (BaaS) | Portable (dump + restore) |
| Storage WAVs | Supabase Storage bucket `alerts` | Supabase | Portable a S3/R2 con migración script |
| Auth | Supabase Auth (JWT + magic link) | Supabase | Portable con esfuerzo |
| Realtime | Supabase Realtime | Supabase | Portable con esfuerzo |

**Vendor lock-in aceptado en Supabase (Auth + Realtime).** Postgres siempre es portable. A cambio: cero deploy separado, cero env sync, Fase 0 en **~1 día**. Cuando el volumen fuerce extracción a backend Node/NestJS separado, la disciplina de estructurar en `lib/services/` + `lib/db/` hace que sea copy-paste, no rewrite.

---

## Hardware objetivo (confirmado por el usuario, 2026-07-05)

- **MCU:** ESP32-S3-DevKitC-1-**N16R8** (chip embebido: `ESP32-S3-WROOM-1-N16R8`).
- **Flash:** 16 MB (no 8 MB como decía `CONTEXT.MD` v5.0 — pendiente de corregir esa doc).
- **PSRAM:** **8 MB** octal (`qio_opsi`).
- **SRAM interna:** 320 KB (fija por chip).

**Por qué importa aquí:** el plan añade WiFi + TLS + `HTTPClient` + `WiFiClientSecure` + una `uploaderTask` con back-off. En un DevKitC-1 pelado (variante `N8` sin PSRAM) los ~200 KB estáticos que ya viven en SRAM interna + ~40 KB de handshake TLS + stacks FreeRTOS dejarían el margen negativo tras días de uptime (fragmentación de heap + fallos de `alloc` durante reintentos). Con los **8 MB de PSRAM del N16R8**, los buffers grandes (multipart POST, JSON, TLS session cache) pueden vivir fuera de SRAM y el margen deja de ser un tema. Los 16 MB de flash también dan espacio para la partición `huge_app.csv` (2 MB de app) + un `nvs` cómodo + espacio para OTA en el futuro sin apretar.

---

## Estado real del repo (auditoría 2026-07-05)

Antes de este plan, se pensaba que `bio-acoustic-frontend` era esqueleto con solo `lib/supabase.ts` grande. Investigación completa reveló que hay **~40% del SaaS ya funcional**. El plan Fase 0 se reduce ~50% respecto a la versión inicial.

### Ya implementado y funcionando (no reconstruir)

- **7 páginas reales:** `/login`, `/dashboard`, `/admin`, `/admin/inventory`, `/admin/sites/[site_id]`, `/dashboard/settings/farm`, `/`.
- **Auth completa** con Supabase Auth (client-side; falta SSR guard, ver Fase 0-D).
- **Multi-tenant RBAC** — jerarquía `organizations → sites → buildings → rooms → devices`.
- **Realtime activo** — 2 suscripciones a `postgres_changes` sobre la tabla `acoustic_events` (en `dashboard/page.tsx:132` y `admin/sites/[site_id]/page.tsx:229`).
- **CRUD funcional** en `lib/supabase.ts` (~21 funciones exportadas) para orgs, sites, buildings, rooms, devices, profiles.
- **`/api/admin/invite-user`** funciona (invita farm admins con service role).
- **Vercel deploy** ya operativo desde `main`.
- **Firmware `bio-acoustic-health`** 1345 líneas, production-ready.

### Falta / hay que crear (esto SÍ es el plan v2)

- **Backend NestJS:** 0 líneas — Fase 0-A.
- **Tabla `pairing_codes`:** no existe — Fase 0-B.
- **Columnas en `devices`:** faltan `ingest_token`, `last_seen` — Fase 0-B.
- **Columnas en `acoustic_events`:** ya existen `event_type`, `audio_url`, `room_id`, `rms_level`, `battery_percentage`. Faltan `site_id`, `baseline_rms`, `peak_rms`, `dominant_freq_hz`, `temp_c`, `uptime_ms`, `operator_label`, `metadata` — Fase 0-A.
- **`middleware.ts`:** no existe — Fase 0-D (auth server-side).
- **Firmware `bio-acoustic-bread`:** 42 líneas skeleton — fuera del alcance de este plan.

### Deuda técnica identificada (no bloqueante para v2)

- `next.config.ts` tiene `ignoreBuildErrors: true` — habilitado para desplegar rápido. Revisar en Fase 0-D.
- `/api/v1/telemetry/route.ts` — proxy fantasma a `localhost:3000`. Se reapunta al backend real o se elimina en Fase 0-C.

---

## Context

El firmware del nodo `bio-acoustic-health` graba WAVs de 8 s (2 s pre-roll + 6 s live) exclusivamente a SD local, sin ninguna capa de red. La SD funciona hoy como almacén permanente y, al llenarse (< 50 MB libres), el sistema entra en `STATE_SD_FULL` y deja de grabar. El objetivo del proyecto es un dataset etiquetado para entrenar un modelo de Edge AI/ML que detecte aplastamientos de lechones.

Este plan aborda tres cambios interrelacionados:

1. **SD como buffer temporal:** cada WAV nuevo se sube a Supabase y sólo se borra localmente cuando la subida está confirmada atómicamente (Storage + fila en tabla de eventos). La SD queda como "caja negra" con lo pendiente + el CSV histórico.
2. **Segundo botón físico "confirmar aplastamiento":** el operador marca en vivo la grabación en curso, o la última si ocurrió hace menos de 30 s, para etiquetado inmediato del dataset.
3. **Todo el trabajo en una rama aislada** para poder estudiarlo sin romper el firmware productivo.

**Motivación:** liberar la SD del rol de storage permanente (ya no hay recolección manual periódica), y capturar etiquetas humanas en el borde para acelerar la fase de entrenamiento del modelo.

---

## Decisiones ya confirmadas por el usuario

- **Tabla de eventos:** ya existe (`acoustic_events`, con 2 suscripciones Realtime activas). **Se extiende con columnas nuevas** en vez de crear una tabla nueva (auditoría 2026-07-05).
- **Autenticación de subida:** endpoint `POST /api/ingest` **como Next.js Route Handler** (server-only) con `X-Device-Token` por dispositivo. La `SUPABASE_SERVICE_ROLE_KEY` vive en `.env.local` (server-only, sin prefijo `NEXT_PUBLIC_`).
- **Ventana hacia atrás para etiquetar:** 30 s (constante `LABEL_BACKWARD_WINDOW_MS = 30000`).
- **Modularizar `main.cpp`:** sólo si supera 1800 líneas tras las nuevas funcionalidades. Por defecto, monolítico.
- **Sin backend separado en Fase 1 (revisado 2026-07-05):** todos los endpoints IoT y admin viven como Next.js Route Handlers en `bio-acoustic-frontend/app/api/*`. Estructura disciplinada (`lib/services/`, `lib/db/`, `lib/validation/`) para extracción futura barata si el volumen lo justifica. Ver §G y §G.8 (criterios de extracción).
- **Supabase se mantiene como BaaS (Postgres + Auth + Storage + Realtime).** Neon y R2 descartados tras evaluación. Ver §G.7.
- **Hardware target:** ESP32-S3-DevKitC-1-**N16R8** (ver sección Hardware objetivo arriba).
- **Nombre de la rama:** `v2/full-stack` (renombrada desde `feature/sd-buffer-and-label-button`).
- **Estructura del monorepo:** proyectos independientes (cada paquete con su `package.json`), sin npm/pnpm workspaces por ahora.
- **Runtime:** el del frontend Next.js (Node 20+ en Vercel). Sin Railway ni backend separado por ahora.
- **Cliente Supabase en Route Handlers:** `@supabase/supabase-js` con `SUPABASE_SERVICE_ROLE_KEY` (server-only). Sin ORM por ahora — el volumen de queries en Route Handlers no lo requiere.
- **Migraciones SQL:** vía `supabase-cli` con archivos versionados en `bio-acoustic-frontend/db/migrations/*.sql`. Aplicables con `supabase db push`.
- **Emails transaccionales:** cubiertos por Supabase Auth desde el inicio (verificación, reset password). Sin proveedor externo por ahora.
- **Proyecto Supabase único (revisado 2026-07-05):** se usa el **mismo proyecto Supabase actual** para desarrollo v2. El proyecto no está en producción real (sin datos sensibles, sólo datos de pruebas). Las migraciones son **aditivas** (columnas nullables, tablas nuevas) — no rompen el frontend actual de `main`. La complejidad de aislar dos proyectos no vale la pena en este estado.
- **Renombrar proyecto Supabase:** opcional, cuando el usuario quiera (`ontiveros bio alert` → `bio-alert` o lo que prefiera). Cosmético, cero impacto.

---

## A. Análisis de impacto — Cambio 1 (SD → buffer + cloud)

### Recursos del ESP32-S3

- **Flash:** añadir `WiFi.h` + `HTTPClient.h` + `WiFiClientSecure` + certificado root suma ~350-450 KB. Actual: ~360 KB. Requiere cambiar particiones a `huge_app.csv` (2 MB) en `platformio.ini`.
- **RAM (DRAM):** el proyecto ya ronda ~210 KB estáticos (ring + preroll + snapshot + FFT). TLS añade ~35-45 KB de heap durante handshakes. Margen apretado sobre los 320 KB. Mitigación **obligatoria**: PSRAM habilitada (`board_build.arduino.memory_type = qio_opsi`) y `WiFiClientSecure::setBufferSizes(4096, 1024)`.
- **CPU:** nueva `uploaderTask` en **Core 1, prioridad 1** (por debajo de `audioAnalysisTask` que corre en prioridad 2). Core 0 (`audioCaptureTask` con I2S DMA) permanece intocado — cualquier contención ahí perdería muestras.

### Interacción con FreeRTOS actual

- La subida y la escritura de WAV comparten el bus SPI de la SD. Se introduce un `sdMutex` (nuevo). `recordWavToSD` y `uploaderTask` lo toman antes de tocar SPI/SD.
- `uploaderTask` se suspende activamente durante `STATE_RECORDING` para evitar cualquier presión sobre SPI mientras el WAV activo se escribe.
- WiFi corre en su propio task del SDK ESP-IDF (Core 0 internamente), sin interferir con la I2S del audio.

### Semántica de "confirmación de subida" (atomicidad)

Regla estricta, en este orden:

1. `POST` multipart al proxy `/api/ingest` con el WAV + metadatos + `X-Device-Token`.
2. El proxy sube al bucket `alerts` con service key.
3. El proxy inserta la fila en `acoustic_events` con `audio_url = storage_path`.
4. Sólo si el proxy responde 200 con `{ok: true, event_id: "..."}` se marca el archivo como subido y se borra localmente.
5. Si (1) falla o responde !=200: reintento con back-off.
6. El firmware nunca ve el path de Storage — la atomicidad vive en el proxy, que puede envolver ambos pasos en una transacción/compensación.

### Reintentos y presión sobre SD

- Back-off exponencial: 5 s → 15 s → 60 s → 5 min → 30 min (tope).
- Sin límite de reintentos (los archivos son valiosos).
- **Guardarraíl:** si `pendingBytes > 20 MB`, descartar el archivo más antiguo (política FIFO), logueando la pérdida en Serial.
- `STATE_SD_FULL` mantiene su umbral de 50 MB, pero ahora puede autoresolverse: al drenar la cola, `isSDFull()` recalcula en el siguiente ciclo de 30 s y el nodo vuelve solo a `STATE_MONITORING`.

### Persistencia de la cola

- Directorio nuevo `/pending/` en SD. Cada grabación produce **un par**:
  - `/pending/<name>.wav` — el audio.
  - `/pending/<name>.meta.json` — `{rms, freq_dom, temp_c, uptime_ms, mac, event_type: "REC"|"ENV", operator_label: null|"crushing", retry_count, next_retry_ms}`.
- Al arrancar, `uploaderTask` escanea `/pending/*.wav` y reconstruye la cola en RAM. Sobrevive a reboots sin parseos de un JSON monolítico.
- El CSV histórico `/log_eventos.csv` se conserva intacto (append-only, caja negra).

### Autenticación (confirmada: proxy Next.js)

- Nuevo endpoint `POST /api/ingest` en `bio-acoustic-frontend/app/api/ingest/route.ts`:
  - Valida `X-Device-Token` contra la tabla `devices` (columna nueva `ingest_token`).
  - Acepta `multipart/form-data` con `audio` (WAV) + `meta` (JSON).
  - Sube el WAV al bucket `alerts/<site_id>/<mac>/<yyyy-mm>/<filename>.wav` con service key (server-side). `site_id` como primer segmento para que el dataset ML del owner se pueda curar por granja sin JOIN a Postgres.
  - Inserta la fila en `acoustic_events`.
  - Responde `{ok: true, event_id: uuid}` o error 4xx/5xx.
- El firmware sólo conoce: URL del proxy + su token. Nunca ve claves de Supabase.

### Schema de la tabla `acoustic_events` (extender, NO crear nueva)

**Importante (aplicado 2026-07-06):** la tabla `acoustic_events` ya existe con Realtime activo. Se extendió en vez de renombrar para evitar romper las 2 suscripciones y las páginas del frontend. Ya tenía: `id (integer SERIAL), "time", device_id, room_id, event_type, rms_level, battery_percentage, audio_url, metadata (jsonb), created_at, confidence`.

⚠️ **Nota de tipo:** `acoustic_events.id` es **INTEGER SERIAL**, no UUID. El `event_id` que devolverá `/api/ingest` en Fase 5 será entero (BIGINT en JSON).

Columnas añadidas (todas nullables + `IF NOT EXISTS`):

```sql
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id);       -- tenant para RLS + path bucket + curación ML
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS baseline_rms FLOAT;
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS peak_rms FLOAT;                          -- pico durante la alerta (rms_level = valor legacy)
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS dominant_freq_hz FLOAT;
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS temp_c FLOAT;
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS uptime_ms BIGINT;
ALTER TABLE acoustic_events ADD COLUMN IF NOT EXISTS operator_label TEXT;                     -- NULL | 'crushing'

CREATE INDEX IF NOT EXISTS idx_acoustic_events_site_id ON acoustic_events(site_id);
CREATE INDEX IF NOT EXISTS idx_acoustic_events_operator_label ON acoustic_events(operator_label) WHERE operator_label IS NOT NULL;
```

Nota: `event_type`, `audio_url`, `metadata` ya existen — no se re-crean.

Sobre `devices` (ya tiene `last_heartbeat TIMESTAMPTZ` — reusamos, no añadimos `last_seen`):

```sql
ALTER TABLE devices ADD COLUMN IF NOT EXISTS ingest_token TEXT UNIQUE;
```

Nueva tabla `pairing_codes`:

```sql
CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,             -- 6 dígitos
  site_id UUID REFERENCES sites(id) NOT NULL,
  room_id UUID REFERENCES rooms(id) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- RLS: SELECT/INSERT sólo con service role.
```

RLS (estado verificado 2026-07-06 — NO se toca en Fase 0-A):
- `acoustic_events`: RLS ya enabled, con 2 policies SELECT que cubren tenant vía `room_id → building → site → organization`. Añadir una policy por `site_id` sería redundante.
- Bucket `alerts`: hoy **público** con policies abiertas a `anon` (`acceso_total 1bmm1ef_*`). Endurecer rompe `main`. Se pospone a Fase 0-D o al cutover.
- `organizations` y `profiles`: **RLS OFF** en producción. Deuda de seguridad conocida, ver memoria `project-security-debt-pending`.

---

## B. Diseño del Cambio 2 (botón de etiqueta)

### Es un botón NUEVO — el existente no cambia

- **BTN_SYNC (GPIO 7, ya existe):** su comportamiento se mantiene **idéntico** — clic corto = Safe Eject, pulsación larga = toggle sensibilidad, ignorado durante `STATE_RECORDING`.
- **BTN_LABEL (GPIO 8, nuevo):** sólo para etiquetar "aplastamiento real" (`operator_label: "crushing"`).
- La "refactorización de `buttonTask`" (Fase 1) es un cambio **interno** que generaliza la task para manejar N botones a través de un array. Desde fuera, BTN_SYNC no se distingue del actual.
- **Única interacción cruzada:** el combo simultáneo BTN_SYNC + BTN_LABEL durante 5 s dispara reset de fábrica (borra NVS de WiFi + ingest_token) — se introduce en Fase 4-bis. Cada botón por separado sigue haciendo lo mismo.

### Pin: **GPIO 8**

Libre en ESP32-S3, sin strapping, `INPUT_PULLUP` disponible. Ocupados hoy: 4/5/6 (LEDs), 7 (BTN_SYNC), 10-13 (SD SPI), 15-17 (INMP441 I2S). GPIO 9 como reserva.

Cableado físico: un pulsador momentáneo entre GPIO 8 y GND. El `INPUT_PULLUP` interno del ESP32 se encarga del pull-up (10-50 kΩ, no hace falta resistencia externa). Pulsado = LOW. Se recomienda un condensador de 100 nF en paralelo con el pulsador para filtrar rebote hardware, aunque el debounce software de 50 ms lo cubre.

### Refactor de `buttonTask`

Generalizar con array + estructura:

```cpp
struct Button {
  uint8_t pin;
  volatile uint32_t pressStartMs;
  volatile bool wasPressed;
  volatile ButtonEvent event;   // NONE | SHORT_CLICK | LONG_PRESS
};
static Button buttons[2] = {
  { BTN_SYNC,  0, false, BTN_NONE },
  { BTN_LABEL, 0, false, BTN_NONE },
};
```

Un solo `buttonTask` itera sobre los dos. `audioAnalysisTask` (y el nuevo consumidor de etiqueta) leen `buttons[i].event` atómicamente y lo resetean.

### UX de etiquetado

| Contexto | Clic corto BTN_LABEL | Feedback LED |
|---|---|---|
| `STATE_RECORDING` | Marca la grabación EN CURSO como `crushing` (setea `volatile const char* currentRecordingLabel`) | Amarillo: doble parpadeo rápido 200/100/200 ms |
| `STATE_MONITORING` + última grabación hace <30 s | Abre `/pending/<lastName>.meta.json`, lee, escribe `operator_label:"crushing"`, cierra | Verde: doble parpadeo 200/100/200 ms |
| `STATE_MONITORING` sin grabación reciente | Rechazo | Rojo: 300 ms fijo |
| `STATE_SD_FULL` / `STATE_PAUSED` / warmup | Ignorado | Rojo: 300 ms fijo |
| Clic largo BTN_LABEL | Reservado (sin acción) | — |

Idempotente: re-etiquetar `crushing` sobre `crushing` no cambia nada.

### Interacción con SPI/SD

- Clic durante RECORDING: **no toca la SD**. Sólo setea `currentRecordingLabel`. `recordWavToSD` lo lee al momento de escribir el `.meta.json` al cerrar el WAV.
- Clic tardío: sí toca SD para reescribir el `.meta.json`, pero fuera de RECORDING no hay contención SPI activa.

### Persistencia de la etiqueta

- **Verdad primaria (cloud):** columna `operator_label TEXT` en `acoustic_events`.
- **Verdad de respaldo (edge):** columna nueva `Etiqueta_Operador` en `/log_eventos.csv` (append only, caja negra offline).
- **NO** se codifica en el nombre del archivo (fragilidad de renombrado + estado en cola).

---

## C. Fases de trabajo (rama `feature/sd-buffer-and-label-button`)

Cada fase es un commit auto-contenido y no rompe `main`. Mergeables independientemente.

> **Nota general de Fase 0 (aclarada 2026-07-05):** **NADA de este plan merge a `main` hasta que TODO esté validado en campo.** Todas las subfases (0-A a 0-F, y luego 1 a 8) viven en la rama, sin excepción. `main` conserva el estado actual (Supabase + Next.js + firmware v1) intacto hasta el corte final. Ver §H.

### Fase 0-A — Migraciones incrementales en Supabase (proyecto único) — ✅ COMPLETADA 2026-07-06
> Se trabajó contra el **proyecto Supabase productivo `uaecpeaefqwjpxgjbfye`**. Las migraciones son aditivas y no rompen la app en `main`.

**Aplicado:**
- `supabase init` en `bio-acoustic-frontend/` → `supabase/config.toml` + `.gitignore`.
- `supabase link --project-ref uaecpeaefqwjpxgjbfye` (autenticación vía `SUPABASE_ACCESS_TOKEN`, DB password vía `SUPABASE_DB_PASSWORD`).
- Auditoría del schema real con `pg_dump` (Docker no disponible → sorteado con `brew install libpq`). Baseline guardado en `bio-acoustic-frontend/supabase/audit-baseline.sql` (git-ignored).
- **3 migraciones aditivas** en `bio-acoustic-frontend/supabase/migrations/`:
  - `20260705153000_add_ingest_token_to_devices.sql` → `devices.ingest_token TEXT UNIQUE` (nullable). NO se añade `last_seen` — ya existe `last_heartbeat`.
  - `20260705153100_extend_acoustic_events_with_audio_columns.sql` → 7 columnas (`site_id, baseline_rms, peak_rms, dominant_freq_hz, temp_c, uptime_ms, operator_label`) + 2 índices. NO se añade `metadata` — ya existe.
  - `20260705153200_create_pairing_codes.sql` → tabla nueva con RLS enabled sin policies (solo service_role tiene acceso).
- **Eliminada la 4ª migración planeada** (`harden_rls_acoustic_events_and_alerts_bucket`): las policies existentes de `acoustic_events` ya cubren tenant; endurecer bucket/RLS rompería `main` y se pospone.
- `supabase db push` aplicó las 3 migraciones sin conflictos.
- Smoke test: `psql` verificó columnas nuevas + filas intactas (6 events, 7 devices, 3 sites); `npm run build` compila las 11 rutas.
- `docs/supabase_schema.sql` actualizado con snapshot post-migración.

**Pendiente para fases futuras (fuera de 0-A):**
- Seed script `db/seed.sql`: postergado — hay datos de prueba suficientes en producción.
- Endurecer bucket `alerts` (hoy público con policies anon abiertas) y activar RLS en `organizations`/`profiles`: Fase 0-D o cutover final. Ver memoria `project-security-debt-pending`.
- Commit sugerido: `db: incremental migrations for v2 (acoustic_events cols + pairing_codes + devices.ingest_token)`.

### Fase 0-B — Reorganizar `lib/supabase.ts` en módulos + añadir validación
> Refactor sin cambio funcional. Prepara el terreno para extracción futura barata y para que las Route Handlers de fases posteriores tengan una capa limpia sobre la que apoyarse.

- **Nueva estructura de directorios en `bio-acoustic-frontend/lib/`:**
  - `lib/supabase/{client.ts,server.ts}` — clientes browser y server-only (con service role).
  - `lib/db/{organizations,sites,buildings,rooms,devices,acoustic_events,profiles,pairing_codes}.ts` — queries agrupadas por dominio. Cada archivo exporta funciones tipadas.
  - `lib/services/` — vacío por ahora, se irá poblando en fases siguientes con `ingest.service.ts`, `pairing.service.ts`, etc.
  - `lib/validation/` — schemas zod para inputs de Route Handlers. Vacío por ahora.
- **Migración de las 21 funciones actuales** de `lib/supabase.ts`:
  - Reads (`getAllOrganizations`, `getSitesByOrganization`, `getDevicesByRoom`, etc.) → `lib/db/<dominio>.ts` (sin cambio de firma).
  - Writes (`createOrganization`, `createSite`, `createBuilding`, `claimDeviceToRoom`, etc.) → también `lib/db/<dominio>.ts`.
  - Auth helpers (`getCurrentUserProfile`, `isSuperAdmin`, `getUserOrganization`) → `lib/db/profiles.ts` o `lib/auth.ts`.
- **Añadir zod al proyecto:** `npm i zod`. Placeholder `lib/validation/organization.schema.ts` con un schema simple como ejemplo del patrón.
- **`lib/supabase.ts` queda vacío o eliminado.** Los imports actuales en el frontend se redireccionan a los nuevos módulos con un search-and-replace ordenado.
- Sin tocar lógica: sólo mover, no reescribir.
- Verificar que `npm run build` y las 7 páginas siguen funcionando idénticas.
- Commit: `frontend: reorganize lib/supabase.ts into per-domain modules + add zod`.

### Fase 0-C — Endurecimiento de seguridad y deuda técnica
- **Nuevo `bio-acoustic-frontend/middleware.ts`** — protege `/dashboard/*` y `/admin/*` con validación server-side del JWT Supabase (usando `createServerClient` de `@supabase/ssr` o el equivalente vigente). Redirige a `/login` si no hay sesión. Cierra el hueco de auth solo client-side.
- **`next.config.ts`:** intentar quitar `ignoreBuildErrors: true`. Fixear los TS errors reales que aparezcan. Si alguno requiere refactor grande, dejarlo con comentario explicando y un TODO.
- **`app/api/v1/telemetry/route.ts`:** eliminar (es un proxy fantasma a `localhost:3000` que no se va a usar). El endpoint IoT real es `/api/ingest`, se implementa en Fase 5.
- **`docs/skill_backend_nestjs.md`:** añadir nota al principio "ARCHIVADO 2026-07-05: NestJS no se implementa en Fase 1. Ver `docs/plan_sd_buffer_label_button.md` §G para el estado actual".
- Verificación: en incógnito, navegar a `/dashboard` sin login → redirect a `/login`. Login → dashboard funciona. Navegar a `/admin` sin ser super_admin → 403 o redirect.
- Commit: `frontend: add auth middleware + tighten TS build + clean tech debt`.

**Duración estimada Fase 0 completa (revisada 2026-07-05):** **~1 día con asistencia de IA.**

### Fase 1 — Refactor mínimo de `buttonTask`
- Introducir `struct Button` + array de dos entradas en `main.cpp`.
- Sin cambios de comportamiento observables (BTN_SYNC funciona igual).
- Commit: `firmware: refactor buttonTask into generic array-driven handler`.

### Fase 2 — Botón de etiqueta (aislado, sin WiFi)
- Definir `BTN_LABEL 8`, `pinMode(BTN_LABEL, INPUT_PULLUP)` en setup.
- Añadir columna `Etiqueta_Operador` al CSV.
- Escribir un `.meta.json` sidecar junto a cada WAV (aunque el uploader no exista todavía).
- Implementar la lógica de ventana 30 s y los tres feedbacks LED.
- Verificación física completa.
- Commit: `firmware: add crushing label button (GPIO 8) with 30s backward window`.

### Fase 3 — Reorganizar output a `/pending/`
- `buildFilename` produce paths `/pending/<name>.wav` + `<name>.meta.json`.
- `mkdir /pending` en el `SD.begin` inicial.
- Verificar que safe eject, SD_FULL, y CSV siguen funcionando.
- Commit: `firmware: route recordings to /pending/ with sidecar metadata`.

### Fase 4 — WiFi + `secrets.h` (sólo `INGEST_URL`)
- Crear `include/secrets.h.example` con `INGEST_URL` (igual para todas las granjas) y opcionalmente `INGEST_ROOT_CA_PEM` (certificado root TLS embebido).
- Añadir `secrets.h` al `.gitignore` del firmware.
- **Ya no se hardcodea SSID/pass ni ingest_token** — provisioning en Fase 4-bis.
- Al boot, intenta conectar con credenciales en NVS. Si falla o no existen → `STATE_PAIRING` (arranca AP + captive portal).
- Log `[WIFI] Conectado, IP: ..., RSSI: ...` cuando ok.
- Commit: `firmware: add WiFi connection scaffolding with NVS credential store`.

### Fase 4-bis — Provisioning por Captive Portal + Claim con código de 6 dígitos

Reemplaza el hardcoding de credenciales por un flujo de comisionado que el granjero puede hacer desde su móvil. Encaja con el multi-tenant SaaS que ya existe.

**Flujo del granjero:**
1. Enchufa el nodo → `STATE_PAIRING` (3 LEDs sincronizados a 500 ms, ya definido en la tabla de estados).
2. Desde el portal SaaS, en la vista de su granja, pulsa "Aparear nuevo nodo" → el frontend llama a `POST /api/pairing-code` y recibe un código de 6 dígitos válido por 10 min. Se muestra en pantalla.
3. Conecta el móvil al SSID abierto `BioAlert-<MAC4>` (últimos 4 dígitos del MAC del ESP32).
4. Se abre solo un formulario web (captive portal) con 3 campos: **SSID granja**, **contraseña**, **código de 6 dígitos**.
5. Al enviar, el nodo:
   - Guarda SSID/pass en NVS (`Preferences.h` bajo namespace `wifi`).
   - Se conecta a la red real.
   - Hace `POST /api/claim` con `{mac, code}`.
   - El backend valida el código, marca la fila de `devices` como reclamada por esa granja/room, genera el `ingest_token`, y lo devuelve.
   - El nodo guarda el token en NVS (namespace `ingest`), apaga el AP y arranca en `STATE_MONITORING`.
6. En el portal SaaS, la fila del dispositivo pasa a "Online".

**Componentes firmware:**
- Librería recomendada: `WiFiManager` (tzapu) para el captive portal, extendida con dos campos custom (`pairing_code` y `farm_password`). Alternativa DIY en ~120 líneas si prefieres control total.
- Módulo `nvs.cpp` (nuevo) que envuelve `Preferences.begin("wifi"/"ingest")` con getters/setters idempotentes.
- Estado `STATE_PAIRING` reutilizado del CONTEXT.MD (ya tiene patrón LED asignado).
- Reset de credenciales: **pulsación larga simultánea de BTN_SYNC + BTN_LABEL durante 5 s** → borra NVS y reinicia en pairing. Nuevo caso a integrar en `buttonTask`.

**Componentes API (Next.js Route Handlers):**
- `POST /api/pairing-code` (`app/api/pairing-code/route.ts`) — requiere JWT del usuario (Farm Admin), validado por middleware o server-side supabase-js. Genera código de 6 dígitos, guarda en `pairing_codes` con TTL 10 min, `site_id` y `room_id`. Lógica en `lib/services/pairing.service.ts`.
- `POST /api/claim` (`app/api/claim/route.ts`) — público (sin JWT, se apoya en el código). Recibe `{mac, code}`, valida vigencia, UPSERT en `devices` (usa `SUPABASE_SERVICE_ROLE_KEY` server-only), genera `ingest_token` con `crypto.randomBytes(24).toString('hex')`, marca el código como `used_at = now()`, responde `{ok, ingest_token, ingest_url}`.
- **Frontend:** vista "Aparear nuevo nodo" en `bio-acoustic-frontend/app/admin/devices/pair/page.tsx` que llama a `/api/pairing-code` y muestra el código + QR opcional.

**Seguridad del pairing:**
- Códigos de 6 dígitos son de un solo uso (`used_at` no null → rechazo).
- TTL de 10 min limita la ventana de brute-force.
- Rate limit del endpoint `/api/claim` a 5 intentos/min por IP.
- El `ingest_token` viaja UNA sola vez sobre la red WiFi de la granja hacia el proxy — sobre HTTPS con el root CA embebido en Fase 4.

**Verificación:**
- Encender nodo sin NVS → aparece SSID `BioAlert-A3F2`. Móvil conecta, portal aparece solo.
- Introducir código inválido → 400, LED rojo 2 s, sigue en pairing.
- Introducir código válido pero SSID/pass equivocados → falla WiFi, se vuelve a levantar AP.
- Reset de fábrica: BTN_SYNC + BTN_LABEL 5 s → NVS limpia, vuelve a pairing.
- Commit: `firmware+frontend: captive portal provisioning + 6-digit pairing claim`.

### Fase 5 — Endpoint `POST /api/ingest` (Next.js Route Handler)
> Se apoya en el `ingest_token` obtenido en Fase 4-bis y en los módulos `lib/db/*` y `lib/services/*` creados en Fase 0-B.

- `app/api/ingest/route.ts` con la siguiente responsabilidad DELGADA:
  1. Extraer y validar `X-Device-Token` (contra `devices.ingest_token`, servicio en `lib/services/device-auth.service.ts`).
  2. Parsear `multipart/form-data` con `Request.formData()` (nativo en Next.js 14+).
  3. Validar `meta` con zod (`lib/validation/ingest.schema.ts`).
  4. Delegar en `lib/services/ingest.service.ts` toda la lógica.
- **`lib/services/ingest.service.ts`:**
  - Upload del WAV a Supabase Storage: `alerts/<site_id>/<mac>/<yyyy-mm>/<filename>.wav`. `site_id` se resuelve server-side desde `devices.mac → site_id` antes del upload.
  - INSERT en `acoustic_events` con `site_id` (resuelto server-side) + las columnas nuevas rellenas.
  - Al INSERT, **Supabase Realtime publica automáticamente** el evento a las 2 suscripciones ya activas del frontend.
  - Atomicidad: si INSERT falla tras upload, borrar objeto de bucket (compensación).
- Respuestas tipadas: `200 {ok, event_id}`, `400 BAD_TOKEN`, `413 TOO_LARGE`, `500 STORAGE_FAILED`, `500 DB_FAILED`.
- Body size max: 512 KB (WAV 8 s = 256 KB, margen 2×). Configurar en `route.ts` con `export const runtime = 'nodejs'` + `export const maxDuration = 30`.
- Rate limit por device (`X-Device-Token` como clave): 30 req/min, implementación con `@upstash/ratelimit` (o Vercel KV) — **evaluar en implementación**; si es fricción, dejarlo para Fase 8.
- Log estructurado JSON con `console.log(JSON.stringify(...))` (Vercel lo captura).
- Prueba: `curl -F "audio=@test.wav" -F 'meta={...}' -H "X-Device-Token: xxx" https://<preview>.vercel.app/api/ingest`.
- Commit: `frontend: add /api/ingest route handler with Supabase Storage upload and atomic event insert`.

### Fase 6 — `uploaderTask` en firmware
- Nueva task en Core 1, prioridad 1.
- Escaneo inicial de `/pending/` al boot.
- POST al proxy con back-off exponencial.
- Al 200 OK: borra `.wav` + `.meta.json` locales.
- `sdMutex` compartido con `recordWavToSD`.
- Suspender durante `STATE_RECORDING`.
- Commit: `firmware: add uploader task with retry queue and atomic delete`.

### Fase 7 — Integración con `STATE_SD_FULL` y guardarraíl 20 MB
- `isSDFull()` sigue disparando a 50 MB.
- Nuevo `pendingBytes()` calcula el tamaño de `/pending/`; si supera 20 MB, descarta FIFO.
- Al drenarse la cola, `STATE_SD_FULL` puede autoresolverse.
- Commit: `firmware: integrate uploader with SD_FULL and pending queue cap`.

### Fase 8 — Endurecimiento E2E
- Reintentos ante WiFi caído mid-upload.
- Timeouts razonables en `HTTPClient` (10 s connect, 30 s upload).
- Reboot durante subida no corrompe estado (los `.meta.json` son la verdad).
- Log estructurado de fallos para inspección serial.
- Commit: `firmware: harden upload path against network and reboot edge cases`.

### Nota sobre modularización
Reevaluar tras Fase 6. Si `main.cpp` > 1800 líneas, dividir en `audio.cpp`, `sd.cpp`, `uploader.cpp`, `buttons.cpp`, `state.cpp` con headers en `include/`. Refactor puro, sin cambio funcional. Commit separado.

---

## D. Archivos y paquetes críticos a modificar

**Firmware (`bio-acoustic-health`):**
- `firmware/bio-acoustic-health/src/main.cpp` (todo el trabajo firmware, hoy 1345 líneas).
- `firmware/bio-acoustic-health/platformio.ini` (particiones `huge_app.csv` + PSRAM `qio_opsi` + `board_upload.flash_size = 16MB`).
- `firmware/bio-acoustic-health/include/secrets.h.example` (nuevo, sólo `INGEST_URL` + opcional root CA).
- `firmware/bio-acoustic-health/.gitignore` (añadir `include/secrets.h`).

**Frontend (`bio-acoustic-frontend`) — todo vive aquí:**

Migraciones y schema:
- `db/migrations/*.sql` (nuevas, versionadas con supabase-cli).
- `db/seed.sql` (semillas para dev).

Reorganización de código existente:
- `lib/supabase/{client.ts, server.ts}` (nuevo, reemplaza `lib/supabase.ts`).
- `lib/db/{organizations,sites,buildings,rooms,devices,acoustic_events,profiles,pairing_codes}.ts` (nuevo, funciones extraídas del viejo `lib/supabase.ts`).
- `lib/services/{ingest,pairing,device-auth,heartbeat}.service.ts` (creados en fases siguientes).
- `lib/validation/*.schema.ts` (zod, se irán añadiendo).
- `lib/supabase.ts` (eliminar tras migración).

Nuevos endpoints (fases posteriores):
- `app/api/ingest/route.ts` (Fase 5).
- `app/api/claim/route.ts` (Fase 4-bis).
- `app/api/pairing-code/route.ts` (Fase 4-bis).
- `app/api/heartbeat/route.ts` (opcional, Fase 6).
- `app/admin/devices/pair/page.tsx` (Fase 4-bis, nueva vista pairing).
- `middleware.ts` (Fase 0-C).

A eliminar:
- `app/api/v1/telemetry/route.ts` (proxy fantasma).

**Documentación (todo en la rama, no en main):**
- `CONTEXT.MD` — actualizado con hardware N16R8 y sección "Route Handlers como API". El CONTEXT.MD de main se actualiza sólo al cutover (§H.4).
- `docs/supabase_schema.sql` — actualizado con las nuevas columnas/tablas (en la rama).
- `docs/planificacion.md` — archivo histórico.
- `docs/plan_sd_buffer_label_button.md` — este documento.
- `docs/skill_backend_nestjs.md` — marcado como archivado en Fase 0-C.
- `docs/setup_accounts.md` — actualizado sin Railway.

## Funciones/utilidades existentes a reutilizar

- `recordWavToSD` (`main.cpp:521`) — se conserva. Sólo cambia el path de destino y añade escritura del `.meta.json`.
- `buildFilename` (`main.cpp:448`) — se extiende para producir el par `.wav` + `.meta.json`.
- `writeEventCSV` (`main.cpp:648`) — se amplía con la columna `Etiqueta_Operador`.
- `isSDFull` (`main.cpp:524`) — se conserva; se añade `pendingBytes()` como función hermana.
- Máquina de estados (`main.cpp:156`, transiciones en `audioAnalysisTask`) — se conserva íntegra.
- Ring buffer y mutex (`main.cpp:173-189`) — intocables.
- `claimDeviceToRoom` (`bio-acoustic-frontend/lib/supabase.ts:640`) — extender para generar `ingest_token` en el momento del apareo.

---

## E. Plan de verificación

| Fase | Cómo probar |
|---|---|
| 0-A | En Supabase Studio: `acoustic_events` con `site_id` + las 7 columnas nuevas, `pairing_codes` creada, `devices.ingest_token` + `devices.last_seen` presentes. Filas existentes intactas. Las páginas del frontend actual siguen funcionando (verificar con `npm run build` + smoke test). `supabase db push` idempotente. Seed opcional (los datos de pruebas existentes bastan). |
| 0-B | Frontend sigue funcionando idéntico: 7 páginas OK, dashboard con Realtime OK, admin panel OK. `lib/supabase.ts` desaparece. Imports actualizados en 7 páginas apuntando a `lib/db/*` y `lib/supabase/client.ts`. `npm run build` pasa. zod instalado, un schema de ejemplo. |
| 0-C | En incógnito: `/dashboard` sin login → redirect a `/login`. `/admin` sin ser super_admin → 403. `npm run build` con `ignoreBuildErrors: false` pasa (o los que queden documentados). `app/api/v1/telemetry/route.ts` eliminado. |
| 1 | Serial monitor: BTN_SYNC (clic corto → PAUSED; clic largo → toggle sensibilidad) funciona idéntico a hoy. |
| 2 | Grabar 3 alertas. Clic durante REC → CSV muestra `crushing` en esa fila. Clic <30 s después → `.meta.json` de la última se actualiza. Clic 60 s después → LED rojo, sin cambios. |
| 3 | Reboot: `ls /pending/` muestra 3 pares `.wav`/`.meta.json`; CSV y estados intactos. |
| 4 | Al boot con NVS válida: `[WIFI] Conectado, IP: x.x.x.x, RSSI: -55`. Sin NVS: entra a `STATE_PAIRING` y levanta AP. |
| 4-bis | Nodo sin credenciales → SSID `BioAlert-A3F2` visible. Portal aparece solo al conectar el móvil. Código válido → nodo se conecta y aparece "Online" en el portal SaaS en <30 s. Código expirado → LED rojo 2 s. Reset (BTN_SYNC+BTN_LABEL 5s) → NVS limpia. |
| 5 | `curl -X POST -F "audio=@sample.wav" -F 'meta={...}' -H "X-Device-Token: dev-token-abc" https://<preview>.vercel.app/api/ingest` → 200 con `event_id`; fila visible en `acoustic_events` con `site_id` + columnas nuevas rellenas; WAV visible en bucket `alerts/<site_id>/<mac>/<yyyy-mm>/`; navegador con Realtime activo recibe el evento en <2 s. |
| 6 | Grabar alerta → tras <60 s el WAV desaparece de `/pending/`, aparece en bucket, fila en `acoustic_events` con etiqueta correcta. |
| 7 | Cortar WiFi 5 min y grabar 3 alertas → cola de 3 en `/pending/`. Reconectar → drena en secuencia. Reboot mid-drenaje → reconstruye cola y continúa. |
| 8 | Llenar SD manualmente hasta 45 MB de `/pending/` → descarte FIFO logueado; nuevas alertas siguen entrando. |

---

## G. Decisión arquitectónica — Supabase + Next.js Route Handlers (revisión final 2026-07-05)

### G.1 Qué se está planteando

Se conserva Supabase como BaaS (Postgres + Auth + Storage + Realtime). **Sin backend separado**. Todos los endpoints IoT y admin viven como Next.js Route Handlers en `bio-acoustic-frontend/app/api/*`:

- Auth flows y lecturas RLS-safe: directas frontend → Supabase (como hoy).
- Realtime: suscripciones directas frontend → Supabase Realtime (como hoy).
- Escrituras que requieran `SERVICE_ROLE_KEY` (bypass de RLS): Route Handlers server-only (`SUPABASE_SERVICE_ROLE_KEY` sin prefijo `NEXT_PUBLIC_`, jamás llega al bundle cliente).
- Endpoints IoT (firmware): Route Handlers con guard de `X-Device-Token`.

**Disciplina de estructura para extracción futura barata:**

```
bio-acoustic-frontend/
├── app/api/*/route.ts       ← handlers DELGADOS: parse + validate + call service
├── lib/services/*.ts        ← lógica de negocio testeable (independiente del framework)
├── lib/db/*.ts              ← queries agrupadas por dominio (devices, acoustic_events, ...)
└── lib/validation/*.ts      ← zod schemas
```

El día que se extraiga un backend Node/NestJS separado, `lib/services/` y `lib/db/` se copian sin cambios funcionales. Route Handlers se convierten en Controllers.

### G.2 Historia de la decisión (4 iteraciones)

1. **Primera propuesta (mía, 2026-07-05):** Supabase + backend NestJS delgado.
2. **Reversión 1 (usuario):** máximo control con Neon + R2 + auth y WS propios. Priorizar control > velocidad.
3. **Reversión 2 (usuario):** volver a Supabase + NestJS. Auth y WS propios como campo minado + operación 24/7.
4. **Reversión final (usuario, misma sesión):** eliminar NestJS. Para Fase 1 (dataset builder, volumen bajo), Next.js Route Handlers bastan. YAGNI.

Documentar el vaivén evita re-litigar en 3 meses.

### G.3 Ventajas de esta ruta (post reversión final)

1. **Fase 0 se reduce a ~1 día** (vs 2-3 días con NestJS, vs 1-2 semanas con stack propio).
2. **Un solo deploy** (Vercel). Cero cuenta Railway, cero env sync entre dos servicios.
3. **Cero superficie propia de Auth o WS.** Supabase lo cubre.
4. **Emails transaccionales** integrados en Supabase Auth.
5. **Aprovecha el ~40% del SaaS ya construido** en el frontend.

### G.4 Criterios para extraer backend separado en el futuro

Extraer a backend Node/NestJS separado cuando **cualquiera** se cumpla:

1. **>50 uploads/minuto sostenidos** — Vercel serverless empieza a fricción.
2. **Aparece necesidad de jobs periódicos** — cron para agregaciones, retrainings de modelo.
3. **Modelo ML en servidor** — necesita proxy de inferencia (Python FastAPI o Node con GPU).
4. **WebSocket custom** que Supabase Realtime no cubra (poco probable).
5. **Body upload >4.5 MB** — WAVs más largos o compresión diferente.

Cualquiera de esos dispara un plan aparte. Hasta entonces, Route Handlers.

### G.5 Trade-offs aceptados

- **Vercel Functions límites** — 10s hobby / 60s Pro / 4.5 MB body. Suficiente para dataset builder (WAV 256 KB × 1-10 uploads simultáneos).
- **Cold starts** — molestan pero el firmware ya tiene retry con back-off.
- **Vendor lock-in en Supabase Auth + Realtime.** Migrar cuesta ~2 semanas si algún día toca. Aceptado.
- **Cuando escale, hay que extraer.** No es "para siempre". Los criterios de G.4 son la señal.

### G.6 Qué se hace explícitamente NO en este plan

- OAuth (Google, Apple). Sólo email + password en v1.
- Multi-región.
- gRPC / GraphQL / tRPC.
- Redis / colas asíncronas / Kafka. La cola vive en la SD del nodo (Fase 6-7).
- Backend NestJS separado (por ahora — ver G.4 para cuándo).
- ORM (Drizzle/Prisma). El volumen de queries en Route Handlers no lo requiere. `supabase-js` con service role basta.

### G.7 Qué se descarta explícitamente

- **Neon:** descartado. Reevaluar si vol >10M rows/mes.
- **Cloudflare R2:** descartado. Reevaluar si el egress de Supabase Storage duele.
- **Auth propia:** descartada. Supabase Auth cubre.
- **WebSocket gateway propio:** descartado. Supabase Realtime cubre.
- **NestJS + Railway en Fase 1:** descartado. Ver G.4 para cuándo reevaluar.
- **Drizzle ORM:** descartado por ahora. Volumen no lo justifica. Reevaluar cuando se extraiga backend.

### G.8 `docs/skill_backend_nestjs.md`

Ese doc queda **desactualizado**. Se marca como archivo histórico. No se elimina para preservar el rastro de la decisión.

---

## H. Estrategia de rama y aislamiento de `main`

### H.1 Regla principal (2026-07-05)

**`main` no se toca hasta el corte final.** El estado productivo actual (nodos v1 en granja piloto grabando a SD local, frontend Vercel actual con Supabase, base de datos Supabase actual) sigue funcionando sin cambios durante todo el desarrollo de este plan. Ningún commit intermedio de las Fases 0 a 8 aterriza en `main`.

### H.2 Consecuencias prácticas

- La rama `feature/sd-buffer-and-label-button` deja de ser una rama corta de firmware y pasa a ser una **rama larga de rewrite completo del stack**. Su nombre actual queda mal — se sugiere renombrarla a algo como `v2/full-stack` o `next` para reflejar que abarca backend, DB, frontend y firmware.
- **Sincronización con main:** la rama se rebasea periódicamente sobre `main` para no divergir demasiado. Sólo bugfixes críticos que aparezcan en el estado productivo se mergean a `main` durante este tiempo y se traen a la rama por rebase.
- **Vercel Production sigue apuntando a `main`.** Nada del frontend v2 llega a `app.tudominio.com` productivo hasta el corte.
- **Railway y Neon existen sólo para la rama.** El backend y la DB nueva viven en entornos independientes del stack productivo actual.

### H.3 Entornos paralelos durante el desarrollo

| Entorno | Sirve a | Origen |
|---|---|---|
| **Prod actual (intocado en código)** | Uso interno de pruebas | Rama `main`, Vercel Prod, Supabase compartido |
| **Preview de la rama v2** | Sólo desarrollo | Vercel Preview (auto por push), Supabase compartido |

**Aislamiento de código**, no de datos: `main` no recibe ningún commit del trabajo v2 hasta el cutover. Pero como el proyecto no está en producción real y no hay datos sensibles, **ambas ramas comparten el mismo proyecto Supabase**. Las migraciones se diseñan aditivas para no romper `main`. Si aparece un caso real donde una migración destructiva fuera necesaria (por ejemplo `DROP COLUMN` o rename), se posterga al cutover final.

### H.4 Cómo se hace el corte final (Fase de cutover)

Cuando las 8 fases estén validadas en un nodo real en la granja piloto durante ≥1 semana sin regresiones:

1. **Congelar `main`:** ningún merge nuevo durante el cutover.
2. **Migración de datos:** exportar de Supabase actual (`pg_dump`) e importar a Neon. Los WAVs históricos de Supabase Storage se copian a R2 (script one-off).
3. **DNS / config swap:** apuntar el frontend Vercel productivo al nuevo backend Railway. Cambiar `INGEST_URL` en la config de los nodos (OTA si ya está la fase OTA implementada; si no, con cable de vuelta al taller).
4. **Merge de la rama a `main`:** un único merge grande (o squash, según preferencia).
5. **Ventana de rollback de 48-72 h** durante la cual `main` se puede revertir al commit anterior si algo peta gordo.
6. **Descomisionar Supabase** una vez estable.

Esto es una operación real de release que planificamos en su propio documento cuando llegue el momento — no ahora.

### H.5 Qué se hace en `main` durante el desarrollo de la rama

- **Bugfixes críticos** del nodo v1 productivo (si aparece un bug urgente en la granja piloto).
- **Nada más.** No features nuevas en el stack viejo — cualquier idea nueva va a la rama.

---

## F. Notas operativas

- **Bucket `alerts`:** hoy tiene INSERT/SELECT públicos. Como parte de la Fase 0, endurecer: INSERT sólo con service role, SELECT restringido por `site_id` (RLS a través de un `event_id`). Esto es requisito antes de dejar el proxy en producción.
- **Rotación del `ingest_token`:** documentar cómo se regenera desde el dashboard si un token se compromete.
- **Modo offline extendido:** el nodo puede pasar semanas sin WiFi. El guardarraíl de 20 MB de cola limita a ~500 alertas antes de descarte FIFO. Ajustable si es insuficiente en campo.
- **Compatibilidad hacia atrás:** los WAVs viejos en la raíz de la SD (pre-refactor) siguen ahí y no se suben. Si se quiere aprovecharlos, añadir un script one-off en Fase 6.5 que mueva `*.wav` de raíz a `/pending/` con `.meta.json` reconstruido desde el CSV.

---

## Preguntas resueltas en esta sesión

1. Tabla de eventos: se crea `acoustic_events` desde cero.
2. Autenticación: proxy Next.js `/api/ingest` con `X-Device-Token`.
3. Ventana de etiquetado: 30 s.
4. Modularización: sólo si `main.cpp` > 1800 líneas.

## Fuera de alcance de este plan

- Provisión física del segundo botón (hardware). Se asume que el operador conectará un pulsador `INPUT_PULLUP` a GPIO 8 antes de las pruebas de Fase 2.
- Modelo Edge AI/ML (fase posterior del proyecto).
- Nodo `bio-acoustic-bread` (ambiental) — sin cambios en este plan.
- UI en el frontend para reproducir/etiquetar/descargar WAVs desde el bucket (candidato natural para un plan aparte).
