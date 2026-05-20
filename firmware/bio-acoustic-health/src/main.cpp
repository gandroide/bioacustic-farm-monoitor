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
#define USE_SD_CARD true

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

// I2S shift: el INMP441 entrega datos en bits altos de la palabra de 32 bits.
// >> 14 da buena dinámica sin clipping; bajar a 12-13 para más volumen.
static const uint8_t I2S_SHIFT = 14;

// DC blocker IIR HPF: y[n] = (x[n] - x[n-1]) + R · y[n-1]
// R = 1019/1024 ≈ 0.9951 → corte ≈ 12 Hz a 16 kHz. Estado continuo entre
// bloques: evita los clicks rítmicos que produce restar la media por bloque.
static const int32_t HPF_R_Q10 = 1019; // R en formato Q10 (1024 = 1.0)

// FFT (para metadatos del dataset, NO como trigger)
static const uint16_t FFT_SAMPLES = 1024; // Debe ser potencia de 2

// Bloque de análisis RMS + FFT
static const uint16_t RMS_BLOCK_SAMPLES =
    FFT_SAMPLES; // Mismo tamaño para reusar buffer

// --- Umbral RMS para trigger de alerta ---
static const float THRESHOLD_RMS = 500.0f; // Ajustar según ambiente real
// RMS_FACTOR: Smart Button alterna entre dos multiplicadores sobre baseline
static const float RMS_FACTOR_SENSITIVE = 1.5f;
static const float RMS_FACTOR_STRICT = 2.5f;
static volatile float RMS_FACTOR = RMS_FACTOR_SENSITIVE;

// --- Filtro de banda para el trigger ---
// Los chillidos de lechón se concentran típicamente en 1.5-5 kHz.
// Disparamos solo si la frecuencia dominante de la FFT cae en esta banda;
// música y voz humana suelen tener dominantes fuera (sub-1 kHz).
static const float TRIGGER_FREQ_MIN_HZ = 1500.0f;
static const float TRIGGER_FREQ_MAX_HZ = 5000.0f;

// --- Onset detection: anti-música sostenida ---
// Disparamos solo si el RMS sube de golpe respecto al bloque previo
// (chillido = ataque brusco, música/voz = energía sostenida).
// Umbral expresado como múltiplo del baseline actual.
static const float ONSET_DELTA_FACTOR = 1.0f;

// Baseline rodante: suavizado exponencial
static const float BASELINE_ALPHA = 0.02f;

// --- Grabación: 8 segundos total (2s pre-roll + 6s live) ---
static const uint32_t RECORD_TOTAL_SECONDS = 8;
static const uint32_t PREROLL_SECONDS = 2;
static const uint32_t LIVE_SECONDS = 6;
static const uint32_t RECORD_BYTES =
    SAMPLE_RATE * (BITS_PER_SAMPLE / 8) * NUM_CHANNELS * RECORD_TOTAL_SECONDS;
static const uint32_t LIVE_BYTES =
    SAMPLE_RATE * (BITS_PER_SAMPLE / 8) * NUM_CHANNELS * LIVE_SECONDS;
static const size_t SD_WRITE_BUF = 4096; // 4 KB por escritura a SD

// --- Muestreo Ambiental Periódico ---
static const uint32_t ENV_INTERVAL_MS = 1800000; // 30 minutos en ms

// --- Anti-bucle: warmup al boot y cooldown post-grabación ---
// Durante estos periodos no se permite disparar grabaciones; el baseline
// sí sigue actualizándose para estabilizarse.
static const uint32_t WARMUP_MS = 10000;  // 10 s tras boot
static const uint32_t COOLDOWN_MS = 5000; // 5 s tras cada grabación

// --- SD llena: margen mínimo libre antes de pausar grabaciones ---
static const uint64_t SD_FULL_THRESHOLD_BYTES = 50ULL * 1024 * 1024; // 50 MB
static const uint32_t SD_CHECK_INTERVAL_MS = 30000; // cada 30 s

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
  STATE_PAIRING,    // Modo emparejamiento — Todos parpadean
  STATE_SD_FULL,    // SD sin espacio — Rojo+Amarillo alternados a 1 Hz
  STATE_PAUSED      // Safe Eject — SD desmontada, Verde+Amarillo fijos
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

