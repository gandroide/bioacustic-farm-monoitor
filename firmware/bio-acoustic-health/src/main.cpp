// =============================================================================
// BIO-ALERT — Sistema de Monitoreo Bioacústico Autónomo
// Fase: Recolección de Datos para Entrenamiento de IA
// Plataforma: ESP32-S3 | Framework: Arduino + FreeRTOS | PlatformIO
// =============================================================================
//
// Arquitectura de Doble Núcleo:
//   Core 0 → Captura I2S ininterrumpida → Ring Buffer
//   Core 1 → Análisis (RMS + FFT + Baseline) → Grabación WAV + CSV
//
// Trigger permisivo:
//   RMS > baseline × factor  AND  1000 Hz < freqDom < 4000 Hz
//   sostenido ≥ 500 ms  →  Graba 10 s de audio (.wav) + metadatos (.csv)
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

// FFT
static const uint16_t FFT_SAMPLES = 1024; // Debe ser potencia de 2

// Ring Buffer: ~2 segundos de audio = 32000 muestras × 2 bytes = 64 KB
static const size_t RING_BUF_SAMPLES = 32000;

// I2S DMA read block size (muestras por lectura)
static const size_t I2S_READ_SAMPLES = 512;

// --- Umbrales del Disparador (sensibilidad alta para pruebas) ---
// RMS_FACTOR ahora es mutable: el Smart Button alterna entre dos valores.
static const float RMS_FACTOR_SENSITIVE = 1.5f; // Sensible: 50% sobre fondo
static const float RMS_FACTOR_STRICT = 2.5f;    // Estricto: 150% sobre fondo
static volatile float RMS_FACTOR = RMS_FACTOR_SENSITIVE; // Valor activo
static const float FREQ_MIN_HZ = 500.0f;     // Frecuencia dominante mínima
static const float FREQ_MAX_HZ = 5000.0f;    // Frecuencia dominante máxima
static const uint32_t TRIGGER_HOLD_MS = 100; // Disparo casi instantáneo (ms)

// Baseline rodante: suavizado exponencial (alpha bajo = más lento)
static const float BASELINE_ALPHA = 0.02f;

// --- Grabación ---
static const uint32_t RECORD_SECONDS = 10;
static const uint32_t RECORD_BYTES =
    SAMPLE_RATE * (BITS_PER_SAMPLE / 8) * NUM_CHANNELS * RECORD_SECONDS;
static const size_t SD_WRITE_BUF = 4096; // Bytes por escritura a SD (4 KB)

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

// Handle de tareas
static TaskHandle_t captureTaskHandle = NULL;
static TaskHandle_t analysisTaskHandle = NULL;
static TaskHandle_t ledTaskHandle = NULL;
static TaskHandle_t buttonTaskHandle = NULL;

// Buffers de FFT (estáticos en Core 1)
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
 * @brief Escribe la cabecera WAV (44 bytes) al inicio del archivo.
 *        PCM 16-bit, mono, 16 kHz.
 */
static void writeWavHeader(File &file, uint32_t dataBytes) {
  uint32_t fileSize = 36 + dataBytes;
  uint32_t byteRate = SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  uint16_t blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);

  // RIFF chunk
  file.write((const uint8_t *)"RIFF", 4);
  file.write((const uint8_t *)&fileSize, 4);
  file.write((const uint8_t *)"WAVE", 4);

  // fmt sub-chunk
  file.write((const uint8_t *)"fmt ", 4);
  uint32_t fmtSize = 16;
  file.write((const uint8_t *)&fmtSize, 4);
  uint16_t audioFormat = 1; // PCM
  file.write((const uint8_t *)&audioFormat, 2);
  uint16_t numCh = NUM_CHANNELS;
  file.write((const uint8_t *)&numCh, 2);
  uint32_t sr = SAMPLE_RATE;
  file.write((const uint8_t *)&sr, 4);
  file.write((const uint8_t *)&byteRate, 4);
  file.write((const uint8_t *)&blockAlign, 2);
  uint16_t bps = BITS_PER_SAMPLE;
  file.write((const uint8_t *)&bps, 2);

  // data sub-chunk
  file.write((const uint8_t *)"data", 4);
  file.write((const uint8_t *)&dataBytes, 4);
}

