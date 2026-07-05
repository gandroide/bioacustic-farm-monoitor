# Plan de Acción — SD como buffer + botón de etiqueta (bio-acoustic-health)

**Rama destino:** `feature/sd-buffer-and-label-button` (creada desde `main`)
**Estado:** Documento para revisión. NO ejecutar. La implementación se decidirá en otra sesión.
**Origen:** Sesión `ultraplan` del 2026-07-04 (`cryptic-forging-newell`), refinado 2026-07-05.
**Versión del nodo objetivo:** iteración v2 del nodo `bio-acoustic-health`. La versión productiva de `main` (v1, sólo SD + análisis local) se conserva intacta hasta que esta rama pase QA en campo.

---

## Arquitectura del sistema (confirmada 2026-07-05, revisión final)

Tres capas independientes, comunicadas por HTTPS. Se reutiliza Supabase como BaaS (ya en uso) y se añade un backend NestJS delgado para IoT + escrituras.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CAPA 1 — EDGE (dentro de cada granja)                                  │
│   ESP32-S3 N16R8 · WiFi local · HTTPS con X-Device-Token                 │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │  POST /ingest, /claim, /heartbeat
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CAPA 2 — CLOUD                                                         │
│                                                                          │
│  ┌────────────────────────┐   ┌──────────────────────────────────────┐  │
│  │ bio-acoustic-backend   │──▶│ Supabase                             │  │
│  │ NestJS · Railway       │   │  ┌────────────────────────────────┐  │  │
│  │ ─ /ingest    (IoT)     │   │  │ Postgres (farms, devices,      │  │  │
│  │ ─ /claim     (IoT)     │   │  │  acoustic_events, pairing_...) │  │  │
│  │ ─ /heartbeat (IoT)     │   │  ├────────────────────────────────┤  │  │
│  │ ─ /pairing-code (adm)  │   │  │ Auth (JWT, email + password)   │  │  │
│  │ ─ /devices, /events    │   │  ├────────────────────────────────┤  │  │
│  │   (writes de admin)    │   │  │ Storage (bucket alerts)        │  │  │
│  │ ─ Guarda SERVICE_KEY   │   │  ├────────────────────────────────┤  │  │
│  └───────────┬────────────┘   │  │ Realtime (WebSocket)           │  │  │
│              │                │  └────────────────────────────────┘  │  │
│              │                └───────────────────┬──────────────────┘  │
│              │                                    │                     │
│              │  writes admin                      │  reads RLS-safe +   │
│              │                                    │  Realtime           │
│              ▼                                    ▼                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ bio-acoustic-frontend                                            │   │
│  │ Next.js 14 · Vercel                                              │   │
│  │ ─ @supabase/auth-helpers-nextjs (login, session)                 │   │
│  │ ─ @supabase/supabase-js (reads RLS + Realtime subscriptions)     │   │
│  │ ─ lib/api.ts → llama al backend para writes IoT-related          │   │
│  └────────────────────────┬─────────────────────────────────────────┘   │
└───────────────────────────┼─────────────────────────────────────────────┘
                            │  HTTPS
                            ▼
             Granjero (Farm Admin) / Super Admin (Ontiveros)
