// =============================================================================
// BRIVEX BIO-ALERT — Nodo BIO-ACOUSTIC-BREATH (Módulo Respiratorio)
// Fase: Dataset Builder — recolección de datos respiratorios
// Plataforma: ESP32-S3 | Framework: Arduino + FreeRTOS | PlatformIO
// =============================================================================
//
// Mismo hardware que el nodo Health (ESP32-S3 + INMP441 + SD), distinta
// misión: donde Health escucha chillidos de aplastamiento en maternidad,
// Breath escucha la RESPIRACIÓN de un corral de destete o engorde.
//
// -----------------------------------------------------------------------------
// POR QUÉ ESTE FIRMWARE NO ES "HEALTH CON OTRA BANDA"
// -----------------------------------------------------------------------------
// Las tres clases objetivo son acústicamente opuestas entre sí:
//
//   - Tos              → impulsiva, corta, banda ancha    (sí la ve un onset)
//   - Grasnido         → SOSTENIDA, tonal, energía baja   (el onset la RECHAZA)
//   - Dificultad resp. → ritmo y esfuerzo en ventanas largas (invisible al RMS)
//
// El trigger de Health exige un onset brusco justamente para descartar sonidos
// sostenidos ("anti-música"). Ese mismo criterio descarta el grasnido. Por eso
// aquí el instrumento principal NO es el trigger, sino el LOG DE FEATURES por
// ventana larga, que se escribe SIEMPRE, dispare o no dispare algo.
//
// -----------------------------------------------------------------------------
// EL ÍNDICE RESPIRATORIO TODAVÍA NO EXISTE — Y ES DELIBERADO
// -----------------------------------------------------------------------------
// No se puede validar una fórmula de índice antes de tener datos etiquetados.
// Definirla ahora sería hornear una suposición dentro de meses de recolección.
//
// En esta fase el índice es un INSTRUMENTO DE INVESTIGACIÓN, no un diagnóstico:
// registramos un conjunto fijo de features baratas por ventana y dejamos que
// las etiquetas clínicas (semáforo) digan después qué combinación predice.
//
// -----------------------------------------------------------------------------
// POLÍTICA DE GRABACIÓN EN TRES NIVELES
// -----------------------------------------------------------------------------
//   1. CENTINELA — 30 s cada 3 min, pase lo que pase. Es la clase negativa y
//      lo único que permite calcular tasas reales sin sesgo de trigger.
//   2. TRIGGER   — nivel RMS deliberadamente FLOJO (sin banda, sin onset).
//      Todavía no sabemos cómo suena una tos en este micrófono y este galpón;
//      afinar ahora sería adivinar. Se afina cuando haya audio real.
//   3. EPISODIO  — si llegan N triggers en poco tiempo, se promueve a grabación
//      continua por chunks. Una respiración anómala dura minutos u horas, no 8 s.
//
// -----------------------------------------------------------------------------
// SEMÁFORO EN MODO MANUAL (FASE 1)
// -----------------------------------------------------------------------------
// El semáforo NO lo enciende ningún algoritmo todavía: lo enciende el trabajador.
// Eso genera etiquetas clínicas con desenlace desde el día uno, usando el mismo
// hardware y el mismo flujo que después funcionará en automático. Cero trabajo
// desechable.
//
//   Pulsación corta (< 1 s)   → avanza el ciclo: NORMAL → ALERTA → CUARENTENA
//   Pulsación larga (>= 3 s)  → vuelve a NORMAL (falsa alarma / corrección)
//   Pulsación lote  (>= 7 s)  → nuevo lote: resetea baseline y batch_id
//
// El "nuevo lote" no es opcional: destete y engorde son todo-dentro/todo-fuera.
// Un baseline aprendido con el lote N no significa nada para el lote N+1.
//
// -----------------------------------------------------------------------------
// ARQUITECTURA
// -----------------------------------------------------------------------------
//   Core 0 → Captura I2S ininterrumpida → Ring Buffer + Pre-roll (2 s)
//   Core 1 → Análisis por bloque → acumuladores de ventana → CSV + grabación
//
// Las features de ventana larga se calculan con ACUMULADORES INCREMENTALES
// sobre los bloques de 1024 muestras que ya fluyen por Core 1. Bufferizar 60 s
// de audio costaría ~1,9 MB y no cabe: Health ya usa el 67,9% de la RAM interna.
//
// Dos estados ORTOGONALES:
//   deviceState   → salud del aparato   (MONITORING, ERROR, SD_FULL, PAUSED...)
//   clinicalState → salud del corral    (NORMAL, ALERTA, CUARENTENA)
// Un nodo puede estar SD_FULL mientras el corral está en CUARENTENA. Meterlos
// en un solo enum duele después.
//
// Sin RTC ni WiFi en esta fase: los datos salen por la tarjeta SD y el tiempo
// se registra como uptime + boot_id, que el backend alinea al sincronizar.
// =============================================================================

// --- C++ Standard Library ---
#include <cstddef>
#include <cstdint>

// --- Arduino Core ---
#include <Arduino.h>

// --- FreeRTOS (FreeRTOS.h DEBE ir primero para definir tipos base) ---
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

// --- ESP-IDF Drivers ---
#include <driver/i2s.h>
#include <esp_mac.h>

// --- Bibliotecas de terceros ---
#include <Preferences.h>
#include <SD.h>
#include <SPI.h>
#include <arduinoFFT.h>

// =============================================================================
// DEFINICIÓN DE PINES
// =============================================================================

// --- Micrófono I2S (INMP441) ---
#define I2S_WS 15
#define I2S_SCK 16
#define I2S_SD 17
#define I2S_PORT I2S_NUM_0

// --- Micro SD (SPI) ---
#define SD_CS 10
#define SPI_MOSI 11
#define SPI_SCK_PIN 12
#define SPI_MISO 13

// --- Semáforo (LEDs) ---
// En banco son los LEDs de la placa. En campo, estos mismos pines alimentan
// el semáforo externo del corral a través de un driver (ver notas de hardware).
#define GREEN_LED 4
#define YELLOW_LED 5
#define RED_LED 6

// --- Botón del semáforo ---
// En banco es el pulsador de la placa. En campo, un botón industrial sellado
// en paralelo: lo pulsan con guantes sucios y su pulsación es un EVENTO CLÍNICO.
#define BTN_CLINICAL 7

// --- Flag de compilación: permite probar la lógica sin tarjeta SD ---
#define USE_SD_CARD true

// =============================================================================
// CONFIGURACIÓN DE AUDIO
// =============================================================================

static const uint32_t SAMPLE_RATE = 16000; // Hz
static const uint16_t BITS_PER_SAMPLE = 16;
static const uint8_t NUM_CHANNELS = 1; // Mono

// NOTA: no bajar el sample rate para ahorrar espacio. Si Breath y Health graban
// a tasas distintas, sus datasets no se pueden juntar y se pierde la clase
// negativa compartida, que es el activo más caro de construir.

// Ring buffer principal: 2 s de audio
static const size_t RING_BUF_SAMPLES = 32000;
static const size_t PREROLL_SAMPLES = RING_BUF_SAMPLES; // 2 s de pre-roll

// Muestras por lectura I2S
static const size_t I2S_READ_SAMPLES = 512;

// El INMP441 entrega 24 bits alineados en 32; desplazamos para bajar a 16.
static const uint8_t I2S_SHIFT = 14;

// DC blocker IIR: R en formato Q10 (1024 = 1.0)
static const int32_t HPF_R_Q10 = 1019;

// FFT — base de todas las features espectrales
static const uint16_t FFT_SAMPLES = 1024; // Debe ser potencia de 2
static const uint16_t BLOCK_SAMPLES = FFT_SAMPLES;

// =============================================================================
// CONFIGURACIÓN DE LA VENTANA DE FEATURES
// =============================================================================
//
// Cada ventana produce UNA fila en /features.csv. Se escribe siempre, haya o no
// grabación. Es el instrumento de investigación del que saldrá el índice.
//
// ~20 floats por ventana ≈ 80 bytes. A una ventana por minuto son ~115 KB/día,
// frente a ~460 MB/día de audio. El stream de features sincroniza sobre
// cualquier conexión; el audio se queda en SD y sube cuando puede.
// =============================================================================

static const uint32_t FEATURE_WINDOW_MS = 60000; // 60 s por ventana

// Histograma de RMS para percentiles (log2-espaciado, 2 bins por octava)
static const uint8_t RMS_HIST_BINS = 32;

// Bandas de energía espectral (Hz). Fijas y documentadas: cambiarlas invalida
// la comparabilidad de todo lo recolectado antes.
static const uint8_t NUM_BANDS = 4;
static const float BAND_EDGES_HZ[NUM_BANDS + 1] = {0.0f, 500.0f, 2000.0f,
                                                   5000.0f, 8000.0f};

// Histograma grueso de frecuencia pico de los impulsos detectados
static const uint8_t IMP_FREQ_BINS = 4;

// =============================================================================
// ANÁLISIS DE MODULACIÓN — respiración dificultosa
// =============================================================================
//
// La tos se detecta por nivel. La respiración dificultosa NO: es de amplitud
// baja y lo que la delata es el RITMO, no la energía. Un cerdo en reposo
// respira a ~15-25 rpm; uno con disnea llega a 40-80 rpm.
//
// Cada respiración es un soplo ancho y suave. Lo que se busca no es el soplo
// sino su PERIODICIDAD: una modulación de la envolvente de amplitud en la banda
// de 0,2-2 Hz. Eso no aparece en el RMS ni en el espectro de audio — hace falta
// un segundo análisis sobre la ENVOLVENTE.
//
// Método: se guarda un RMS por bloque (uno cada 64 ms → 15,6 Hz de muestreo),
// y una vez por ventana se le aplica una FFT. Un pico en la banda respiratoria
// da la frecuencia y la fuerza del ritmo. Coste: una FFT de 512 puntos por
// minuto, despreciable.
//
// LIMITACIÓN CONOCIDA: en un corral con 30 animales se superponen 30 ritmos y
// la periodicidad se emborrona. Funcionará mejor en periodos tranquilos y con
// pocos animales cerca del micrófono. Que sirva o no es una pregunta empírica
// — que es exactamente el motivo de registrarlo desde ya.
// =============================================================================

static const uint16_t ENV_FFT_SIZE = 512; // 512 × 64 ms ≈ 32,8 s de envolvente
static const float MOD_FREQ_MIN_HZ = 0.2f; // 12 respiraciones/min
static const float MOD_FREQ_MAX_HZ = 2.0f; // 120 respiraciones/min

