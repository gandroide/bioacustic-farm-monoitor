# Plan de Acción — Nodo `bio-acoustic-breath` (Módulo Respiratorio)

**Rama:** `v2/full-stack`
**Estado:** Firmware v0.1 implementado y compilando. Sin flashear a hardware.
**Fecha:** 2026-07-31
**Nodo hermano:** `bio-acoustic-health` — **intacto**, no se tocó ni una línea.

---

## 1. Alcance y frontera con `health`

Dos nodos sobre el **mismo hardware** (ESP32-S3 N16R8 + INMP441 + Micro SD), con firmwares distintos.

| Nodo | Ubicación | Escucha | Detecta | Reacciona en |
|---|---|---|---|---|
| `health` | Maternidad | Chillidos | Aplastamiento de lechones | **segundos** |
| `breath` | Destete / Engorde | Respiración | Tos, grasnidos, dificultad, humedad | **horas** |

Esa asimetría temporal es un regalo, no un defecto. Un aplastamiento mata rápido y obliga a reaccionar en segundos. Una enfermedad respiratoria se desarrolla en días, así que `breath` puede permitirse ventanas de confirmación largas — y eso compra muchísima robustez contra falsos positivos.

### Nota de nomenclatura

El nodo se llamaba `bread` ("pan" en inglés). Renombrado a `breath` el 2026-07-31 vía `git mv` (historial preservado). Su cabecera anterior lo describía como *"Módulo de Cría / Maternidad"* con sensores de temperatura y humedad — alcance que quedó obsoleto y fue reescrito.

---

## 2. Por qué `breath` no es `health` con otra banda

Es el error de diseño más fácil de cometer aquí, y hay que dejarlo por escrito.

Las tres presentaciones clínicas **no son variantes del mismo fenómeno**. Lo que las delata vive en dimensiones distintas de la señal:

| Presentación | Forma acústica | Dónde está la información |
|---|---|---|
| **Tos** | Impulsiva, corta, banda ancha | Energía |
| **Grasnido / sibilancia** | Sostenida, tonal, energía baja | Tonalidad espectral |
| **Dificultad respiratoria** | Soplos suaves, amplitud muy baja | **Ritmo de la envolvente** |
| **Respiración húmeda** | Transitorios < 20 ms, amplitud baja | **Microestructura temporal** |

Consecuencias directas sobre el firmware de `health`, que no sirven aquí:

- **El onset detector rechaza el grasnido.** `ONSET_DELTA_FACTOR` existe en `health` para descartar sonidos sostenidos ("anti-música"). Un grasnido *es* un sonido sostenido. Ese criterio es un anti-grasnido.
- **El RMS de 64 ms borra la respiración húmeda.** Un bloque de 1024 muestras promedia un estertor de 10 ms hasta hacerlo desaparecer.
- **La dificultad respiratoria es invisible al nivel.** Es de amplitud baja; lo que la delata es la periodicidad, no la energía.

### Y el diagnóstico no está en el evento

Una tos aislada no es una patología. Un cerdo sano tose. Lo patológico es una **tasa** sostenida en el tiempo.

> **La etiqueta de `breath` no es por-evento, es por-ventana.** Un WAV de 8 s con una tos es un dato **sin etiqueta posible** — nadie puede decir si ese corral estaba enfermo mirando 8 segundos.

Por eso el modelo de grabación de `health` (dispara → graba 8 s → cooldown) no falla por impreciso. Falla porque **produce datos que no se pueden etiquetar**.

---

## 3. La decisión central: todavía no existe el índice respiratorio

No se puede validar una fórmula antes de tener datos etiquetados. Definir "el índice" hoy sería hornear una suposición dentro de meses de recolección, sin forma de recuperarlos.

> **En fase 1 el índice es un instrumento de investigación, no un diagnóstico.** No se diseña el índice: se diseña el **log de features**. Se registra un conjunto fijo de medidas baratas por ventana y se deja que las etiquetas clínicas digan después qué combinación predice.

Corolario práctico: **no afinar la detección todavía.** El trigger de `health` está afinado a 1,5-5 kHz porque ya se sabe cómo suena un chillido de lechón. Para `breath` no se sabe cómo suena una tos *en ese micrófono, en ese galpón, con esa raza y esa densidad*. Cualquier banda elegida hoy es una conjetura, y una conjetura mal puesta hace perder en silencio justo los eventos que se necesitan.

---

## 4. Esquema de `features.csv` — el instrumento

Una fila por ventana de 60 s. **Se escribe siempre**, dispare o no dispare algo. Es la única salida sin sesgo de trigger.