/**
 * @brief Graba 10 segundos de audio del I2S directamente a un archivo .wav en
 * la SD.
 *
 * NOTA DE DISEÑO: Durante la grabación, leemos directamente del I2S (bypass
 * del ring buffer). Esto garantiza que no perdemos muestras y que el Core 1
 * tiene control total del flujo de escritura a la SD sin competir con el
 * ring buffer. El Core 0 sigue llenando el ring buffer, pero el Core 1 no
 * lo consume durante estos 10 segundos. Al terminar, el ring buffer se
 * resetea para evitar procesar datos obsoletos.
 */
static bool recordWavToSD() {
#if USE_SD_CARD
  eventCounter++;

  // Generar nombre de archivo: /alerta_001.wav
  char filename[32];
  snprintf(filename, sizeof(filename), "/alerta_%03lu.wav",
           (unsigned long)eventCounter);

  Serial.printf("[REC] Iniciando grabación: %s (%u s)...\n", filename,
                RECORD_SECONDS);

  File wavFile = SD.open(filename, FILE_WRITE);
  if (!wavFile) {
    Serial.printf("[ERROR] No se pudo crear %s\n", filename);
    eventCounter--; // Revertir contador
    return false;
  }

  // Escribir cabecera WAV (se calculan los 320000 bytes de data)
  writeWavHeader(wavFile, RECORD_BYTES);

  // Buffer temporal para lectura I2S → escritura SD
  // Usamos SD_WRITE_BUF / 2 muestras (cada muestra = 2 bytes)
  int16_t sdBuf[SD_WRITE_BUF / sizeof(int16_t)];
  uint32_t totalBytesWritten = 0;
  size_t bytesRead = 0;

  while (totalBytesWritten < RECORD_BYTES) {
    size_t bytesToRead = SD_WRITE_BUF;
    // No leer más de lo necesario en el último bloque
    if (totalBytesWritten + bytesToRead > RECORD_BYTES) {
      bytesToRead = RECORD_BYTES - totalBytesWritten;
    }

    esp_err_t err =
        i2s_read(I2S_PORT, sdBuf, bytesToRead, &bytesRead, pdMS_TO_TICKS(1000));
    if (err != ESP_OK || bytesRead == 0) {
      Serial.println("[ERROR] Fallo de lectura I2S durante grabación.");
      break;
    }

    size_t written = wavFile.write((const uint8_t *)sdBuf, bytesRead);
    if (written != bytesRead) {
      Serial.println("[ERROR] Escritura incompleta a SD.");
      break;
    }
    totalBytesWritten += written;
  }

  wavFile.close();
  Serial.printf("[REC] Grabación completada: %s (%lu bytes)\n", filename,
                (unsigned long)totalBytesWritten);

  return (totalBytesWritten >= RECORD_BYTES);
#else
  // --- MOCK: Simular grabación sin hardware SD ---
  eventCounter++;
  Serial.printf("[MOCK] Simulando grabación de %u segundos (evento #%lu)...\n",
                RECORD_SECONDS, (unsigned long)eventCounter);
  vTaskDelay(pdMS_TO_TICKS(10000)); // Retener STATE_RECORDING → LED amarillo
  Serial.printf("[MOCK] Grabación simulada completada (evento #%lu).\n",
                (unsigned long)eventCounter);
  return true;
#endif
}

// =============================================================================
// GENERACIÓN DE METADATOS — CSV
// =============================================================================

/**
 * @brief Escribe una línea de metadatos en /log_eventos.csv (append).
 *        Crea el archivo con cabecera si no existe.
 */