// =============================================================================
// FACTOR DE CRESTA — respiración húmeda (estertores)
// =============================================================================
//
// Los estertores son micro-transitorios explosivos de menos de 20 ms y amplitud
// baja. Un bloque de 1024 muestras (64 ms) los promedia hasta hacerlos
// desaparecer del RMS: por eso la respiración húmeda es invisible a todo lo que
// se midió hasta ahora.
//
// El factor de cresta (pico / RMS) sí los ve: un soplo suave y ruidoso da un
// valor bajo (~3-4), mientras que los estertores producen picos altos sobre un
// fondo de energía baja. Se calcula en el mismo recorrido que ya hace el RMS,
// así que sale gratis.
// =============================================================================

// (sin constantes: el factor de cresta se registra crudo, sin umbral, porque
//  todavía no hay datos con los que fijar uno)

// Fracción de energía acumulada que define el rolloff espectral
static const float ROLLOFF_FRACTION = 0.85f;

// =============================================================================
// POLÍTICA DE GRABACIÓN — TRES NIVELES
// =============================================================================

// --- Nivel 1: CENTINELA (muestreo ciego, sin sesgo de trigger) ---
static const uint32_t SENTINEL_INTERVAL_MS = 180000; // cada 3 min
static const uint32_t SENTINEL_SECONDS = 30;         // 30 s por captura
// 30 s cada 180 s = 16,7% de duty cycle ≈ 460 MB/día ≈ 69 días en una SD de 32 GB

// Intervalo reducido durante periodos tranquilos. La respiración dificultosa y
// la húmeda son de amplitud baja: solo son audibles cuando el corral calla. De
// noche los animales están quietos, la ventilación baja y están amontonados, y
// ahí la relación señal-ruido mejora muchísimo. Sin RTC no sabemos la hora,
// pero el propio nivel de fondo delata el periodo tranquilo.
static const uint32_t SENTINEL_INTERVAL_QUIET_MS = 60000; // cada 1 min
static const float QUIET_REF_ALPHA = 0.02f; // relajación de las referencias
static const float QUIET_FRACTION = 0.30f;  // umbral sobre el rango del día

// --- Nivel 2: TRIGGER (deliberadamente flojo) ---
// Sin filtro de banda y sin onset: ambos criterios de Health descartarían el
// grasnido. Aquí solo pedimos nivel. Se afina cuando haya audio real.
static const float THRESHOLD_RMS = 400.0f; // piso absoluto
static const float RMS_FACTOR = 2.0f;      // multiplicador sobre baseline
static const float BASELINE_ALPHA = 0.02f; // suavizado exponencial

static const uint32_t TRIGGER_PREROLL_SECONDS = 2;
static const uint32_t TRIGGER_LIVE_SECONDS = 8;
static const uint32_t TRIGGER_TOTAL_SECONDS =
    TRIGGER_PREROLL_SECONDS + TRIGGER_LIVE_SECONDS;

// --- Nivel 3: EPISODIO (latch) ---
// Si llegan EPISODE_TRIGGER_COUNT triggers dentro de EPISODE_WINDOW_MS, se
// promueve a grabación continua por chunks. Un problema respiratorio da minutos
// u horas de sonido; 8 s no lo capturan.
//
// El episodio se graba como SECUENCIA DE CHUNKS de tamaño fijo, no como un WAV
// gigante: un corte de luz pierde un chunk, no el episodio entero, y no hace
// falta parchear la cabecera RIFF al cerrar.
//
// Entre chunks hay una ventana corta de análisis (EPISODE_EVAL_MS) para decidir
// si el episodio continúa. Eso deja un hueco de audio entre chunks: es una
// limitación conocida y aceptada de esta versión, y queda registrada en el CSV.
static const uint8_t EPISODE_TRIGGER_COUNT = 3;
static const uint32_t EPISODE_WINDOW_MS = 60000;    // 3 triggers en 60 s

// SEGUNDA VÍA AL EPISODIO — sin ella, un corral con disnea severa y cero toses
// nunca grabaría audio largo, que es justo el caso que más lo necesita.
// Se dispara por ritmo respiratorio marcado y sostenido, no por impulsos.
//
// UMBRAL PROVISIONAL: sin datos no hay forma de fijarlo con fundamento. Se
// elige alto a propósito — es preferible perder episodios que llenar la SD de
// falsos. Se recalibra en cuanto haya semanas de features.csv reales.
static const float MOD_STRENGTH_EPISODE = 6.0f;
static const uint8_t MOD_SUSTAINED_WINDOWS = 3; // 3 ventanas seguidas ≈ 3 min

// Un episodio por ritmo no genera impulsos, así que el timeout por inactividad
// lo cerraría tras el primer chunk. Se le garantiza un mínimo de audio continuo.
static const uint8_t MOD_EPISODE_MIN_CHUNKS = 5; // ≈ 5 min
static const uint32_t EPISODE_CHUNK_SECONDS = 60;   // 1 min por chunk
static const uint32_t EPISODE_EVAL_MS = 10000;      // análisis entre chunks
static const uint32_t EPISODE_IDLE_TIMEOUT_MS = 120000; // 2 min sin triggers
static const uint32_t EPISODE_MAX_MS = 1800000;     // tope duro: 30 min

// --- Escritura a SD ---
static const size_t SD_WRITE_BUF = 4096; // 4 KB por escritura

// =============================================================================
// CONFIGURACIÓN CLÍNICA (SEMÁFORO)
// =============================================================================

// Duración de la ventana de cuarentena tras aplicar tratamiento.
// 48 h es el plazo en que un antibiótico respiratorio debería mostrar respuesta.
static const uint32_t QUARANTINE_DURATION_MS = 172800000UL; // 48 h

// Sin RTC, el tiempo de cuarentena se acumula en uptime y se persiste cada
// NVS_SAVE_INTERVAL_MS. Un reinicio pierde como mucho ese intervalo de conteo.
static const uint32_t NVS_SAVE_INTERVAL_MS = 300000; // 5 min

// =============================================================================
// TEMPORIZADORES OPERATIVOS
// =============================================================================

static const uint32_t WARMUP_MS = 10000;          // 10 s tras boot
static const uint32_t TRIGGER_COOLDOWN_MS = 3000; // tras cada grabación

// Cooldown corto a propósito: un cooldown largo suprimiría el conteo de
// triggers y el latch de episodio nunca llegaría a dispararse.

static const uint64_t SD_FULL_THRESHOLD_BYTES = 50ULL * 1024 * 1024; // 50 MB
static const uint32_t SD_CHECK_INTERVAL_MS = 30000;                  // cada 30 s

// =============================================================================
// SEMÁFORO Y BOTÓN
// =============================================================================

static const uint8_t LED_BRILLO = 127; // PWM 50%

static const uint32_t BTN_DEBOUNCE_MS = 50;
static const uint32_t BTN_SHORT_MAX_MS = 1000;  // avanza ciclo clínico
static const uint32_t BTN_LONG_PRESS_MS = 3000; // vuelve a NORMAL
static const uint32_t BTN_BATCH_PRESS_MS = 7000; // nuevo lote

// =============================================================================
// MÁQUINA DE ESTADOS — DOS DIMENSIONES ORTOGONALES
// =============================================================================

// Estado del APARATO: ¿está el nodo en condiciones de escuchar?
typedef enum {
  DEV_MONITORING, // Operación normal
  DEV_RECORDING,  // Grabando audio a SD
  DEV_ERROR,      // Fallo crítico
  DEV_SD_FULL,    // SD sin espacio
  DEV_PAUSED      // Safe Eject — SD desmontada
} DeviceState_t;

// Estado del CORRAL: lo que ve el trabajador en el semáforo.
typedef enum {
  CLIN_NORMAL = 0,    // Verde  — sin señales de problema
  CLIN_ALERT = 1,     // Rojo   — hay que tomar medidas en este corral
  CLIN_QUARANTINE = 2 // Amarillo — tratado, en observación
} ClinicalState_t;

// Nivel de grabación que originó un WAV (queda en el nombre y en el CSV)
typedef enum { REC_SENTINEL, REC_TRIGGER, REC_EPISODE } RecTier_t;

// =============================================================================
// VARIABLES GLOBALES
// =============================================================================

volatile DeviceState_t deviceState = DEV_MONITORING;
volatile ClinicalState_t clinicalState = CLIN_NORMAL;

// Cede el control del semáforo a buttonTask mientras da realimentación de un
// gesto. Sin esto ledTask, que refresca a 20 Hz, pisaría el parpadeo de
// confirmación y el trabajador no vería nada al mantener pulsado.
static volatile bool ledOverride = false;

// Ring Buffer
static int16_t ringBuffer[RING_BUF_SAMPLES];
static volatile size_t rbWriteIdx = 0;
static volatile size_t rbReadIdx = 0;
static SemaphoreHandle_t rbMutex = NULL;

// Snapshot del pre-roll: se copia bajo mutex al inicio de cada grabación
// para evitar que Core 0 sobrescriba los samples mientras los escribimos a SD.
static int16_t prerollSnapshot[PREROLL_SAMPLES];

// Pre-roll Buffer dedicado: sliding window de los últimos 2 s de audio.
// Lo alimenta audioCaptureTask en paralelo al ring buffer y NUNCA se drena.
static int16_t prerollBuffer[PREROLL_SAMPLES];
static volatile size_t prerollWriteIdx = 0;
static SemaphoreHandle_t prerollMutex = NULL;

// Contadores
static uint32_t recCounter = 0;    // WAVs grabados
static uint32_t windowCounter = 0; // ventanas de features escritas

// Baseline rodante de RMS (ruido de fondo del corral)
static float rmsBaseline = 0.0f;
static bool baselineInitialized = false;

// Timers
static uint32_t bootTimeMs = 0;
static uint32_t lastSentinelMs = 0;
static uint32_t lastRecordingEndMs = 0;

// Persistencia NVS
static Preferences prefs;
static uint32_t bootId = 0;
static uint32_t batchId = 1;
static uint32_t quarantineElapsedMs = 0; // acumulado, sobrevive a reinicios
static uint32_t quarantineTickMs = 0;    // referencia de conteo en este boot

// Handles de tareas
static TaskHandle_t captureTaskHandle = NULL;
static TaskHandle_t analysisTaskHandle = NULL;
static TaskHandle_t ledTaskHandle = NULL;
static TaskHandle_t buttonTaskHandle = NULL;

// Buffers de FFT
static float vReal[FFT_SAMPLES];
static float vImag[FFT_SAMPLES];

static ArduinoFFT<float> FFT =
    ArduinoFFT<float>(vReal, vImag, FFT_SAMPLES, SAMPLE_RATE);

// =============================================================================
// ACUMULADORES DE VENTANA — el instrumento de investigación
// =============================================================================
//
// Todo se acumula por BLOQUE (1024 muestras ≈ 64 ms), nunca guardando audio.
// Una ventana de 60 s son ~937 bloques y el coste en RAM es de unos 200 bytes.
// =============================================================================