Todo se calcula con **acumuladores incrementales** sobre los bloques de 1024 muestras que ya fluyen por Core 1. Bufferizar 60 s de audio costaría ~1,9 MB y no cabe: el nodo ya usa ~68% de la RAM interna.

| Grupo | Columnas | Para qué |
|---|---|---|
| Identidad | `uptime_ms`, `boot_id`, `batch_id`, `window`, `clinical`, `blocks` | Alineación y contexto |
| Nivel | `rms_mean`, `rms_std`, `rms_max`, `rms_p50`, `rms_p90`, `rms_baseline` | Actividad general |
| Espectral | `centroid_hz`, `centroid_std`, `flatness`, `flatness_std`, `rolloff_hz` | Tonalidad, brillo |
| Bandas | `band0`..`band3` (0-500, 500-2k, 2k-5k, 5k-8k Hz) | Distribución de energía |
| Impulsos | `impulses`, `imp_b0`..`imp_b3` | Tos |
| **Cresta** | `crest_mean`, `crest_max` | **Respiración húmeda** |
| **Modulación** | `breath_rate_bpm`, `mod_strength`, `mod_freq_hz` | **Dificultad respiratoria** |
| Contexto | `temp_c` | Deriva térmica |

### `flatness` — el detector natural del grasnido

Mide cuán tonal vs ruidoso es el sonido: media geométrica / media aritmética del espectro. Un grasnido es tonal → flatness baja. El ruido del corral es ancho → flatness alta. Es prácticamente el detector de la clase que el onset de `health` rechaza, y sale casi gratis de la FFT que ya se calcula.

### Se registra la desviación, no solo la media

`centroid_std` y `flatness_std` existen porque **el contenido diagnóstico suele estar en la variabilidad**. Dos corrales pueden tener la misma flatness media y desviaciones opuestas: uno con ruido estable, otro con respiración húmeda irregular. Coste: una suma de cuadrados más por bloque.

### El número que hace viable Venezuela

| Flujo | Volumen diario |
|---|---|
| Audio | ~460 MB |
| **Features** | **~115 KB** |

Cuatro mil veces menos. **El stream de features sincroniza sobre cualquier conexión.** El audio se queda en SD y sube cuando puede, o se recoge a mano. Eso desacopla la operación en tiempo real de la conectividad.

---

## 5. Análisis de modulación — la dificultad respiratoria

La medida más importante que `health` no tiene.

Un cerdo en reposo respira a ~15-25 rpm; con disnea llega a 40-80. Cada respiración es un soplo ancho y suave de amplitud baja: **por nivel es invisible**. Lo que la delata es la *periodicidad*.

**Método.** Se guarda un RMS por bloque (uno cada ~64 ms → envolvente muestreada a 15,6 Hz) en un buffer circular de 512 posiciones (~32,8 s). Una vez por ventana:

1. Se copia en orden cronológico y se le resta la media (sin esto el bin DC domina y tapa todo)
2. FFT de 512 puntos sobre la envolvente
3. Se busca el pico dominante entre 0,2 y 2,0 Hz (12-120 rpm)
4. `mod_strength` = pico / media del espectro de modulación en esa banda

Alta fuerza = hay un ritmo claro. Baja = solo ruido sin estructura.

Coste: **una FFT de 512 puntos por minuto**. Despreciable.

### Limitaciones conocidas

- **Superposición.** Con 30 animales se solapan 30 ritmos y la periodicidad se emborrona. Funcionará mejor con pocos animales cerca del micrófono y en periodos tranquilos. **Si sirve o no en un corral real es una pregunta empírica** — y ese es exactamente el motivo de registrarlo desde ya en vez de decidirlo por teoría.
- **Huecos durante grabación.** Mientras se escribe un chunk el bucle de análisis no corre, así que la envolvente tiene huecos y la estimación posterior parte de datos incompletos.

---

## 6. Factor de cresta — la respiración húmeda

Los estertores son transitorios explosivos de menos de 20 ms y amplitud baja. Un bloque de 64 ms los promedia hasta borrarlos: **la respiración húmeda era invisible a todo lo demás**.

El factor de cresta (pico / RMS) sí los ve. Un soplo suave y ruidoso da ~3-4; los estertores producen picos altos sobre un fondo de energía baja. Se calcula en el mismo recorrido que ya hace el RMS, así que sale gratis.

Se registra **crudo, sin umbral**, porque todavía no hay datos con los que fijar uno.

---

## 7. Política de grabación en tres niveles

### Nivel 1 — Centinela (ciego, sin sesgo)

