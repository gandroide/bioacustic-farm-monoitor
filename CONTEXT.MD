# 🐷 ONTIVEROS BIO-ALERT — Master Context

> **Fuente de la verdad** para Arquitectura, Hardware, Frontend y Reglas de Negocio.
> Última actualización: 2026-04-28 (v4.0 — Limpieza Monorepo, Smart Button, FFT)

---

## 1. Identidad y Arquitectura Global

* **Objetivo:** Sistema de monitoreo bioacústico para granjas porcinas que detecta aplastamiento de lechones (chillidos) mediante procesamiento local (FFT/RMS/ZCR) y alerta al granjero en tiempo real vía SaaS.
* **Estructura Monorepo:**
  * **`/bio-acoustic-frontend`:** Frontend SaaS en Next.js 14 (Cloud).
  * **`/firmware/bio-acoustic-health`:** Nodo principal — Monitoreo de audio (Edge). **ACTIVO.**
  * **`/firmware/bio-acoustic-bread`:** Nodo de cría/maternidad — Sensores ambientales (Edge). **EN DESARROLLO.**
  * **`/docs`:** Documentación de planificación y esquemas.
* **Base de Datos (BaaS):** Supabase (PostgreSQL + Auth + Storage + RLS).
* **Estado Actual:** Plataforma SaaS Multi-Tenant con firmware funcional en ESP32-S3.

---

## 2. Cloud Web App & Backend (SaaS Multi-Tenant)

* **Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Shadcn/UI, Supabase.
* **Directorio:** `/bio-acoustic-frontend` (Root Directory en Vercel: `bio-acoustic-frontend`).
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

* **MCU:** ESP32-S3-DevKitC-1 programado en C++ usando PlatformIO y framework Arduino.
* **Arquitectura:** FreeRTOS Dual-Core.
  * **Core 0:** `audioCaptureTask` — Lectura continua I2S → Ring Buffer.
  * **Core 1:** `audioAnalysisTask` — FFT + RMS + Detección de frecuencia dominante.
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

* **Clic Corto (< 1 segundo):** Health Check.
  * Verifica la disponibilidad de la SD (escribe/elimina `/_health_check.tmp`).
  * Feedback: 3 parpadeos rápidos en verde (OK) o rojo (fallo).
* **Pulsación Larga (≥ 3 segundos):** Cambio de Sensibilidad.
  * Alterna `RMS_THRESHOLD_FACTOR` entre `1.5f` (sensible) y `2.5f` (estricto).
  * Feedback: LED amarillo encendido 2 segundos.
  * La variable es `volatile float` para cambios en tiempo de ejecución.
* **Debounce:** 50ms basado en `xTaskGetTickCount()`.

### 4.4 Compilación

* **RAM:** 27.8% (91KB / 320KB)
* **Flash:** 9.0% (300KB / 3.3MB)
* **Librerías:** ArduinoFFT 2.0.4, SD 2.0.0, SPI 2.0.0.

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

## 6. Lógica de Detección en el Borde (Edge AI)

* **Captura:** `i2s_read()` alimenta un Ring Buffer thread-safe (mutex + volatile indices).
* **Análisis (Core 1):**
  * **RMS:** Calcula la media cuadrática de las muestras. Baseline rodante con EWMA (α = 0.01).
  * **FFT:** ArduinoFFT sobre 512 muestras para extraer la frecuencia dominante.
  * **Condición de Disparo:** `RMS > baseline * RMS_FACTOR` **Y** `frecuencia_dominante > FREQ_MIN_HZ` (configurable).
* **Grabación:** Al disparar, graba un archivo WAV (~3s) en la Micro SD con header correcto.
* **CSV de Eventos:** Registra timestamp, RMS, frecuencia, baseline y nombre de archivo en `/events_log.csv`.
* **Gestión de Errores:** Si la SD falla, enciende LED rojo fijo (50%) pero el sistema continúa monitoreando.

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