# Plan de Proyecto: Sistema de Bioacústica y Alerta Temprana para Granjas Porcinas

**Versión:** 1.0
**Estado:** Planificación
**Objetivo Principal:** Detección en tiempo real de estrés porcino (aplastamiento/dolor) mediante IA en el borde (Edge Computing) para reducir la mortalidad de lechones.

---

## 1. Resumen Ejecutivo

El sistema monitorea el ambiente auditivo de las salas de maternidad porcina. Utilizando micrófonos y micro-ordenadores locales, una Inteligencia Artificial analiza el espectro de audio continuamente. Al detectar patrones de frecuencia compatibles con "chillidos de aplastamiento" o estrés agudo, el sistema activa inmediatamente una alarma sonora local para alertar a los operarios o provocar que la madre se levante, y registra el evento en la nube.

---

## 2. Arquitectura Técnica

### 2.1 Hardware (Edge Layer)

El procesamiento debe ser local para garantizar latencia cero y funcionamiento offline.

- **Unidad de Procesamiento:** Raspberry Pi 4 (4GB/8GB) o NVIDIA Jetson Nano (para mayor potencia de IA).
- **Entrada de Audio:** Micrófonos USB omnidireccionales con clasificación IP67 (resistentes a humedad y polvo) + Espuma anti-viento.
- **Salida de Audio:** Altavoces PA conectados vía Jack 3.5mm o Bluetooth.
- **Caja:** Carcasa industrial con ventilación pasiva y protección contra amoníaco/polvo.

### 2.2 Software Stack

- **Lenguaje:** Python 3.9+
- **Librerías de Audio:** `PyAudio` (captura), `Librosa` (procesamiento DSP).
- **Motor de IA:** TensorFlow Lite (optimizado para CPU ARM).
- **Backend / Nube:** Supabase (PostgreSQL) para logs históricos y gestión de dispositivos.
- **Comunicación:** MQTT (Protocolo ligero IoT) para enviar alertas al dashboard.

---

## 3. Fases de Desarrollo (Roadmap)

### Fase 1: Adquisición de Datos (Data Mining)

_Objetivo: Crear el dataset para entrenar a la IA._

1.  Instalación de equipos de grabación en una granja piloto.
2.  Grabación continua (24/7) durante 10-14 días.
3.  Etiquetado manual de audios:
    - `Clase 0`: Silencio / Ruido ambiente (ventiladores).
    - `Clase 1`: Gruñidos normales / Alimentación.
    - `Clase 2`: **Emergencia** (Chillidos agudos/Dolor).

### Fase 2: Desarrollo del Modelo (Machine Learning)

_Objetivo: Crear un cerebro capaz de distinguir sonidos._

1.  **Pre-procesamiento:** Convertir audios a Espectrogramas Mel.
2.  **Entrenamiento:** Entrenar una red neuronal convolucional (CNN) ligera (ej. MobileNet).
3.  **Conversión:** Convertir el modelo a `.tflite` para que corra rápido en la Raspberry Pi.
4.  **Validación:** Asegurar que la precisión sea > 90% para evitar falsos positivos.

### Fase 3: Desarrollo de la Aplicación (Edge App)

_Objetivo: El software que corre en la granja._

1.  Implementar el "Buffer Circular" (graba los últimos 3 segundos constantemente).
2.  Integrar el modelo TFLite para inferencia en tiempo real.
3.  Programar la lógica de disparo (Trigger):
    - _IF_ `prediccion == Emergencia` _AND_ `probabilidad > 0.85`:
      - Disparar sonido de alerta.
      - Enviar log a Supabase.

### Fase 4: Integración y Dashboard

_Objetivo: Visualización de datos._

1.  Crear tabla `alert_logs` en Supabase.
2.  Desarrollar dashboard simple (o integrar en AXIS.ops) para ver:
    - Número de alertas por día.
    - Estado de los micrófonos (Online/Offline).

---

## 4. Estructura de Datos (Supabase Schema)

Propuesta para la tabla de registro de incidentes:

| Columna         | Tipo      | Descripción                                    |
| :-------------- | :-------- | :--------------------------------------------- |
| `id`            | uuid      | Identificador único del evento                 |
| `sensor_id`     | text      | ID de la Raspberry Pi (ej. "SALA-04-A")        |
| `created_at`    | timestamp | Hora exacta del incidente                      |
| `confidence`    | float     | Nivel de certeza de la IA (0.0 - 1.0)          |
| `duration`      | float     | Duración del chillido en segundos              |
| `audio_snippet` | url       | (Opcional) Link al archivo de audio en Storage |

---

## 5. Matriz de Riesgos y Soluciones

| Riesgo                    | Impacto                             | Estrategia de Mitigación                                                                                                       |
| :------------------------ | :---------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| **Falsos Positivos**      | Alto (El granjero ignora la alarma) | Ajustar el umbral de confianza (>90%) y re-entrenar con más ruido de fondo.                                                    |
| **Suciedad en Micrófono** | Medio (Pérdida de señal)            | Usar micrófonos IP67 y establecer protocolo de limpieza semanal.                                                               |
| **Fallo de Internet**     | Bajo (Para la alerta inmediata)     | El procesamiento es local (Edge). Si cae internet, la alarma suena igual; solo se pierde el registro en la nube temporalmente. |
| **Daño por Animales**     | Alto (Equipo roto)                  | Instalación en techo/paredes altas, lejos del alcance físico de los cerdos. Cableado protegido con conductos metálicos.        |

---

## 6. Próximos Pasos Inmediatos (Action Items)

- [ ] **Hardware:** Comprar 1 Raspberry Pi y 1 Micrófono USB para pruebas de escritorio.
- [ ] **Dataset:** Buscar datasets públicos de sonidos de animales (ej. _Escudo_ o _AudioSet_ de Google) para un pre-entrenamiento inicial antes de ir a la granja.
- [ ] **Prototipo:** Escribir un script en Python que simplemente detecte cuando el volumen supera ciertos decibelios (Prueba de concepto).


Componente,Especificación,Costo Aprox. (€),Notas
SBC,Raspberry Pi 4 (4GB),€ 60.00,El precio fluctúa según stock.
Almacenamiento,MicroSD 32GB High Endurance,€ 12.00,Vital para que no falle el OS.
Micrófono,Micrófono Lavalier + USB Dongle,€ 15.00,El dongle USB limpia el ruido eléctrico.
Altavoz,Trompeta PA (Monacor/Generic),€ 25.00,Modelo básico de megafonía.
Amplificador,Módulo Amp (ej. PAM8403/8610),€ 5.00,Para dar potencia al altavoz.
Caja (Case),Caja Estanca IP65 (200x150mm),€ 20.00,Plástico ABS resistente.
Fuente Poder,Fuente USB-C 3A Oficial,€ 12.00,Fuente de calidad para evitar reinicios.
Varios,"Cables, espuma, conectores",€ 10.00,Prensaestopas para los cables.
,,,
TOTAL ESTIMADO,Materiales por Unidad,€ 159.00,(Aprox. $170 USD)