30 s cada 3 min, pase lo que pase. Es la clase negativa y lo único que permite calcular tasas reales. Sin muestreo ciego el dataset queda 100% sesgado a lo que disparó el trigger, y el modelo nunca aprende qué es "normal".

**Centinela adaptativo.** En periodos tranquilos baja a 30 s cada 1 min. La respiración dificultosa y la húmeda son de amplitud baja: solo son audibles cuando el corral calla. De noche los animales están quietos, la ventilación baja y están amontonados — la relación señal-ruido mejora muchísimo.

Sin RTC no se sabe la hora, pero **el propio nivel de fondo delata el periodo tranquilo**: se mantienen referencias lentas del mínimo y máximo del baseline (relajación exponencial, `QUIET_REF_ALPHA = 0.02`), y se considera tranquilo cuando el baseline actual está en el 30% inferior de ese rango.

### Nivel 2 — Trigger (deliberadamente flojo)

Solo nivel RMS: **sin filtro de banda y sin onset**. Ambos criterios de `health` descartarían el grasnido. Se afina cuando haya audio real.

Graba 2 s de pre-roll + 8 s en vivo.

### Nivel 3 — Episodio (latch), con **dos vías**

Una respiración anómala da minutos u horas de sonido; 8 s no la capturan.

**Vía A — impulsos.** 3 triggers dentro de 60 s → episodio.

**Vía B — ritmo.** `mod_strength ≥ 6.0` durante 3 ventanas consecutivas → episodio.

> La vía B no es opcional. Sin ella, **un corral con disnea severa y cero toses nunca grabaría audio largo** — justo el caso que más lo necesita.

Un episodio por ritmo no genera impulsos, así que el timeout por inactividad lo cerraría tras el primer chunk. Se le garantiza un mínimo de 5 chunks (~5 min).

**Los episodios se trocean en chunks de 1 min de tamaño fijo**, no se abre un WAV gigante: un corte de luz pierde un chunk, no el episodio entero, y no hace falta parchear la cabecera RIFF al cerrar. Tope duro: 30 min.

Entre chunks hay 10 s de análisis para decidir si el episodio continúa. Eso deja un hueco de audio entre chunks — limitación conocida y aceptada de esta versión.

### Matemática de almacenamiento

A 16 kHz / 16-bit / mono = **32 kB/s**:

| | Volumen |
|---|---|
| Continuo | 115 MB/h · 2,76 GB/día |
| Centinela normal (16,7% duty) | ~460 MB/día → **~69 días en SD de 32 GB** |
| Chunk de episodio (1 min) | 1,9 MB |

**No bajar el sample rate para ahorrar espacio.** Si `health` y `breath` graban a tasas distintas sus datasets no se pueden juntar, y se pierde la clase negativa compartida — el activo más caro de construir.

---

## 8. El semáforo: el activo central del proyecto

### Por qué importa más de lo que parece

El mayor riesgo de `breath` era el *ground truth*: audio sin diagnóstico veterinario no se puede entrenar ni validar. **El flujo del semáforo lo resuelve solo.** Visto como generador de datos:

| Momento | Lo que genera |
|---|---|
| Rojo se enciende | timestamp de sospecha + audio previo |
| Trabajador pulsa | **"aquí hubo enfermedad real y se trató"**, firmado por un humano |
| Ventana amarilla 48 h | audio de evolución bajo tratamiento |
| Pasa a verde | **"el tratamiento funcionó"** → confirma retroactivamente el rojo |
| Vuelve a rojo | **"no mejoró"** → el caso más valioso del dataset |

Etiquetado clínico **con desenlace**, producido por la operación diaria, sin trabajo extra para nadie.

### Fase 1: modo manual

El semáforo **no lo enciende ningún algoritmo todavía** — lo enciende el trabajador cuando él nota un corral con problemas. El resto del flujo funciona igual, hecho por personas.

Se gana el dataset etiquetado, la validación de que el flujo operativo funciona con gente real, y el hábito instalado antes de que el algoritmo tenga que ganarse la confianza. **Cero trabajo desechable**: el mismo hardware y firmware pasan a automático cuando el modelo esté listo.

### Dos estados ortogonales

```
deviceState   → DEV_MONITORING · DEV_RECORDING · DEV_ERROR · DEV_SD_FULL · DEV_PAUSED
clinicalState → CLIN_NORMAL · CLIN_ALERT · CLIN_QUARANTINE
```

Un nodo puede estar `SD_FULL` mientras el corral está en `QUARANTINE`. `health` los tiene fundidos en un solo enum porque no tiene dimensión clínica; aquí meterlos juntos duele.

