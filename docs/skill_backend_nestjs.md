# Skill: NestJS Backend Controller

## Contexto
API central que recibe datos de múltiples sensores y gestiona la lógica de negocio antes de persistir en DB.

## Arquitectura NestJS
* Usar arquitectura estándar: `Controller` -> `Service` -> `Repository/Supabase`.

## Endpoints Requeridos

### 1. Ingesta de Eventos
* `POST /api/events/report`
* **Body:** `{ "device_id": "mac-address", "rms_value": 3050, "timestamp": "ISO..." }`
* **Lógica:** 1. Verificar si el `device_id` está registrado en la BD y activo.
    2. Obtener el `farm_id` asociado al dispositivo.
    3. Insertar en Supabase tabla `events`.

### 2. Heartbeat (Latido)
* `POST /api/devices/ping`
* **Body:** `{ "device_id": "..." }`
* **Lógica:** Actualizar columna `last_seen` en la tabla `devices`. Si un dispositivo no hace ping en 5 min, marcar como `OFFLINE`.

## Integración Supabase
* Usar librería `@supabase/supabase-js`.
* **Schema Sugerido:**
    * `farms` (id, name, location)
    * `devices` (id, farm_id, status, last_seen)
    * `events` (id, device_id, severity, created_at)