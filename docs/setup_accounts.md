# Setup de cuentas — Rama `v2/full-stack`

Checklist reutilizable para configurar los servicios cloud del stack v2.
Este documento es referencia; ver `docs/plan_sd_buffer_label_button.md` para el contexto arquitectónico completo.

---

## Resumen del stack v2

| Servicio | Uso | Coste inicial |
|---|---|---|
| **Supabase** | Postgres + Auth + Storage + Realtime | Free tier |
| **Vercel** | Deploy del frontend Next.js + Route Handlers (API) | Free tier hobby |

**NO se necesitan** (por ahora): Railway, NestJS backend, Neon, Cloudflare R2, Auth.js/Clerk, Pusher/Ably, Resend/Postmark.

**Cuándo añadir Railway + NestJS backend en el futuro:** ver `docs/plan_sd_buffer_label_button.md` §G.4 (criterios de extracción). Resumen: cuando >50 uploads/min sostenidos, jobs periódicos, modelo ML server-side, o WAVs >4.5 MB.

---

## 1. Supabase — dos proyectos

### 1.1 Proyecto productivo (renombrar)

- Supabase Dashboard → tu proyecto actual `ontiveros bio alert` → Settings → General → **renombrar a `bio-alert`** (o el nombre que prefieras). Cambio cosmético, cero downtime. La URL y las env vars no cambian.

### 1.2 Proyecto de desarrollo v2 (crear)

- Supabase Dashboard → **New project** → Nombre: `bio-alert-v2-dev`.
- Región: **la misma que el productivo** (para consistencia).
- Postgres 17.
- **Recomendación:** copia el schema desde el proyecto productivo para partir del mismo estado.
  - Opción rápida: `pg_dump --schema-only` desde `bio-alert` → aplica al v2-dev.
  - Opción manual: ejecuta el contenido de `docs/supabase_schema.sql` en el SQL Editor del proyecto nuevo.

### 1.3 Credenciales del proyecto v2-dev

Necesitarás las siguientes para el `.env.local` del frontend (todas del proyecto **v2-dev**, no del productivo):

| Variable | Dónde obtenerla | Uso |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API → Project URL | Cliente browser + server. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → `anon` `public` | Cliente browser (RLS aplica). |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → `service_role` `secret` | **SERVER-ONLY.** Route Handlers en `app/api/*`. Sin prefijo `NEXT_PUBLIC_` para que Next.js NO lo empaquete al bundle cliente. |

**El JWT secret y el `DATABASE_URL` no son necesarios en Fase 1** — no hay backend NestJS ni ORM que use conexión directa a Postgres. Se añadirán si algún día se extrae el backend.

### 1.4 Bucket Storage

- Studio → Storage → confirmar que `alerts` existe.
- Políticas RLS del bucket (se endurecerán en Fase 0-A):
  - INSERT: sólo con service role (Route Handlers).
  - SELECT: restringido por `farm_id` matching path.

### 1.5 Supabase CLI (opcional pero recomendado para migraciones)

En Fase 0-A usaremos `supabase-cli` para versionar las migraciones en `db/migrations/*.sql`.

- Install: `brew install supabase/tap/supabase` (macOS) o ver docs para otros sistemas.
- Login: `supabase login`.
- Link al proyecto v2-dev: se hace desde Fase 0-A, no ahora.

---

## 2. Vercel (frontend + API)

Confirmar en `vercel.com` → tu proyecto:

- **Production branch:** `main` (intocado durante todo el desarrollo v2).
- **Preview branches:** todas las demás. La rama `v2/full-stack` genera automáticamente un preview cuando se hace push.
- **Env vars del preview de la rama:**
  - `NEXT_PUBLIC_SUPABASE_URL` → apuntando al proyecto **v2-dev**.
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → apuntando al proyecto **v2-dev**.
  - `SUPABASE_SERVICE_ROLE_KEY` → del proyecto **v2-dev** (marcar como sensitive).
  - Se configuran en Vercel Dashboard → Project → Settings → Environment Variables → Preview.

**Producción sigue apuntando a Supabase productivo (`bio-alert`).** Solo los previews de la rama v2 apuntan a `bio-alert-v2-dev`.

---

## 3. Aislamiento de main durante desarrollo

| Entorno | Sirve a | Origen |
|---|---|---|
| **Prod actual** (intocado) | Granja piloto + nodos v1 productivos | Rama `main`, Vercel Prod, Supabase `bio-alert` |
| **Preview de la rama v2** | Solo desarrollo | Vercel Preview de `v2/full-stack`, Supabase `bio-alert-v2-dev` |

---

## 4. Qué NO se hace en esta rama

- No se pushea nada a `main`.
- No se toca la config de Vercel Production.
- No se toca el proyecto Supabase productivo (`bio-alert`).
- No se toca el firmware v1 productivo que hoy graba en la granja piloto.

---

## Referencia rápida

- Plan completo: `docs/plan_sd_buffer_label_button.md`.
- Estrategia de rama y cutover: §H del plan.
- Fase 0 (migraciones + reorganización + middleware): §C del plan, subfases 0-A / 0-B / 0-C.
- Criterios de extracción a backend NestJS separado: §G.4 del plan.