```

**Ownership por pieza:**

| Pieza | Stack | Hosting | Ownership |
|---|---|---|---|
| Nodos (edge) | C++ / PlatformIO | Hardware físico | 100% propia |
| Backend | NestJS + Drizzle ORM (Postgres) + `@supabase/supabase-js` (Storage + Auth admin) | Railway | 100% propio (código) |
| Base de datos | Postgres | **Supabase** (BaaS) | Portable (dump + restore a cualquier Postgres) |
| Storage WAVs | Bucket S3-compatible | **Supabase Storage** | Portable a S3/R2 con migración script si algún día duele |
| Auth | JWT emitido por Supabase Auth | Supabase | Portable con esfuerzo (~1 semana) |
| Realtime | Supabase Realtime (WebSocket managed) | Supabase | Portable con esfuerzo (~1 semana) |
| Frontend | Next.js 14 App Router | Vercel | 100% propio |

**Vendor lock-in aceptado a nivel Supabase (Auth + Realtime).** Postgres siempre es portable; Storage y Auth son las piezas donde salir cuesta más, pero se puede — sólo no es inmediato. A cambio, la Fase 0 pasa de 1-2 semanas a 3-5 días, y no hay superficie propia de Auth / WS que mantener y patchear.

---

## Hardware objetivo (confirmado por el usuario, 2026-07-05)

- **MCU:** ESP32-S3-DevKitC-1-**N16R8** (chip embebido: `ESP32-S3-WROOM-1-N16R8`).
- **Flash:** 16 MB (no 8 MB como decía `CONTEXT.MD` v5.0 — pendiente de corregir esa doc).
- **PSRAM:** **8 MB** octal (`qio_opsi`).
- **SRAM interna:** 320 KB (fija por chip).

**Por qué importa aquí:** el plan añade WiFi + TLS + `HTTPClient` + `WiFiClientSecure` + una `uploaderTask` con back-off. En un DevKitC-1 pelado (variante `N8` sin PSRAM) los ~200 KB estáticos que ya viven en SRAM interna + ~40 KB de handshake TLS + stacks FreeRTOS dejarían el margen negativo tras días de uptime (fragmentación de heap + fallos de `alloc` durante reintentos). Con los **8 MB de PSRAM del N16R8**, los buffers grandes (multipart POST, JSON, TLS session cache) pueden vivir fuera de SRAM y el margen deja de ser un tema. Los 16 MB de flash también dan espacio para la partición `huge_app.csv` (2 MB de app) + un `nvs` cómodo + espacio para OTA en el futuro sin apretar.

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

- **Tabla de eventos:** ninguna vive todavía en producción. Se crea desde cero como parte de este trabajo.
- **Autenticación de subida:** endpoint `POST /ingest` **en un backend NestJS separado** (ver §G) con `X-Device-Token` por dispositivo. La `SUPABASE_SERVICE_ROLE_KEY` nunca sale del backend.
- **Ventana hacia atrás para etiquetar:** 30 s (constante `LABEL_BACKWARD_WINDOW_MS = 30000`).
- **Modularizar `main.cpp`:** sólo si supera 1800 líneas tras las nuevas funcionalidades. Por defecto, monolítico.
- **Backend separado desde ya:** se abre el paquete `bio-acoustic-backend/` (NestJS) como parte de la Fase 0. Justificación completa en §G.
- **Supabase se mantiene como BaaS (Postgres + Auth + Storage + Realtime).** Neon y R2 descartados tras evaluación. Ver §G.7.
- **Hardware target:** ESP32-S3-DevKitC-1-**N16R8** (ver sección Hardware objetivo arriba).
- **Nombre de la rama:** `v2/full-stack` (renombrada desde `feature/sd-buffer-and-label-button`).
- **Estructura del monorepo:** proyectos independientes (cada paquete con su `package.json`), sin npm/pnpm workspaces por ahora.
- **Node runtime del backend:** **Node 22 LTS** (fijado en `engines` del `package.json` y en Railway).
- **ORM del backend:** **Drizzle** apuntando a `DATABASE_URL` de Supabase. `@supabase/supabase-js` para Storage y Auth admin API.
- **Emails transaccionales:** cubiertos por Supabase Auth desde el inicio (verificación, reset password). Sin proveedor externo por ahora.

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
  - Sube el WAV al bucket `alerts/<mac>/<filename>.wav` con service key (server-side).
  - Inserta la fila en `acoustic_events`.
  - Responde `{ok: true, event_id: uuid}` o error 4xx/5xx.
- El firmware sólo conoce: URL del proxy + su token. Nunca ve claves de Supabase.

### Schema de la tabla `acoustic_events` (a crear desde cero)

Confirmado por el usuario: no vive todavía. Propuesta a alinear en Supabase antes de tocar firmware:

```sql
CREATE TABLE acoustic_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  device_id UUID REFERENCES devices(id),
  farm_id UUID REFERENCES farms(id),
  room_id UUID REFERENCES rooms(id),
  event_type TEXT NOT NULL,          -- 'REC' | 'ENV'
  baseline_rms FLOAT,
  peak_rms FLOAT,
  dominant_freq_hz FLOAT,
  temp_c FLOAT,
  uptime_ms BIGINT,
  audio_url TEXT,                    -- storage path en bucket `alerts`
  operator_label TEXT,               -- NULL | 'crushing' (extensible a futuro)
  metadata JSONB DEFAULT '{}'::jsonb
);
-- RLS: SELECT por farm_id del usuario; INSERT sólo vía service role (proxy).
```

Y sobre `devices`: añadir columna `ingest_token TEXT UNIQUE NOT NULL` (generada al aparear el dispositivo con `claimDeviceToRoom`).

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

### Fase 0-A — Bootstrap del backend `bio-acoustic-backend` (NestJS + Drizzle + Supabase)
- Nuevo paquete `bio-acoustic-backend/` en la raíz del monorepo.
- Scaffold: `nest new bio-acoustic-backend --package-manager npm --strict`.
- Dependencias core: `drizzle-orm`, `drizzle-kit`, `postgres` (driver), `@supabase/supabase-js`, `helmet`, `class-validator`, `class-transformer`, `@nestjs/config`, `@nestjs/throttler`.
- Node engine: fijar `>=22 <23` en `package.json`.
- Módulos base:
  - `AppModule` (config, helmet, ConfigModule con validación de env).
  - `DatabaseModule` (Drizzle provider apuntando al `DATABASE_URL` de Supabase).
  - `SupabaseModule` (cliente supabase-js singleton con `SERVICE_ROLE_KEY`, para Storage y Auth admin API).
  - `AuthModule` (guards: `JwtSupabaseGuard` valida JWT de Supabase; `DeviceTokenGuard` valida `X-Device-Token` contra `devices.ingest_token`; `RoleGuard` chequea `super_admin` | `farm_admin`).
  - Módulos placeholder: `DevicesModule`, `EventsModule`, `IngestModule`, `PairingModule`, `FarmsModule`, `SitesModule`, `BuildingsModule`, `RoomsModule`.
- `.env.example`: `DATABASE_URL` (postgres URL de Supabase), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `PORT=3001`, `FRONTEND_URL`, `NODE_ENV`.
- Health check: `GET /health` → `{ok, uptime, db: "connected"|"error", supabase: "reachable"|"error"}`.
- CORS: permite `FRONTEND_URL` con `credentials: true`.
- Deploy inicial a Railway con env vars configuradas.
- Rate limit global: 100 req/min por IP (`@nestjs/throttler`).
- Commit: `backend: scaffold NestJS + Drizzle + Supabase clients with health check`.

### Fase 0-B — Schema en Supabase (migraciones Drizzle o SQL versionado)
- Schema TypeScript en `bio-acoustic-backend/src/db/schema.ts` reflejando la realidad + añadidos:
  - Tablas existentes en Supabase actual (import/adaptar): `organizations`, `sites`, `buildings`, `rooms`, `farms`, `profiles`, `devices`, `events`.
  - Añadir columna `ingest_token TEXT UNIQUE` a `devices` (para auth IoT).
  - Añadir columna `last_seen TIMESTAMPTZ` a `devices` (para heartbeat).
  - Nueva tabla `acoustic_events` (id, device_id, farm_id, room_id, event_type, baseline_rms, peak_rms, dominant_freq_hz, temp_c, uptime_ms, audio_url, operator_label, metadata, created_at).
  - Nueva tabla `pairing_codes` (code, farm_id, room_id, expires_at, used_at).
- Herramienta de migraciones: `drizzle-kit generate` produce `.sql` en `bio-acoustic-backend/db/migrations/`.
- Comando `npm run db:migrate` aplica contra Supabase (usando `SUPABASE_SERVICE_ROLE_KEY` como conexión superusuario para DDL).
- **RLS:**
  - `acoustic_events`: SELECT restringido por `farm_id` del usuario (vía JWT claims). INSERT sólo con service role.
  - `pairing_codes`: sin acceso público. Sólo backend.
- **Bucket `alerts`:** endurecer políticas — INSERT sólo con service role, SELECT restringido a usuarios con `farm_id` matching en el path `<mac>` del objeto (o usando función SQL que resuelva `mac → farm_id`).
- Actualizar `/docs/supabase_schema.sql` como snapshot canónico post-migración.
- Commit: `db: add acoustic_events + pairing_codes + devices.ingest_token via Drizzle migrations`.

### Fase 0-C — Extraer escrituras del frontend al backend
Corte que evita que `lib/supabase.ts` (hoy 722 líneas) siga creciendo indefinidamente.

- Migrar al backend NestJS todos los métodos de **escritura** y de **negocio** (los que necesitan service role o que hacen JOINs/agregaciones complejas):
  - `DevicesController`: `POST /devices`, `PATCH /devices/:id`, `POST /devices/:id/claim` (reutiliza lógica de `claimDeviceToRoom`).
  - `FarmsController`, `SitesController`, `BuildingsController`, `RoomsController`: CRUDs equivalentes a los que hoy están en `lib/supabase.ts`.
  - `EventsController`: `GET /events?farm_id=…` con paginación server-side.
- **Se quedan en el frontend (directas a Supabase):**
  - Todas las lecturas RLS-safe con anon key (dashboards, listados por `farm_id`).
  - Suscripciones Realtime (`supabase.channel('acoustic_events:farm_id=eq.X')`).
  - Auth flows (`signIn`, `signOut`, `signUp`, session cookies).
  - Signed URLs de Storage (`supabase.storage.from('alerts').createSignedUrl`).
- Nuevo `bio-acoustic-frontend/lib/api.ts` — cliente REST tipado que apunta a `NEXT_PUBLIC_BACKEND_URL`. Envía el JWT de Supabase en `Authorization: Bearer <token>`.
- Dejar `lib/supabase.ts` sólo con lecturas + auth + realtime + signed URLs. Objetivo: <300 líneas.
- Revisar `app/api/v1/telemetry/route.ts` — hoy proxifica a un backend inexistente. Reapuntar al backend real de Railway o eliminar si ya no es necesario.
- Commit: `frontend+backend: extract write-path and admin logic from lib/supabase.ts into NestJS`.

**Duración estimada de Fase 0 completa:** ~3-5 días con asistencia de IA. Sin IA: ~2 semanas.

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

**Componentes backend (NestJS, módulo `PairingModule`):**
- `POST /pairing-code` — requiere JWT del usuario (Farm Admin). Genera código de 6 dígitos, guarda en tabla `pairing_codes` con TTL 10 min, `farm_id` y `room_id` que el admin eligió.
- `POST /claim` — público (sin JWT, se apoya en el código). Recibe `{mac, code}`, valida vigencia, UPSERT en `devices` (crea la fila si no existe con esa MAC), genera `ingest_token` con `crypto.randomBytes(24).toString('hex')`, marca el código como `used_at = now()`, responde `{ok: true, ingest_token, ingest_url}`.
- La lógica de UPSERT reutiliza el `DevicesService` de Fase 0-C.
- **Frontend:** vista "Aparear nuevo nodo" en `bio-acoustic-frontend/app/admin/devices/pair/page.tsx` que llama a `POST /pairing-code` y muestra el código en pantalla + un QR opcional.

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

### Fase 5 — Endpoint `POST /ingest` (backend NestJS, módulo `IngestModule`)
> Se apoya en el `ingest_token` obtenido en Fase 4-bis y en el scaffold de Fase 0-A.

- Controller `IngestController` con guard `DeviceTokenGuard`:
  - `POST /ingest` con `multipart/form-data` (`audio` = WAV, `meta` = JSON string).
  - Body size limit 512 KB (WAV de 8 s = 256 KB, margen 2×).
  - **Streaming del WAV a Supabase Storage** vía `supabase.storage.from('alerts').upload(path, stream)`: path = `<mac>/<yyyy-mm>/<filename>.wav`. **No cargar el WAV entero en memoria** — pipe del stream de multer.
  - INSERT en `acoustic_events` con `audio_url = <path>` y todos los metadatos.
  - Al INSERT, **Supabase Realtime automáticamente publica** el evento a todos los clientes suscritos con matching `farm_id`. El backend no hace broadcast manual.
  - Responde `{ok: true, event_id: uuid}` o error tipado (`400 BAD_TOKEN`, `413 TOO_LARGE`, `500 STORAGE_FAILED`, `500 DB_FAILED`).
  - Atomicidad: si el INSERT en Postgres falla tras subir el WAV, borrar el objeto del bucket (compensación). Si el upload falla, no toca la DB.
- Rate limit por dispositivo: 30 req/min (protección contra bugs de firmware que reintenten en bucle).
- Log estructurado (JSON) para inspección: `{level, event, device_mac, event_type, size, latency_ms}`.
- Prueba: `curl -F "audio=@test.wav" -F 'meta={...}' -H "X-Device-Token: xxx" http://localhost:3001/ingest`.
- Commit: `backend: add /ingest endpoint with Supabase Storage upload and atomic event insert`.

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