typedef struct {
  uint32_t blocks;

  // Nivel
  double rmsSum;
  double rmsSumSq;
  float rmsMax;
  uint32_t rmsHist[RMS_HIST_BINS];

  // Espectral — se acumula también la suma de cuadrados porque el contenido
  // diagnóstico suele estar en la VARIABILIDAD, no en la media. Un corral con
  // respiración húmeda irregular y otro con ruido estable pueden tener la misma
  // flatness media y desviaciones muy distintas.
  double centroidSum;
  double centroidSumSq;
  double flatnessSum;
  double flatnessSumSq;
  double rolloffSum;
  double bandSum[NUM_BANDS];

  // Impulsivo (tos)
  uint32_t impulseCount;
  uint32_t impulseFreqHist[IMP_FREQ_BINS];

  // Factor de cresta (respiración húmeda / estertores)
  double crestSum;
  float crestMax;
} WindowAccum_t;

static WindowAccum_t win;
static uint32_t windowStartMs = 0;

// --- Envolvente de amplitud: un RMS por bloque, para el análisis de ritmo ---
// Buffer circular que siempre contiene los últimos ENV_FFT_SIZE bloques
// (~32,8 s). Se llena continuamente y se analiza una vez por ventana.
static float envBuf[ENV_FFT_SIZE];
static uint16_t envIdx = 0;
static uint32_t envFilled = 0;

// Buffers de la FFT de envolvente. Separados de vReal/vImag a propósito: esos
// se usan para el audio en el mismo bucle y reutilizarlos sería un bug sutil.
static float envReal[ENV_FFT_SIZE];
static float envImag[ENV_FFT_SIZE];

static ArduinoFFT<float> ENV_FFT = ArduinoFFT<float>(
    envReal, envImag, ENV_FFT_SIZE, 1000.0f / 64.0f); // ~15,6 Hz

// Resultado del último análisis de modulación (se escribe en features.csv)
static float lastBreathRateBpm = 0.0f;
static float lastModStrength = 0.0f;
static float lastModFreqHz = 0.0f;

// Ventanas consecutivas con ritmo respiratorio marcado — segunda vía al episodio
static uint8_t modSustainedCount = 0;

// Referencias lentas del nivel de fondo, para detectar el periodo tranquilo
static float baselineQuietRef = 0.0f;
static float baselineLoudRef = 0.0f;
static volatile bool isQuietPeriod = false;

/**
 * @brief Analiza la envolvente de amplitud buscando periodicidad respiratoria.
 *
 * Resta la media (si no, el bin DC domina y tapa todo), aplica FFT y busca el
 * pico dominante dentro de la banda respiratoria. La "fuerza" es la razón entre
 * ese pico y la media del espectro de modulación: alta significa que hay un
 * ritmo claro, baja que solo hay ruido sin estructura.
 *
 * @param outRateBpm   Frecuencia del pico convertida a respiraciones/min.
 * @param outStrength  Cuán marcado es el ritmo (pico / media).
 * @param outFreqHz    Frecuencia del pico en Hz.
 */
static void analyzeModulation(float *outRateBpm, float *outStrength,
                              float *outFreqHz) {
  *outRateBpm = 0.0f;
  *outStrength = 0.0f;
  *outFreqHz = 0.0f;

  if (envFilled < ENV_FFT_SIZE)
    return; // aún no hay 32,8 s de envolvente

  // Copiar en orden cronológico desde el índice de escritura (el más antiguo)
  float mean = 0.0f;
  for (uint16_t i = 0; i < ENV_FFT_SIZE; i++) {
    envReal[i] = envBuf[(envIdx + i) % ENV_FFT_SIZE];
    envImag[i] = 0.0f;
    mean += envReal[i];
  }
  mean /= (float)ENV_FFT_SIZE;

  // Quitar la componente continua: sin esto el bin 0 domina el espectro
  for (uint16_t i = 0; i < ENV_FFT_SIZE; i++) {
    envReal[i] -= mean;
  }

  ENV_FFT.windowing(FFTWindow::Hamming, FFTDirection::Forward);
  ENV_FFT.compute(FFTDirection::Forward);
  ENV_FFT.complexToMagnitude();

  const float envSampleRate = 1000.0f / 64.0f; // un bloque cada ~64 ms
  const float envBinHz = envSampleRate / (float)ENV_FFT_SIZE;

  uint16_t binMin = (uint16_t)(MOD_FREQ_MIN_HZ / envBinHz);
  uint16_t binMax = (uint16_t)(MOD_FREQ_MAX_HZ / envBinHz);
  if (binMin < 1)
    binMin = 1;
  if (binMax >= ENV_FFT_SIZE / 2)
    binMax = ENV_FFT_SIZE / 2 - 1;

  float peakMag = 0.0f;
  uint16_t peakBin = binMin;
  float sumMag = 0.0f;
  uint16_t nBins = 0;

  for (uint16_t i = binMin; i <= binMax; i++) {
    sumMag += envReal[i];
    nBins++;
    if (envReal[i] > peakMag) {
      peakMag = envReal[i];
      peakBin = i;
    }
  }

  if (nBins == 0 || sumMag <= 0.0f)
    return;

  float meanMag = sumMag / (float)nBins;
  *outFreqHz = (float)peakBin * envBinHz;
  *outRateBpm = *outFreqHz * 60.0f;
  *outStrength = (meanMag > 0.0f) ? (peakMag / meanMag) : 0.0f;
}

/**
 * @brief Deja los acumuladores de ventana en cero.
 */
static void winReset() {
  memset(&win, 0, sizeof(win));
  windowStartMs = millis();
}

/**
 * @brief Mapea un RMS a su bin del histograma (log2, 2 bins por octava).
 *        Un histograma log cubre el rango dinámico del corral sin gastar
 *        memoria en guardar la serie completa.
 */
static uint8_t rmsHistBin(float rms) {
  if (rms < 1.0f)
    return 0;
  int b = (int)(log2f(rms) * 2.0f);
  if (b < 0)
    b = 0;
  if (b >= RMS_HIST_BINS)
    b = RMS_HIST_BINS - 1;
  return (uint8_t)b;
}

/**
 * @brief Percentil aproximado a partir del histograma log2.
 * @param p Fracción acumulada buscada (0.5 = mediana, 0.9 = p90).
 * @return RMS reconstruido desde el centro del bin correspondiente.
 */
static float rmsHistPercentile(const uint32_t *hist, uint32_t total, float p) {
  if (total == 0)
    return 0.0f;
  uint32_t target = (uint32_t)(total * p);
  uint32_t acc = 0;
  for (uint8_t i = 0; i < RMS_HIST_BINS; i++) {
    acc += hist[i];
    if (acc >= target) {
      return powf(2.0f, ((float)i + 0.5f) / 2.0f);
    }
  }
  return powf(2.0f, ((float)(RMS_HIST_BINS - 1) + 0.5f) / 2.0f);
}

// =============================================================================
// RING BUFFER — Operaciones Thread-Safe
// =============================================================================

/**
 * @brief Retorna cuántas muestras hay disponibles para leer en el ring buffer.
 */
static size_t rb_available() {
  size_t w = rbWriteIdx;
  size_t r = rbReadIdx;
  if (w >= r)
    return w - r;
  return RING_BUF_SAMPLES - r + w;
}

/**
 * @brief Escribe un bloque de muestras al ring buffer (llamado desde Core 0).
 *        Si el buffer está lleno, las muestras más viejas se sobrescriben.
 */
static void rb_write(const int16_t *data, size_t count) {
  xSemaphoreTake(rbMutex, portMAX_DELAY);
  for (size_t i = 0; i < count; i++) {
    ringBuffer[rbWriteIdx] = data[i];
    rbWriteIdx = (rbWriteIdx + 1) % RING_BUF_SAMPLES;
    if (rbWriteIdx == rbReadIdx) {
      rbReadIdx = (rbReadIdx + 1) % RING_BUF_SAMPLES;
    }
  }
  xSemaphoreGive(rbMutex);
}

/**
 * @brief Lee un bloque de muestras del ring buffer (llamado desde Core 1).
 * @return Número de muestras realmente leídas.
 */
static size_t rb_read(int16_t *dest, size_t count) {
  xSemaphoreTake(rbMutex, portMAX_DELAY);
  size_t avail = rb_available();
  size_t toRead = (count < avail) ? count : avail;
  for (size_t i = 0; i < toRead; i++) {
    dest[i] = ringBuffer[rbReadIdx];
    rbReadIdx = (rbReadIdx + 1) % RING_BUF_SAMPLES;
  }
  xSemaphoreGive(rbMutex);
  return toRead;
}

// =============================================================================
// PRE-ROLL BUFFER — sliding window de los últimos 2 s (nunca se drena)
// =============================================================================

/**
 * @brief Escribe muestras al buffer dedicado de pre-roll, sobrescribiendo
 *        circularmente. Llamado desde audioCaptureTask en paralelo a rb_write.
 */
static void preroll_write(const int16_t *data, size_t count) {
  xSemaphoreTake(prerollMutex, portMAX_DELAY);
  for (size_t i = 0; i < count; i++) {
    prerollBuffer[prerollWriteIdx] = data[i];
    prerollWriteIdx = (prerollWriteIdx + 1) % PREROLL_SAMPLES;
  }
  xSemaphoreGive(prerollMutex);
}

/**
 * @brief Copia los últimos PREROLL_SAMPLES en orden cronológico al destino.
 *        La posición de escritura actual es, en un buffer circular lleno,
 *        justo la muestra más antigua.
 */
static void preroll_snapshot(int16_t *dest) {
  xSemaphoreTake(prerollMutex, portMAX_DELAY);
  size_t startIdx = prerollWriteIdx;
  for (size_t i = 0; i < PREROLL_SAMPLES; i++) {
    dest[i] = prerollBuffer[(startIdx + i) % PREROLL_SAMPLES];
  }
  xSemaphoreGive(prerollMutex);
}

// =============================================================================
// INICIALIZACIÓN DE HARDWARE
// =============================================================================

/**
 * @brief Configura y arranca el driver I2S para el INMP441.
 */