El semáforo muestra **estado del corral**, punto — no parpadea al grabar, porque las grabaciones son constantes y eso sería ruido para el trabajador. Los fallos del aparato **sí** tienen prioridad visual, porque significan "este nodo no está escuchando".

### Gestos del botón

| Gesto | Acción | Razón registrada |
|---|---|---|
| Corta (< 1 s) | Avanza ciclo NORMAL → ALERTA → CUARENTENA → NORMAL | `manual_deteccion`, `tratamiento_aplicado`, `tratamiento_efectivo` |
| Larga (≥ 3 s) | Vuelve a NORMAL | `correccion_manual` |
| Lote (≥ 7 s) | Nuevo lote: resetea baseline y `batch_id` | `nuevo_lote` |

Durante la retención el semáforo da realimentación (amarillo a los 3 s, triple parpadeo al confirmar lote): el trabajador lleva guantes y **sin señal visual no puede distinguir 3 s de 7 s**.

> **Fase 2:** cuando el algoritmo encienda el rojo solo, la pulsación larga pasa a significar **"falsa alarma del detector"** sin cambiar el vocabulario de gestos. Distinguir "traté" de "no encontré nada" es crítico: si ambas fueran la misma pulsación, todos los rojos quedarían etiquetados como aciertos y sería imposible medir la tasa de falsos positivos.

### El problema del lote

Destete y engorde son **todo-dentro/todo-fuera**: la población entera cambia cada pocas semanas. Un baseline aprendido con el lote N no significa nada para el lote N+1 — otros animales, otro número, otro peso, otro sonido.

Por eso "nuevo lote" es un evento explícito que resetea el baseline. **No es opcional**: sin él, el baseline es basura después de cada reposición.

El cambio de lote se registra en CSV **aunque el semáforo ya esté en verde** — `setClinicalState()` no escribe fila si no hay transición, y se perdería el marcador de inicio de lote.

### Persistencia

Una cuarentena de 48 h **no puede perderse porque se fue la corriente**. Se persiste en NVS: `clinicalState`, `batchId`, `quarantineElapsedMs`, `bootId`.

Sin RTC solo se puede contar uptime, así que el acumulado se guarda cada 5 min: **un reinicio pierde como mucho 5 minutos de conteo**.

---

## 9. Los tres registros en SD

| Archivo | Cadencia | Contenido |
|---|---|---|
| `/features.csv` | 1/min, **siempre** | El instrumento — denso y regular |
| `/log_audio.csv` | 1 por WAV | Qué se grabó y por qué |
| `/log_clinico.csv` | 1 por transición | **Las etiquetas con desenlace** |

Separarlos importa: `features.csv` es apto para análisis directo; los otros dos son dispersos y dirigidos por eventos.

Nomenclatura de WAV: `/SEN_<uptime>_<clin>.wav`, `/TRG_<uptime>_RMS<val>_<clin>.wav`, `/EPI_<id>_<seq>_<clin>.wav`.

---

## 10. Estado del firmware

**Implementado y compilando.** `firmware/bio-acoustic-breath/src/main.cpp`, 2.012 líneas, autocontenido.

| | `health` | `breath` |
|---|---|---|
| RAM | 67,9% (222.604 B) | **69,9%** (229.204 B) |
| Flash | 11,0% | 11,5% |

Los acumuladores de ventana costaron ~350 B; los buffers de envolvente ~6,2 KB.

### Bugs corregidos durante la implementación

1. **`ledTask` pisaba la realimentación del botón** — refresca a 20 Hz, el amarillo de confirmación nunca se habría visto. Resuelto con un flag `ledOverride` al que `ledTask` cede.
2. **La pulsación larga usaba un `digitalRead` crudo**, saltándose el debounce. Ahora se resuelve al soltar, por duración.
3. **El conteo de impulsos moría durante el cooldown** — 3 s ciegos tras cada grabación, justo dentro de un brote de tos. Separados `impulseDetected` (alimenta features y latch) de `triggered` (dispara grabación).
4. **`EPS` colisiona con un macro de los headers Xtensa** (`#define EPS 192`). Renombrado a `MAG_EPS`.

### Constantes provisionales — recalibrar con datos

| Constante | Valor | Nota |
|---|---|---|
| `MOD_STRENGTH_EPISODE` | `6.0` | **Inventado.** Alto a propósito: mejor perder episodios que llenar la SD |
| `THRESHOLD_RMS` | `400.0` | Piso absoluto, sin validar en campo |
| `RMS_FACTOR` | `2.0` | Sin validar |
| `QUIET_FRACTION` | `0.30` | Umbral de periodo tranquilo, sin validar |

---

## 11. Pendiente