**Backend nuevo (`bio-acoustic-backend`):**
- Todo el paquete (raíz del monorepo, hermano de `bio-acoustic-frontend/`).
- `bio-acoustic-backend/src/db/{schema.ts,client.ts}` (Drizzle apuntando a Supabase Postgres).
- `bio-acoustic-backend/src/supabase/supabase.module.ts` (cliente supabase-js con service role para Storage + Auth admin).
- `bio-acoustic-backend/src/auth/guards/{jwt-supabase,role,device-token}.guard.ts`.
- `bio-acoustic-backend/src/modules/{farms,sites,buildings,rooms,devices,events,ingest,pairing}/`.
- `bio-acoustic-backend/db/migrations/*.sql` (generadas por drizzle-kit).

**Frontend (`bio-acoustic-frontend`):**
- **Mantiene:** dependencias `@supabase/*`. Auth + reads + Realtime + signed URLs siguen directas contra Supabase.
- **`lib/supabase.ts`** — se **adelgaza** a <300 líneas (queda sólo: cliente, reads, realtime, storage signed URLs, auth helpers).
- **Nuevo:** `lib/api.ts` (cliente REST tipado del backend, envía JWT Supabase en Authorization).
- `app/api/v1/telemetry/route.ts` — revisar y reapuntar al backend Railway o eliminar si redundante.
- `app/admin/devices/pair/page.tsx` (nueva vista de pairing).

