# 🐷 Bio-Alert — Sistema de Monitoreo Bioacústico

Plataforma de monitoreo bioacústico para granjas porcinas. Fase actual: **Dataset Builder** — recolección de audio en el borde (ESP32-S3) sobre eventos disparados por RMS + capturas ambientales periódicas, para entrenar modelos de Edge AI/ML. El SaaS multi-tenant consume y gestiona los eventos.

Dos nodos sobre el **mismo hardware**, con firmwares distintos:

| Nodo | Ubicación | Escucha | Detecta |
|---|---|---|---|
| **health** | Maternidad | Chillidos | Aplastamiento de lechones |
| **breath** | Destete / Engorde | Respiración | Tos, grasnidos, dificultad respiratoria |

## Arquitectura

```
granja/
├── bio-acoustic-frontend/       → Web App SaaS (Next.js 14 + Supabase)
├── firmware/
│   ├── bio-acoustic-health/     → Nodo IoT principal: Audio (ESP32-S3)
│   └── bio-acoustic-breath/     → Nodo IoT secundario: Respiratorio (ESP32-S3)
├── docs/                        → Documentación y esquemas SQL
├── CONTEXT.MD                   → Fuente de verdad técnica
└── BD_SCHEMA.md                 → Schema de base de datos
```

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| **Edge (Firmware)** | ESP32-S3, C++, PlatformIO, FreeRTOS dual-core, ArduinoFFT |
| **Cloud (Frontend)** | Next.js 14, TypeScript, Tailwind CSS, Shadcn/UI |
| **Backend (BaaS)** | Supabase (PostgreSQL, Auth, Storage, Realtime) |

## Firmware Edge — Features actuales

- Captura I2S continua (INMP441) en Core 0 → ring buffer de 2 s.
- Análisis RMS + baseline EWMA + FFT (metadata) en Core 1.
- Grabación WAV de **8 s** (2 s pre-roll + 6 s live) en dos modos:
  - **REC**: alerta por RMS > `max(THRESHOLD_RMS, baseline · RMS_FACTOR)`.
  - **ENV**: muestreo ambiental automático cada 30 min.
- I2S leído como 32-bit y convertido a 16-bit por software para reducir ruido del INMP441.
- **Warmup (10 s)** al boot y **cooldown (5 s)** post-grabación para evitar disparos en cascada.
- **Detección de SD llena** (`STATE_SD_FULL`, < 50 MB libres) con LED rojo+amarillo alternados a 1 Hz.
- **Smart Button**: clic corto = health check de SD; pulsación ≥ 3 s = toggle de sensibilidad.
- Log de metadatos en `/log_eventos.csv` (MAC, uptime, baseline, pico RMS, freq dominante, temp).

## Quick Start

### Frontend
```bash
cd bio-acoustic-frontend
npm install
npm run dev
```

### Firmware (requiere PlatformIO CLI)
```bash
cd firmware/bio-acoustic-health
pio run            # Compilar
pio run -t upload  # Flashear al ESP32-S3
pio device monitor # Monitor serial
```

## Documentación

- **[CONTEXT.MD](CONTEXT.MD)** — Arquitectura, pinout, reglas del proyecto
- **[BD_SCHEMA.md](BD_SCHEMA.md)** — Schema de la base de datos
- **[docs/](docs/)** — Planificación, integración Supabase, skills

## Hardware

El nodo principal (`bio-acoustic-health`) integra:
- 🎙️ Micrófono INMP441 — I2S, 16 kHz, lectura 32-bit → conversión a 16-bit por software
- 💾 Micro SD (SPI, FAT32) para grabación WAV + CSV de eventos
- 🟢🟡🔴 3 LEDs indicadores (PWM): MONITOREO, GRABANDO, ERROR, SD_FULL, PAIRING
- 🔘 Smart Button:
  - **Clic corto (< 1 s)** → Safe Eject: desmonta la SD por software, LED verde+amarillo fijos. Otro clic remonta y reanuda.
  - **Pulsación larga (≥ 3 s)** → Toggle sensibilidad (1.5× ↔ 2.5×).
  - **Durante grabación** el clic corto se ignora (no interrumpe el WAV en curso).

## Licencia

Proyecto privado — Ontiveros.
