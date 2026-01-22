# Project Spec: Autonomous Pig Rescue System (Bioacoustics)

## 1. Identidad del Proyecto
Sistema independiente de IoT (Internet of Things) para la detección temprana de aplastamiento en salas de maternidad porcina.
**Prioridad Absoluta:** Detección offline y disparo de alarma local.

## 2. Hardware Layer (The Edge)
* **Nodo:** Raspberry Pi 4 (o equivalente Linux ARM).
* **Sensores:** Micrófono USB Omnidireccional.
* **Actuadores:** Altavoz PA (Salida Jack 3.5mm) + (Opcional) Luz Estroboscópica via GPIO.
* **Conectividad:** Wi-Fi/Ethernet hacia el servidor central.

## 3. Stack Tecnológico
* **Edge (Raspberry Pi):** * Python 3.9+
    * PyAudio (Captura) + Numpy (Cálculo) + TFLite (Inferencia futura).
    * Operación: Servicio systemd "Headless" (sin monitor).
* **Backend (Control Central):**
    * NestJS (Node.js framework).
    * Función: API REST para recibir logs, gestionar estado de dispositivos (Heartbeat) y actualizaciones OTA.
* **Database & Realtime:**
    * Supabase (PostgreSQL).
    * Función: Persistencia de logs de incidentes y notificaciones en tiempo real al Dashboard.

## 4. Flujo de Datos
1. **[SENSOR]** Micrófono captura audio (Buffer 3s).
2. **[EDGE - Python]** Analiza RMS (Volumen) y Patrón (IA).
3. **[EDGE - Python]** Si es POSITIVO:
    * a) Dispara Alarma Local (Prioridad 0).
    * b) Envía HTTP POST al Backend NestJS (Prioridad 1).
4. **[BACKEND - NestJS]** Valida el dispositivo y guarda el evento en Supabase.
5. **[SUPABASE]** Notifica a la Web App vía WebSockets.