**Documentación (todo en la rama, no en main):**
- `CONTEXT.MD` — se actualiza **en la rama** con hardware N16R8 y sección "Backend NestJS + Supabase" (v2). El CONTEXT.MD de main se actualiza sólo al hacer el corte final (§H.4).
- `docs/supabase_schema.sql` — actualizado con las nuevas tablas (en la rama).
- `docs/planificacion.md` — archivo histórico, sin cambios.
- `docs/plan_sd_buffer_label_button.md` — este documento; puede permanecer en main como referencia porque no cambia código.

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
| 0-A | `curl http://localhost:3001/health` responde 200 con `db: "connected"` y `supabase: "reachable"`. `curl -H "X-Device-Token: bad" .../devices` responde 401. |
| 0-B | En Supabase Studio: `acoustic_events` y `pairing_codes` visibles con schema correcto; INSERT manual con service key inserta OK; UPDATE de `devices` con `ingest_token` OK. Bucket `alerts` con políticas endurecidas. `npm run db:migrate` idempotente. |
| 0-C | Frontend sigue funcionando: dashboard, listados, admin panel intactos. `lib/supabase.ts` bajo 300 líneas. Endpoints admin (crear device, aparear a room) pasan por backend. Realtime + auth siguen directos a Supabase desde frontend. |
| 1 | Serial monitor: BTN_SYNC (clic corto → PAUSED; clic largo → toggle sensibilidad) funciona idéntico a hoy. |
| 2 | Grabar 3 alertas. Clic durante REC → CSV muestra `crushing` en esa fila. Clic <30 s después → `.meta.json` de la última se actualiza. Clic 60 s después → LED rojo, sin cambios. |
| 3 | Reboot: `ls /pending/` muestra 3 pares `.wav`/`.meta.json`; CSV y estados intactos. |
| 4 | Al boot con NVS válida: `[WIFI] Conectado, IP: x.x.x.x, RSSI: -55`. Sin NVS: entra a `STATE_PAIRING` y levanta AP. |
| 4-bis | Nodo sin credenciales → SSID `BioAlert-A3F2` visible. Portal aparece solo al conectar el móvil. Código válido → nodo se conecta y aparece "Online" en el portal SaaS en <30 s. Código expirado → LED rojo 2 s. Reset (BTN_SYNC+BTN_LABEL 5s) → NVS limpia. |
| 5 | `curl -X POST -F "audio=@sample.wav" -F 'meta={...}' -H "X-Device-Token: dev-token-abc" http://localhost:3001/ingest` → 200 con `event_id`; fila visible en `acoustic_events`; WAV visible en bucket `alerts/<mac>/<yyyy-mm>/`; navegador con Realtime activo recibe el evento en <2 s. |
| 6 | Grabar alerta → tras <60 s el WAV desaparece de `/pending/`, aparece en bucket, fila en `acoustic_events` con etiqueta correcta. |
| 7 | Cortar WiFi 5 min y grabar 3 alertas → cola de 3 en `/pending/`. Reconectar → drena en secuencia. Reboot mid-drenaje → reconstruye cola y continúa. |
| 8 | Llenar SD manualmente hasta 45 MB de `/pending/` → descarte FIFO logueado; nuevas alertas siguen entrando. |