static bool initI2S() {
  Serial.println("[...] Inicializando I2S (INMP441)...");

  i2s_config_t i2s_config = {.mode =
                                 (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
                             .sample_rate = SAMPLE_RATE,
                             .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
                             .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
                             .communication_format = I2S_COMM_FORMAT_STAND_I2S,
                             .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
                             .dma_buf_count = 8,
                             .dma_buf_len = 1024,
                             .use_apll = false,
                             .tx_desc_auto_clear = false,
                             .fixed_mclk = 0};

  i2s_pin_config_t pin_config = {.bck_io_num = I2S_SCK,
                                 .ws_io_num = I2S_WS,
                                 .data_out_num = I2S_PIN_NO_CHANGE,
                                 .data_in_num = I2S_SD};

  esp_err_t err = i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  if (err != ESP_OK) {
    Serial.printf("[ERROR] i2s_driver_install falló: %d\n", err);
    return false;
  }

  err = i2s_set_pin(I2S_PORT, &pin_config);
  if (err != ESP_OK) {
    Serial.printf("[ERROR] i2s_set_pin falló: %d\n", err);
    return false;
  }

  Serial.println("[OK] I2S configurado (32-bit→16-bit, 16kHz, mono).");
  return true;
}

/**
 * @brief Inicializa la Micro SD por SPI con pines personalizados.
 */
static bool initSD() {
  Serial.println("[...] Inicializando Micro SD...");

  SPI.begin(SPI_SCK_PIN, SPI_MISO, SPI_MOSI, SD_CS);

  if (!SD.begin(SD_CS, SPI)) {
    Serial.println("[ERROR] No se pudo montar la SD.");
    Serial.println("        Verifica inserción, formato FAT32 y cableado SPI.");
    return false;
  }

  uint8_t cardType = SD.cardType();
  if (cardType == CARD_NONE) {
    Serial.println("[ERROR] Sin tarjeta SD detectada.");
    return false;
  }

  Serial.printf("[OK] SD montada. Tipo: %s | Tamaño: %llu MB\n",
                (cardType == CARD_MMC)    ? "MMC"
                : (cardType == CARD_SD)   ? "SDSC"
                : (cardType == CARD_SDHC) ? "SDHC"
                                          : "?",
                SD.cardSize() / (1024 * 1024));

  return true;
}

/**
 * @brief Inicializa los 3 pines del semáforo como salida y los apaga.
 */
static void initLEDs() {
  pinMode(GREEN_LED, OUTPUT);
  pinMode(YELLOW_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  analogWrite(GREEN_LED, 0);
  analogWrite(YELLOW_LED, 0);
  analogWrite(RED_LED, 0);
  Serial.println("[OK] Semáforo inicializado.");
}

/**
 * @brief Inicializa el botón clínico con pull-up interno.
 */
static void initButton() {
  pinMode(BTN_CLINICAL, INPUT_PULLUP);
  Serial.println("[OK] Botón clínico inicializado (INPUT_PULLUP).");
}

// =============================================================================
// PERSISTENCIA NVS — el estado clínico debe sobrevivir a un corte de luz
// =============================================================================
//
// Una cuarentena de 48 h no puede perderse porque se fue la corriente. Sin RTC
// solo podemos contar uptime, así que persistimos el acumulado periódicamente:
// un reinicio pierde como mucho NVS_SAVE_INTERVAL_MS de conteo.
// =============================================================================

/**
 * @brief Carga estado clínico, lote y cuarentena desde NVS. Incrementa bootId.
 */
static void loadClinicalState() {
  prefs.begin("breath", false);

  bootId = prefs.getUInt("bootId", 0) + 1;
  prefs.putUInt("bootId", bootId);

  batchId = prefs.getUInt("batchId", 1);
  clinicalState = (ClinicalState_t)prefs.getUChar("clinical", CLIN_NORMAL);
  quarantineElapsedMs = prefs.getUInt("qElapsed", 0);

  quarantineTickMs = millis();

  Serial.printf("[NVS] Boot #%lu | Lote #%lu | Clínico: %s",
                (unsigned long)bootId, (unsigned long)batchId,
                (clinicalState == CLIN_NORMAL)   ? "NORMAL"
                : (clinicalState == CLIN_ALERT)  ? "ALERTA"
                                                 : "CUARENTENA");
  if (clinicalState == CLIN_QUARANTINE) {
    Serial.printf(" (%lu h acumuladas)",
                  (unsigned long)(quarantineElapsedMs / 3600000UL));
  }
  Serial.println();
}

/**
 * @brief Vuelca estado clínico, lote y cuarentena a NVS.
 */
static void saveClinicalState() {
  prefs.putUChar("clinical", (uint8_t)clinicalState);
  prefs.putUInt("batchId", batchId);
  prefs.putUInt("qElapsed", quarantineElapsedMs);
}

// =============================================================================
// UTILIDADES — MAC Address
// =============================================================================

/**
 * @brief Obtiene la dirección MAC del chip como string "AA:BB:CC:DD:EE:FF".
 */
static String getMACAddress() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X", mac[0],
           mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(macStr);
}

/**
 * @brief Etiqueta corta del estado clínico, para nombres de archivo y CSV.
 */
static const char *clinicalTag(ClinicalState_t s) {
  switch (s) {
  case CLIN_ALERT:
    return "A";
  case CLIN_QUARANTINE:
    return "Q";
  default:
    return "N";
  }
}

// =============================================================================
// GRABACIÓN WAV
// =============================================================================

/**
 * @brief Escribe la cabecera WAV (RIFF) de 44 bytes en el archivo.
 * @param file Referencia al objeto File de la SD.
 * @param dataSize Tamaño total de los datos PCM en bytes.
 */
static void writeWavHeader(File &file, uint32_t dataSize) {
  uint32_t totalFileSize = dataSize + 44 - 8;
  uint32_t byteRate = SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  uint16_t blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);

  file.write((const uint8_t *)"RIFF", 4);
  file.write((const uint8_t *)&totalFileSize, 4);
  file.write((const uint8_t *)"WAVE", 4);
  file.write((const uint8_t *)"fmt ", 4);
  uint32_t fmtSize = 16;
  file.write((const uint8_t *)&fmtSize, 4);
  uint16_t audioFormat = 1; // PCM
  file.write((const uint8_t *)&audioFormat, 2);
  uint16_t numChannels = NUM_CHANNELS;
  file.write((const uint8_t *)&numChannels, 2);
  uint32_t sampleRate = SAMPLE_RATE;
  file.write((const uint8_t *)&sampleRate, 4);
  file.write((const uint8_t *)&byteRate, 4);
  file.write((const uint8_t *)&blockAlign, 2);
  uint16_t bitsPerSample = BITS_PER_SAMPLE;
  file.write((const uint8_t *)&bitsPerSample, 2);
  file.write((const uint8_t *)"data", 4);
  file.write((const uint8_t *)&dataSize, 4);
}

/**
 * @brief Indica si la SD tiene menos de SD_FULL_THRESHOLD_BYTES libres.
 */
static bool isSDFull() {
#if USE_SD_CARD
  uint64_t total = SD.totalBytes();
  uint64_t used = SD.usedBytes();
  if (total <= used)
    return true;
  return (total - used) < SD_FULL_THRESHOLD_BYTES;
#else
  return false;
#endif
}

/**
 * @brief Graba audio a un WAV de duración fija.
 *
 * Todos los niveles (centinela, trigger, episodio) usan tamaño fijo conocido de
 * antemano, así que la cabecera RIFF se escribe una sola vez y no hace falta
 * parchearla al cerrar. Los episodios largos se trocean en chunks de tamaño fijo
 * en lugar de abrir un WAV gigante: un corte de luz pierde un chunk, no todo.
 *
 * @param totalSeconds Duración total del archivo.
 * @param withPreroll  Si true, los primeros TRIGGER_PREROLL_SECONDS salen del
 *                     buffer de pre-roll (contexto previo al evento).
 * @param filename     Nombre ya construido por el caller, para que coincida
 *                     exactamente con el registrado en el CSV.
 * @return true si se escribieron todos los bytes esperados.
 */
static bool recordWav(uint32_t totalSeconds, bool withPreroll,
                      const char *filename) {
#if USE_SD_CARD
  const uint32_t bytesPerSecond =
      SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  const uint32_t targetBytes = bytesPerSecond * totalSeconds;

  // Last-mile check: si la SD se llenó entre chequeos periódicos, abortar.
  if (isSDFull()) {
    Serial.println("[REC] Abortado: SD sin espacio suficiente.");
    deviceState = DEV_SD_FULL;
    return false;
  }

  File wavFile = SD.open(filename, FILE_WRITE);
  if (!wavFile) {
    Serial.printf("[ERROR] No se pudo crear %s\n", filename);
    return false;
  }

  writeWavHeader(wavFile, targetBytes);

  uint32_t totalBytesWritten = 0;
  const size_t chunkSamples = SD_WRITE_BUF / sizeof(int16_t);
  int16_t sdBuf[SD_WRITE_BUF / sizeof(int16_t)];

  // === FASE 1 (opcional): volcar el pre-roll ===
  if (withPreroll) {
    preroll_snapshot(prerollSnapshot); // copia bajo mutex propio, ~1-2 ms

    size_t prerollOffset = 0;
    while (prerollOffset < PREROLL_SAMPLES) {
      size_t thisChunk = chunkSamples;
      if (prerollOffset + thisChunk > PREROLL_SAMPLES)
        thisChunk = PREROLL_SAMPLES - prerollOffset;

      size_t bytesToWrite = thisChunk * sizeof(int16_t);
      size_t written = wavFile.write(
          (const uint8_t *)&prerollSnapshot[prerollOffset], bytesToWrite);
      totalBytesWritten += written;
      prerollOffset += thisChunk;

      if (written != bytesToWrite) {
        Serial.println("[ERROR] Escritura incompleta (pre-roll).");
        break;
      }
    }
  }

  // === FASE 2: consumir del ring buffer hasta completar la duración ===
  // Se lee del ring buffer en vez de competir con captureTask por el driver
  // I2S: la contención descarta muestras y deja el audio acelerado al
  // reproducirlo. El HPF ya viene aplicado desde captureTask.
  uint32_t liveTarget = targetBytes - totalBytesWritten;
  uint32_t liveWritten = 0;

  while (liveWritten < liveTarget) {
    size_t samplesThisRound = chunkSamples;
    size_t samplesRemaining = (liveTarget - liveWritten) / sizeof(int16_t);
    if (samplesThisRound > samplesRemaining)
      samplesThisRound = samplesRemaining;

    // Timeout defensivo: si captureTask murió, no nos bloqueamos para siempre.
    uint32_t waitStartMs = millis();
    while (rb_available() < samplesThisRound) {
      if (millis() - waitStartMs > 2000) {
        Serial.println("[ERROR] Ring buffer no se llena (¿captureTask OK?).");
        goto live_end;
      }
      vTaskDelay(pdMS_TO_TICKS(20));
    }

    size_t samplesRead = rb_read(sdBuf, samplesThisRound);
    size_t bytesToWriteSD = samplesRead * sizeof(int16_t);
    size_t written = wavFile.write((const uint8_t *)sdBuf, bytesToWriteSD);
    if (written != bytesToWriteSD) {
      Serial.println("[ERROR] Escritura incompleta (live).");
      break;
    }
    liveWritten += written;
    totalBytesWritten += written;
  }
live_end:

  wavFile.close();
  Serial.printf("[REC] %s — %lu bytes\n", filename,
                (unsigned long)totalBytesWritten);

  return (totalBytesWritten >= targetBytes);
#else
  (void)withPreroll;
  Serial.printf("[MOCK] Simulando %s (%lus)...\n", filename,
                (unsigned long)totalSeconds);
  vTaskDelay(pdMS_TO_TICKS(totalSeconds * 1000));
  return true;
#endif
}

