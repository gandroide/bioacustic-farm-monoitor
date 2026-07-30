# Manual técnico — Nodo BIO-ACOUSTIC-HEALTH

Guía de instalación, operación y diagnóstico del nodo acústico BRIVEX BIO-ALERT.
Dirigida al técnico de campo que instala, mantiene o retira el dispositivo en la granja.

**Versión firmware documentada:** v2.0 (rama `main`, `firmware/bio-acoustic-health/src/main.cpp`).
**Hardware:** ESP32-S3-DevKitC-1 (N16R8) + micrófono INMP441 + módulo micro SD SPI.

---

## 1. ¿Qué hace este dispositivo?

Es un **recolector inteligente de datos acústicos** que graba en tarjeta SD los eventos sonoros anómalos que detecta en una nave ganadera (típicamente chillidos de lechón por aplastamiento u otras alertas de bienestar animal).

**Funcionamiento en una frase:** el nodo escucha 24/7 → cuando detecta un sonido con las características de una alerta real (nivel, frecuencia y ataque brusco) graba 8 segundos de audio en la SD junto con metadatos. Además hace una grabación ambiental automática cada 30 minutos como muestra de control.

Esos audios etiquetados alimentan el dataset de entrenamiento del modelo de detección acústica del SaaS BIO-ALERT.

**Importante — versión actual (v1):**
- El nodo **no** se conecta a WiFi ni sube nada al backend por sí solo.
- Todo se guarda en la tarjeta SD local. El operario retira la SD periódicamente y los audios se ingestan por otra vía.
- La subida automática y el emparejamiento por WiFi están planificados pero no forman parte de la versión actual del firmware.

---

## 2. Contenido del kit

| Elemento | Descripción |
|---|---|
| Placa ESP32-S3-DevKitC-1 con firmware BIO-ACOUSTIC-HEALTH ya cargado | Cerebro del nodo |
| Micrófono INMP441 con cableado I2S | Sensor acústico digital |
| Módulo micro SD SPI | Almacenamiento local |
| Tarjeta micro SD (recomendada: 32 GB, Clase 10, formateada en FAT32) | Soporte de audios y CSV |
| Cable USB-C | Alimentación (5 V, 500 mA) |
| Caja / soporte de fijación | Según variante de instalación |

---

## 3. Componentes visibles en el nodo

El nodo tiene, accesibles desde el exterior:

- **3 LEDs indicadores:** Verde, Amarillo, Rojo.
- **1 botón físico** (BTN_SYNC): pulsador único, momentáneo, con pull-up interno.
- **1 slot micro SD** en el módulo lateral.
- **1 conector USB-C** en la placa ESP32-S3 (alimentación y consola de diagnóstico).
- **1 micrófono** (INMP441) apuntando al área a monitorizar.

---

## 4. Instalación en la granja

### 4.1 Antes de ir a la granja

1. **Formatear la SD en FAT32.** El nodo requiere FAT32; NTFS, exFAT o ext4 no montan.
2. **Insertar la SD en el módulo lateral** con el nodo apagado.
3. **Verificar en banco de trabajo** que al alimentar por USB-C aparece el **LED verde parpadeando cada segundo** (heartbeat de operación normal). Ver §5.

### 4.2 En la granja

1. **Ubicación del micrófono:**
   - Colocar el INMP441 a **1.5–2 metros de altura** sobre la zona a monitorizar (parideras, corrales de destete, etc.).
   - **Evitar** ponerlo cerca de ventiladores, motores, extractores o goteros de agua a presión: el ruido sostenido no dispara la alerta (el filtro lo descarta) pero infla el "ruido de fondo" (baseline) y sube el umbral de disparo, perdiendo sensibilidad.
   - **Evitar** el contacto directo con el techo o superficies metálicas: transmiten vibraciones mecánicas al micrófono.
   - Orientar el frontal del micrófono (los orificios pequeños del INMP441) hacia la zona vigilada.

2. **Alimentación:**
   - Enchufar el cable USB-C a una fuente de 5 V ≥ 500 mA (adaptador de pared, PoE splitter con USB, batería 5 V, etc.).
   - **No** usar cargadores rápidos de 9 V/12 V: solo 5 V.
   - El nodo no tiene batería interna. Si se corta la corriente, se apaga inmediatamente. Al volver la corriente, arranca solo.

