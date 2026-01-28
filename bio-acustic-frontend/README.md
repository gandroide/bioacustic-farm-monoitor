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

*Last updated: January 27, 2026*