// =============================================================================
// CSV — TRES REGISTROS SEPARADOS
// =============================================================================
//
//   /features.csv   → una fila por ventana. SIEMPRE. Es el instrumento.
//   /log_audio.csv  → una fila por WAV grabado.
//   /log_clinico.csv→ una fila por cambio de estado del semáforo.
//
// Separarlos importa: features.csv es denso y regular (apto para análisis
// directo), mientras que los otros dos son dispersos y dirigidos por eventos.
// =============================================================================

/**
 * @brief Escribe una fila de features de ventana en /features.csv (append).
 *        Es la única salida que no depende de que algo dispare.
 */
static void writeFeatureCSV(float rmsMean, float rmsStd, float rmsP50,
                            float rmsP90, float centroidMean, float centroidStd,
                            float flatnessMean, float flatnessStd,
                            float rolloff, const float *bands,
                            const uint32_t *impHist, float crestMean,
                            float crestMax, float breathRateBpm,
                            float modStrength, float modFreqHz) {
#if USE_SD_CARD
  const char *csvPath = "/features.csv";
  bool fileExists = SD.exists(csvPath);

  File csvFile = SD.open(csvPath, FILE_APPEND);
  if (!csvFile) {
    Serial.println("[ERROR] No se pudo abrir/crear features.csv");
    return;
  }

  if (!fileExists) {
    csvFile.println(
        "uptime_ms,boot_id,batch_id,window,clinical,blocks,"
        "rms_mean,rms_std,rms_max,rms_p50,rms_p90,rms_baseline,"
        "centroid_hz,centroid_std,flatness,flatness_std,rolloff_hz,"
        "band0,band1,band2,band3,"
        "impulses,imp_b0,imp_b1,imp_b2,imp_b3,"
        "crest_mean,crest_max,breath_rate_bpm,mod_strength,mod_freq_hz,temp_c");
  }

  csvFile.printf("%lu,%lu,%lu,%lu,%s,%lu,"
                 "%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,"
                 "%.1f,%.1f,%.4f,%.4f,%.1f,"
                 "%.4f,%.4f,%.4f,%.4f,"
                 "%lu,%lu,%lu,%lu,%lu,"
                 "%.2f,%.2f,%.1f,%.2f,%.3f,%.1f\n",
                 (unsigned long)millis(), (unsigned long)bootId,
                 (unsigned long)batchId, (unsigned long)windowCounter,
                 clinicalTag(clinicalState), (unsigned long)win.blocks,
                 rmsMean, rmsStd, win.rmsMax, rmsP50, rmsP90, rmsBaseline,
                 centroidMean, centroidStd, flatnessMean, flatnessStd, rolloff,
                 bands[0], bands[1], bands[2], bands[3],
                 (unsigned long)win.impulseCount, (unsigned long)impHist[0],
                 (unsigned long)impHist[1], (unsigned long)impHist[2],
                 (unsigned long)impHist[3], crestMean, crestMax, breathRateBpm,
                 modStrength, modFreqHz, temperatureRead());

  csvFile.close();
#else
  (void)rmsMean; (void)rmsStd; (void)rmsP50; (void)rmsP90;
  (void)centroidMean; (void)centroidStd; (void)flatnessMean;
  (void)flatnessStd; (void)rolloff; (void)bands; (void)impHist;
  (void)crestMean; (void)crestMax; (void)breathRateBpm;
  (void)modStrength; (void)modFreqHz;
#endif
}

/**
 * @brief Registra un WAV grabado en /log_audio.csv (append).
 */
static void writeAudioCSV(const char *wavFilename, RecTier_t tier,
                          float rmsAtTrigger, uint32_t episodeId,
                          uint16_t episodeSeq) {
#if USE_SD_CARD
  const char *csvPath = "/log_audio.csv";
  bool fileExists = SD.exists(csvPath);

  File csvFile = SD.open(csvPath, FILE_APPEND);
  if (!csvFile) {
    Serial.println("[ERROR] No se pudo abrir/crear log_audio.csv");
    return;
  }

  if (!fileExists) {
    csvFile.println("archivo,tier,uptime_ms,boot_id,batch_id,clinical,"
                    "rec_n,rms,baseline,episode_id,episode_seq,mac");
  }

  csvFile.printf("%s,%s,%lu,%lu,%lu,%s,%lu,%.1f,%.1f,%lu,%u,%s\n",
                 wavFilename,
                 (tier == REC_SENTINEL)  ? "SEN"
                 : (tier == REC_TRIGGER) ? "TRG"
                                         : "EPI",
                 (unsigned long)millis(), (unsigned long)bootId,
                 (unsigned long)batchId, clinicalTag(clinicalState),
                 (unsigned long)recCounter, rmsAtTrigger, rmsBaseline,
                 (unsigned long)episodeId, episodeSeq,
                 getMACAddress().c_str());

  csvFile.close();
#else
  (void)wavFilename; (void)tier; (void)rmsAtTrigger;
  (void)episodeId; (void)episodeSeq;
#endif
}

/**
 * @brief Registra un cambio de estado clínico en /log_clinico.csv (append).
 *        Estas filas son las etiquetas con desenlace: el activo central.
 */
static void writeClinicalCSV(ClinicalState_t from, ClinicalState_t to,
                             const char *reason) {
#if USE_SD_CARD
  const char *csvPath = "/log_clinico.csv";
  bool fileExists = SD.exists(csvPath);

  File csvFile = SD.open(csvPath, FILE_APPEND);
  if (!csvFile) {
    Serial.println("[ERROR] No se pudo abrir/crear log_clinico.csv");
    return;
  }

  if (!fileExists) {
    csvFile.println("uptime_ms,boot_id,batch_id,from,to,reason,"
                    "quarantine_ms,baseline,mac");
  }

  csvFile.printf("%lu,%lu,%lu,%s,%s,%s,%lu,%.1f,%s\n", (unsigned long)millis(),
                 (unsigned long)bootId, (unsigned long)batchId,
                 clinicalTag(from), clinicalTag(to), reason,
                 (unsigned long)quarantineElapsedMs, rmsBaseline,
                 getMACAddress().c_str());

  csvFile.close();
#else
  (void)from; (void)to; (void)reason;
#endif
}

// =============================================================================
// TRANSICIONES CLÍNICAS
// =============================================================================

/**
 * @brief Cambia el estado clínico, lo persiste y lo registra en CSV.
 *        Único punto por el que puede cambiar el semáforo: así ninguna
 *        transición se queda sin etiqueta.
 */
static void setClinicalState(ClinicalState_t to, const char *reason) {
  ClinicalState_t from = clinicalState;
  if (from == to)
    return;

  clinicalState = to;

  // Entrar en cuarentena arranca el reloj; salir lo limpia.
  if (to == CLIN_QUARANTINE) {
    quarantineElapsedMs = 0;
    quarantineTickMs = millis();
  } else {
    quarantineElapsedMs = 0;
  }

  saveClinicalState();
  writeClinicalCSV(from, to, reason);

  Serial.println("============================================");
  Serial.printf(">>> CLÍNICO: %s → %s (%s)\n", clinicalTag(from),
                clinicalTag(to), reason);
  Serial.println("============================================");
}

// =============================================================================
// TAREA: CAPTURA DE AUDIO (Core 0) — Prioridad Alta
// =============================================================================
//
// Lee del I2S en bloques y alimenta ring buffer y pre-roll. Nunca toca la SD ni
// los LEDs. Si el ring buffer se llena, las muestras viejas se sobrescriben.
// =============================================================================

static void audioCaptureTask(void *param) {
  static int32_t readBuf32[I2S_READ_SAMPLES];
  static int16_t readBuf16[I2S_READ_SAMPLES];
  size_t bytesRead = 0;

  Serial.println("[Core 0] Tarea de captura I2S iniciada.");

  for (;;) {
    esp_err_t err = i2s_read(I2S_PORT, readBuf32, sizeof(readBuf32), &bytesRead,
                             portMAX_DELAY);
    if (err == ESP_OK && bytesRead > 0) {
      size_t samplesRead = bytesRead / sizeof(int32_t);

      // DC blocker IIR (estado continuo entre bloques). Sin esto el INMP441
      // leído como 32-bit trae un offset que infla el RMS de "silencio" y
      // satura los primeros bins de la FFT.
      static int32_t hpfPrevX = 0;
      static int32_t hpfPrevY = 0;
      for (size_t i = 0; i < samplesRead; i++) {
        int32_t x = readBuf32[i];
        int64_t y_acc = ((int64_t)hpfPrevY * HPF_R_Q10) >> 10;
        int32_t y = (int32_t)((int64_t)(x - hpfPrevX) + y_acc);
        hpfPrevX = x;
        hpfPrevY = y;
        readBuf16[i] = (int16_t)(y >> I2S_SHIFT);
      }
      rb_write(readBuf16, samplesRead);
      preroll_write(readBuf16, samplesRead);
    }
    taskYIELD();
  }
}

// =============================================================================
// TAREA: ANÁLISIS + FEATURES + GRABACIÓN (Core 1) — Prioridad Media
// =============================================================================
//
// Por cada bloque de 1024 muestras:
//   1. RMS y baseline rodante
//   2. FFT → centroide, flatness, rolloff, energía por banda
//   3. Acumular todo en la ventana (nunca guardando audio)
//   4. Evaluar trigger y política de grabación
//
// Al cerrarse la ventana (60 s) se vuelca una fila a /features.csv.
//
// spectral_flatness merece atención: mide cuán tonal vs ruidoso es el sonido.
// Un grasnido es tonal → flatness baja. El ruido del corral es ancho →
// flatness alta. Es prácticamente el detector natural de la clase que el onset
// de Health rechaza, y sale casi gratis de la FFT que ya calculamos.
// =============================================================================

