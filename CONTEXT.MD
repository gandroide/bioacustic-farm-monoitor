# 🐷 ONTIVEROS BIO-ALERT (AXIS.ops) - Master Context

> **Fuente de la verdad** para Arquitectura, Hardware, Frontend y Reglas de Negocio.
> Última actualización: 2026-03-26 (v3.0 — Integración Monorepo & ZCR)

---

## 1. Identidad y Arquitectura Global

* **Objetivo:** Sistema de monitoreo bioacústico para granjas porcinas que detecta aplastamiento de lechones (chillidos) mediante procesamiento local (ZCR/RMS) y alerta al granjero en tiempo real vía SaaS.
* **Estructura Monorepo:** El proyecto "granja" consolida todo el ecosistema.
* **Carpeta `/bioalert-web`:** Frontend SaaS en Next.js (Cloud).
* **Carpeta `/firmware`:** Nodos de hardware ESP32-S3 (Edge).
* **Base de Datos (BaaS):** Supabase (PostgreSQL + Auth + Storage).
* **Estado Actual:** Transición de MVP "Single Farm" a plataforma SaaS Multi-Tenant.

---

## 2. Cloud Web App & Backend (SaaS Multi-Tenant)

* **Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Shadcn/UI, Supabase.
* **Hosting:** Vercel (Root Directory configurado como `bioalert-web`).
* **Multi-Tenancy (Meta Actual):** Crear tabla `farms`, vincular usuarios/eventos/dispositivos a un `farm_id`, e implementar Row Level Security (RLS) estricto por granja.
* **Roles:** Super Admin (Ontiveros - acceso global) y Farm Admin (acceso aislado a su granja).
* **Visualización:** PWA instalable (Mobile First), ondas de audio con `wavesurfer.js`, suscripción real-time a Supabase.
* **Fix Crítico de Vercel:** En `lib/supabase.ts`, se mantiene un fallback `|| 'placeholder'` para variables de entorno para evitar fallos de build.

---

## 3. Design System & UI Guidelines (INMUTABLE)

* **Filosofía Visual:** "Industrial Clean" / "Sci-Fi Dashboard". Minimalista, oscuro, alto contraste. Herramienta profesional crítica.
* **Modo de Color:** Únicamente Dark Mode (`bg-slate-950` o `bg-black`).
* **Color Primario:** Naranja Seguridad (`text-amber-500` / `bg-amber-500`).
* **Semántica:** Alerta (`red-500`), Advertencia (`amber-500`), Seguro (`emerald-500`), Info (`slate-400`).
* **Tipografía:** `Inter` (general) y `Geist Mono` / `Monospace` (datos técnicos y telemetría).
* **Componentes:** Uso exclusivo de Shadcn/UI y Lucide-React (strokeWidth 2 o 1.5). Aplicar efectos de cristal (`backdrop-blur`) y sombras de color (Glow) para KPIs críticos.

---

## 4. Hardware IoT: Nodo Bio-Acoustic-Health (Firmware)

* **Plataforma:** ESP32-S3-DevKitC-1 programado en C++ usando PlatformIO y framework Arduino.
* **Configuración Serial:** Puerto nativo `/dev/cu.usb*`, Baudrate `115200`, Flag `-D ARDUINO_USB_CDC_ON_BOOT=1`.
* **Micrófono (INMP441 - I2S):** Pin 15 (WS), Pin 16 (SCK), Pin 17 (SD). Canal Izquierdo (L/R a GND). 16-bit, 16 kHz.
* **Tarjeta Micro SD (SPI):** Pin 10 (CS), Pin 11 (MOSI), Pin 12 (SCK), Pin 13 (MISO). Formato FAT32.
* **LEDs Indicadores (PWM al 50% de brillo):** Pin 4 (Verde), Pin 5 (Amarillo), Pin 6 (Rojo).
* **Botón de Sincronización (BTN_SYNC):** Pin 7. Conectado directo a GND usando resistencia interna `INPUT_PULLUP`. Estado activo = `LOW`.

---

## 5. Lógica de Detección en el Borde (Edge AI)

* **Telemetría:** `i2s_read()` captura 256 muestras continuas para cálculo matemático.
* **Volumen (RMS):** Calcula la media cuadrática. Umbral base: `1000`.
* **Frecuencia (ZCR):** Zero-Crossing Rate con histéresis (±50) para ignorar ruido de fondo. Evalúa sonidos agudos. Umbral base: `30`.
* **Condición de Disparo (Chillido):** El LED Amarillo se enciende 100ms SOLAMENTE si `RMS > 1000` **Y** `ZCR > 30`.
* **Gestión de Errores:** Si la SD falla, enciende LED rojo fijo (50%) pero el sistema continúa ejecutándose sin detenerse.

---

## 6. Reglas Estrictas y Advertencias (NO TOCAR)

* **Internacionalización (i18n):** NO intentar reimplementar `next-intl` bajo ninguna circunstancia hasta que el Multi-Tenant esté en producción.
* **Assets PWA:** Los iconos `manifest.json` deben generarse automáticamente desde el archivo maestro `/public/icono`.
* **Estabilidad del Build:** Si se modifica `next.config.mjs` o `middleware.ts`, verificar doblemente en Vercel.
* **Estructura PlatformIO:** Mantener los nodos (`bio-acoustic-health`, `bio-acoustic-bread`, etc.) en carpetas aisladas dentro de `/firmware` con sus propios `platformio.ini`.