// Snapshot del pre-roll: se copia bajo mutex al inicio de cada grabación
// para evitar que Core 0 sobrescriba los samples mientras los escribimos a SD.
static int16_t prerollSnapshot[PREROLL_SAMPLES];

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

// Timestamps para warmup (tras boot) y cooldown (tras cada grabación)
static uint32_t bootTimeMs = 0;
static uint32_t lastRecordingEndMs = 0;

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

  // INMP441 es un mic I2S de 24-bit; se lee como 32-bit y se convierte
  // a 16-bit por software (shift >> I2S_SHIFT) para reducir ruido de fondo.
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
static void buildFilename(char *dest, size_t destLen, bool isEnv,
                          float rmsValue) {
  uint32_t uptimeSec = millis() / 1000;
  // Formatear RMS con 1 decimal, reemplazando '.' por '-' para compatibilidad
  // FAT32
  int rmsInt = (int)rmsValue;
  int rmsDec = (int)((rmsValue - rmsInt) * 10);
  if (rmsDec < 0)
    rmsDec = -rmsDec;
  if (isEnv) {
    snprintf(dest, destLen, "/ENV_%lu_RMS%d-%d.wav", (unsigned long)uptimeSec,
             rmsInt, rmsDec);
  } else {
    snprintf(dest, destLen, "/REC_%lu_RMS%d-%d.wav", (unsigned long)uptimeSec,
             rmsInt, rmsDec);
  }
}

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
 *        Cuando USE_SD_CARD=false siempre devuelve false (modo mock).
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
 * @brief Graba 8 segundos de audio: 2s pre-roll del Ring Buffer + 6s live I2S.
 *        Escribe en chunks para evitar perder muestras.
 * @param isEnv true si es captura ambiental periódica
 * @param currentRMS Valor RMS para logging
 * @param filename Nombre del archivo (ya construido por el caller para que
 *        coincida con el registrado en el CSV)
 * @return true si la grabación fue exitosa
 */