3. **Verificación in-situ tras encender:**
   - **Primeros 10 segundos:** fase de warmup — el nodo escucha pero no dispara aún.
   - Tras el warmup, el **LED verde parpadea 1 s ON / 1 s OFF**. Estado normal.
   - Si el verde no aparece, ver §7 (diagnóstico).

4. **Registro del nodo (opcional pero recomendado):**
   - Con la placa alimentada, abrir el monitor serial USB a **115200 baud** desde un portátil (Arduino IDE, PlatformIO, `screen /dev/tty.usbmodem* 115200`, etc.).
   - En el arranque el nodo imprime su **dirección MAC** (formato `AA:BB:CC:DD:EE:FF`). Apuntar esa MAC y asociarla en el inventario a la nave/paridera donde se instala. Esa MAC identifica el nodo de por vida.

---

## 5. Estados del sistema y señalización LED

El nodo tiene **6 estados** posibles. El LED indica en qué estado está sin necesidad de conectar nada.

| Estado | Cuándo ocurre | Verde | Amarillo | Rojo |
|---|---|---|---|---|
| **MONITORING** (normal) | Operación normal, escuchando | **Parpadeo 1 s ON / 1 s OFF** (heartbeat) | Apagado | Apagado |
| **RECORDING** | Grabando un evento (8 s) | Apagado | **Fijo encendido** | Apagado |
| **PAUSED** (Safe Eject) | SD desmontada por el usuario para extracción segura | **Fijo encendido** | **Fijo encendido** | Apagado |
| **SD_FULL** | Menos de 50 MB libres en la SD | Apagado | **Parpadeo alternado con rojo (500 ms)** | **Parpadeo alternado con amarillo (500 ms)** |
| **ERROR** | Fallo crítico (I2S caído, SD ilegible tras remount, escritura corrupta) | Apagado | Apagado | **Parpadeo rápido 200 ms ON / 200 ms OFF** |
| **PAIRING / confirmación** | Se muestra durante 2 s cuando cambias sensibilidad con el botón | **Los 3 LEDs sincronizados (500 ms)** o solo amarillo fijo 2 s | | |

**Regla mnemotécnica rápida para el técnico:**
- **Verde solo, parpadeando** → todo bien.
- **Amarillo solo, fijo** → grabando ahora mismo (dura 8 s).
- **Verde + Amarillo fijos** → SD lista para sacar.
- **Rojo + Amarillo alternando** → SD llena, hay que vaciarla.
- **Rojo parpadeando rápido** → problema, requiere intervención.

---

## 6. El botón (BTN_SYNC)

El nodo tiene **un solo pulsador** con dos funciones distintas según la duración de la pulsación:

### 6.1 Clic corto (< 1 segundo) — Safe Eject / Reanudar

Alterna entre monitorización normal y modo de extracción segura de la SD.

| Estado actual | Qué hace el clic corto |
|---|---|
| **MONITORING** | Desmonta la SD limpiamente → pasa a **PAUSED** (verde+amarillo fijos). **Ahora es seguro sacar la SD.** |
| **PAUSED** | Vuelve a montar la SD → pasa a **MONITORING**. |
| **RECORDING** | **Se ignora.** El botón no interrumpe una grabación en curso. Espera a que el LED amarillo se apague (~8 s) y reintenta. |
| Cualquier otro | Se ignora o comportamiento indeterminado — evitar. |

**Procedimiento de extracción segura de la SD:**
1. Verificar que el nodo NO está grabando (amarillo apagado).
2. Pulsar y soltar el botón brevemente (< 1 s).
3. Esperar hasta ver **verde + amarillo fijos simultáneos** (estado PAUSED).
4. Ya se puede extraer la SD físicamente sin corromper el sistema de archivos.
5. Insertar la SD nueva (o la misma tras copiar/borrar audios).
6. Volver a pulsar el botón brevemente → vuelve a **verde parpadeando** (MONITORING).

