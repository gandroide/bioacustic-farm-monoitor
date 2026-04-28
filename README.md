# 🐷 Bio-Alert — Sistema de Monitoreo Bioacústico

Sistema de detección de estrés porcino (aplastamiento de lechones) mediante procesamiento de audio en el borde y plataforma SaaS multi-tenant.

## Arquitectura

```
granja/
├── bio-acoustic-frontend/       → Web App SaaS (Next.js 14 + Supabase)
├── firmware/
│   ├── bio-acoustic-health/     → Nodo IoT principal: Audio (ESP32-S3)
│   └── bio-acoustic-bread/      → Nodo IoT secundario: Ambiente (ESP32-S3)
├── docs/                        → Documentación y esquemas SQL
├── CONTEXT.MD                   → Fuente de verdad técnica
└── BD_SCHEMA.md                 → Schema de base de datos
```

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| **Edge (Firmware)** | ESP32-S3, C++, PlatformIO, FreeRTOS, ArduinoFFT |
| **Cloud (Frontend)** | Next.js 14, TypeScript, Tailwind CSS, Shadcn/UI |
| **Backend (BaaS)** | Supabase (PostgreSQL, Auth, Storage, Realtime) |

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
- 🎙️ Micrófono INMP441 (I2S, 16kHz, 16-bit)
- 💾 Micro SD (SPI, FAT32) para grabación WAV
- 🟢🟡🔴 3 LEDs indicadores (PWM)
- 🔘 Smart Button (Health Check / Cambio de Sensibilidad)

## Licencia

Proyecto privado — Ontiveros.
