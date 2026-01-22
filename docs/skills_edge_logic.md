# Skill: Python Edge Monitor

## Contexto
Script de ejecución continua en la Raspberry Pi. Debe ser robusto a fallos de red.

## Requerimientos de Código
Generar un script `main.py` modular con las siguientes características:

### 1. Módulo de Audio (Class `AudioEar`)
* Usar `pyaudio` con `PaInt16`.
* Configurar un `stream` no bloqueante o usar `threading` para que el análisis no pause la grabación.
* Implementar reconexión automática si el micrófono USB se desconecta.

### 2. Lógica de Detección (Class `Brain`)
* **Fase 1 (Volumen):** Calcular RMS usando `numpy`. Si `rms > THRESHOLD`, activar trigger.
* **Fase 2 (IA - Placeholder):** Dejar la estructura lista para inyectar un modelo `.tflite` en el futuro.
* **Debounce:** Implementar un tiempo de enfriamiento (`cooldown = 5s`) tras una alarma para no saturar el altavoz.

### 3. Módulo de Comunicación (Class `Comms`)
* Método `send_alert(level, farm_id)`: Envía un POST al endpoint de NestJS `/api/events/report`.
* **Manejo de Error:** Si no hay internet, debe guardar el evento en un archivo local `offline_events.json` y reintentar enviarlo luego (Cola de reintento). NO debe crashear el script.

### 4. Ejecución
* Bloque `if __name__ == "__main__":` que inicie los hilos y maneje `KeyboardInterrupt` para limpieza (Graceful Shutdown).