**Si al remontar el LED se queda en rojo parpadeando rápido:** la SD está mal insertada, corrupta o mal formateada. Reformatear en FAT32 en un PC y reintentar.

### 6.2 Zona muerta (entre 1 y 3 segundos)

Pulsaciones de esa duración **no hacen nada**. Es intencional: evita disparos accidentales cuando el clic no fue ni corto ni claramente largo.

### 6.3 Pulsación larga (≥ 3 segundos) — Cambio de sensibilidad

Alterna entre dos perfiles de sensibilidad del algoritmo de detección:

- **SENSIBLE** (por defecto): dispara con RMS > 1.5× ruido de fondo.
- **ESTRICTO**: dispara con RMS > 2.5× ruido de fondo — menos falsos positivos, pero puede perder alertas suaves.

**Cómo se hace:**
1. Mantener el botón pulsado sin soltar.
2. A los 3 segundos el firmware **enciende el LED amarillo fijo 2 s** como confirmación visual del cambio.
3. Soltar el botón cuando aparezca el amarillo (o después — no importa).
4. Tras los 2 s de amarillo, el nodo vuelve a MONITORING con la nueva sensibilidad.

**Regla:** ambientes muy ruidosos (ventilación fuerte, mucho tráfico humano) → usar ESTRICTO. Ambientes tranquilos donde se quiere máxima sensibilidad → dejar SENSIBLE.

El nodo **no recuerda** este ajuste entre reinicios: tras un corte de corriente vuelve a SENSIBLE por defecto.

---

## 7. Diagnóstico y solución de problemas

### 7.1 Ningún LED se enciende al alimentar

- Verificar el cable USB-C y la fuente (5 V, ≥ 500 mA).
- Probar con otro cable — algunos cables USB-C son solo de carga y no aportan datos ni alimentación suficiente.
- Comprobar que la fuente no está en modo Quick Charge (debe ser 5 V fijos).
- Si con otro cable y fuente sigue sin encender, la placa puede tener un daño físico → sustituir.

### 7.2 LED rojo parpadea rápido continuamente

Fallo crítico. Causas típicas:
- **SD ausente, mal insertada o dañada.** Extraer, reformatear en FAT32 y reintentar.
- **Micrófono I2S no responde.** Verificar el conector del INMP441 (cable suelto o pines mal contactados).
- **Escritura corrupta a mitad de una grabación.** Si tras el error el nodo vuelve solo a MONITORING (verde parpadeando) en unos 5 s, el evento se descartó pero el sistema se recuperó. Si se queda en rojo → reiniciar por corte de alimentación.

Para diagnóstico más fino, conectar el USB al portátil y abrir el monitor serial (115200 baud): el firmware imprime la causa exacta (`[ERROR] ...`).

### 7.3 LED rojo + amarillo alternando (SD_FULL)

La SD tiene menos de 50 MB libres.
- Hacer Safe Eject (clic corto), sacar la SD, vaciarla en un PC (mover los `.wav` y el `log_eventos.csv` a almacenamiento definitivo), volver a insertar y clic corto para remontar.
- El nodo comprueba el espacio libre cada 30 segundos, así que si liberas espacio y vuelves a montar, el estado vuelve solo a MONITORING sin necesidad de reiniciar.

### 7.4 Verde parpadea pero no graba nunca

- Confirmar que hay ruido acústico real cerca del micrófono. Un chasquido cerca (palmada, silbido agudo) debería disparar una grabación en 1–2 s y encender el amarillo 8 s.
- Si tampoco dispara con estímulos claros:
  - Puede estar en modo ESTRICTO (pulsar largo 3 s para volver a SENSIBLE).
  - El ruido ambiente puede ser tan alto que el baseline sube y el umbral queda inalcanzable → recolocar el micrófono lejos de ventiladores/motores.
- Los primeros **10 segundos tras encender** el nodo está en warmup y NO dispara alertas por diseño (deja al micrófono estabilizarse). También hay un **cooldown de 5 s** tras cada grabación en el que no dispara la siguiente.

### 7.5 El nodo graba constantemente (falsos positivos)