static void audioAnalysisTask(void *param) {
  int16_t analysisBuf[BLOCK_SAMPLES];

  // Estado del latch de episodio
  static uint32_t triggerTimes[EPISODE_TRIGGER_COUNT] = {0};
  static uint8_t triggerIdx = 0;
  static bool episodeActive = false;
  static bool episodeFromModulation = false;
  static uint32_t episodeId = 0;
  static uint16_t episodeSeq = 0;
  static uint32_t episodeStartMs = 0;
  static uint32_t lastTriggerMs = 0;

  Serial.println("[Core 1] Tarea de análisis + features iniciada.");

  lastSentinelMs = millis();
  winReset();

  // Precalcular los bins de la FFT que delimitan cada banda
  const float binHz = (float)SAMPLE_RATE / (float)FFT_SAMPLES;
  uint16_t bandBin[NUM_BANDS + 1];
  for (uint8_t b = 0; b <= NUM_BANDS; b++) {
    uint16_t bin = (uint16_t)(BAND_EDGES_HZ[b] / binHz);
    if (bin < 1)
      bin = 1;
    if (bin > FFT_SAMPLES / 2)
      bin = FFT_SAMPLES / 2;
    bandBin[b] = bin;
  }

  for (;;) {
    if (rb_available() < BLOCK_SAMPLES) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    size_t got = rb_read(analysisBuf, BLOCK_SAMPLES);
    if (got < BLOCK_SAMPLES) {
      vTaskDelay(pdMS_TO_TICKS(5));
      continue;
    }

    // === 1. RMS y pico del bloque ===
    // El pico se lleva en el mismo recorrido: el factor de cresta (pico/RMS)
    // es lo único que delata los estertores de la respiración húmeda, que un
    // RMS de 64 ms promedia hasta hacerlos desaparecer.
    int64_t sumSq = 0;
    int32_t peakAbs = 0;
    for (uint16_t i = 0; i < BLOCK_SAMPLES; i++) {
      int32_t s = (int32_t)analysisBuf[i];
      sumSq += s * s;
      int32_t a = (s < 0) ? -s : s;
      if (a > peakAbs)
        peakAbs = a;
    }
    float rms = sqrtf((float)sumSq / BLOCK_SAMPLES);
    float crest = (rms > 1.0f) ? ((float)peakAbs / rms) : 0.0f;

    // Alimentar la envolvente de amplitud (un valor por bloque) para el
    // análisis de ritmo respiratorio que se hace al cerrar la ventana.
    envBuf[envIdx] = rms;
    envIdx = (envIdx + 1) % ENV_FFT_SIZE;
    if (envFilled < ENV_FFT_SIZE)
      envFilled++;

    // === 2. Baseline rodante ===
    // El primer RMS tras boot incluye un transient del I2S que infla el
    // baseline. Recalibramos una vez al terminar el warmup.
    static bool baselineRecalibrated = false;
    bool warmupJustEnded =
        !baselineRecalibrated && (millis() - bootTimeMs) >= WARMUP_MS;
    if (!baselineInitialized || warmupJustEnded) {
      rmsBaseline = rms;
      baselineInitialized = true;
      if (warmupJustEnded) {
        baselineRecalibrated = true;
        Serial.printf("[BASELINE] Recalibrado tras warmup: %.0f\n", rms);
      }
    } else {
      rmsBaseline = BASELINE_ALPHA * rms + (1.0f - BASELINE_ALPHA) * rmsBaseline;
    }

    // === 3. FFT → features espectrales ===
    for (uint16_t i = 0; i < BLOCK_SAMPLES; i++) {
      vReal[i] = (float)analysisBuf[i];
      vImag[i] = 0.0f;
    }
    FFT.windowing(FFTWindow::Hamming, FFTDirection::Forward);
    FFT.compute(FFTDirection::Forward);
    FFT.complexToMagnitude();

    const uint16_t halfBins = FFT_SAMPLES / 2;
    // MAG_EPS y no EPS: los headers Xtensa definen `EPS` como macro (192).
    const float MAG_EPS = 1e-6f;

    float magSum = 0.0f;      // Σ magnitud (media aritmética)
    float logSum = 0.0f;      // Σ ln(magnitud) (media geométrica)
    float weightedSum = 0.0f; // Σ f·magnitud (centroide)
    float maxMag = 0.0f;
    uint16_t maxBin = 1;
    float bandEnergy[NUM_BANDS] = {0.0f};

    for (uint16_t i = 1; i < halfBins; i++) {
      float m = vReal[i];
      magSum += m;
      logSum += logf(m + MAG_EPS);
      weightedSum += m * ((float)i * binHz);
      if (m > maxMag) {
        maxMag = m;
        maxBin = i;
      }
      for (uint8_t b = 0; b < NUM_BANDS; b++) {
        if (i >= bandBin[b] && i < bandBin[b + 1]) {
          bandEnergy[b] += m;
          break;
        }
      }
    }

    uint16_t nBins = halfBins - 1;
    float centroid = (magSum > MAG_EPS) ? (weightedSum / magSum) : 0.0f;

    // Flatness = media geométrica / media aritmética. 0 = tonal, 1 = ruido.
    float geoMean = expf(logSum / (float)nBins);
    float ariMean = magSum / (float)nBins;
    float flatness = (ariMean > MAG_EPS) ? (geoMean / ariMean) : 0.0f;

    // Rolloff: frecuencia bajo la cual se acumula ROLLOFF_FRACTION de la energía
    float rolloffTarget = magSum * ROLLOFF_FRACTION;
    float acc = 0.0f;
    float rolloff = 0.0f;
    for (uint16_t i = 1; i < halfBins; i++) {
      acc += vReal[i];
      if (acc >= rolloffTarget) {
        rolloff = (float)i * binHz;
        break;
      }
    }

    float peakFreq = (float)maxBin * binHz;

    // === 4. Acumular en la ventana ===
    win.blocks++;
    win.rmsSum += rms;
    win.rmsSumSq += (double)rms * (double)rms;
    if (rms > win.rmsMax)
      win.rmsMax = rms;
    win.rmsHist[rmsHistBin(rms)]++;

    win.centroidSum += centroid;
    win.centroidSumSq += (double)centroid * (double)centroid;
    win.flatnessSum += flatness;
    win.flatnessSumSq += (double)flatness * (double)flatness;
    win.rolloffSum += rolloff;
    for (uint8_t b = 0; b < NUM_BANDS; b++) {
      win.bandSum[b] += (magSum > MAG_EPS) ? (bandEnergy[b] / magSum) : 0.0f;
    }

    win.crestSum += crest;
    if (crest > win.crestMax)
      win.crestMax = crest;

    // === 5. Cierre de ventana → fila en features.csv ===
    if ((millis() - windowStartMs) >= FEATURE_WINDOW_MS && win.blocks > 0) {
      float n = (float)win.blocks;
      float rmsMean = (float)(win.rmsSum / n);
      float variance = (float)(win.rmsSumSq / n) - (rmsMean * rmsMean);
      float rmsStd = (variance > 0.0f) ? sqrtf(variance) : 0.0f;
      float p50 = rmsHistPercentile(win.rmsHist, win.blocks, 0.5f);
      float p90 = rmsHistPercentile(win.rmsHist, win.blocks, 0.9f);

      float bands[NUM_BANDS];
      for (uint8_t b = 0; b < NUM_BANDS; b++) {
        bands[b] = (float)(win.bandSum[b] / n);
      }

      float centroidMean = (float)(win.centroidSum / n);
      float centroidVar =
          (float)(win.centroidSumSq / n) - (centroidMean * centroidMean);
      float centroidStd = (centroidVar > 0.0f) ? sqrtf(centroidVar) : 0.0f;

      float flatnessMean = (float)(win.flatnessSum / n);
      float flatnessVar =
          (float)(win.flatnessSumSq / n) - (flatnessMean * flatnessMean);
      float flatnessStd = (flatnessVar > 0.0f) ? sqrtf(flatnessVar) : 0.0f;

      float crestMean = (float)(win.crestSum / n);

      // Ritmo respiratorio: la única medida que ve la respiración dificultosa.
      analyzeModulation(&lastBreathRateBpm, &lastModStrength, &lastModFreqHz);

      // Referencias lentas del ruido de fondo para identificar el periodo
      // tranquilo sin RTC. Se relajan hacia el baseline actual, así que siguen
      // el ciclo diario del corral por sí solas.
      if (baselineLoudRef <= 0.0f) {
        baselineQuietRef = rmsBaseline;
        baselineLoudRef = rmsBaseline;
      }
      if (rmsBaseline < baselineQuietRef) {
        baselineQuietRef = rmsBaseline;
      } else {
        baselineQuietRef += QUIET_REF_ALPHA * (rmsBaseline - baselineQuietRef);
      }
      if (rmsBaseline > baselineLoudRef) {
        baselineLoudRef = rmsBaseline;
      } else {
        baselineLoudRef += QUIET_REF_ALPHA * (rmsBaseline - baselineLoudRef);
      }
      isQuietPeriod =
          (rmsBaseline < baselineQuietRef +
                             QUIET_FRACTION * (baselineLoudRef - baselineQuietRef));

      // Conteo de ventanas consecutivas con ritmo respiratorio marcado.
      if (lastModStrength >= MOD_STRENGTH_EPISODE) {
        modSustainedCount++;
      } else {
        modSustainedCount = 0;
      }

      windowCounter++;
      writeFeatureCSV(rmsMean, rmsStd, p50, p90, centroidMean, centroidStd,
                      flatnessMean, flatnessStd, (float)(win.rolloffSum / n),
                      bands, win.impulseFreqHist, crestMean, win.crestMax,
                      lastBreathRateBpm, lastModStrength, lastModFreqHz);

      Serial.printf("[WIN #%lu] rms=%.0f±%.0f | flat=%.3f±%.3f | "
                    "crest=%.1f/%.1f | resp=%.0frpm f=%.1f | imp=%lu | %s\n",
                    (unsigned long)windowCounter, rmsMean, rmsStd, flatnessMean,
                    flatnessStd, crestMean, win.crestMax, lastBreathRateBpm,
                    lastModStrength, (unsigned long)win.impulseCount,
                    clinicalTag(clinicalState));

      winReset();
    }

    // === 6. Conteo de cuarentena y guardado periódico en NVS ===
    if (clinicalState == CLIN_QUARANTINE) {
      uint32_t now = millis();
      quarantineElapsedMs += (now - quarantineTickMs);
      quarantineTickMs = now;

      // Vencida sin mejora → vuelve a rojo. En modo manual el algoritmo no
      // evalúa mejoría: simplemente pide al trabajador que reevalúe.
      if (quarantineElapsedMs >= QUARANTINE_DURATION_MS) {
        setClinicalState(CLIN_ALERT, "cuarentena_vencida");
      }
    } else {
      quarantineTickMs = millis();
    }

    static uint32_t lastNvsSaveMs = 0;
    if (millis() - lastNvsSaveMs >= NVS_SAVE_INTERVAL_MS) {
      lastNvsSaveMs = millis();
      saveClinicalState();
    }

    // === 7. Chequeo periódico de espacio en SD ===
    static uint32_t lastSDCheckMs = 0;
    if ((millis() - lastSDCheckMs >= SD_CHECK_INTERVAL_MS) &&
        (deviceState == DEV_MONITORING || deviceState == DEV_SD_FULL)) {
      lastSDCheckMs = millis();
      bool full = isSDFull();
      if (full && deviceState == DEV_MONITORING) {
        Serial.println("[SD] SD casi llena → DEV_SD_FULL");
        deviceState = DEV_SD_FULL;
      } else if (!full && deviceState == DEV_SD_FULL) {
        Serial.println("[SD] Espacio libre detectado → DEV_MONITORING");
        deviceState = DEV_MONITORING;
      }
    }

    if (deviceState != DEV_MONITORING) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    bool inWarmup = (millis() - bootTimeMs) < WARMUP_MS;
    bool inCooldown = (lastRecordingEndMs != 0) &&
                      ((millis() - lastRecordingEndMs) < TRIGGER_COOLDOWN_MS);

    // === 8. Detección de nivel (sin banda, sin onset — a propósito) ===
    float threshold = rmsBaseline * RMS_FACTOR;
    if (threshold < THRESHOLD_RMS)
      threshold = THRESHOLD_RMS;

    // Se separan dos conceptos que es tentador unir:
    //   impulseDetected → alimenta el log de features y el latch de episodio.
    //                     NO lo silencia el cooldown: si dejara de contar
    //                     durante los 3 s posteriores a cada grabación,
    //                     subestimaría los brotes justo cuando más importan.
    //   triggered       → además dispara una grabación TRG, y ahí sí manda
    //                     el cooldown, que existe para no saturar la SD.
    bool impulseDetected = !inWarmup && (rms > threshold);
    bool triggered = impulseDetected && !inCooldown;

    if (impulseDetected) {
      win.impulseCount++;
      uint8_t fb = (uint8_t)(peakFreq / (float)(SAMPLE_RATE / 2) * IMP_FREQ_BINS);
      if (fb >= IMP_FREQ_BINS)
        fb = IMP_FREQ_BINS - 1;
      win.impulseFreqHist[fb]++;

      triggerTimes[triggerIdx] = millis();
      triggerIdx = (triggerIdx + 1) % EPISODE_TRIGGER_COUNT;
      lastTriggerMs = millis();

      // ¿Los últimos EPISODE_TRIGGER_COUNT impulsos caben en la ventana?
      if (!episodeActive) {
        uint32_t oldest = triggerTimes[triggerIdx]; // el que se sobrescribirá
        if (oldest != 0 && (millis() - oldest) <= EPISODE_WINDOW_MS) {
          episodeActive = true;
          episodeFromModulation = false;
          episodeId = millis() / 1000;
          episodeSeq = 0;
          episodeStartMs = millis();
          Serial.println("============================================");
          Serial.printf(">>> EPISODIO #%lu iniciado (%u triggers en %lus)\n",
                        (unsigned long)episodeId, EPISODE_TRIGGER_COUNT,
                        (unsigned long)(EPISODE_WINDOW_MS / 1000));
          Serial.println("============================================");
        }
      }
    }

    // === 8b. Segunda vía al episodio: ritmo respiratorio sostenido ===
    // No depende de impulsos. Un corral con disnea y sin toses llega aquí.
    if (!episodeActive && modSustainedCount >= MOD_SUSTAINED_WINDOWS) {
      episodeActive = true;
      episodeFromModulation = true;
      episodeId = millis() / 1000;
      episodeSeq = 0;
      episodeStartMs = millis();
      lastTriggerMs = millis();
      modSustainedCount = 0;
      Serial.println("============================================");
      Serial.printf(">>> EPISODIO #%lu iniciado por RITMO RESPIRATORIO "
                    "(%.0f rpm, fuerza %.1f)\n",
                    (unsigned long)episodeId, lastBreathRateBpm,
                    lastModStrength);
      Serial.println("============================================");
    }

    // === 9. Ejecutar política de grabación ===
    // El centinela acelera en periodos tranquilos: es cuando la respiración
    // dificultosa y la húmeda están por encima del piso de ruido.
    uint32_t sentinelInterval =
        isQuietPeriod ? SENTINEL_INTERVAL_QUIET_MS : SENTINEL_INTERVAL_MS;
    bool sentinelDue = (millis() - lastSentinelMs) >= sentinelInterval;

    if (episodeActive) {
      // --- Nivel 3: chunk de episodio ---
      char filename[64];
      episodeSeq++;
      snprintf(filename, sizeof(filename), "/EPI_%lu_%03u_%s.wav",
               (unsigned long)episodeId, episodeSeq,
               clinicalTag(clinicalState));

      deviceState = DEV_RECORDING;
      recCounter++;
      bool ok = recordWav(EPISODE_CHUNK_SECONDS, false, filename);
      if (ok) {
        writeAudioCSV(filename, REC_EPISODE, rms, episodeId, episodeSeq);
      }
      lastRecordingEndMs = millis();
      deviceState = DEV_MONITORING;

      // Ventana corta de análisis antes de decidir si el episodio sigue.
      vTaskDelay(pdMS_TO_TICKS(EPISODE_EVAL_MS));

      bool idle = (millis() - lastTriggerMs) > EPISODE_IDLE_TIMEOUT_MS;
      bool capped = (millis() - episodeStartMs) > EPISODE_MAX_MS;

      // Un episodio por ritmo no produce impulsos: el idle timeout lo cerraría
      // tras el primer chunk. Se le garantiza un mínimo de audio continuo.
      bool modFloor =
          episodeFromModulation && (episodeSeq < MOD_EPISODE_MIN_CHUNKS);

      if (capped || (idle && !modFloor)) {
        Serial.printf(">>> EPISODIO #%lu cerrado tras %u chunks (%s, origen %s)\n",
                      (unsigned long)episodeId, episodeSeq,
                      capped ? "tope" : "sin actividad",
                      episodeFromModulation ? "ritmo" : "impulsos");
        episodeActive = false;
        episodeFromModulation = false;
        modSustainedCount = 0; // evita re-disparo inmediato
        memset(triggerTimes, 0, sizeof(triggerTimes));
      }

    } else if (sentinelDue) {
      // --- Nivel 1: centinela (ciego, sin sesgo) ---
      char filename[64];
      snprintf(filename, sizeof(filename), "/SEN_%lu_%s.wav",
               (unsigned long)(millis() / 1000), clinicalTag(clinicalState));

      lastSentinelMs = millis();
      deviceState = DEV_RECORDING;
      recCounter++;
      bool ok = recordWav(SENTINEL_SECONDS, false, filename);
      if (ok) {
        writeAudioCSV(filename, REC_SENTINEL, rms, 0, 0);
      }
      lastRecordingEndMs = millis();
      deviceState = DEV_MONITORING;

    } else if (triggered) {
      // --- Nivel 2: trigger con pre-roll ---
      char filename[64];
      int rmsInt = (int)rms;
      snprintf(filename, sizeof(filename), "/TRG_%lu_RMS%d_%s.wav",
               (unsigned long)(millis() / 1000), rmsInt,
               clinicalTag(clinicalState));

      deviceState = DEV_RECORDING;
      recCounter++;
      bool ok = recordWav(TRIGGER_TOTAL_SECONDS, true, filename);
      if (ok) {
        writeAudioCSV(filename, REC_TRIGGER, rms, 0, 0);
      }
      lastRecordingEndMs = millis();
      deviceState = DEV_MONITORING;
    }
  }
}