---

## G. Decisión arquitectónica — Supabase + backend NestJS delgado (revisión final 2026-07-05)

### G.1 Qué se está planteando

Se conserva Supabase como BaaS (Postgres + Auth + Storage + Realtime) y se añade un backend NestJS delgado que concentra los endpoints IoT y las escrituras de admin:

- **Backend:** NestJS en `bio-acoustic-backend/`, desplegado en **Railway**.
- **Base de datos:** **Supabase Postgres** (sin cambio respecto a la actual).
- **ORM en el backend:** **Drizzle** apuntando al `DATABASE_URL` de Supabase (usa `SERVICE_ROLE_KEY` para bypass de RLS en operaciones de escritura). Alternativa aceptable: `@supabase/supabase-js` con service role para todo. Drizzle se prefiere para queries no triviales; supabase-js se usa cuando toca Storage o Auth admin API.
- **Storage de WAVs:** **Supabase Storage**, bucket `alerts`. Endurecido: INSERT sólo con service role (desde backend), SELECT restringido por `farm_id` vía RLS.
- **Auth:** Supabase Auth (JWT + email + password, magic link opcional después). El frontend usa `@supabase/auth-helpers-nextjs`. El backend valida JWTs de Supabase con el JWT secret o llamando a `auth.getUser()`.
- **Realtime:** Supabase Realtime. El frontend se suscribe directamente a `acoustic_events` filtrado por `farm_id`. El backend no gestiona WebSockets — RLS filtra automáticamente.
- **Frontend:** Next.js 14 en Vercel, mantiene `@supabase/*` para lecturas RLS-safe + Realtime. Añade `lib/api.ts` para llamadas al backend en el path de escritura.

