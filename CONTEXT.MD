# 🐷 ONTIVEROS BIO-ALERT — Master Context

> **Fuente de la verdad** para Arquitectura, Hardware, Frontend y Reglas de Negocio.
> Última actualización: 2026-07-05 (v6.0 — Rama `v2/full-stack`: hardware N16R8 + backend NestJS + SD como buffer + botón de etiqueta)
>
> ⚠️ **Este archivo está en la rama `v2/full-stack`.** `main` mantiene v5.0 con el stack v1 productivo. Ver `docs/plan_sd_buffer_label_button.md` para detalles del rewrite.

---

## 1. Identidad y Arquitectura Global

* **Objetivo:** Plataforma de monitoreo bioacústico para granjas porcinas. La **fase actual** del firmware es de **Dataset Builder para Edge AI/ML**: recolectar audio en el borde sobre eventos disparados por RMS + capturas ambientales periódicas, etiquetarlo, y entrenar un modelo que más adelante correrá en el propio ESP32-S3 para detectar estrés porcino (p. ej. aplastamiento de lechones) y alertar vía el SaaS multi-tenant.
* **Estructura Monorepo:**
  * **`/bio-acoustic-frontend`:** SaaS completo — UI + API (Next.js 14 Route Handlers + Supabase). Deploy: Vercel.
  * **`/firmware/bio-acoustic-health`:** Nodo principal — Monitoreo de audio (Edge). **v2 en desarrollo, v1 en main.**
  * **`/firmware/bio-acoustic-bread`:** Nodo de cría/maternidad — Sensores ambientales (Edge). **EN DESARROLLO.**
  * **`/docs`:** Documentación de planificación y esquemas.
* **Base de Datos (BaaS):** Supabase (PostgreSQL + Auth + Storage + Realtime + RLS).
* **Backend en Fase 1:** No hay backend separado. Los endpoints IoT (`/api/ingest`, `/api/claim`, `/api/heartbeat`, `/api/pairing-code`) viven como Next.js Route Handlers dentro del frontend. Ver `docs/plan_sd_buffer_label_button.md` §G para criterios de extracción futura.
* **Estado Actual (rama v2/full-stack):** rewrite del firmware (SD como buffer + WiFi + botón de etiqueta), extensión de schema Supabase, `middleware.ts` de auth server-side. `main` conserva v1 productivo intacto hasta cutover.

---

## 2. Cloud Web App & Backend (SaaS Multi-Tenant)

* **Stack Frontend + API:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Shadcn/UI, `@supabase/*`. Todo en un solo paquete: páginas RSC + Route Handlers en `app/api/*` para IoT y writes admin.
* **Cliente Supabase en Route Handlers:** `@supabase/supabase-js` con `SUPABASE_SERVICE_ROLE_KEY` (server-only, sin prefijo `NEXT_PUBLIC_`, jamás en el bundle cliente).
* **Directorio:** `/bio-acoustic-frontend` (Root Directory en Vercel).
* **Multi-Tenancy:** Tabla `farms` con `farm_id` vinculado a usuarios/eventos/dispositivos. Row Level Security (RLS) activo.
* **Roles:** Super Admin (Ontiveros — acceso global) y Farm Admin (acceso aislado a su granja).
* **Features:**
  * PWA instalable (Mobile First).
  * Dashboard con eventos en tiempo real (Supabase Realtime).
  * Panel de Admin: gestión de inventario y sitios.
  * Autenticación con Supabase Auth + Middleware de rutas protegidas.
* **Fix Crítico de Vercel:** En `lib/supabase.ts`, se mantiene un fallback `|| 'placeholder'` para variables de entorno para evitar fallos de build.

---

## 3. Design System & UI Guidelines (INMUTABLE)

* **Filosofía Visual:** "Industrial Clean" / "Sci-Fi Dashboard". Minimalista, oscuro, alto contraste.
* **Modo de Color:** Únicamente Dark Mode (`bg-slate-950` o `bg-black`).
* **Color Primario:** Naranja Seguridad (`text-amber-500` / `bg-amber-500`).
* **Semántica:** Alerta (`red-500`), Advertencia (`amber-500`), Seguro (`emerald-500`), Info (`slate-400`).
* **Tipografía:** `Inter` (general) y `Geist Mono` / `Monospace` (datos técnicos y telemetría).
* **Componentes:** Uso exclusivo de Shadcn/UI y Lucide-React (strokeWidth 2 o 1.5). Aplicar efectos de cristal (`backdrop-blur`) y sombras de color (Glow) para KPIs críticos.

---

## 4. Hardware IoT: Nodo Bio-Acoustic-Health (Firmware)