// =============================================================================
// TAREA: SEMÁFORO (Core 1) — Prioridad Baja
// =============================================================================
//
// El semáforo significa ESTADO DEL CORRAL, punto. No parpadea al grabar: eso
// sería ruido para el trabajador, y las grabaciones son constantes.
//
// Los fallos del aparato SÍ tienen prioridad sobre el estado clínico, porque
// significan "este nodo no está escuchando" — y eso el trabajador debe verlo.
// =============================================================================

static void ledTask(void *param) {
  Serial.println("[LED] Tarea de semáforo iniciada.");

  uint32_t lastToggle = 0;
  bool ledOn = false;

  for (;;) {
    uint32_t now = millis();

    // --- Prioridad 0: buttonTask está mostrando realimentación de un gesto ---
    if (ledOverride) {
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }

    // --- Prioridad 1: fallos del aparato ---
    if (deviceState == DEV_ERROR) {
      // Rojo parpadeo rápido
      analogWrite(GREEN_LED, 0);
      analogWrite(YELLOW_LED, 0);
      if ((now - lastToggle) >= 200) {
        ledOn = !ledOn;
        analogWrite(RED_LED, ledOn ? LED_BRILLO : 0);
        lastToggle = now;
      }
    } else if (deviceState == DEV_SD_FULL) {
      // Rojo + amarillo alternados a 1 Hz
      analogWrite(GREEN_LED, 0);
      if ((now - lastToggle) >= 500) {
        ledOn = !ledOn;
        analogWrite(RED_LED, ledOn ? LED_BRILLO : 0);
        analogWrite(YELLOW_LED, ledOn ? 0 : LED_BRILLO);
        lastToggle = now;
      }
    } else if (deviceState == DEV_PAUSED) {
      // Verde + amarillo fijos: "SD desmontada, puedes extraerla"
      analogWrite(GREEN_LED, LED_BRILLO);
      analogWrite(YELLOW_LED, LED_BRILLO);
      analogWrite(RED_LED, 0);
      lastToggle = now;

    } else {
      // --- Prioridad 2: estado clínico del corral ---
      switch (clinicalState) {
      case CLIN_NORMAL:
        // Verde heartbeat: el nodo está vivo y no ve problema
        analogWrite(YELLOW_LED, 0);
        analogWrite(RED_LED, 0);
        if ((now - lastToggle) >= 1000) {
          ledOn = !ledOn;
          analogWrite(GREEN_LED, ledOn ? LED_BRILLO : 0);
          lastToggle = now;
        }
        break;

      case CLIN_ALERT:
        // Rojo fijo: hay que tomar medidas en este corral
        analogWrite(GREEN_LED, 0);
        analogWrite(YELLOW_LED, 0);
        analogWrite(RED_LED, LED_BRILLO);
        lastToggle = now;
        break;

      case CLIN_QUARANTINE:
        // Amarillo fijo: tratado, en observación
        analogWrite(GREEN_LED, 0);
        analogWrite(YELLOW_LED, LED_BRILLO);
        analogWrite(RED_LED, 0);
        lastToggle = now;
        break;
      }
    }

    vTaskDelay(pdMS_TO_TICKS(50)); // Polling a 20 Hz
  }
}

