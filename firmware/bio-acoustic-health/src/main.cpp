// =============================================================================
// BRIVEX BIO-ALERT — Recolector Inteligente de Datos Acústicos
// Fase: Dataset Builder para Edge AI / Machine Learning
// Plataforma: ESP32-S3 | Framework: Arduino + FreeRTOS | PlatformIO
// =============================================================================
//
// Arquitectura de Doble Núcleo:
//   Core 0 → Captura I2S ininterrumpida → Ring Buffer (2s pre-roll)
//   Core 1 → Análisis (RMS + FFT metadata) → Grabación WAV 5s
//
// Modos de grabación:
//   1. REC (Alerta):  RMS > THRESHOLD_RMS → REC_[uptime]_RMS[val].wav
//   2. ENV (Ambiente): Cada 30 min automático → ENV_[uptime]_RMS[val].wav
//
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

// --- Módulo Micro SD (SPI) ---
#define SD_CS 10
#define SPI_MOSI 11
#define SPI_SCK_PIN 12
#define SPI_MISO 13

// --- LEDs Indicadores ---
#define GREEN_LED 4
#define YELLOW_LED 5
#define RED_LED 6

// --- Pulsador ---
#define BTN_SYNC 7

// --- Interruptor Maestro: Hardware Mocking ---
// Cambiar a 'true' cuando el módulo Micro SD esté conectado físicamente.
#define USE_SD_CARD false

// =============================================================================
// CONSTANTES DE CONFIGURACIÓN
// =============================================================================

// Audio
static const uint32_t SAMPLE_RATE = 16000; // Hz
static const uint16_t BITS_PER_SAMPLE = 16;
static const uint8_t NUM_CHANNELS = 1; // Mono

// Ring Buffer: ~2 segundos de audio = 32000 muestras × 2 bytes = 64 KB
static const size_t RING_BUF_SAMPLES = 32000;
static const size_t PREROLL_SAMPLES = RING_BUF_SAMPLES; // 2s de pre-roll

// I2S DMA read block size (muestras por lectura)
static const size_t I2S_READ_SAMPLES = 512;

// FFT (para metadatos del dataset, NO como trigger)
static const uint16_t FFT_SAMPLES = 1024; // Debe ser potencia de 2

// Bloque de análisis RMS + FFT
static const uint16_t RMS_BLOCK_SAMPLES = FFT_SAMPLES; // Mismo tamaño para reusar buffer

// --- Umbral RMS para trigger de alerta ---
static const float THRESHOLD_RMS = 500.0f; // Ajustar según ambiente real
// RMS_FACTOR: Smart Button alterna entre dos multiplicadores sobre baseline
static const float RMS_FACTOR_SENSITIVE = 1.5f;
static const float RMS_FACTOR_STRICT = 2.5f;
static volatile float RMS_FACTOR = RMS_FACTOR_SENSITIVE;

// Baseline rodante: suavizado exponencial
static const float BASELINE_ALPHA = 0.02f;

// --- Grabación: 5 segundos total (2s pre-roll + 3s live) ---
static const uint32_t RECORD_TOTAL_SECONDS = 5;
static const uint32_t PREROLL_SECONDS = 2;
static const uint32_t LIVE_SECONDS = 3;
static const uint32_t RECORD_BYTES =
    SAMPLE_RATE * (BITS_PER_SAMPLE / 8) * NUM_CHANNELS * RECORD_TOTAL_SECONDS;
static const uint32_t LIVE_BYTES =
    SAMPLE_RATE * (BITS_PER_SAMPLE / 8) * NUM_CHANNELS * LIVE_SECONDS;
static const size_t SD_WRITE_BUF = 4096; // 4 KB por escritura a SD

// --- Muestreo Ambiental Periódico ---
static const uint32_t ENV_INTERVAL_MS = 1800000; // 30 minutos en ms

// --- LEDs ---
static const uint8_t LED_BRILLO = 127; // PWM 50%

// --- Botón ---
static const uint32_t BTN_DEBOUNCE_MS = 50;
static const uint32_t BTN_SHORT_MAX_MS = 1000; // Máximo ms para clic corto
static const uint32_t BTN_LONG_PRESS_MS =
    3000; // ms para cambio de sensibilidad

// =============================================================================
// ENUMERACIÓN DE ESTADOS DEL SISTEMA
// =============================================================================
typedef enum {
  STATE_MONITORING, // Operación normal — Verde heartbeat
  STATE_RECORDING,  // Grabando audio + CSV — Amarillo fijo
  STATE_ERROR,      // Fallo crítico — Rojo parpadeo rápido
  STATE_PAIRING     // Modo emparejamiento — Todos parpadean
} SystemState_t;