Es un **backend delgado** — sólo escrituras + IoT. Las lecturas RLS-safe se quedan directas frontend→Supabase.

### G.2 Historia de la decisión

1. **Primera propuesta (mía):** Supabase + backend NestJS delgado.
2. **Reversión intermedia (del usuario, misma sesión):** stack de máximo control con Neon + R2 + auth propia + WS propio. Argumento: priorizar control > velocidad, y compensar el tiempo extra con asistencia IA.
3. **Reversión final (del usuario, misma sesión):** volver a Supabase. Se acepta el consejo original tras evaluar el volumen real de trabajo previo (Auth y WS propios como campo minado + operación 24/7).

Documentar el vaivén evita re-litigar la decisión en 3 meses.

### G.3 Ventajas asumidas de esta ruta

1. **Fase 0 se reduce a 3-5 días** (vs 1-2 semanas del stack propio). El firmware v2 puede empezar antes.
2. **Cero superficie propia de Auth.** Sin timing attacks, sin CSRF propio, sin rotación de refresh tokens que operar.
3. **Realtime "gratis".** Suscripción declarativa en el frontend; el backend ni ve los WebSockets.
4. **Emails transaccionales integrados.** Supabase Auth envía verificación, reset password, magic link sin proveedor extra.
5. **Panel Supabase Studio para inspección.** Buscar eventos, revisar usuarios, ejecutar SQL, sin instalar TablePlus.
6. **Backups automáticos** (según plan Supabase). El free tier tiene backups de 7 días; los pagos tienen PITR.