static void writeEventCSV() {
#if USE_SD_CARD
  const char *csvPath = "/log_eventos.csv";
  bool fileExists = SD.exists(csvPath);

  File csvFile = SD.open(csvPath, FILE_APPEND);
  if (!csvFile) {
    Serial.println("[ERROR] No se pudo abrir/crear log_eventos.csv");
    return;
  }

  // Escribir cabecera si es archivo nuevo
  if (!fileExists) {
    csvFile.println("Nombre_Archivo,MAC_Address,Uptime_ms,Num_Evento,Ruido_"
                    "Fondo_RMS,Pico_RMS_Evento,Frecuencia_Hz,Temp_Core_C");
  }

  // Construir nombre del archivo asociado
  char filename[32];
  snprintf(filename, sizeof(filename), "alerta_%03lu.wav",
           (unsigned long)eventCounter);

  // Obtener datos del sistema
  String mac = getMACAddress();
  unsigned long uptime = millis();
  float tempC = temperatureRead(); // Sensor de temperatura interno del silicio

  // Escribir fila de datos
  csvFile.printf("%s,%s,%lu,%lu,%.1f,%.1f,%.1f,%.1f\n", filename, mac.c_str(),
                 uptime, (unsigned long)eventCounter, lastBaseline, lastPeakRMS,
                 lastFreqHz, tempC);

  csvFile.close();
  Serial.printf("[CSV] Evento #%lu registrado en log_eventos.csv\n",
                (unsigned long)eventCounter);
#else
  // MOCK: Sin SD, no escribir CSV
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
// TAREA: ANÁLISIS + GRABACIÓN (Core 1) — Prioridad Media
// =============================================================================
//
// Extrae bloques de FFT_SAMPLES del ring buffer. Calcula:
//   1. RMS del bloque
//   2. Baseline rodante (media exponencial)
//   3. FFT → frecuencia dominante
//
// Si las condiciones del trigger se cumplen durante >= TRIGGER_HOLD_MS:
//   → Cambia estado a STATE_RECORDING
//   → Graba WAV de 10 s directamente del I2S
//   → Escribe metadatos CSV
//   → Resetea ring buffer y vuelve a STATE_MONITORING
//
// Stack: 16384 bytes (FFT + buffers locales necesitan espacio).
// =============================================================================

static void audioAnalysisTask(void *param) {
  int16_t analysisBuf[FFT_SAMPLES];
  uint32_t triggerStartMs = 0;
  bool triggerActive = false;

  Serial.println("[Core 1] Tarea de análisis + grabación iniciada.");

  for (;;) {
    // Esperar a tener suficientes muestras en el ring buffer
    if (rb_available() < FFT_SAMPLES) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    // Extraer bloque del ring buffer
    size_t got = rb_read(analysisBuf, FFT_SAMPLES);
    if (got < FFT_SAMPLES) {
      vTaskDelay(pdMS_TO_TICKS(5));
      continue;
    }

    // === 1. Calcular RMS ===
    int64_t sumSq = 0;
    for (int i = 0; i < FFT_SAMPLES; i++) {
      int32_t s = (int32_t)analysisBuf[i];
      sumSq += s * s;
    }
    float rms = sqrtf((float)sumSq / FFT_SAMPLES);

    // === 2. Actualizar Baseline rodante ===
    if (!baselineInitialized) {
      rmsBaseline = rms;
      baselineInitialized = true;
    } else {
      // Media exponencial: baseline = alpha * rms + (1 - alpha) * baseline
      rmsBaseline =
          BASELINE_ALPHA * rms + (1.0f - BASELINE_ALPHA) * rmsBaseline;
    }

    // === 3. FFT → Frecuencia Dominante ===
    // Copiar muestras a los arrays de FFT (float)
    for (int i = 0; i < FFT_SAMPLES; i++) {
      vReal[i] = (float)analysisBuf[i];
      vImag[i] = 0.0f;
    }

    FFT.windowing(FFTWindow::Hamming, FFTDirection::Forward);
    FFT.compute(FFTDirection::Forward);
    FFT.complexToMagnitude();

    // Buscar el bin con mayor magnitud (ignorar bin 0 = DC offset)
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

    // === 4. Telemetría periódica (cada ~500 ms, basado en bloques procesados)
    // === Con 16000 Hz y bloques de 1024, procesamos ~15.6 bloques/s.
    // Imprimimos cada 8 bloques ≈ cada ~512 ms.
    static uint8_t printCounter = 0;
    printCounter++;
    if (printCounter >= 8) {
      printCounter = 0;
      Serial.printf("RMS: %.0f | Base: %.0f | Freq: %.0f Hz | Estado: %s\n",
                    rms, rmsBaseline, freqDominant,
                    (systemState == STATE_MONITORING)  ? "MONITOR"
                    : (systemState == STATE_RECORDING) ? "REC"
                    : (systemState == STATE_ERROR)     ? "ERROR"
                                                       : "PAIRING");
    }

    // === 5. Lógica del Disparador ===
    // No disparar si estamos grabando, en error o en pairing
    if (systemState != STATE_MONITORING) {
      triggerActive = false;
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    // Umbral dinámico: RMS debe superar la baseline por un factor
    float threshold = rmsBaseline * RMS_FACTOR;
    // Mínimo absoluto para evitar disparos con baseline muy baja (silencio
    // total)
    if (threshold < 200.0f)
      threshold = 200.0f;

    bool conditionMet = (rms > threshold) && (freqDominant >= FREQ_MIN_HZ) &&
                        (freqDominant <= FREQ_MAX_HZ);

    if (conditionMet) {
      if (!triggerActive) {
        // Inicio de condición sostenida
        triggerActive = true;
        triggerStartMs = millis();
      } else if ((millis() - triggerStartMs) >= TRIGGER_HOLD_MS) {
        // ¡DISPARO! Condición sostenida por >= 500 ms
        Serial.println("============================================");
        Serial.printf(">>> TRIGGER ACTIVADO | RMS=%.0f Thr=%.0f Freq=%.0f Hz\n",
                      rms, threshold, freqDominant);
        Serial.println("============================================");

        // Guardar datos del evento para el CSV
        lastPeakRMS = rms;
        lastFreqHz = freqDominant;
        lastBaseline = rmsBaseline;

        // Cambiar estado visual
        systemState = STATE_RECORDING;

        // Grabar WAV
        bool ok = recordWavToSD();

        if (ok) {
          // --- Grabación exitosa: escribir CSV y volver a monitoreo ---
          writeEventCSV();

          // Resetear ring buffer (datos obsoletos post-grabación)
          xSemaphoreTake(rbMutex, portMAX_DELAY);
          rbWriteIdx = 0;
          rbReadIdx = 0;
          xSemaphoreGive(rbMutex);

          systemState = STATE_MONITORING;
          triggerActive = false;
          Serial.println("[OK] Volviendo a modo MONITOREO.\n");

        } else {
          // --- Grabación FALLÓ: feedback visual de error en campo ---
          Serial.println("============================================");
          Serial.println("[ERROR] recordWavToSD() FALLÓ.");
          Serial.println("        Causa probable: SD no montada o extraída.");
          Serial.println("        LED ROJO activo por 5 segundos...");
          Serial.println("============================================");

          systemState = STATE_ERROR; // LED rojo parpadeo rápido (ledTask)

          // Mantener estado de error visible para el operador en campo
          vTaskDelay(pdMS_TO_TICKS(5000));

          // Resetear ring buffer (datos acumulados durante el error)
          xSemaphoreTake(rbMutex, portMAX_DELAY);
          rbWriteIdx = 0;
          rbReadIdx = 0;
          xSemaphoreGive(rbMutex);

          // Intentar recuperación automática
          systemState = STATE_MONITORING;
          triggerActive = false;
          Serial.println(
              "[RECOVERY] Recuperación automática. Volviendo a MONITOREO.\n");
        }
      }
    } else {
      // Condición rota, resetear timer
      triggerActive = false;
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
  Serial.println("  BIO-ALERT | Recolección de Datos v1.0");
  Serial.println("  ESP32-S3 | FreeRTOS Dual-Core");
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
  Serial.println("--- Configuración del Trigger ---");
  Serial.printf("  RMS Factor:    %.1fx sobre baseline\n", RMS_FACTOR);
  Serial.printf("  Freq. Banda:   %.0f - %.0f Hz\n", FREQ_MIN_HZ, FREQ_MAX_HZ);
  Serial.printf("  Sostener:      %lu ms\n", (unsigned long)TRIGGER_HOLD_MS);
  Serial.printf("  Grabación:     %u s (%lu bytes)\n", RECORD_SECONDS,
                (unsigned long)RECORD_BYTES);
  Serial.printf("  FFT muestras:  %u (resolución: %.1f Hz/bin)\n", FFT_SAMPLES,
                (float)SAMPLE_RATE / FFT_SAMPLES);
  Serial.println("---------------------------------\n");

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

    // Core 1: Análisis + Grabación (prioridad media)
    xTaskCreatePinnedToCore(audioAnalysisTask, "Analysis_Rec",
                            16384, // Stack grande: FFT + buffers
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