// =============================================================================
// VARIABLES GLOBALES
// =============================================================================

// Estado actual del sistema (volatile para acceso multi-hilo)
volatile SystemState_t systemState = STATE_MONITORING;

// Ring Buffer
static int16_t ringBuffer[RING_BUF_SAMPLES];
static volatile size_t rbWriteIdx = 0;
static volatile size_t rbReadIdx = 0;
static SemaphoreHandle_t rbMutex = NULL;

// Contador de eventos (archivos grabados)
static uint32_t eventCounter = 0;

// Smart Button: estado de sensibilidad (false = sensible, true = estricto)
static volatile bool sensitivityStrict = false;

// Baseline rodante de RMS (ruido de fondo)
static float rmsBaseline = 0.0f;
static bool baselineInitialized = false;

// Datos del último evento detectado (para CSV)
static float lastPeakRMS = 0.0f;
static float lastFreqHz = 0.0f;
static float lastBaseline = 0.0f;

// Timer para muestreo ambiental periódico (millis-based, non-blocking)
static uint32_t lastEnvCaptureMs = 0;

// Handle de tareas
static TaskHandle_t captureTaskHandle = NULL;
static TaskHandle_t analysisTaskHandle = NULL;
static TaskHandle_t ledTaskHandle = NULL;
static TaskHandle_t buttonTaskHandle = NULL;

// Buffers de FFT (metadatos para dataset ML)
static float vReal[FFT_SAMPLES];
static float vImag[FFT_SAMPLES];

// Objeto FFT
static ArduinoFFT<float> FFT =
    ArduinoFFT<float>(vReal, vImag, FFT_SAMPLES, SAMPLE_RATE);

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
    // Si alcanzamos el read index, avanzamos el read (perdemos datos viejos)
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

/**
 * @brief Copia las muestras actuales del ring buffer sin avanzar el read index.
 *        Usado para volcar el pre-roll de 2s al archivo WAV.
 *        Devuelve cuántas muestras copió (hasta RING_BUF_SAMPLES).
 */