### G.4 Trade-offs aceptados

- **Vendor lock-in parcial en Auth y Realtime.** Migrar Auth cuesta ~1 semana; migrar Realtime, otra semana. No es imposible, pero no es una tarde.
- **Coste crece con volumen.** Supabase free tier basta hasta ~500 MB DB + 1 GB Storage. Se escala a Pro ($25/mes) cuando el dataset crezca. Aceptable.
- **`SUPABASE_SERVICE_KEY` en el backend** — se aísla en Railway env vars, nunca en el frontend ni en el firmware.

### G.5 Por qué NestJS y no Hono / Fastify / Express

- Ya existe `docs/skill_backend_nestjs.md` con la elección documentada.
- DI + guards + interceptors modelan bien: `DeviceTokenGuard`, `JwtSupabaseGuard`, `RateLimitInterceptor`, `LoggingInterceptor`.
- Módulos por dominio hacen predecible dónde vive cada cosa.
- Verbosidad aceptada; se paga sólo una vez.

### G.6 Qué se hace explícitamente NO en este plan

- Reemplazar todas las lecturas del frontend por llamadas al backend. Se conservan las lecturas RLS-safe directas — son rápidas y seguras.
- OAuth (Google, Apple). Sólo email + password en la v1. Se añade después con un click en Supabase Studio si hace falta.
- Multi-región. Un solo deploy en Railway EU.
- gRPC / GraphQL / tRPC. REST + JSON basta.
- Redis / colas asíncronas / Kafka. La cola vive en la SD del nodo (Fase 6-7).

### G.7 Qué se descarta explícitamente

- **Neon:** descartado. Volveremos a evaluarlo si algún día el volumen supera 10M rows/mes o si necesitamos DB branching para experimentos ML.
- **Cloudflare R2:** descartado en v2. Podría considerarse en el futuro sólo si el egress de Supabase Storage se vuelve caro (que requiere volumen serio).
- **Auth propia con JWT + argon2:** descartada. Supabase Auth cubre todos los casos que necesitamos.
- **WebSocket gateway propio:** descartado. Supabase Realtime lo hace mejor y sin código a mantener.

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
| **Prod actual** (intocado) | Granja piloto real + nodos v1 | Rama `main`, Vercel Prod, Supabase actual |
| **Preview de la rama** | Sólo el usuario y colaboradores | Vercel Preview (auto por PR), Railway (proyecto separado), Neon (branch de DB o proyecto separado), R2 (bucket `alerts-dev`) |

Vercel crea previews por rama automáticamente. Railway se configura para desplegar la rama a un servicio marcado como `bio-acoustic-backend-preview`. Neon puede usar **DB branching** (una de sus ventajas fuertes): la rama de git tiene su propia rama de DB, aislada del prod cuando prod exista.

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

- **Bucket `alerts`:** hoy tiene INSERT/SELECT públicos. Como parte de la Fase 0, endurecer: INSERT sólo con service role, SELECT restringido por `farm_id` (RLS a través de un `event_id`). Esto es requisito antes de dejar el proxy en producción.
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