- Cambiar a ESTRICTO con pulsación larga (3 s).
- Alejar el micrófono de fuentes de ruido agudo intermitente (silbatos de aire comprimido, chirridos metálicos periódicos, etc.).
- Como referencia técnica: el trigger solo dispara si (a) el RMS supera 1.5×/2.5× el ruido de fondo, (b) la frecuencia dominante cae en 1.5–5 kHz (banda de chillidos de lechón), (c) hay un ataque brusco (onset). Los ruidos sostenidos no disparan.

### 7.6 Cortes de corriente

- El nodo arranca solo cuando vuelve la corriente. No requiere intervención.
- Se pierden únicamente las grabaciones en curso en el momento del corte (máximo un fichero incompleto que se detectará al leer el CSV).
- La SD conserva íntegras todas las grabaciones anteriores al corte porque se cierran fichero a fichero.

---

## 8. Qué se guarda en la SD

### 8.1 Ficheros de audio

Todos los ficheros son WAV, mono, 16 kHz, 16-bit PCM, **8 segundos de duración** (2 s de contexto pre-evento + 6 s post-detección). Se guardan en la **raíz** de la SD.

Dos tipos, distinguibles por prefijo:

| Prefijo | Significado | Cuándo se genera |
|---|---|---|
| `REC_<uptime>_RMS<valor>.wav` | Alerta acústica real | Cuando el algoritmo detecta un evento (chillido, ruido anómalo) |
| `ENV_<uptime>_RMS<valor>.wav` | Muestra ambiental de control | Automáticamente cada 30 minutos (dispositivo escuchando sin evento) |

- `<uptime>` = segundos desde que el nodo arrancó (útil para ordenar cronológicamente entre reinicios).
- `<valor>` = nivel RMS que disparó la grabación, útil para curación rápida.

Ejemplo: `REC_1234_RMS812-5.wav` = alerta disparada a los 1234 s de uptime con RMS 812.5.

### 8.2 CSV de eventos

Fichero único `/log_eventos.csv` (en la raíz de la SD), formato:

```
Archivo,Tipo,MAC,Uptime_ms,Evento,Baseline_RMS,Pico_RMS,Freq_Dom_Hz,Temp_C
```

Se añade una línea por cada grabación (REC o ENV). Este CSV es la clave para curar el dataset después: cada `.wav` está identificado por MAC del nodo + uptime + métricas del evento.

---

## 9. Especificaciones técnicas resumidas

| Parámetro | Valor |
|---|---|
| Micro | ESP32-S3-DevKitC-1 (N16R8: 16 MB flash + 8 MB PSRAM) |
| Micrófono | INMP441 I2S (32-bit → 16-bit por software) |
| Almacenamiento | Micro SD FAT32 (mínimo 8 GB, recomendado 32 GB Clase 10) |
| Muestreo | 16 kHz mono 16-bit PCM |
| Duración por grabación | 8 s (2 s pre-roll + 6 s live) |
| Muestreo ambiental | Automático cada 30 minutos |
| Alimentación | 5 V DC ≥ 500 mA por USB-C |
| Warmup post-boot | 10 s sin disparo de alertas |
| Cooldown post-grabación | 5 s sin disparo de alertas |
| Umbral SD llena | 50 MB libres mínimo |
| Chequeo espacio SD | Cada 30 s |
| Consola de diagnóstico | USB CDC a 115200 baud |
| Firmware runtime | FreeRTOS doble núcleo (Core 0 = captura I2S, Core 1 = análisis + LED + botón) |

---

## 10. Contacto y soporte

Ante cualquier situación no cubierta en este manual:

1. **Anotar** la MAC del nodo, el LED que se está viendo, y (si es posible) la salida del monitor serial USB a 115200 baud.
2. **Contactar** al equipo de soporte técnico del proyecto BIO-ALERT con esos tres datos.

> **Nota de versión:** este manual describe el firmware v2.0 en la rama `main` del monorepo `bio-acoustic-farm`. La próxima iteración añadirá un segundo botón (BTN_LABEL) para etiquetar eventos en el borde y conectividad WiFi con emparejamiento contra el SaaS — cuando esas funciones se desplieguen, este documento debe actualizarse.