static bool recordWavToSD(bool isEnv, float currentRMS, const char *filename) {
#if USE_SD_CARD
  // Last-mile check: si la SD se llenó entre chequeos periódicos, abortar.
  if (isSDFull()) {
    Serial.println("[REC] Abortado: SD sin espacio suficiente.");
    systemState = STATE_SD_FULL;
    return false;
  }

  eventCounter++;

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
  // Copiamos TODO el pre-roll a un buffer estático bajo mutex para aislarlo
  // del Core 0 antes de escribir a SD. Tarda ~1-2 ms (memcpy en SRAM).
  const size_t chunkSamples = SD_WRITE_BUF / sizeof(int16_t); // 2048 muestras
  int16_t sdBuf[SD_WRITE_BUF / sizeof(int16_t)];

  xSemaphoreTake(rbMutex, portMAX_DELAY);
  size_t snapAvail = rb_available();
  size_t samplesToWrite =
      (snapAvail < PREROLL_SAMPLES) ? snapAvail : PREROLL_SAMPLES;
  size_t snapStart = rbReadIdx;
  for (size_t i = 0; i < samplesToWrite; i++) {
    prerollSnapshot[i] = ringBuffer[(snapStart + i) % RING_BUF_SAMPLES];
  }
  // Consumir solo lo que realmente copiamos
  rbReadIdx = (snapStart + samplesToWrite) % RING_BUF_SAMPLES;
  xSemaphoreGive(rbMutex);

  // Escribir el snapshot a SD en chunks (sin mutex, ya está aislado en RAM)
  size_t prerollOffset = 0;
  while (prerollOffset < samplesToWrite) {
    size_t thisChunk = chunkSamples;
    if (prerollOffset + thisChunk > samplesToWrite)
      thisChunk = samplesToWrite - prerollOffset;

    size_t bytesToWrite = thisChunk * sizeof(int16_t);
    size_t written = wavFile.write((const uint8_t *)&prerollSnapshot[prerollOffset],
                                   bytesToWrite);
    totalBytesWritten += written;
    prerollOffset += thisChunk;

    if (written != bytesToWrite) {
      Serial.println("[ERROR] Escritura incompleta (pre-roll).");
      break;
    }
  }

  Serial.printf("[REC] Pre-roll: %lu bytes escritos\n",
                (unsigned long)totalBytesWritten);

  // === FASE 2: Grabar los segundos restantes desde el ring buffer ===
  // Se consume del ring buffer (alimentado a 16 kHz por audioCaptureTask)
  // en lugar de competir con captureTask por el driver I2S. Eso eliminaba
  // samples por contención y dejaba el audio acelerado ~2× al reproducir.
  // El HPF ya está aplicado en captureTask antes de meter al ring buffer.
  uint32_t liveBytesTarget = RECORD_BYTES - totalBytesWritten;
  uint32_t liveWritten = 0;
  uint32_t liveStartMs = millis();

  while (liveWritten < liveBytesTarget) {
    size_t samplesThisRound = chunkSamples;
    size_t bytesRemaining = liveBytesTarget - liveWritten;
    size_t samplesRemaining = bytesRemaining / sizeof(int16_t);
    if (samplesThisRound > samplesRemaining)
      samplesThisRound = samplesRemaining;

    // Esperar a tener suficientes muestras en el ring buffer.
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

  uint32_t liveDurationMs = millis() - liveStartMs;
  Serial.printf("[REC] Live phase: %lu ms (esperado ~%lu ms) — %s\n",
                (unsigned long)liveDurationMs,
                (unsigned long)(LIVE_SECONDS * 1000),
                (liveDurationMs < LIVE_SECONDS * 1000 - 300)   ? "⚠ RÁPIDO"
                : (liveDurationMs > LIVE_SECONDS * 1000 + 300) ? "⚠ LENTO"
                                                               : "✓");

  wavFile.close();
  Serial.printf("[REC] Completado: %s (%lu bytes total)\n", filename,
                (unsigned long)totalBytesWritten);

  return (totalBytesWritten >= RECORD_BYTES);
#else
  // --- MOCK: Simular grabación sin hardware SD ---
  (void)currentRMS;
  eventCounter++;
  Serial.printf("[MOCK] Simulando %s (%s, %us)...\n", filename,
                isEnv ? "ENV" : "ALERTA", RECORD_TOTAL_SECONDS);
  vTaskDelay(pdMS_TO_TICKS(RECORD_TOTAL_SECONDS * 1000));
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
    csvFile.println("Archivo,Tipo,MAC,Uptime_ms,Evento,Baseline_RMS,Pico_RMS,"
                    "Freq_Dom_Hz,Temp_C");
  }

  String mac = getMACAddress();
  unsigned long uptime = millis();
  float tempC = temperatureRead();

  csvFile.printf("%s,%s,%s,%lu,%lu,%.1f,%.1f,%.1f,%.1f\n", wavFilename,
                 isEnv ? "ENV" : "REC", mac.c_str(), uptime,
                 (unsigned long)eventCounter, lastBaseline, lastPeakRMS,
                 lastFreqHz, tempC);

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
  // Buffers estáticos para no comer stack (la tarea es pequeña, 6 KB).
  static int32_t readBuf32[I2S_READ_SAMPLES];
  static int16_t readBuf16[I2S_READ_SAMPLES];
  size_t bytesRead = 0;

  uint32_t totalSamples = 0;
  uint32_t lastReportMs = millis();

  Serial.println("[Core 0] Tarea de captura I2S iniciada.");

  for (;;) {
    esp_err_t err = i2s_read(I2S_PORT, readBuf32, sizeof(readBuf32), &bytesRead,
                             portMAX_DELAY);
    if (err == ESP_OK && bytesRead > 0) {
      size_t samplesRead = bytesRead / sizeof(int32_t);

      // DC blocker IIR (estado continuo entre bloques).
      // Sin esto, el INMP441 leído como 32-bit tiene offset enorme que
      // infla el RMS de "silencio" y satura los primeros bins de la FFT.
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
      totalSamples += samplesRead;
    }

    uint32_t now = millis();
    if (now - lastReportMs >= 5000) {
      Serial.printf("[I2S-RATE] %lu sps\n",
                    (unsigned long)(totalSamples / 5));
      totalSamples = 0;
      lastReportMs = now;
    }
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
    // El primer RMS tras boot incluye un transient del I2S que infla
    // el baseline ~30 s. Recalibramos UNA vez al terminar el warmup
    // con el RMS estable de ese momento → threshold operativo de inmediato.
    static bool baselineRecalibrated = false;
    bool warmupJustEnded = !baselineRecalibrated &&
                           (millis() - bootTimeMs) >= WARMUP_MS;
    if (!baselineInitialized || warmupJustEnded) {
      rmsBaseline = rms;
      baselineInitialized = true;
      if (warmupJustEnded) {
        baselineRecalibrated = true;
        Serial.printf("[BASELINE] Recalibrado tras warmup: %.0f\n", rms);
      }
    } else {
      rmsBaseline =
          BASELINE_ALPHA * rms + (1.0f - BASELINE_ALPHA) * rmsBaseline;
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
    float freqDominant =
        (float)maxBin * (float)SAMPLE_RATE / (float)FFT_SAMPLES;
    lastFreqHz = freqDominant;

    // === 4. Telemetría periódica (~500ms) ===
    static uint8_t printCounter = 0;
    printCounter++;
    if (printCounter >= 8) {
      printCounter = 0;
      float threshold = rmsBaseline * RMS_FACTOR;
      if (threshold < THRESHOLD_RMS)
        threshold = THRESHOLD_RMS;
      uint32_t nextEnvSec =
          (ENV_INTERVAL_MS - (millis() - lastEnvCaptureMs)) / 1000;
      Serial.printf("RMS: %.0f | Base: %.0f | Freq: %.0f Hz | Thr: %.0f | "
                    "NextENV: %lus | %s\n",
                    rms, rmsBaseline, freqDominant, threshold,
                    (unsigned long)nextEnvSec,
                    (systemState == STATE_MONITORING)  ? "MONITOR"
                    : (systemState == STATE_RECORDING) ? "REC"
                    : (systemState == STATE_ERROR)     ? "ERROR"
                    : (systemState == STATE_SD_FULL)   ? "SD_FULL"
                    : (systemState == STATE_PAUSED)    ? "PAUSED"
                                                       : "PAIRING");
    }

    // === Chequeo periódico de espacio en SD ===
    // Solo aplicable en MONITORING/SD_FULL. En PAUSED la SD está desmontada
    // (los reads darían 0) y en ERROR/RECORDING no tiene sentido pisarlo.
    static uint32_t lastSDCheckMs = 0;
    if ((millis() - lastSDCheckMs >= SD_CHECK_INTERVAL_MS) &&
        (systemState == STATE_MONITORING || systemState == STATE_SD_FULL)) {
      lastSDCheckMs = millis();
      bool full = isSDFull();
      if (full && systemState == STATE_MONITORING) {
        Serial.println("[SD] SD casi llena → STATE_SD_FULL");
        systemState = STATE_SD_FULL;
      } else if (!full && systemState == STATE_SD_FULL) {
        Serial.println("[SD] Espacio libre detectado → STATE_MONITORING");
        systemState = STATE_MONITORING;
      }
    }

    // No disparar si no estamos monitoreando
    if (systemState != STATE_MONITORING) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    // === Anti-bucle: warmup tras boot y cooldown tras cada grabación ===
    // El baseline ya se actualizó arriba; aquí solo bloqueamos triggers.
    bool inWarmup = (millis() - bootTimeMs) < WARMUP_MS;
    bool inCooldown = (lastRecordingEndMs != 0) &&
                      ((millis() - lastRecordingEndMs) < COOLDOWN_MS);
    if (inWarmup || inCooldown) {
      continue;
    }

    // === 5. Trigger por RMS + Frecuencia + Onset ===
    // Triple criterio para distinguir chillidos de música/voz:
    //   (a) Nivel: RMS > baseline·factor (con piso absoluto THRESHOLD_RMS)
    //   (b) Banda: frecuencia dominante en TRIGGER_FREQ_MIN..MAX_HZ
    //   (c) Onset: subida brusca respecto al bloque anterior (~64 ms)
    float threshold = rmsBaseline * RMS_FACTOR;
    if (threshold < THRESHOLD_RMS)
      threshold = THRESHOLD_RMS;

    static float prevRMS = 0.0f;
    float deltaRMS = rms - prevRMS;
    prevRMS = rms;

    bool rmsLevelOk = (rms > threshold);
    bool freqInBand = (lastFreqHz >= TRIGGER_FREQ_MIN_HZ &&
                       lastFreqHz <= TRIGGER_FREQ_MAX_HZ);
    bool onsetOk = (deltaRMS > rmsBaseline * ONSET_DELTA_FACTOR);

    bool rmsTriggered = rmsLevelOk && freqInBand && onsetOk;

    // Log de sonidos altos descartados por filtro (útil para tuning).
    // Throttle a 1 evento cada 500 ms para no saturar la serial.
    if (rmsLevelOk && !rmsTriggered) {
      static uint32_t lastFilterLogMs = 0;
      if (millis() - lastFilterLogMs >= 500) {
        lastFilterLogMs = millis();
        Serial.printf("[FILTER] RMS=%.0f alto pero descartado: "
                      "Freq=%.0f Hz [%s], ΔRMS=%.0f [%s]\n",
                      rms, lastFreqHz, freqInBand ? "OK" : "NO",
                      deltaRMS, onsetOk ? "OK" : "NO");
      }
    }

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
        Serial.printf(">>> TRIGGER | RMS=%.0f Thr=%.0f Freq=%.0f Hz "
                      "ΔRMS=%.0f\n",
                      rms, threshold, lastFreqHz, deltaRMS);
        Serial.println("============================================");
      }

      lastPeakRMS = rms;
      lastBaseline = rmsBaseline;
      systemState = STATE_RECORDING;

      // Construir el nombre UNA SOLA VEZ y reusarlo en disco y en el CSV
      // (antes se generaba dos veces, con uptimes distintos → mismatch).
      char filename[48];
      buildFilename(filename, sizeof(filename), isEnv, rms);

      bool ok = recordWavToSD(isEnv, rms, filename);

      if (ok) {
        writeEventCSV(filename, isEnv);

        // Resetear ring buffer post-grabación
        xSemaphoreTake(rbMutex, portMAX_DELAY);
        rbWriteIdx = 0;
        rbReadIdx = 0;
        xSemaphoreGive(rbMutex);

        lastRecordingEndMs = millis();
        systemState = STATE_MONITORING;
        Serial.printf("[OK] Volviendo a MONITOREO (cooldown %lus).\n",
                      (unsigned long)(COOLDOWN_MS / 1000));
      } else {
        Serial.println("[ERROR] Grabación falló. LED ROJO 5s...");
        systemState = STATE_ERROR;
        vTaskDelay(pdMS_TO_TICKS(5000));

        xSemaphoreTake(rbMutex, portMAX_DELAY);
        rbWriteIdx = 0;
        rbReadIdx = 0;
        xSemaphoreGive(rbMutex);

        lastRecordingEndMs = millis();
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

    case STATE_SD_FULL:
      // Rojo + Amarillo alternados a 1 Hz (500 ms cada uno)
      analogWrite(GREEN_LED, 0);
      if ((now - lastToggle) >= 500) {
        ledOn = !ledOn;
        analogWrite(RED_LED, ledOn ? LED_BRILLO : 0);
        analogWrite(YELLOW_LED, ledOn ? 0 : LED_BRILLO);
        lastToggle = now;
      }
      break;

    case STATE_PAUSED:
      // Verde + Amarillo simultáneos fijos: "SD libre, puedes extraerla"
      analogWrite(GREEN_LED, LED_BRILLO);
      analogWrite(YELLOW_LED, LED_BRILLO);
      analogWrite(RED_LED, 0);
      lastToggle = now;
      ledOn = false;
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
          // CLIC CORTO (< 1 segundo): Safe Eject Mode (toggle PAUSED)
          // ============================================================
          if (durationMs < BTN_SHORT_MAX_MS) {
            Serial.printf("[BTN] Clic corto detectado (%lu ms)\n",
                          (unsigned long)durationMs);

            if (systemState == STATE_RECORDING) {
              Serial.println(
                  "[BTN] Ignorado: grabación en curso. Espera y reintenta.");
            } else if (systemState == STATE_PAUSED) {
              // Reanudar: remontar la SD y volver a MONITORING
              Serial.println("[BTN] Reanudando: remontando SD...");
#if USE_SD_CARD
              SPI.begin(SPI_SCK_PIN, SPI_MISO, SPI_MOSI, SD_CS);
              if (!SD.begin(SD_CS, SPI)) {
                Serial.println(
                    "[BTN] [ERROR] No se pudo remontar la SD → STATE_ERROR.");
                systemState = STATE_ERROR;
              } else {
                Serial.println("[BTN] SD remontada OK → STATE_MONITORING.");
                lastRecordingEndMs = millis(); // cooldown post-reanudación
                systemState = STATE_MONITORING;
              }
#else
              systemState = STATE_MONITORING;
              Serial.println("[BTN] (mock) Reanudado → STATE_MONITORING.");
#endif
            } else {
              // Entrar en PAUSED: desmontar SD para extracción segura
              Serial.println("[BTN] Pausando para extracción segura...");
#if USE_SD_CARD
              SD.end();
              Serial.println(
                  "[BTN] SD desmontada. Puedes extraerla con seguridad.");
#endif
              systemState = STATE_PAUSED;
            }
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
  Serial.printf("  Trigger Banda: %.0f - %.0f Hz\n", TRIGGER_FREQ_MIN_HZ,
                TRIGGER_FREQ_MAX_HZ);
  Serial.printf("  Onset Δ:       > %.1fx baseline (anti-sostenido)\n",
                ONSET_DELTA_FACTOR);
  Serial.printf("  Grabación:     %us total (%lus pre-roll + %lus live)\n",
                RECORD_TOTAL_SECONDS, (unsigned long)PREROLL_SECONDS,
                (unsigned long)LIVE_SECONDS);
  Serial.printf("  ENV Interval:  %lu min\n",
                (unsigned long)(ENV_INTERVAL_MS / 60000));
  Serial.printf("  Warmup:        %lus | Cooldown: %lus\n",
                (unsigned long)(WARMUP_MS / 1000),
                (unsigned long)(COOLDOWN_MS / 1000));
  Serial.printf("  SD Full Thr:   %llu MB libres mínimo\n",
                SD_FULL_THRESHOLD_BYTES / (1024ULL * 1024ULL));
  Serial.printf("  I2S:           32-bit→16-bit (shift >> %u)\n", I2S_SHIFT);
  Serial.printf("  Ring Buffer:   %u muestras (%u KB)\n", RING_BUF_SAMPLES,
                (RING_BUF_SAMPLES * 2) / 1024);
  Serial.printf("  FFT:           %u bins (%.1f Hz/bin) — solo metadatos\n",
                FFT_SAMPLES, (float)SAMPLE_RATE / FFT_SAMPLES);
  Serial.println("------------------------------------\n");

  // === Lanzar tareas FreeRTOS ===

  bootTimeMs = millis(); // arranque del warmup anti-bucle

  // Core 0: Captura I2S (prioridad alta)
  // Solo se lanza si el hardware está OK
  if (systemState != STATE_ERROR) {
    xTaskCreatePinnedToCore(audioCaptureTask,   // Función
                            "I2S_Capture",      // Nombre
                            6144,               // Stack (bytes)
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