static size_t rb_snapshot(int16_t *dest, size_t maxSamples) {
  xSemaphoreTake(rbMutex, portMAX_DELAY);
  size_t avail = rb_available();
  size_t toCopy = (maxSamples < avail) ? maxSamples : avail;
  size_t idx = rbReadIdx;
  for (size_t i = 0; i < toCopy; i++) {
    dest[i] = ringBuffer[idx];
    idx = (idx + 1) % RING_BUF_SAMPLES;
  }
  xSemaphoreGive(rbMutex);
  return toCopy;
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
                             .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
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

  Serial.println("[OK] I2S configurado (16-bit, 16kHz, mono).");
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
 * @brief Inicializa los 3 pines LED como salida y los apaga.
 */
static void initLEDs() {
  pinMode(GREEN_LED, OUTPUT);
  pinMode(YELLOW_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  analogWrite(GREEN_LED, 0);
  analogWrite(YELLOW_LED, 0);
  analogWrite(RED_LED, 0);
  Serial.println("[OK] LEDs inicializados.");
}

/**
 * @brief Inicializa el botón con pull-up interno.
 */
static void initButton() {
  pinMode(BTN_SYNC, INPUT_PULLUP);
  Serial.println("[OK] Botón BTN_SYNC inicializado (INPUT_PULLUP).");
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

// =============================================================================
// GRABACIÓN WAV — Cabecera RIFF Dinámica
// =============================================================================

/**
 * @brief Genera nombre de archivo dinámico según tipo de grabación.
 * @param dest Buffer destino para el nombre
 * @param isEnv true = captura ambiental, false = alerta RMS
 * @param rmsValue Valor RMS actual para incluir en el nombre
 */
static void buildFilename(char *dest, size_t destLen, bool isEnv, float rmsValue) {
  uint32_t uptimeSec = millis() / 1000;
  // Formatear RMS con 1 decimal, reemplazando '.' por '-' para compatibilidad FAT32
  int rmsInt = (int)rmsValue;
  int rmsDec = (int)((rmsValue - rmsInt) * 10);
  if (rmsDec < 0) rmsDec = -rmsDec;
  if (isEnv) {
    snprintf(dest, destLen, "/ENV_%lu_RMS%d-%d.wav",
             (unsigned long)uptimeSec, rmsInt, rmsDec);
  } else {
    snprintf(dest, destLen, "/REC_%lu_RMS%d-%d.wav",
             (unsigned long)uptimeSec, rmsInt, rmsDec);
  }
}

/**
 * @brief Graba 5 segundos de audio: 2s pre-roll del Ring Buffer + 3s live I2S.
 *        Escribe en chunks para evitar perder muestras.
 * @param isEnv true si es captura ambiental periódica
 * @param currentRMS Valor RMS actual para el nombre del archivo
 * @return true si la grabación fue exitosa
 */
static bool recordWavToSD(bool isEnv, float currentRMS) {
#if USE_SD_CARD
  eventCounter++;

  // Generar nombre dinámico
  char filename[48];
  buildFilename(filename, sizeof(filename), isEnv, currentRMS);

  Serial.printf("[REC] Iniciando: %s (%s, %us)...\n", filename,
                isEnv ? "ENV" : "ALERTA", RECORD_TOTAL_SECONDS);

  File wavFile = SD.open(filename, FILE_WRITE);
  if (!wavFile) {
    Serial.printf("[ERROR] No se pudo crear %s\n", filename);
    eventCounter--;
    return false;
  }

  // Escribir cabecera WAV
  writeWavHeader(wavFile, RECORD_BYTES);

  uint32_t totalBytesWritten = 0;

  // === FASE 1: Volcar 2s de pre-roll desde el Ring Buffer ===
  // Leemos en chunks de SD_WRITE_BUF/2 muestras para no saturar la SD
  const size_t chunkSamples = SD_WRITE_BUF / sizeof(int16_t); // 2048 muestras
  int16_t sdBuf[SD_WRITE_BUF / sizeof(int16_t)];

  // Copiar snapshot del ring buffer (no-destructivo, Core 0 sigue escribiendo)
  // Procesamos directamente desde el ring buffer en chunks
  size_t prerollRemaining = PREROLL_SAMPLES;
  size_t prerollOffset = 0;

  // Tomar snapshot de la posición actual del ring buffer
  xSemaphoreTake(rbMutex, portMAX_DELAY);
  size_t snapAvail = rb_available();
  size_t snapStart = rbReadIdx;
  // Avanzar read index para "consumir" el pre-roll
  rbReadIdx = rbWriteIdx;
  xSemaphoreGive(rbMutex);

  size_t samplesToWrite = (snapAvail < PREROLL_SAMPLES) ? snapAvail : PREROLL_SAMPLES;
  size_t snapIdx = snapStart;

  while (prerollOffset < samplesToWrite) {
    size_t thisChunk = chunkSamples;
    if (prerollOffset + thisChunk > samplesToWrite)
      thisChunk = samplesToWrite - prerollOffset;

    // Copiar desde ring buffer (sin mutex, datos ya "consumidos")
    for (size_t i = 0; i < thisChunk; i++) {
      sdBuf[i] = ringBuffer[(snapStart + prerollOffset + i) % RING_BUF_SAMPLES];
    }

    size_t bytesToWrite = thisChunk * sizeof(int16_t);
    size_t written = wavFile.write((const uint8_t *)sdBuf, bytesToWrite);
    totalBytesWritten += written;
    prerollOffset += thisChunk;

    if (written != bytesToWrite) {
      Serial.println("[ERROR] Escritura incompleta (pre-roll).");
      break;
    }
  }

  Serial.printf("[REC] Pre-roll: %lu bytes escritos\n",
                (unsigned long)totalBytesWritten);

  // === FASE 2: Grabar 3s en tiempo real desde I2S ===
  size_t bytesRead = 0;
  uint32_t liveBytesTarget = LIVE_BYTES;
  // Ajustar si el pre-roll fue menor de lo esperado
  uint32_t actualPrerollBytes = totalBytesWritten;
  liveBytesTarget = RECORD_BYTES - actualPrerollBytes;

  uint32_t liveWritten = 0;
  while (liveWritten < liveBytesTarget) {
    size_t bytesToRead = SD_WRITE_BUF;
    if (liveWritten + bytesToRead > liveBytesTarget)
      bytesToRead = liveBytesTarget - liveWritten;

    esp_err_t err = i2s_read(I2S_PORT, sdBuf, bytesToRead,
                             &bytesRead, pdMS_TO_TICKS(1000));
    if (err != ESP_OK || bytesRead == 0) {
      Serial.println("[ERROR] Fallo I2S durante grabación live.");
      break;
    }

    size_t written = wavFile.write((const uint8_t *)sdBuf, bytesRead);
    if (written != bytesRead) {
      Serial.println("[ERROR] Escritura incompleta (live).");
      break;
    }
    liveWritten += written;
    totalBytesWritten += written;
  }

  wavFile.close();
  Serial.printf("[REC] Completado: %s (%lu bytes total)\n", filename,
                (unsigned long)totalBytesWritten);

  return (totalBytesWritten >= RECORD_BYTES);
#else
  // --- MOCK: Simular grabación sin hardware SD ---
  eventCounter++;
  char filename[48];
  buildFilename(filename, sizeof(filename), isEnv, currentRMS);
  Serial.printf("[MOCK] Simulando %s (%s, %us)...\n", filename,
                isEnv ? "ENV" : "ALERTA", RECORD_TOTAL_SECONDS);
  // Simular el tiempo de grabación (5s)
  vTaskDelay(pdMS_TO_TICKS(5000));
  Serial.printf("[MOCK] Grabación simulada completada: %s\n", filename);
  return true;
#endif
}

// =============================================================================
// GENERACIÓN DE METADATOS — CSV
// =============================================================================

/**
 * @brief Escribe una línea de metadatos en /log_eventos.csv (append).
 */
static void writeEventCSV(const char *wavFilename, bool isEnv) {
#if USE_SD_CARD
  const char *csvPath = "/log_eventos.csv";
  bool fileExists = SD.exists(csvPath);

  File csvFile = SD.open(csvPath, FILE_APPEND);
  if (!csvFile) {
    Serial.println("[ERROR] No se pudo abrir/crear log_eventos.csv");
    return;
  }

  if (!fileExists) {
    csvFile.println("Archivo,Tipo,MAC,Uptime_ms,Evento,Baseline_RMS,Pico_RMS,Freq_Dom_Hz,Temp_C");
  }

  String mac = getMACAddress();
  unsigned long uptime = millis();
  float tempC = temperatureRead();

  csvFile.printf("%s,%s,%s,%lu,%lu,%.1f,%.1f,%.1f,%.1f\n",
                 wavFilename, isEnv ? "ENV" : "REC", mac.c_str(),
                 uptime, (unsigned long)eventCounter, lastBaseline,
                 lastPeakRMS, lastFreqHz, tempC);

  csvFile.close();
  Serial.printf("[CSV] Evento #%lu registrado\n", (unsigned long)eventCounter);
#else
  Serial.printf("[MOCK] CSV omitido (evento #%lu, SD deshabilitada).\n",
                (unsigned long)eventCounter);
#endif
}

// =============================================================================
// TAREA: CAPTURA DE AUDIO (Core 0) — Prioridad Alta
// =============================================================================
//
// Esta tarea corre en un loop infinito leyendo del I2S en bloques de
// I2S_READ_SAMPLES y copiándolos al ring buffer. Nunca toca la SD ni
// los LEDs. Si el ring buffer se llena, las muestras más viejas se
// sobrescriben automáticamente.
//
// Stack: 4096 bytes (la lectura I2S usa DMA, no necesita mucho stack).
// =============================================================================

static void audioCaptureTask(void *param) {
  int16_t readBuf[I2S_READ_SAMPLES];
  size_t bytesRead = 0;

  Serial.println("[Core 0] Tarea de captura I2S iniciada.");

  for (;;) {
    esp_err_t err =
        i2s_read(I2S_PORT, readBuf, sizeof(readBuf), &bytesRead, portMAX_DELAY);
    if (err == ESP_OK && bytesRead > 0) {
      size_t samplesRead = bytesRead / sizeof(int16_t);
      rb_write(readBuf, samplesRead);
    }
    // Yield mínimo para que el watchdog no se dispare
    taskYIELD();
  }
}

// =============================================================================
// TAREA: ANÁLISIS RMS + GRABACIÓN (Core 1) — Prioridad Media
// =============================================================================
//
// Extrae bloques de RMS_BLOCK_SAMPLES del ring buffer. Calcula:
//   1. RMS del bloque
//   2. Baseline rodante (media exponencial)
//
// Disparadores:
//   A) RMS > THRESHOLD_RMS (y > baseline * RMS_FACTOR) → Grabación REC
//   B) Timer ENV cada 30 min (millis-based) → Grabación ENV
//
// Grabación: 2s pre-roll + 3s live = 5s total WAV
// Stack: 8192 bytes (sin FFT, necesita menos)
// =============================================================================

static void audioAnalysisTask(void *param) {
  int16_t analysisBuf[RMS_BLOCK_SAMPLES];

  Serial.println("[Core 1] Tarea de análisis RMS + grabación iniciada.");

  // Inicializar timer ambiental
  lastEnvCaptureMs = millis();

  for (;;) {
    // Esperar a tener suficientes muestras
    if (rb_available() < RMS_BLOCK_SAMPLES) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    // Extraer bloque del ring buffer (no-destructivo para pre-roll)
    // Usamos rb_read que avanza el read index
    size_t got = rb_read(analysisBuf, RMS_BLOCK_SAMPLES);
    if (got < RMS_BLOCK_SAMPLES) {
      vTaskDelay(pdMS_TO_TICKS(5));
      continue;
    }

    // === 1. Calcular RMS ===
    int64_t sumSq = 0;
    for (int i = 0; i < RMS_BLOCK_SAMPLES; i++) {
      int32_t s = (int32_t)analysisBuf[i];
      sumSq += s * s;
    }
    float rms = sqrtf((float)sumSq / RMS_BLOCK_SAMPLES);

    // === 2. Actualizar Baseline rodante ===
    if (!baselineInitialized) {
      rmsBaseline = rms;
      baselineInitialized = true;
    } else {
      rmsBaseline = BASELINE_ALPHA * rms + (1.0f - BASELINE_ALPHA) * rmsBaseline;
    }

    // === 3. FFT → Frecuencia Dominante (metadatos para ML, NO trigger) ===
    for (int i = 0; i < RMS_BLOCK_SAMPLES; i++) {
      vReal[i] = (float)analysisBuf[i];
      vImag[i] = 0.0f;
    }
    FFT.windowing(FFTWindow::Hamming, FFTDirection::Forward);
    FFT.compute(FFTDirection::Forward);
    FFT.complexToMagnitude();

    float maxMag = 0.0f;
    uint16_t maxBin = 1;
    for (uint16_t i = 1; i < (FFT_SAMPLES / 2); i++) {
      if (vReal[i] > maxMag) {
        maxMag = vReal[i];
        maxBin = i;
      }
    }
    float freqDominant = (float)maxBin * (float)SAMPLE_RATE / (float)FFT_SAMPLES;
    lastFreqHz = freqDominant;

    // === 4. Telemetría periódica (~500ms) ===
    static uint8_t printCounter = 0;
    printCounter++;
    if (printCounter >= 8) {
      printCounter = 0;
      float threshold = rmsBaseline * RMS_FACTOR;
      if (threshold < THRESHOLD_RMS) threshold = THRESHOLD_RMS;
      uint32_t nextEnvSec = (ENV_INTERVAL_MS - (millis() - lastEnvCaptureMs)) / 1000;
      Serial.printf("RMS: %.0f | Base: %.0f | Freq: %.0f Hz | Thr: %.0f | NextENV: %lus | %s\n",
                    rms, rmsBaseline, freqDominant, threshold, (unsigned long)nextEnvSec,
                    (systemState == STATE_MONITORING)  ? "MONITOR"
                    : (systemState == STATE_RECORDING) ? "REC"
                    : (systemState == STATE_ERROR)     ? "ERROR"
                                                       : "PAIRING");
    }

    // No disparar si no estamos monitoreando
    if (systemState != STATE_MONITORING) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    // === 5. Trigger por RMS (Alerta) — FFT NO participa en el trigger ===
    float threshold = rmsBaseline * RMS_FACTOR;
    if (threshold < THRESHOLD_RMS) threshold = THRESHOLD_RMS;

    bool rmsTriggered = (rms > threshold);

    // === 6. Timer ENV (Muestreo Ambiental cada 30 min) ===
    bool envTriggered = ((millis() - lastEnvCaptureMs) >= ENV_INTERVAL_MS);

    // === 7. Ejecutar grabación si alguno dispara ===
    if (rmsTriggered || envTriggered) {
      bool isEnv = envTriggered && !rmsTriggered;

      if (isEnv) {
        Serial.println("============================================");
        Serial.printf(">>> ENV TIMER | Captura ambiental (RMS=%.0f)\n", rms);
        Serial.println("============================================");
        lastEnvCaptureMs = millis(); // Reset timer
      } else {
        Serial.println("============================================");
        Serial.printf(">>> TRIGGER RMS | RMS=%.0f Thr=%.0f\n", rms, threshold);
        Serial.println("============================================");
      }

      lastPeakRMS = rms;
      lastBaseline = rmsBaseline;
      systemState = STATE_RECORDING;

      bool ok = recordWavToSD(isEnv, rms);

      if (ok) {
        // Generar nombre para CSV
        char csvFilename[48];
        buildFilename(csvFilename, sizeof(csvFilename), isEnv, rms);
        writeEventCSV(csvFilename, isEnv);

        // Resetear ring buffer post-grabación
        xSemaphoreTake(rbMutex, portMAX_DELAY);
        rbWriteIdx = 0;
        rbReadIdx = 0;
        xSemaphoreGive(rbMutex);

        systemState = STATE_MONITORING;
        Serial.println("[OK] Volviendo a modo MONITOREO.\n");
      } else {
        Serial.println("[ERROR] Grabación falló. LED ROJO 5s...");
        systemState = STATE_ERROR;
        vTaskDelay(pdMS_TO_TICKS(5000));

        xSemaphoreTake(rbMutex, portMAX_DELAY);
        rbWriteIdx = 0;
        rbReadIdx = 0;
        xSemaphoreGive(rbMutex);

        systemState = STATE_MONITORING;
        Serial.println("[RECOVERY] Volviendo a MONITOREO.\n");
      }
    }
  }
}

// =============================================================================
// TAREA: MÁQUINA DE ESTADOS LED (Core 1) — Prioridad Baja
// =============================================================================
//
// Gestiona los LEDs de forma no bloqueante según systemState.
// Usa millis() para temporizar sin llamar a delay() largo.
//
// Stack: 2048 bytes.
// =============================================================================

static void ledTask(void *param) {
  Serial.println("[LED] Tarea de LEDs iniciada.");

  uint32_t lastToggle = 0;
  bool ledOn = false;

  for (;;) {
    uint32_t now = millis();

    switch (systemState) {

    case STATE_MONITORING:
      // Verde: Heartbeat 1s on / 1s off
      analogWrite(YELLOW_LED, 0);
      analogWrite(RED_LED, 0);
      if ((now - lastToggle) >= 1000) {
        ledOn = !ledOn;
        analogWrite(GREEN_LED, ledOn ? LED_BRILLO : 0);
        lastToggle = now;
      }
      break;

    case STATE_RECORDING:
      // Amarillo fijo, verde y rojo apagados
      analogWrite(GREEN_LED, 0);
      analogWrite(YELLOW_LED, LED_BRILLO);
      analogWrite(RED_LED, 0);
      lastToggle = now; // Reset para heartbeat limpio al volver
      ledOn = false;
      break;

    case STATE_ERROR:
      // Rojo: parpadeo rápido (200ms on/200ms off)
      analogWrite(GREEN_LED, 0);
      analogWrite(YELLOW_LED, 0);
      if ((now - lastToggle) >= 200) {
        ledOn = !ledOn;
        analogWrite(RED_LED, ledOn ? LED_BRILLO : 0);
        lastToggle = now;
      }
      break;

    case STATE_PAIRING:
      // Todos parpadean sincronizados (500ms on/500ms off)
      if ((now - lastToggle) >= 500) {
        ledOn = !ledOn;
        uint8_t val = ledOn ? LED_BRILLO : 0;
        analogWrite(GREEN_LED, val);
        analogWrite(YELLOW_LED, val);
        analogWrite(RED_LED, val);
        lastToggle = now;
      }
      break;
    }

    vTaskDelay(pdMS_TO_TICKS(50)); // Polling a 20 Hz — suficiente para LEDs
  }
}

// =============================================================================
// TAREA: SMART BUTTON (Core 1) — Prioridad Baja
// =============================================================================
//
// Detecta pulsaciones con debounce de 50 ms usando xTaskGetTickCount()
// para medición no bloqueante de duración.
//
// Clic Corto (< 1 segundo): Health Check
//   - Pausa monitoreo de audio momentáneamente.
//   - Si USE_SD_CARD: verifica que la SD está montada.
//     → OK:  Parpadea LED verde  3 veces.
//     → Fallo: Parpadea LED rojo 3 veces.
//   - Vuelve a STATE_MONITORING.
//
// Pulsación Larga (>= 3 segundos): Cambio de Sensibilidad
//   - Detectada en tiempo real mientras el botón sigue presionado.
//   - Alterna RMS_FACTOR entre SENSITIVE (1.5) y STRICT (2.5).
//   - Enciende LED amarillo 2 s como confirmación visual.
//   - Vuelve a STATE_MONITORING.
//
// Stack: 2048 bytes.
// =============================================================================

static void buttonTask(void *param) {
  Serial.println("[BTN] Smart Button iniciado.");

  bool lastStableState = HIGH; // Pull-up: HIGH = no presionado
  bool lastReading = HIGH;
  TickType_t lastDebounceTick = xTaskGetTickCount();
  TickType_t pressStartTick = 0;
  bool pressed = false;
  bool longPressHandled = false; // Evita re-disparo mientras sigue presionado

  for (;;) {
    bool reading = digitalRead(BTN_SYNC);
    TickType_t now = xTaskGetTickCount();

    // --- Debounce ---
    if (reading != lastReading) {
      lastDebounceTick = now;
    }
    lastReading = reading;

    if ((now - lastDebounceTick) >= pdMS_TO_TICKS(BTN_DEBOUNCE_MS)) {
      // Estado estable alcanzado
      if (reading != lastStableState) {
        lastStableState = reading;

        if (lastStableState == LOW) {
          // ── Botón acaba de ser presionado ──
          pressed = true;
          longPressHandled = false;
          pressStartTick = now;
          Serial.println("[BTN] Botón presionado...");

        } else if (pressed) {
          // ── Botón acaba de ser soltado ──
          pressed = false;

          // Si la pulsación larga ya se procesó, ignorar el release
          if (longPressHandled) {
            longPressHandled = false;
            continue;
          }

          uint32_t durationMs = (now - pressStartTick) * portTICK_PERIOD_MS;

          // ============================================================
          // CLIC CORTO (< 1 segundo): Health Check
          // ============================================================
          if (durationMs < BTN_SHORT_MAX_MS) {
            Serial.printf(
                "[BTN] Clic corto detectado (%lu ms) → Health Check\n",
                (unsigned long)durationMs);

            // Pausar monitoreo de audio durante el chequeo
            SystemState_t previousState = systemState;
            systemState =
                STATE_PAIRING; // Estado temporal (todos LEDs parpadean)

            // Pequeña pausa para que el sistema registre el cambio
            vTaskDelay(pdMS_TO_TICKS(200));

            // Apagar todos los LEDs antes de la secuencia
            analogWrite(GREEN_LED, 0);
            analogWrite(YELLOW_LED, 0);
            analogWrite(RED_LED, 0);

#if USE_SD_CARD
            // Verificar si la SD sigue montada intentando abrir un archivo test
            bool sdOk = false;
            File testFile = SD.open("/_health_check.tmp", FILE_WRITE);
            if (testFile) {
              testFile.close();
              SD.remove("/_health_check.tmp");
              sdOk = true;
            }

            if (sdOk) {
              Serial.println("[BTN] ✓ Health Check: SD OK → Verde ×3");
              // Parpadear LED verde 3 veces
              for (int i = 0; i < 3; i++) {
                analogWrite(GREEN_LED, LED_BRILLO);
                vTaskDelay(pdMS_TO_TICKS(200));
                analogWrite(GREEN_LED, 0);
                vTaskDelay(pdMS_TO_TICKS(200));
              }
            } else {
              Serial.println("[BTN] ✗ Health Check: SD FALLO → Rojo ×3");
              // Parpadear LED rojo 3 veces
              for (int i = 0; i < 3; i++) {
                analogWrite(RED_LED, LED_BRILLO);
                vTaskDelay(pdMS_TO_TICKS(200));
                analogWrite(RED_LED, 0);
                vTaskDelay(pdMS_TO_TICKS(200));
              }
            }
#else
            // Sin SD: siempre reportar OK (mock)
            Serial.println(
                "[BTN] ✓ Health Check (mock, SD deshabilitada) → Verde ×3");
            for (int i = 0; i < 3; i++) {
              analogWrite(GREEN_LED, LED_BRILLO);
              vTaskDelay(pdMS_TO_TICKS(200));
              analogWrite(GREEN_LED, 0);
              vTaskDelay(pdMS_TO_TICKS(200));
            }
#endif

            // Restaurar estado de monitoreo
            systemState = STATE_MONITORING;
            Serial.println(
                "[BTN] Health Check completado. Volviendo a MONITOREO.");
          }
          // Else: duración entre 1s y 3s → sin acción (zona muerta)
        }
      }

      // ================================================================
      // PULSACIÓN LARGA (>= 3 segundos): Cambio de Sensibilidad
      // Detectada en tiempo real mientras el botón sigue presionado.
      // ================================================================
      if (pressed && !longPressHandled) {
        uint32_t heldMs = (now - pressStartTick) * portTICK_PERIOD_MS;

        if (heldMs >= BTN_LONG_PRESS_MS) {
          longPressHandled = true;

          // Alternar sensibilidad
          sensitivityStrict = !sensitivityStrict;
          RMS_FACTOR =
              sensitivityStrict ? RMS_FACTOR_STRICT : RMS_FACTOR_SENSITIVE;

          Serial.println("============================================");
          Serial.printf(
              "[BTN] Sensibilidad cambiada → %s (RMS_FACTOR = %.1f)\n",
              sensitivityStrict ? "ESTRICTO" : "SENSIBLE", RMS_FACTOR);
          Serial.println("============================================");

          // Pausar monitoreo y encender LED amarillo 2 s como confirmación
          SystemState_t previousState = systemState;
          systemState = STATE_PAIRING; // Evitar que ledTask interfiera

          // Apagar todos y encender amarillo
          analogWrite(GREEN_LED, 0);
          analogWrite(RED_LED, 0);
          analogWrite(YELLOW_LED, LED_BRILLO);

          vTaskDelay(pdMS_TO_TICKS(2000)); // Confirmación visual: 2 segundos

          analogWrite(YELLOW_LED, 0);

          // Restaurar monitoreo
          systemState = STATE_MONITORING;
          Serial.println(
              "[BTN] Confirmación visual completada. Volviendo a MONITOREO.");
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
  Serial.println("  BRIVEX BIO-ALERT | Dataset Builder v2.0");
  Serial.println("  ESP32-S3 | FreeRTOS Dual-Core | Pre-Roll");
  Serial.println("=============================================");

  // Mostrar MAC del dispositivo
  String mac = getMACAddress();
  Serial.printf("  MAC: %s\n", mac.c_str());
  Serial.printf("  Temp. Core: %.1f °C\n", temperatureRead());
  Serial.println("=============================================\n");

  // --- Crear mutex del ring buffer ---
  rbMutex = xSemaphoreCreateMutex();
  if (rbMutex == NULL) {
    Serial.println("[FATAL] No se pudo crear el mutex del ring buffer.");
    while (true) {
      delay(1000);
    }
  }

  // --- Inicializar hardware ---
  initLEDs();
  initButton();

  // Inicializar SD
#if USE_SD_CARD
  if (!initSD()) {
    // systemState = STATE_ERROR;
    Serial.println(
        "[FATAL] Sin SD, el sistema no puede grabar. Estado: ERROR.");
  }
#else
  Serial.println("[WARN] USE_SD_CARD=false. SD deshabilitada (mock activo).");
#endif

  // Inicializar I2S
  if (!initI2S()) {
    systemState = STATE_ERROR;
    Serial.println("[FATAL] I2S falló. Estado: ERROR.");
  }

  if (systemState == STATE_ERROR) {
    Serial.println("\n[!!] SISTEMA EN ESTADO DE ERROR.");
    Serial.println("     Solo los LEDs y el botón de reinicio funcionan.\n");
  }

  // --- Mostrar configuración ---
  Serial.println("--- Configuración del Recolector ---");
  Serial.printf("  RMS Threshold: %.0f (mínimo absoluto)\n", THRESHOLD_RMS);
  Serial.printf("  RMS Factor:    %.1fx sobre baseline\n", RMS_FACTOR);
  Serial.printf("  Grabación:     %us total (2s pre-roll + 3s live)\n",
                RECORD_TOTAL_SECONDS);
  Serial.printf("  ENV Interval:  %lu min\n",
                (unsigned long)(ENV_INTERVAL_MS / 60000));
  Serial.printf("  Ring Buffer:   %u muestras (%u KB)\n",
                RING_BUF_SAMPLES, (RING_BUF_SAMPLES * 2) / 1024);
  Serial.printf("  FFT:           %u bins (%.1f Hz/bin) — solo metadatos\n",
                FFT_SAMPLES, (float)SAMPLE_RATE / FFT_SAMPLES);
  Serial.println("------------------------------------\n");

  // === Lanzar tareas FreeRTOS ===

  // Core 0: Captura I2S (prioridad alta)
  // Solo se lanza si el hardware está OK
  if (systemState != STATE_ERROR) {
    xTaskCreatePinnedToCore(audioCaptureTask,   // Función
                            "I2S_Capture",      // Nombre
                            4096,               // Stack (bytes)
                            NULL,               // Parámetro
                            3,                  // Prioridad (alta)
                            &captureTaskHandle, // Handle
                            0                   // Core 0
    );

    // Core 1: Análisis RMS + FFT + Grabación (prioridad media)
    xTaskCreatePinnedToCore(audioAnalysisTask, "RMS_FFT_Rec",
                            16384, // Stack grande: FFT buffers
                            NULL,
                            2, // Prioridad media
                            &analysisTaskHandle,
                            1 // Core 1
    );
  }

  // Core 1: LEDs (prioridad baja — siempre activa)
  xTaskCreatePinnedToCore(ledTask, "LED_FSM", 2048, NULL,
                          1, // Prioridad baja
                          &ledTaskHandle, 1);

  // Core 1: Botón (prioridad baja — siempre activa)
  xTaskCreatePinnedToCore(buttonTask, "Button", 2048, NULL, 1,
                          &buttonTaskHandle, 1);

  Serial.println("[OK] Todas las tareas FreeRTOS lanzadas.");
  Serial.println("     Sistema ACTIVO. Monitoreando audio...\n");
}

// =============================================================================
// LOOP — Vacío (toda la lógica vive en tareas FreeRTOS)
// =============================================================================
void loop() {
  // El loop de Arduino no se usa. FreeRTOS maneja todo.
  // Ponemos un delay largo para que no consuma CPU innecesariamente.
  vTaskDelay(pdMS_TO_TICKS(10000));
}
