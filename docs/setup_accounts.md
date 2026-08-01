# Setup de cuentas — Rama `v2/full-stack`

Checklist reutilizable para configurar los servicios cloud del stack v2.
Este documento es referencia; ver `docs/plan_sd_buffer_label_button.md` para el contexto arquitectónico completo.

---

## Resumen del stack v2

| Servicio | Uso | Coste inicial |
|---|---|---|
| **Supabase** | Postgres + Auth + Storage + Realtime | Free tier (proyecto único, el que ya usas) |
| **Vercel** | Deploy del frontend Next.js + Route Handlers (API) | Free tier hobby |

**NO se necesitan** (por ahora): Railway, NestJS backend, segundo proyecto Supabase, Neon, Cloudflare R2, Auth.js/Clerk, Pusher/Ably, Resend/Postmark.

**Cuándo añadir backend separado (NestJS + Railway):** ver `docs/plan_sd_buffer_label_button.md` §G.4. Resumen: cuando >50 uploads/min sostenidos, jobs periódicos, modelo ML server-side, o WAVs >4.5 MB.

**Cuándo aislar un segundo proyecto Supabase:** cuando exista producción real con datos sensibles (granja piloto en operación real). Ahora no es el caso.

---

## 1. Supabase — proyecto único

Se usa el **mismo proyecto** que ya tienes para pruebas (`ontiveros bio alert` o el nombre que le hayas puesto).

### 1.1 Credenciales

Necesitarás las siguientes para el `.env.local` del frontend:

| Variable | Dónde obtenerla | Uso |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API → Project URL | Cliente browser + server. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → `anon` `public` | Cliente browser (RLS aplica). |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → `service_role` `secret` | **SERVER-ONLY.** Route Handlers en `app/api/*`. Sin prefijo `NEXT_PUBLIC_` para que Next.js NO lo empaquete al bundle cliente. |

(Es probable que las dos primeras ya estén en tu `.env.local` actual del frontend. La tercera hay que añadirla si no está.)

### 1.2 Bucket Storage

- Studio → Storage → confirmar que `alerts` existe.
- Políticas RLS del bucket (se endurecerán en Fase 0-A):
  - INSERT: sólo con service role (Route Handlers).
  - SELECT: restringido por `farm_id` matching path.

### 1.3 Supabase CLI (necesario para Fase 0-A)

En Fase 0-A usaremos `supabase-cli` para versionar las migraciones en `db/migrations/*.sql`.

- Install: `brew install supabase/tap/supabase` (macOS).
- Login: `supabase login`.
- Link al proyecto se hace desde Fase 0-A, no ahora.

### 1.4 Renombrar (opcional)

Si el nombre `ontiveros bio alert` te chirría, renombrarlo desde Settings → General → Project Name es cosmético y cero downtime. Sin urgencia — puedes dejarlo para cuando quieras.

---

## 2. Vercel (frontend + API)

Confirmar en `vercel.com` → tu proyecto:

- **Production branch:** `main` (intocado durante todo el desarrollo v2).
- **Preview branches:** todas las demás. La rama `v2/full-stack` genera automáticamente un preview cuando se hace push.
- **Env vars:** las que ya tenga el proyecto, más `SUPABASE_SERVICE_ROLE_KEY` (marcar como sensitive). Se configuran en Vercel Dashboard → Project → Settings → Environment Variables.

---

## 3. Aislamiento de main durante desarrollo

| Aspecto | Estrategia |
|---|---|
| **Código** | Aislado. `main` no recibe commits del trabajo v2 hasta el cutover. |
| **Datos (Supabase)** | Compartido. Sin datos productivos que proteger. Migraciones aditivas para no romper `main`. |

Si en algún momento del desarrollo aparece una migración destructiva necesaria (DROP COLUMN, rename), se posterga al cutover final o se aísla temporalmente un segundo proyecto en ese momento.

---

## 4. Qué NO se hace en esta rama

- No se pushea nada a `main`.
- No se toca la config de Vercel Production.
- No se hacen migraciones destructivas (DROP, rename) en Supabase.
- No se toca el firmware v1 productivo.

---

## Referencia rápida

- Plan completo: `docs/plan_sd_buffer_label_button.md`.
- Estrategia de rama y cutover: §H del plan.
- Fase 0 (migraciones + reorganización + middleware): §C del plan, subfases 0-A / 0-B / 0-C.
- Criterios de extracción a backend NestJS separado: §G.4 del plan.
