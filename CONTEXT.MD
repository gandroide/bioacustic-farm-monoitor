# 🐷 ONTIVEROS BIO-ALERT - Project Master Context

## 1. Identidad y Propósito
* **Nombre del Proyecto:** Ontiveros Bio-Alert (Bio-Alert).
* **Objetivo:** Sistema de monitoreo bioacústico para granjas porcinas. Detecta aplastamiento de lechones mediante IA y alerta al granjero en tiempo real.
* **Estado Actual:** MVP Funcional (Frontend + Backend + Script Python).
* **Meta Inmediata:** Transformar en plataforma SaaS Multi-Tenant para recolectar datos de múltiples granjas.

## 2. Arquitectura Técnica (Monorepo)
El proyecto convive en un solo repositorio con dos partes diferenciadas:

### A. Edge (Raspberry Pi / Local)
* **Ubicación:** Raíz del proyecto.
* **Lenguaje:** Python (`main.py`).
* **Librerías:** PyAudio, Librosa, NumPy, Supabase-py.
* **Función:** Escucha el micrófono, detecta eventos (simulados o reales), graba el clip de audio y lo sube a Supabase Storage + Database.

### B. Cloud Web App (Frontend)
* **Ubicación:** Carpeta `/bioalert-web`.
* **Framework:** Next.js 14 (App Router) + TypeScript.
* **Estilos:** Tailwind CSS + Shadcn/UI (Dark Mode Industrial).
* **Hosting:** Vercel (`https://bioacoustic-farm-monitor.vercel.app`).
* **Características Clave:**
    * **PWA:** Instalable en móviles (gracias a `@ducanh2912/next-pwa`).
    * **Audio:** Visualización de ondas con `wavesurfer.js`.
    * **Real-time:** Suscripción a cambios en Supabase para alertas instantáneas.
    * **Internacionalización:** Preparado para `next-intl` (ES, PT, EN).

### C. Backend (BaaS)
* **Plataforma:** Supabase.
* **Tablas Clave:** `events` (alertas), `devices` (sensores).
* **Auth:** Supabase Auth.
* **Storage:** Bucket `audio-clips` para los archivos .wav.