### 4.1 Plataforma

* **MCU:** ESP32-S3-DevKitC-1-**N16R8** (320 KB SRAM interna, **16 MB Flash**, **8 MB PSRAM octal `qio_opsi`**) programado en C++ usando PlatformIO y framework Arduino. La PSRAM habilita en v2 la coexistencia de I2S DMA + WiFi + TLS + uploader task sin fragmentación de heap.
* **Arquitectura:** FreeRTOS Dual-Core.
  * **Core 0:** `audioCaptureTask` — Lectura I2S continua a 32-bit, conversión a 16-bit con shift `>> I2S_SHIFT` (default 14) → Ring Buffer thread-safe (32 K muestras = 2 s de pre-roll).
  * **Core 1:** `audioAnalysisTask` — RMS + baseline EWMA (α=0.02) + FFT (1024 muestras, solo metadatos) + máquina de triggers + grabación WAV.
  * **Core 1:** `ledTask` — Máquina de estados para feedback visual.
  * **Core 1:** `buttonTask` — Smart Button con medición de duración.
* **Configuración Serial:** Puerto nativo `/dev/cu.usb*`, Baudrate `115200`, Flag `-D ARDUINO_USB_CDC_ON_BOOT=1`.

### 4.2 Pinout

| Componente | Pin | Notas |
|---|---|---|
| Micrófono INMP441 — WS | GPIO 15 | Canal Izquierdo (L/R a GND) |
| Micrófono INMP441 — SCK | GPIO 16 | |
| Micrófono INMP441 — SD | GPIO 17 | 16-bit, 16 kHz, mono |
| Micro SD — CS | GPIO 10 | SPI, FAT32 |
| Micro SD — MOSI | GPIO 11 | |
| Micro SD — SCK | GPIO 12 | |
| Micro SD — MISO | GPIO 13 | |
| LED Verde | GPIO 4 | PWM al 50% brillo |
| LED Amarillo | GPIO 5 | PWM al 50% brillo |
| LED Rojo | GPIO 6 | PWM al 50% brillo |
| Botón (BTN_SYNC) | GPIO 7 | `INPUT_PULLUP`, activo = LOW |

### 4.3 Smart Button

* **Clic Corto (< 1 segundo): Safe Eject Mode** — toggle de `STATE_PAUSED`.
  * Estando en `MONITORING` (o cualquier estado distinto de `RECORDING`): desmonta la SD por software con `SD.end()` y entra en `STATE_PAUSED` (LED verde+amarillo fijos). La SD se puede extraer físicamente sin riesgo de corrupción.
  * Estando en `STATE_PAUSED`: vuelve a llamar `SPI.begin()` + `SD.begin()`. Si el remontaje falla → `STATE_ERROR`. Si OK → `STATE_MONITORING` con cooldown aplicado.
  * **Durante `STATE_RECORDING` el clic se ignora** para no abortar el WAV en curso (hay que esperar a que termine, máx. 8 s).
* **Pulsación Larga (≥ 3 segundos): Cambio de Sensibilidad.**
  * Alterna `RMS_FACTOR` entre `1.5f` (sensible) y `2.5f` (estricto).
  * Feedback: LED amarillo encendido 2 segundos.
  * La variable es `volatile float` para cambios en tiempo de ejecución.
  * El modo de sensibilidad **no se persiste** entre reinicios (vuelve a sensible).
* **Zona muerta (1-3 s):** sin acción. Evita disparos accidentales.
* **Debounce:** 50 ms basado en `xTaskGetTickCount()`. Polling a 50 Hz.

### 4.4 Estados del sistema

| Estado | Patrón LED | Significado |
|---|---|---|
| `STATE_MONITORING` | Verde heartbeat 1 Hz | Operación normal |
| `STATE_RECORDING` | Amarillo fijo | Grabando WAV + CSV |
| `STATE_ERROR` | Rojo parpadeo rápido (200 ms) | Fallo crítico (grabación o remontaje SD) |
| `STATE_SD_FULL` | Rojo + Amarillo alternados (500 ms) | SD con < 50 MB libres; pausa grabaciones |
| `STATE_PAUSED` | **Verde + Amarillo simultáneos fijos** | Safe Eject: SD desmontada por software, segura para extraer |
| `STATE_PAIRING` | Los 3 LEDs sincronizados (500 ms) | Cambio de sensibilidad en curso |

### 4.5 Compilación

