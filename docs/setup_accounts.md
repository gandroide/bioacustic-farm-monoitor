# Setup de cuentas — Rama `v2/full-stack`

Checklist reutilizable para configurar los servicios cloud del stack v2.
Este documento es referencia; ver `docs/plan_sd_buffer_label_button.md` para el contexto arquitectónico completo.

---

## Resumen del stack v2

| Servicio | Uso | Coste inicial |
|---|---|---|
| **Supabase** | Postgres + Auth + Storage + Realtime | Free tier |
| **Railway** | Deploy del backend NestJS | ~$5/mes (crédito free tier) |
| **Vercel** | Deploy del frontend Next.js | Free tier hobby |

**NO se necesitan:** Neon, Cloudflare R2, Auth.js/Clerk, Pusher/Ably, Resend/Postmark (Supabase Auth cubre emails).

---

## 1. Supabase (probablemente ya tienes cuenta)

### Credenciales que el backend NestJS necesita

Ir a `supabase.com` → tu proyecto → Settings.

| Variable de entorno | Dónde obtenerla | Uso |
|---|---|---|
| `DATABASE_URL` | Settings → Database → Connection string → **URI** con parámetro `?sslmode=require`. **Usar la conexión directa (puerto 5432)**, NO el pooler para migraciones. | Drizzle para queries y migraciones desde el backend. |
| `SUPABASE_URL` | Settings → API → Project URL | Cliente `@supabase/supabase-js` en el backend. |
| `SUPABASE_ANON_KEY` | Settings → API → `anon` `public` | Cliente supabase-js del frontend (mismo que ya está). |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → `service_role` `secret` | **NUNCA al frontend.** Solo el backend NestJS. Da bypass de RLS. |
| `SUPABASE_JWT_SECRET` | Settings → API → JWT Settings → `JWT Secret` | Backend valida JWTs del frontend firmando localmente sin round-trip. |

### Verificar el bucket `alerts`

- Studio → Storage → confirmar que existe. Si no, crear.
- Políticas RLS del bucket (se endurecerán en Fase 0-B):
  - INSERT: sólo con service role (backend).
  - SELECT: restringido por `farm_id` del usuario.

---

## 2. Railway (deploy del backend)

### Setup

1. `railway.app` → Sign up con GitHub.
2. Conectar el repo `gandroide/bioacustic-farm-monoitor`.
3. **No crear proyecto todavía.** Se crea desde el CLI/UI de Railway en Fase 0-A, apuntando al subdirectorio `bio-acoustic-backend/` de la rama `v2/full-stack`.
4. Confirmar que la cuenta tiene $5/mes de crédito free tier activo.

### Env vars a configurar en Railway (en Fase 0-A)

Todas las variables de la sección 1 de Supabase, más:

- `PORT` → Railway lo inyecta automáticamente. No hace falta setearlo.
- `NODE_ENV=production` (en producción).
- `FRONTEND_URL` → URL del preview Vercel de la rama (para CORS).

---

## 3. Vercel (frontend, ya configurado)

Confirmar en `vercel.com` → tu proyecto:

- **Production branch:** `main` (intocado durante todo el desarrollo v2).
- **Preview branches:** todas las demás. La rama `v2/full-stack` genera automáticamente un preview cuando se hace push.
- **Env vars del preview:** las que ya tenga el proyecto + añadir `NEXT_PUBLIC_BACKEND_URL` (URL del Railway preview) cuando el backend esté desplegado en Fase 0-A.

---

## 4. Aislamiento de main durante desarrollo

| Entorno | Sirve a | Origen |
|---|---|---|
| **Prod actual** (intocado) | Granja piloto + nodos v1 productivos | Rama `main`, Vercel Prod, Supabase proyecto actual |
| **Preview de la rama v2** | Solo desarrollo | Vercel Preview + Railway proyecto separado + **Supabase proyecto separado (o mismo con schema branching)** |

**Recomendación fuerte:** crear un **segundo proyecto Supabase** llamado `bio-acoustic-v2-dev` para no arriesgar datos del proyecto productivo actual. Migraciones destructivas + tests de RLS se ejecutan ahí. La migración de datos reales del prod al schema v2 se hace en el cutover final (§H.4 del plan).

---

## 5. Qué NO se hace en esta rama

- No se pushea nada a `main`.
- No se toca la config de Vercel Production.
- No se toca el proyecto Supabase productivo (usar segundo proyecto para dev).
- No se toca el firmware v1 productivo que hoy graba en la granja piloto.

---

## Referencia rápida

- Plan completo: `docs/plan_sd_buffer_label_button.md`.
- Estrategia de rama y cutover: §H del plan.
- Fase 0 (bootstrap del backend): §C del plan, subfases 0-A / 0-B / 0-C.
