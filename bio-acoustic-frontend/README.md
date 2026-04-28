# Ontiveros Bio-Alert - Bioacoustic Monitoring System

**Next-generation livestock monitoring platform powered by AI-driven audio analysis**

![Version](https://img.shields.io/badge/version-0.7.0-orange)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![License](https://img.shields.io/badge/license-Proprietary-red)

---

## 🎯 Overview

Ontiveros Bio-Alert is an industrial-grade web platform for real-time bioacoustic monitoring in livestock operations. It provides:

- **Real-time Alert Monitoring**: Live dashboard with instant notifications
- **Audio Analysis**: ML-powered sound classification and pattern recognition
- **Historical Data**: Comprehensive event logging and analytics
- **Multi-Device Support**: Centralized monitoring for multiple edge devices
- **Cloud Integration**: Seamless Supabase backend for data persistence and audio storage

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **UI Components**: Shadcn/UI
- **Icons**: Lucide React
- **Charts**: Recharts
- **Audio**: wavesurfer.js (planned)

### Backend
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage
- **Real-time**: Supabase Realtime subscriptions
- **Authentication**: Supabase Auth (planned)

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn
- Supabase project configured

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   
   The `.env.local` file is already configured with your Supabase credentials:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://uaecpeaefqwjpxgjbfye.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key_here
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

4. **Open your browser:**
   
   Navigate to [http://localhost:3000](http://localhost:3000)

---

## 📂 Project Structure

```
axis-frontend/
├── app/
│   ├── dashboard/
│   │   └── page.tsx          # Main dashboard
│   ├── login/
│   │   └── page.tsx          # Login page
│   ├── layout.tsx            # Root layout
│   ├── globals.css           # Global styles + theme
│   └── page.tsx              # Homepage (redirects to login)
│
├── components/
│   ├── dashboard/
│   │   ├── kpi-cards.tsx     # KPI cards component
│   │   ├── alerts-chart.tsx  # Timeline chart
│   │   └── events-table.tsx  # Events data table
│   └── ui/                   # Shadcn/UI components
│       ├── button.tsx
│       ├── card.tsx
│       ├── table.tsx
│       ├── badge.tsx
│       └── dialog.tsx
│
├── lib/
│   ├── supabase.ts           # Supabase client + types
│   └── utils.ts              # Utility functions
│
├── public/                   # Static assets
└── .env.local                # Environment variables
```

---

## 🎨 Design System

### Color Palette - Industrial Dark Mode

Ontiveros Bio-Alert uses a carefully crafted "Industrial Dark Mode" palette:

| Color | Usage | oklch Value |
|-------|-------|-------------|
| **Slate-950** | Background | `oklch(0.11 0.015 264)` |
| **Orange Amber** | Alerts, Primary Actions | `oklch(0.68 0.19 55)` |
| **Green Emerald** | Success, Safe States | `oklch(0.5 0.15 165)` |
| **Blue Steel** | Charts, Data Viz | `oklch(0.6 0.18 230)` |
| **Red Alert** | Danger, Critical | `oklch(0.58 0.22 25)` |

### Typography

- **Sans**: Inter (UI elements)
- **Mono**: JetBrains Mono (data, codes, timestamps)

### Design Philosophy

- **Military-Grade UI**: Industrial, not consumer
- **High Contrast**: Optimized for 24/7 operations
- **Data-First**: Information density balanced with clarity
- **Responsive**: Desktop-first, mobile-ready

---

## 📊 Dashboard Features

### 1. KPI Cards

Real-time metrics displayed in four key cards:

- **Alerts Today**: Total alert count in 24h period with trend indicator
- **Last Alert**: Most recent event timestamp and device
- **Avg. Noise Level**: Average RMS amplitude across all events
- **System Status**: Edge device connectivity status

### 2. Alert Timeline Chart

- **Time Range**: Last 24 hours
- **Metrics**: Alert count and confidence level
- **Visual Style**: Area chart with gradient fills
- **Interaction**: Hover tooltips with detailed metrics

### 3. Events Table

Comprehensive event log with:

- **Timestamp**: Precise time of alert
- **Device ID**: Source edge device identifier
- **Alert Type**: Classification (noise_threshold, high_pitch, ml_prediction)
- **Confidence**: ML model confidence score
- **Metrics**: RMS and ZCR values
- **Audio Playback**: Integrated player for audio files

### 4. Real-time Updates

- **WebSocket Connection**: Live data streaming from Supabase
- **Auto-refresh**: 30-second polling fallback
- **Manual Refresh**: On-demand data reload

---

## 🔐 Authentication (Planned)

Future authentication features:

- Email/Password login
- Role-based access control (Admin, Operator, Viewer)
- Session management
- Protected routes

---

## 📈 Data Flow

```
Edge Device (Raspberry Pi)
      ↓
Python Script (main.py)
      ↓
Supabase Storage (audio files)
      ↓
Supabase Database (events table)
      ↓
Realtime Subscription
      ↓
Next.js Dashboard
      ↓
User Interface
```

---

## 🔧 Development

### Available Scripts

```bash
# Development server
npm run dev

# Production build
npm run build

# Start production server
npm start

# Lint code
npm run lint

# Type check
npm run type-check
```

### Adding New Components

To add new Shadcn/UI components:

```bash
npx shadcn@latest add [component-name]
```

Example:
```bash
npx shadcn@latest add dropdown-menu
```

---

## 🌐 Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import repository in Vercel
3. Add environment variables
4. Deploy

### Manual Deployment

```bash
npm run build
npm start
```

The app will run on port 3000 by default.

---

## 📦 Database Schema

The app expects a `events` table in Supabase with this structure:

```sql
CREATE TABLE events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    device_id TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    metadata JSONB DEFAULT '{}'::jsonb
);
```

---

## 🎯 Roadmap

### Phase 1: Foundation ✅
- [x] Next.js 14 setup with TypeScript
- [x] Tailwind CSS v4 with custom theme
- [x] Shadcn/UI integration
- [x] Supabase client configuration
- [x] Login page design
- [x] Dashboard layout

### Phase 2: Core Features (Current)
- [x] KPI cards with real data
- [x] Alert timeline chart
- [x] Events table with filtering
- [ ] Audio player integration (wavesurfer.js)
- [ ] Real-time notifications

### Phase 3: Advanced Features
- [ ] User authentication
- [ ] Device management page
- [ ] Historical analytics
- [ ] Export reports (PDF/CSV)
- [ ] Mobile app (React Native)

### Phase 4: ML Integration
- [ ] Live spectrogram visualization
- [ ] Confidence threshold adjustment
- [ ] Model performance metrics
- [ ] A/B testing dashboard

---

## 🐛 Troubleshooting

### Port Already in Use

```bash
# Kill process on port 3000
npx kill-port 3000

# Or run on different port
npm run dev -- -p 3001
```

### Supabase Connection Issues

1. Verify `.env.local` variables are correct
2. Check Supabase project is active
3. Ensure table `events` exists
4. Verify RLS policies allow public access

### Build Errors

```bash
# Clean cache
rm -rf .next

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

---

## 📞 Support

For issues or questions:

- **Documentation**: Check this README first
- **Supabase Dashboard**: [https://uaecpeaefqwjpxgjbfye.supabase.co](https://uaecpeaefqwjpxgjbfye.supabase.co)
- **Next.js Docs**: [https://nextjs.org/docs](https://nextjs.org/docs)

---

## 📄 License

Proprietary - All Rights Reserved

---

## 🎖️ Credits

Built with passion for next-generation livestock intelligence.

**Ontiveros Bio-Alert** - Transforming Agriculture Through Technology

---

"Operaciones de Fábrica". ---> PASO IMPORTANTE PARA FUTURO PROXIMO

📦 Protocolo de Alta de Hardware (Factory Provisioning)
Cuándo ejecutar: Justo antes de empaquetar una Raspberry Pi/Sensor para enviársela a un cliente. Quién lo ejecuta: El equipo de operaciones o Super Admin.

1. El Concepto
El dispositivo debe nacer en la base de datos como "Huérfano" (sin dueño). Esto permite que el sistema lo reconozca como válido cuando el cliente intente registrarlo, pero no esté asignado a ninguna sala todavía.

device_uid: Es el ID que imprimirás en la etiqueta adhesiva pegada a la caja (Ej: RPI-LOTE5-004).

room_id: Se deja en NULL. Esto es la señal de que es "Stock Nuevo".

status: Se pone en 'offline' porque está en una caja apagado.

2. La Instrucción SQL (Para guardar)
Copia y pega esto en tu gestor de notas o documentación interna:

SQL
-- 🏭 ALTA DE NUEVO STOCK (Provisionamiento)
-- Ejecutar esto antes de enviar el equipo físico.

INSERT INTO public.devices (
    device_uid,
    status,
    room_id,      -- NULL = No tiene sala asignada (Huérfano)
    is_active     -- TRUE = El dispositivo es válido para ser reclamado
) 
VALUES (
    'ETIQUETA-DEL-DISPOSITIVO',  -- <--- CAMBIAR ESTO (Ej: 'RPI-055-JALISCO')
    'offline',
    NULL,
    true
);
3. Verificación (Opcional)
Para confirmar que el dispositivo está listo para ser reclamado, puedes consultar los dispositivos huérfanos:

SQL
-- Ver stock disponible (sin dueño)
SELECT * FROM public.devices WHERE room_id IS NULL;
💡 La Solución Definitiva (Para no usar SQL)
Como fundador, no deberías depender de correr comandos SQL cada vez que vendes un sensor. Es propenso a errores humanos (te puedes olvidar de una comilla o del NULL).

Te sugiero pedirle a tu Agente en el futuro que cree una pequeña pantalla en tu /admin llamada "Inventario de Hardware":

Un input simple: UID del Nuevo Dispositivo.

Un botón: [Registrar Stock].

Por detrás, el sistema ejecuta exactamente el INSERT de arriba automáticamente.


---

*Last updated: January 27, 2026*

DOCUMENTACION 

# 🐷 Ontiveros Bio-Alert | IoT SaaS Platform

**Versión:** 1.0.0 (Enterprise Architecture)
**Stack:** Next.js + Supabase + Tailwind CSS + IoT Integration

## 📖 Descripción del Proyecto

Ontiveros Bio-Alert es una plataforma SaaS Multi-Tenant diseñada para el monitoreo bio-acústico en granjas porcinas. El sistema permite detectar enfermedades respiratorias mediante el análisis de audio en tiempo real, ofreciendo dashboards diferenciados para la gestión operativa (Granjeros) y la gestión de negocio/hardware (Super Admin).

La arquitectura ha sido refactorizada para soportar desde pequeños productores hasta grandes corporaciones (como Plumrose) mediante una estructura jerárquica escalable.

---

## 🏗️ Arquitectura de Datos (The Hierarchy)

El sistema ya no utiliza un modelo plano. Se basa en una estructura de "muñeca rusa" para permitir escalabilidad infinita:

`Organization` ➤ `Site` ➤ `Building` ➤ `Room` ➤ `Device`

1.  **Organization (Tenant):** La entidad legal/cliente que paga (ej: *Plumrose Corp*).
2.  **Site (Sede):** Ubicación física geográfica (ej: *Granja Valencia*).
3.  **Building (Nave):** Estructura física (ej: *Galpón Maternidad Norte*).
4.  **Room (Sala):** Unidad mínima de producción.
5.  **Device (Nodo IoT):** Hardware (Raspberry Pi + Micrófono) asignado a una Sala.

---

## 🔐 Roles y Seguridad (RLS)

El sistema utiliza **Row Level Security (RLS)** de Supabase para aislar los datos.

### Roles de Usuario (`profiles`)
* **Super Admin:** Acceso total a todas las organizaciones, métricas financieras (MRR) y herramientas de depuración de hardware.
* **Org Admin:** Dueño de la granja. Ve todos los sitios de su `organization_id`.
* **Site Manager:** (Roadmap) Acceso restringido a un solo `site_id`.

### Política de Seguridad Clave
Ningún usuario puede ver datos que no coincidan con su `organization_id`.
> *Nota:* Si insertas datos manualmente vía SQL, asegúrate de asignar el `organization_id` correcto o el dato será invisible para el usuario.

---

## 🖥️ Estructura del Frontend

La aplicación está dividida en dos "mundos" totalmente separados:

### 1. 🚜 Client Dashboard (`/dashboard`)
* **Audiencia:** Granjeros, Veterinarios.
* **Funciones:**
    * Visualización de Alertas Bioacústicas.
    * Mapas de Calor de ruido.
    * **Self-Service:** Configuración de granja (`/dashboard/settings/farm`) para agregar naves/salas sin soporte técnico.

### 2. 🛡️ Super Admin Dashboard (`/admin`)
* **Audiencia:** CEO, Equipo Técnico de Ontiveros.
* **Funciones:**
    * **KPIs de Negocio:** MRR, Churn, Costos de Nube.
    * **Drill-Down:** Navegación profunda por la jerarquía de los clientes.
    * **IoT Simulator:** Herramienta de "Modo Dios" para pruebas.

---

## 🛠️ Herramientas de Desarrollo y Debugging

### IoT Simulator (Solo Admin)
Ubicado en la vista de detalle de un Site (`/admin/sites/[id]`). Permite simular el comportamiento del hardware sin tener dispositivos físicos conectados:
* **Force Online:** Pone todos los dispositivos en verde y actualiza `last_heartbeat`.
* **Kill Site:** Simula una caída masiva (todos a rojo/offline).
* **Critical Failure:** Apaga aleatoriamente 2 dispositivos.

> **⚠️ Importante:** El simulador modifica la base de datos real. Usar con precaución en producción.

---

## 🗄️ Esquema de Base de Datos (Core Tables)

Si necesitas hacer consultas SQL manuales, estas son las tablas clave:

| Tabla | Descripción | Clave Foránea Principal |
| :--- | :--- | :--- |
| `organizations` | Clientes pagadores | `id` |
| `sites` | Granjas físicas | `organization_id` |
| `buildings` | Naves/Galpones | `site_id` |
| `rooms` | Salas interiores | `building_id` |
| `devices` | Hardware IoT | `room_id` |
| `events` | Alertas de audio (Tos) | `device_uid` |

---

## 🚑 Solución de Problemas Comunes (Troubleshooting)

### Error: `42703 column "x" does not exist`
* **Causa:** El código Frontend (React) espera una columna que no existe en la Base de Datos (ej: `is_active` o `updated_at`).
* **Solución:** Ejecutar en Supabase SQL Editor:
    ```sql
    ALTER TABLE public.table_name ADD COLUMN column_name DATA_TYPE DEFAULT value;
    ```

### Error: `PGRST204` / `401 Unauthorized` al guardar
* **Causa:** Intentas hacer un `UPDATE` o `INSERT` pero las políticas RLS solo permiten `SELECT`.
* **Solución:** Crear una política de escritura en Supabase:
    ```sql
    CREATE POLICY "Permitir Update" ON public.tabla FOR UPDATE USING (true) WITH CHECK (true);
    ```

### Error de Hidratación: `<p> cannot be a descendant of <p>`
* **Causa:** Uso incorrecto de componentes UI. `DialogDescription` de Shadcn ya es un párrafo (`p`), no se debe meter otro `p` o `div` dentro.
* **Solución:** Cambiar las etiquetas internas por `<span>`.

---

## 🚀 Instalación y Despliegue

1.  **Clonar repositorio:** `git clone ...`
2.  **Variables de Entorno:** Configurar `.env.local` con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3.  **Instalar dependencias:** `npm install`
4.  **Correr servidor dev:** `npm run dev`

---

*Documentación generada para Ontiveros Bio-Alert © 2026*