* **RAM:** ~50% (≈164 KB / 320 KB) — incluye `prerollSnapshot` 64 KB + buffers I2S 32-bit + ring buffer.
* **Flash:** ~11% (≈360 KB / 3.3 MB).
* **Librerías:** ArduinoFFT 2.0.4, SD 2.0.0, SPI 2.0.0.
* **`USE_SD_CARD = true`** (hardware SD conectado). Si se desconecta físicamente, cambiar a `false` activa el modo MOCK.

---

## 5. Hardware IoT: Nodo Bio-Acoustic-Bread (Firmware)

* **Estado:** EN DESARROLLO — Esqueleto estructural presente.
* **Enfoque:** Monitoreo ambiental de salas de cría/maternidad.
* **Implementaciones Pendientes:**
  * Sensores ambientales (Temperatura, Humedad).
  * Lógica de recolección de datos específica para maternidad.
  * Protocolo de comunicación con el nodo Health o directo a Supabase.
  * Gestión de energía optimizada.

---

## 6. Lógica de Detección en el Borde (Dataset Builder)

* **Captura I2S (Core 0):** `i2s_read()` en modo 32-bit; cada muestra se shifta `>> I2S_SHIFT` (default 14) a int16 para reducir el ruido de fondo del INMP441. El ring buffer es thread-safe (mutex + volatile indices) y guarda **2 s de pre-roll**.
* **Análisis (Core 1):**
  * **RMS:** Media cuadrática sobre bloques de 1024 muestras. Baseline rodante con EWMA (α = 0.02).
  * **FFT:** ArduinoFFT sobre 1024 muestras → frecuencia dominante. **Solo metadato para el dataset; NO participa en el trigger.**
  * **Trigger REC (alerta):** `RMS > max(THRESHOLD_RMS=500, baseline · RMS_FACTOR)` con `RMS_FACTOR ∈ {1.5, 2.5}` controlado por el Smart Button.
  * **Trigger ENV (ambiental):** timer de 30 min para muestreo automático.
* **Anti-bucle:**
  * **Warmup 10 s tras boot:** el baseline se actualiza pero no se permite disparar (evita falsos triggers por I2S inestable al arrancar).
  * **Cooldown 5 s post-grabación:** mismo principio, da margen para que el baseline se reajuste al silencio post-evento.
* **Grabación:** Al disparar, escribe WAV de **8 s** (2 s pre-roll + 6 s live) con header RIFF correcto.
  * El pre-roll se copia bajo mutex a un buffer estático (`prerollSnapshot`) antes de la escritura → evita race con Core 0.
  * El nombre del archivo se construye **una sola vez** y se reutiliza para WAV y CSV (garantiza coherencia).
* **CSV de Eventos:** `/log_eventos.csv` con columnas `Archivo,Tipo,MAC,Uptime_ms,Evento,Baseline_RMS,Pico_RMS,Freq_Dom_Hz,Temp_C`.
* **SD llena:** Cada 30 s se chequea `SD.totalBytes() - SD.usedBytes()`. Si quedan < 50 MB → `STATE_SD_FULL` (LED rojo+amarillo alternados, sin grabaciones). Al liberar espacio (SD nueva o limpieza), el sistema vuelve solo a `STATE_MONITORING`.
* **Errores de grabación:** Si `recordWavToSD` falla, `STATE_ERROR` con LED rojo 5 s y vuelta automática a monitoreo (no bloquea el sistema).

---

## 7. Base de Datos (Supabase)

### Relaciones Principales

| Origen | Relación | Destino |
|---|---|---|
| `events.farm_id` | → | `farms.id` |
| `devices.farm_id` | → | `farms.id` |
| `profiles.farm_id` | → | `farms.id` |

* **RLS:** Activo. Cada granja solo ve sus propios datos.
* **Storage Bucket:** `alerts` — Almacena archivos WAV subidos desde dispositivos edge.
* **Schema SQL:** Ver `/docs/supabase_schema.sql`.

---

## 8. Reglas Estrictas y Advertencias (NO TOCAR)

* **Internacionalización (i18n):** NO intentar reimplementar `next-intl` bajo ninguna circunstancia hasta que el Multi-Tenant esté en producción.
* **Assets PWA:** Los iconos `manifest.json` deben generarse automáticamente desde el archivo maestro `/public/icono`.
* **Estabilidad del Build:** Si se modifica `next.config.ts` o `middleware.ts`, verificar doblemente en Vercel.
* **Estructura PlatformIO:** Mantener los nodos (`bio-acoustic-health`, `bio-acoustic-bread`, etc.) en carpetas aisladas dentro de `/firmware` con sus propios `platformio.ini`.
* **Vercel Root Directory:** Configurado como `bio-acoustic-frontend`. Si se renombra la carpeta, actualizar en Vercel Dashboard → Settings → General → Root Directory.