// =============================================================================
// TAREA: BOTÓN CLÍNICO (Core 1) — Prioridad Baja
// =============================================================================
//
// Tres gestos sobre un único pulsador. Durante la pulsación el semáforo da
// realimentación para que el trabajador sepa qué gesto va a ejecutar antes de
// soltar: sin eso, distinguir 3 s de 7 s con guantes es imposible.
//
//   Corta  (< 1 s)   → avanza ciclo: NORMAL → ALERTA → CUARENTENA → NORMAL
//   Larga  (>= 3 s)  → vuelve a NORMAL (falsa alarma / corrección)
//   Lote   (>= 7 s)  → nuevo lote: resetea baseline y batch_id
//
// En fase 2, cuando el algoritmo encienda el rojo solo, la pulsación larga pasa
// a significar "falsa alarma del detector" sin cambiar el vocabulario de gestos.
// =============================================================================

static void buttonTask(void *param) {
  Serial.println("[BTN] Botón clínico iniciado.");

  bool lastStableState = HIGH; // Pull-up: HIGH = no presionado
  bool lastReading = HIGH;
  TickType_t lastDebounceTick = xTaskGetTickCount();
  TickType_t pressStartTick = 0;
  bool pressed = false;
  bool gestureHandled = false;

  for (;;) {
    bool reading = digitalRead(BTN_CLINICAL);
    TickType_t now = xTaskGetTickCount();

    // --- Debounce ---
    if (reading != lastReading) {
      lastDebounceTick = now;
    }
    lastReading = reading;

    if ((now - lastDebounceTick) >= pdMS_TO_TICKS(BTN_DEBOUNCE_MS)) {
      if (reading != lastStableState) {
        lastStableState = reading;

        if (lastStableState == LOW) {
          // ── Presionado ──
          pressed = true;
          gestureHandled = false;
          pressStartTick = now;

        } else if (pressed) {
          // ── Soltado ──
          pressed = false;

          if (gestureHandled) {
            gestureHandled = false;
            continue;
          }

          uint32_t durationMs = (now - pressStartTick) * portTICK_PERIOD_MS;

          // Apagar la realimentación de retención antes de actuar.
          ledOverride = false;

          if (durationMs < BTN_SHORT_MAX_MS) {
            // --- Gesto corto: avanzar el ciclo clínico ---
            switch (clinicalState) {
            case CLIN_NORMAL:
              // El trabajador detectó un problema respiratorio en el corral
              setClinicalState(CLIN_ALERT, "manual_deteccion");
              break;
            case CLIN_ALERT:
              // Medicamento suministrado → arranca la ventana de observación
              setClinicalState(CLIN_QUARANTINE, "tratamiento_aplicado");
              break;
            case CLIN_QUARANTINE:
              // El problema ya no se presenta: el tratamiento fue efectivo
              setClinicalState(CLIN_NORMAL, "tratamiento_efectivo");
              break;
            }

          } else if (durationMs >= BTN_LONG_PRESS_MS) {
            // --- Gesto largo: corrección / falsa alarma ---
            // El gesto de lote (>= 7 s) ya se ejecutó durante la retención y
            // marcó gestureHandled, así que aquí solo llegan 3-7 s.
            setClinicalState(CLIN_NORMAL, "correccion_manual");
          }
          // Zona muerta entre 1 s y 3 s: sin acción.
        }
      }

      // --- Realimentación y gesto de lote, mientras sigue presionado ---
      // El trabajador lleva guantes: sin señal visual no puede distinguir 3 s
      // de 7 s. El amarillo avisa "suelta ahora = volver a NORMAL".
      if (pressed && !gestureHandled) {
        uint32_t heldMs = (now - pressStartTick) * portTICK_PERIOD_MS;

        if (heldMs >= BTN_BATCH_PRESS_MS) {
          gestureHandled = true;
          ledOverride = true;

          // Nuevo lote: destete y engorde son todo-dentro/todo-fuera. Un
          // baseline del lote anterior no significa nada para el nuevo.
          batchId++;
          baselineInitialized = false;

          // El cambio de lote debe quedar registrado aunque el semáforo ya
          // esté en verde: setClinicalState() no escribe fila si no hay
          // transición, y perderíamos el marcador de inicio de lote.
          if (clinicalState == CLIN_NORMAL) {
            writeClinicalCSV(CLIN_NORMAL, CLIN_NORMAL, "nuevo_lote");
          } else {
            setClinicalState(CLIN_NORMAL, "nuevo_lote");
          }
          saveClinicalState();

          Serial.printf("[BTN] NUEVO LOTE #%lu — baseline reseteado\n",
                        (unsigned long)batchId);

          // Confirmación: los tres LEDs parpadean 3 veces
          for (uint8_t i = 0; i < 3; i++) {
            analogWrite(GREEN_LED, LED_BRILLO);
            analogWrite(YELLOW_LED, LED_BRILLO);
            analogWrite(RED_LED, LED_BRILLO);
            vTaskDelay(pdMS_TO_TICKS(150));
            analogWrite(GREEN_LED, 0);
            analogWrite(YELLOW_LED, 0);
            analogWrite(RED_LED, 0);
            vTaskDelay(pdMS_TO_TICKS(150));
          }
          ledOverride = false;

        } else if (heldMs >= BTN_LONG_PRESS_MS) {
          // Solo señal visual. La acción se resuelve al soltar, con debounce.
          ledOverride = true;
          analogWrite(GREEN_LED, 0);
          analogWrite(RED_LED, 0);
          analogWrite(YELLOW_LED, LED_BRILLO);
        }
      }
    }

    vTaskDelay(pdMS_TO_TICKS(20)); // Polling a 50 Hz
  }
}

// =============================================================================
// SETUP
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(2000); // Esperar a que el USB CDC se estabilice en Mac

  Serial.println();
  Serial.println("=============================================");
  Serial.println("  BRIVEX BIO-ALERT | Nodo BREATH v0.1");
  Serial.println("  Dataset Builder — Respiratorio");
  Serial.println("  ESP32-S3 | FreeRTOS Dual-Core");
  Serial.println("=============================================");

  String mac = getMACAddress();
  Serial.printf("  MAC: %s\n", mac.c_str());
  Serial.printf("  Temp. Core: %.1f °C\n", temperatureRead());
  Serial.println("=============================================\n");

  // --- Estado clínico persistido (debe cargarse antes de encender el semáforo)
  loadClinicalState();

  // --- Mutex del ring buffer y del pre-roll ---
  rbMutex = xSemaphoreCreateMutex();
  prerollMutex = xSemaphoreCreateMutex();
  if (rbMutex == NULL || prerollMutex == NULL) {
    Serial.println("[FATAL] No se pudo crear mutex (ring buffer o pre-roll).");
    while (true) {
      delay(1000);
    }
  }

  // --- Inicializar hardware ---
  initLEDs();
  initButton();

#if USE_SD_CARD
  if (!initSD()) {
    deviceState = DEV_ERROR;
    Serial.println("[FATAL] Sin SD, el nodo no puede recolectar. Estado: ERROR.");
  }
#else
  Serial.println("[WARN] USE_SD_CARD=false. SD deshabilitada (mock activo).");
#endif

  if (!initI2S()) {
    deviceState = DEV_ERROR;
    Serial.println("[FATAL] I2S falló. Estado: ERROR.");
  }

  if (deviceState == DEV_ERROR) {
    Serial.println("\n[!!] NODO EN ESTADO DE ERROR.");
    Serial.println("     Solo el semáforo y el botón de reinicio funcionan.\n");
  }

  // --- Mostrar configuración ---
  Serial.println("--- Configuración del Recolector Respiratorio ---");
  Serial.printf("  Ventana features: %lus → /features.csv\n",
                (unsigned long)(FEATURE_WINDOW_MS / 1000));
  Serial.printf("  Centinela:        %lus cada %lu min (%.1f%% duty)\n",
                (unsigned long)SENTINEL_SECONDS,
                (unsigned long)(SENTINEL_INTERVAL_MS / 60000),
                100.0f * SENTINEL_SECONDS / (SENTINEL_INTERVAL_MS / 1000.0f));
  Serial.printf("  Trigger:          RMS > %.0f o %.1fx baseline (flojo)\n",
                THRESHOLD_RMS, RMS_FACTOR);
  Serial.printf("  Episodio:         %u triggers en %lus → chunks de %lus\n",
                EPISODE_TRIGGER_COUNT,
                (unsigned long)(EPISODE_WINDOW_MS / 1000),
                (unsigned long)EPISODE_CHUNK_SECONDS);
  Serial.printf("  Cuarentena:       %lu h\n",
                (unsigned long)(QUARANTINE_DURATION_MS / 3600000UL));
  Serial.printf("  Bandas (Hz):      %.0f-%.0f-%.0f-%.0f-%.0f\n",
                BAND_EDGES_HZ[0], BAND_EDGES_HZ[1], BAND_EDGES_HZ[2],
                BAND_EDGES_HZ[3], BAND_EDGES_HZ[4]);
  Serial.printf("  FFT:              %u bins (%.1f Hz/bin)\n", FFT_SAMPLES,
                (float)SAMPLE_RATE / FFT_SAMPLES);
  Serial.printf("  Ring Buffer:      %u muestras (%u KB)\n", RING_BUF_SAMPLES,
                (RING_BUF_SAMPLES * 2) / 1024);
  Serial.println("  Semáforo:         MODO MANUAL (lo enciende el trabajador)");
  Serial.println("------------------------------------------------\n");

  bootTimeMs = millis();

  if (deviceState != DEV_ERROR) {
    // Core 0: Captura I2S (prioridad alta)
    xTaskCreatePinnedToCore(audioCaptureTask, "I2S_Capture", 6144, NULL, 3,
                            &captureTaskHandle, 0);

    // Core 1: Análisis + features + grabación (prioridad media)
    xTaskCreatePinnedToCore(audioAnalysisTask, "Analysis", 16384, NULL, 2,
                            &analysisTaskHandle, 1);
  }

  // Core 1: Semáforo (prioridad baja — siempre activa)
  xTaskCreatePinnedToCore(ledTask, "Semaforo", 2048, NULL, 1, &ledTaskHandle, 1);

  // Core 1: Botón clínico (prioridad baja — siempre activa)
  xTaskCreatePinnedToCore(buttonTask, "Boton", 3072, NULL, 1, &buttonTaskHandle,
                          1);

  Serial.println("[OK] Todas las tareas FreeRTOS lanzadas.");
  Serial.println("     Nodo ACTIVO. Recolectando datos respiratorios...\n");
}

// =============================================================================
// LOOP — Vacío (toda la lógica vive en tareas FreeRTOS)
// =============================================================================
void loop() { vTaskDelay(pdMS_TO_TICKS(10000)); }