### Hardware

- **Semáforo externo.** El firmware maneja los pines 4/5/6, pero un semáforo legible a distancia en un galpón iluminado necesita driver, cableado y sellado contra humedad y amoníaco. Los LEDs de la placa son de diagnóstico a 30 cm.
- **Botón industrial sellado** en paralelo al pin 7. Lo pulsan con guantes sucios.

### Software

- **Log diario por corral en Supabase** — qué corrales se trataron, con qué, mortalidad, nota del cuidador. No es firmware y puede empezarse ya. Complementa las etiquetas del semáforo.
- **Sin WiFi en v0.1.** Los datos salen por la tarjeta SD. La sincronización llega después.
- **Extracción de `firmware/common/`.** Ver abajo.

---

## 12. Extracción de `firmware/common/` — cuándo y cómo

`breath` es hoy **autocontenido y duplica** el núcleo de `health` (I2S, ring buffer, pre-roll, escritor WAV, gestión de SD llena, debounce). Es deuda técnica **consciente y aceptada**: `health` funciona y está por irse a campo, y refactorizarlo justo antes de desplegarlo es riesgo sin beneficio inmediato.

**El riesgo que preocupa no existe.** C++ se compila y enlaza de forma estática: si falta un archivo, el build falla en el Mac, ruidosamente, y no se genera ningún `.bin`. No hay escenario de un ESP32 al que "le falte código" — o el binario está completo, o no hay binario.

### Protocolo de verificación

Línea base medida el 2026-07-31, antes de tocar nada:

```
health pre-refactor →  RAM: 222.604 B (67,9%)  ·  Flash: 367.369 B (11,0%)
breath pre-refactor →  RAM: 229.204 B (69,9%)  ·  Flash: 383.905 B (11,5%)
```

1. Extraer el núcleo a `firmware/common/`, referenciado vía `lib_extra_dirs` en ambos `platformio.ini`
2. Recompilar los dos y **comparar contra esos números**. Si se mueven mucho, algo se coló
3. Flashear a hardware real y correr el ciclo completo: LEDs, grabación, SD, botón

**Cuándo:** cuando `breath` esté validado en banco, no antes.

---

## 13. Orden de trabajo

- [x] Renombrar `bread` → `breath` y corregir alcance en docs
- [x] Firmware v0.1: features, tres niveles de grabación, semáforo manual, NVS
- [ ] Flashear a hardware y validar en banco (ver checklist abajo)
- [ ] Log diario por corral en Supabase
- [ ] Desplegar semáforo en modo manual y acumular etiquetas clínicas
- [ ] Recalibrar constantes provisionales con semanas de `features.csv` real
- [ ] Extraer `firmware/common/`
- [ ] Fase 2: detección automática

### Checklist de banco

```bash
cd firmware/bio-acoustic-breath && ~/.platformio/penv/bin/pio run -t upload -t monitor
```

| Qué | Cómo | Esperado |
|---|---|---|
| Ventanas | Dejar correr 5 min | Una fila/min en `features.csv` |
| Persistencia NVS | Poner en amarillo, desenchufar, enchufar | Sigue en amarillo, cuarentena conserva el acumulado |
| Gestos | Pulsación corta ×3 | Verde → rojo → amarillo → verde, tres filas en `log_clinico.csv` |
| Realimentación | Mantener 3 s y soltar | Amarillo durante la retención, vuelve a NORMAL |
| Nuevo lote | Mantener 7 s | Triple parpadeo, `batch_id` incrementa |
| **Ritmo** | Cerdo (o fuente periódica) cerca | `breath_rate_bpm` plausible, `mod_strength` > 1 |
| **Cresta** | Arrugar papel junto al micrófono | `crest_max` se dispara — es lo más parecido a un estertor disponible en banco |
| Centinela | Ambiente silencioso vs ruidoso | El intervalo baja a 1 min cuando calla |

---

## 14. Riesgos abiertos

1. **La superposición puede matar el análisis de ritmo.** 30 animales = 30 ritmos solapados. Es la incógnita mayor y solo el campo la responde.
2. **La fatiga de alertas no se recupera.** Si el rojo se dispara con un portón metálico y el trabajador va tres veces sin encontrar nada, deja de mirar el semáforo. El rojo nunca debe dispararse con una sola detección.
3. **El verde debería sugerir, no dar de alta.** Un verde equivocado significa un corral enfermo desatendido. En la interfaz conviene *"sin señales de problema"*, no *"curado"*.
4. **Sin registro veterinario, las etiquetas del semáforo son lo único que hay.** Vale la pena protegerlas: son el activo más caro del proyecto.