## 3. Soluciones Técnicas Importantes (NO TOCAR)
1.  **Deploy en Vercel:** Se configuró el "Root Directory" en Vercel como `bioalert-web`.
2.  **Fix de Build:** En `lib/supabase.ts`, usamos un fallback (`|| 'placeholder'`) para las variables de entorno `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Esto evita que el build falle en Vercel durante la generación estática.
3.  **Componentes:** Los Iconos de Lucide-React se manejan dinámicamente en `kpi-cards.tsx` (se corrigió un bug de `undefined`).

## 4. PRÓXIMO PASO: Implementación Multi-Tenancy (SaaS)
Vamos a pasar de "Single Farm" a "Multi-Farm" para permitir recolectar datos de varios clientes/granjas vecinas y entrenar el modelo de ML.

**Requerimientos para el Agente:**
1.  **Base de Datos:**
    * Crear tabla `farms`.
    * Vincular `users`, `events` y `devices` a un `farm_id`.
2.  **Seguridad (RLS):**
    * Implementar Row Level Security estricto. Un usuario de la "Granja A" NUNCA debe ver datos de la "Granja B".
3.  **Roles:**
    * `Super Admin` (Yo, Ontiveros): Veo todo, creo granjas, descargo audios para ML.
    * `Farm Admin`: Solo ve su granja.
4.  **Frontend:**
    * Crear ruta `/admin` (solo para Super Admin) para gestionar altas de granjas.
    * Asegurar que el Dashboard actual filtre automáticamente por la granja del usuario.

## 5. DESIGN SYSTEM & UI GUIDELINES (INMUTABLE)
Cualquier nueva funcionalidad debe respetar estrictamente estas reglas visuales para mantener la coherencia.

### A. Filosofía Visual ("The Vibe")
* **Estilo:** "Industrial Clean" / "Sci-Fi Dashboard". Minimalista, oscuro, alto contraste.
* **Propósito:** Herramienta profesional de monitoreo crítico. No debe parecer una red social ni una web corporativa genérica.
* **Modo:** **Dark Mode Only**. No implementar Light Mode.

### B. Paleta de Colores (Tailwind)
* **Fondo Principal:** `bg-slate-950` o `bg-black`.
* **Superficies (Tarjetas):** `bg-card` con bordes sutiles (`border-border/50`) y efectos de cristal (`backdrop-blur`).
* **Color Primario (Marca):** Naranja Seguridad (`text-amber-500` / `bg-amber-500`). Usado para logos y acentos principales.
* **Semántica de Estados:**
    * 🚨 **Peligro/Alerta:** `text-red-500` / `bg-red-500/10` (Glow effects).
    * ⚠️ **Advertencia:** `text-amber-500` / `bg-amber-500/10`.
    * ✅ **Seguro/Operativo:** `text-emerald-500` / `bg-emerald-500/10`.
    * ℹ️ **Info/Neutro:** `text-slate-400`.

### C. Tipografía
* **Principal:** `Inter` (Sans-serif) para textos generales.
* **Datos Técnicos:** `Geist Mono` o `Monospace` para IDs, timestamps, coordenadas y lecturas de sensores.

### D. Componentes & UX
* **Librería UI:** Usar exclusivamente **Shadcn/UI**. No mezclar con otras librerías de estilos.
* **Iconografía:** **Lucide-React**. Grosor de línea `strokeWidth={2}` o `1.5` para elegancia.
* **Feedback Visual:**
    * Los elementos interactivos deben tener estados `:hover` claros.
    * Usar "Glow Effects" (sombras de color) para destacar KPIs críticos.
* **Mobile First (PWA):**
    * Botones de acción (Play, Refresh) deben tener un área de toque mínima de 44px.
    * Evitar tablas anchas en móvil; usar tarjetas (Cards) o listas apiladas.
## 6. ROADMAP TÉCNICO & ADVERTENCIAS (LEER ANTES DE TOCAR CÓDIGO)

### A. ⚠️ Zona de Peligro: Internacionalización (i18n)
* **Estado:** FALLIDA Y REVERTIDA.
* **Historial:** Se intentó implementar `next-intl` previamente y rompió la estructura del proyecto y el despliegue.
* **Instrucción Estricta:** NO intentar reimplementar i18n (idiomas) hasta que la funcionalidad Multi-Tenant esté 100% estable y desplegada en producción.
* **Estrategia Futura:** Cuando se retome, hacerlo en una rama separada (`feature/i18n`) y NUNCA directamente en main. Priorizar la estabilidad del Dashboard sobre los idiomas por ahora.

### B. Gestión de Assets PWA (Iconos)
* **Recurso Origen:** Existe un archivo maestro llamado `icono` (puede ser .png/.jpg) en la carpeta `/public`.
* **Tarea Pendiente:** El Agente debe tomar ese archivo y generar automáticamente los assets requeridos por el `manifest.json`:
    1.  Renombrar/Convertir a `icon-192x192.png`.
    2.  Renombrar/Convertir a `icon-512x512.png`.
    3.  Asegurar que el `manifest.json` apunte a estos nuevos archivos para que la instalación en el móvil muestre el logo correcto y no el de Vercel/Next.js por defecto.

### C. Estabilidad del Despliegue
* **Regla de Oro:** Si un cambio requiere modificar `next.config.mjs` o el `middleware.ts`, se debe verificar doblemente que no rompa el build en Vercel. (Recordar el fix de `d3-ease` y las variables de entorno).
---
*Fin del contexto. Por favor, actúa como Arquitecto Senior y ayúdame a implementar el punto 4.*