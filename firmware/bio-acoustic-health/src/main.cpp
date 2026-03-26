// =============================================================================
// BIO-ALERT — Sistema de Monitoreo Bioacústico
// Prueba de Integración de Hardware v3.0
// Plataforma: ESP32-S3 | Framework: Arduino | PlatformIO
// =============================================================================
// Cambios v3.0:
//   - Añadido cálculo de ZCR (Zero-Crossing Rate) para filtrado frecuencial.
//   - LED amarillo ahora requiere doble condición: RMS > umbral Y ZCR > umbral.
//   - Histéresis en ZCR para evitar falsos positivos por ruido de fondo.
//   - Telemetría mejorada: Serial imprime RMS y ZCR separados por tabulación.
// =============================================================================
// Historial:
//   v2.0 - PWM LEDs 50%, INPUT_PULLUP, UMBRAL_RUIDO=1000, SD no bloquea.
//   v1.0 - Prueba de hardware inicial.
// =============================================================================

#include <Arduino.h>
#include <driver/i2s.h>
#include <SPI.h>
#include <SD.h>

// =============================================================================
// DEFINICIÓN DE PINES
// =============================================================================

// --- Micrófono I2S (INMP441) ---
#define I2S_WS   15   // Word Select (LRCLK)
#define I2S_SCK  16   // Bit Clock (BCLK)
#define I2S_SD   17   // Serial Data (DOUT del micrófono)
#define I2S_PORT I2S_NUM_0

// --- Módulo Micro SD (SPI) ---
#define SD_CS    10   // Chip Select
#define SPI_MOSI 11
#define SPI_SCK  12
#define SPI_MISO 13

// --- LEDs Indicadores (controlados por PWM) ---
#define GREEN_LED  4
#define YELLOW_LED 5
#define RED_LED    6

// --- Pulsador de Sincronización ---
// NOTA: Sin resistencia externa. Se usa INPUT_PULLUP interno.
//       Presionado = LOW (conecta a GND).
#define BTN_SYNC 7

// =============================================================================
// CONSTANTES DE CONFIGURACIÓN
// =============================================================================

// Frecuencia de muestreo del micrófono (Hz)
static const uint32_t SAMPLE_RATE     = 16000;

// Umbral de volumen RMS para activar el LED amarillo
static const int32_t  UMBRAL_RUIDO    = 1000;

// Umbral de ZCR (Zero-Crossing Rate) — cruces por buffer.
// Valores altos = sonido agudo. Valor inicial de calibración.
static const int32_t  UMBRAL_ZCR      = 30;

// Zona muerta (histéresis) para el conteo de cruces por cero.
// Muestras con valor absoluto menor a este umbral se consideran "silencio"
// y no cuentan como cruce. Evita falsos positivos por ruido de fondo.
static const int16_t  ZCR_HISTERESIS  = 50;

// Tiempo que permanece encendido el LED amarillo al detectar ruido (ms)
static const uint32_t DURACION_ALERTA = 100;

// Tamaño del buffer de lectura I2S (en número de muestras)
static const size_t   BUFFER_SAMPLES  = 256;

// --- Parámetros de PWM para LEDs ---
// Brillo al 50%: duty cycle 127 de 255 (resolución 8 bits)
static const uint8_t  LED_BRILLO_50   = 127;
static const uint8_t  LED_APAGADO     = 0;

// =============================================================================
// VARIABLES GLOBALES
// =============================================================================

// Buffer para muestras de audio (16 bits)
int16_t audioBuffer[BUFFER_SAMPLES];

// Flag para saber si la SD se inicializó correctamente
bool sdDisponible = false;

// =============================================================================
// FUNCIONES AUXILIARES — LEDs (PWM)
// =============================================================================

/**
 * @brief Enciende un LED al 50% de brillo usando PWM.
 * @param pin Pin del LED.
 */
void encenderLED(uint8_t pin) {
  analogWrite(pin, LED_BRILLO_50);
}

/**
 * @brief Apaga un LED (duty cycle = 0).
 * @param pin Pin del LED.
 */
void apagarLED(uint8_t pin) {
  analogWrite(pin, LED_APAGADO);
}

/**
 * @brief Inicializa los 3 LEDs como salidas y los apaga.
 */
void inicializarLEDs() {
  pinMode(GREEN_LED, OUTPUT);
  pinMode(YELLOW_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);

  apagarLED(GREEN_LED);
  apagarLED(YELLOW_LED);
  apagarLED(RED_LED);

  Serial.println("[OK] LEDs inicializados (PWM, apagados).");
}

/**
 * @brief Hace parpadear un LED al 50% de brillo un número de veces.
 * @param pin        Pin del LED.
 * @param veces      Número de parpadeos.
 * @param duracionMs Duración de cada encendido/apagado (ms).
 */
void parpadearLED(uint8_t pin, uint8_t veces, uint32_t duracionMs) {
  for (uint8_t i = 0; i < veces; i++) {
    encenderLED(pin);
    delay(duracionMs);
    apagarLED(pin);
    delay(duracionMs);
  }
}

// =============================================================================
// FUNCIONES AUXILIARES — Botón
// =============================================================================

/**
 * @brief Inicializa el botón de sincronización usando INPUT_PULLUP.
 *        Ya no hay resistencia pull-up externa; se usa la interna del ESP32-S3.
 */
void inicializarBoton() {
  pinMode(BTN_SYNC, INPUT_PULLUP);
  Serial.println("[OK] Botón BTN_SYNC inicializado (INPUT_PULLUP interno).");
}

// =============================================================================
// FUNCIONES AUXILIARES — Tarjeta SD
// =============================================================================

/**
 * @brief Inicializa la tarjeta Micro SD usando pines SPI personalizados.
 * @return true si la inicialización fue exitosa, false en caso contrario.
 */
bool inicializarSD() {
  Serial.println("[...] Inicializando tarjeta Micro SD...");

  // Configurar el bus SPI con los pines personalizados
  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, SD_CS);

  // Intentar montar la tarjeta SD
  if (!SD.begin(SD_CS, SPI)) {
    Serial.println("[ERROR] ¡No se pudo inicializar la tarjeta SD!");
    Serial.println("        Verifica:");
    Serial.println("        - Que la tarjeta esté insertada correctamente.");
    Serial.println("        - Que la tarjeta esté formateada en FAT32.");
    Serial.println("        - Las conexiones SPI (CS=10, MOSI=11, SCK=12, MISO=13).");
    return false;
  }

  // Mostrar información de la tarjeta
  uint8_t cardType = SD.cardType();
  if (cardType == CARD_NONE) {
    Serial.println("[ERROR] No se detectó ninguna tarjeta SD.");
    return false;
  }

  Serial.print("[OK] Tarjeta SD detectada. Tipo: ");
  switch (cardType) {
    case CARD_MMC:  Serial.println("MMC");   break;
    case CARD_SD:   Serial.println("SDSC");  break;
    case CARD_SDHC: Serial.println("SDHC");  break;
    default:        Serial.println("Desconocido"); break;
  }

  uint64_t cardSize = SD.cardSize() / (1024 * 1024);
  Serial.printf("     Tamaño total: %llu MB\n", cardSize);

  return true;
}

// =============================================================================
// FUNCIONES AUXILIARES — Micrófono I2S
// =============================================================================

/**
 * @brief Inicializa el bus I2S para lectura del micrófono INMP441.
 *        Configuración: 16 bits, 16 kHz, canal izquierdo (L/R a GND).
 * @return true si la inicialización fue exitosa, false en caso contrario.
 */
bool inicializarI2S() {
  Serial.println("[...] Inicializando bus I2S para micrófono INMP441...");

  // Configuración del driver I2S
  i2s_config_t i2s_config = {
    .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate          = SAMPLE_RATE,
    .bits_per_sample      = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format       = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count        = 8,
    .dma_buf_len          = 256,
    .use_apll             = false,
    .tx_desc_auto_clear   = false,
    .fixed_mclk           = 0
  };

  // Configuración de pines I2S
  i2s_pin_config_t pin_config = {
    .bck_io_num   = I2S_SCK,
    .ws_io_num    = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num  = I2S_SD
  };

  // Instalar el driver I2S
  esp_err_t err = i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  if (err != ESP_OK) {
    Serial.printf("[ERROR] No se pudo instalar el driver I2S (código: %d)\n", err);
    return false;
  }

  // Configurar los pines I2S
  err = i2s_set_pin(I2S_PORT, &pin_config);
  if (err != ESP_OK) {
    Serial.printf("[ERROR] No se pudieron configurar los pines I2S (código: %d)\n", err);
    return false;
  }

  Serial.println("[OK] Bus I2S configurado correctamente (16-bit, 16kHz, canal izquierdo).");
  return true;
}

// =============================================================================
// SETUP
// =============================================================================
void setup() {
  // --- Comunicación Serial ---
  Serial.begin(115200);
  delay(1500);

  Serial.println("=========================================");
  Serial.println("  BIO-ALERT | Prueba de Hardware v3.0");
  Serial.println("  PWM 50% | ZCR + RMS | Pull-up interno");
  Serial.println("=========================================");
  Serial.println();

  // --- 1. Inicializar LEDs (PWM) ---
  inicializarLEDs();

  // --- 2. Inicializar Botón (INPUT_PULLUP) ---
  inicializarBoton();

  // --- 3. Inicializar Tarjeta SD ---
  sdDisponible = inicializarSD();

  if (sdDisponible) {
    // Éxito: parpadeo rápido del LED verde al 50% (3 veces)
    parpadearLED(GREEN_LED, 3, 150);
    Serial.println("[OK] Tarjeta SD lista. LED verde parpadeó 3 veces.");
  } else {
    // Fallo: encender LED rojo al 50% de brillo (NO detener el sistema)
    encenderLED(RED_LED);
    Serial.println("[!!] LED ROJO encendido (50%) — Fallo en la tarjeta SD.");
    Serial.println("     El sistema CONTINÚA sin almacenamiento SD.");
  }

  Serial.println();

  // --- 4. Inicializar Micrófono I2S ---
  if (!inicializarI2S()) {
    encenderLED(RED_LED);
    Serial.println("[FATAL] No se pudo inicializar I2S. Sistema detenido.");
    while (true) { delay(1000); }
  }

  Serial.println();
  Serial.println("=========================================");
  Serial.printf("  Umbral RMS: %d | Umbral ZCR: %d\n", UMBRAL_RUIDO, UMBRAL_ZCR);
  Serial.println("  LED amarillo = RMS > umbral Y ZCR > umbral");
  Serial.println("  - Habla o aplaude cerca del micrófono.");
  Serial.println("  - Presiona el botón BTN_SYNC (pin 7).");
  Serial.println("=========================================");
  Serial.println();
}

// =============================================================================
// LOOP
// =============================================================================
void loop() {
  // -------------------------------------------------------------------------
  // 1. LECTURA DEL MICRÓFONO I2S — CÁLCULO DE RMS Y ZCR
  // -------------------------------------------------------------------------
  size_t bytesRead = 0;

  esp_err_t result = i2s_read(
    I2S_PORT,
    audioBuffer,
    sizeof(audioBuffer),
    &bytesRead,
    portMAX_DELAY
  );

  int32_t volumen = 0;
  int32_t zcr     = 0;

  if (result == ESP_OK && bytesRead > 0) {
    int samplesRead = bytesRead / sizeof(int16_t);
    int64_t sumaCuadrados = 0;
    int32_t cruces = 0;

    // Estado de signo de la muestra anterior para detección de cruces.
    // 0 = dentro de zona muerta, 1 = positiva, -1 = negativa.
    int8_t signoAnterior = 0;

    for (int i = 0; i < samplesRead; i++) {
      int32_t muestra = (int32_t)audioBuffer[i];

      // --- Acumular para RMS ---
      sumaCuadrados += muestra * muestra;

      // --- Conteo de ZCR con histéresis ---
      // Solo consideramos la muestra si supera la zona muerta.
      // Esto evita que el ruido de fondo (oscilaciones mínimas
      // alrededor de cero) infle artificialmente el ZCR.
      int8_t signoActual = 0;
      if (muestra > ZCR_HISTERESIS) {
        signoActual = 1;
      } else if (muestra < -ZCR_HISTERESIS) {
        signoActual = -1;
      }
      // Si la muestra está dentro de [-ZCR_HISTERESIS, +ZCR_HISTERESIS],
      // signoActual queda en 0 y no se registra ningún cruce.

      if (signoActual != 0 && signoAnterior != 0 && signoActual != signoAnterior) {
        cruces++;
      }

      // Actualizar el signo anterior solo si salimos de la zona muerta
      if (signoActual != 0) {
        signoAnterior = signoActual;
      }
    }

    // RMS = raíz cuadrada del promedio de los cuadrados
    volumen = (int32_t)sqrt((double)sumaCuadrados / samplesRead);
    zcr = cruces;

    // Telemetría: formato tabulado para monitor serial y calibración
    Serial.printf("RMS: %d \t ZCR: %d\n", volumen, zcr);
  } else {
    Serial.println("[ERROR] Fallo al leer datos del I2S.");
  }

  // -------------------------------------------------------------------------
  // 2. LÓGICA DE LED AMARILLO — Detección de Chillido Agudo (PWM 50%)
  //    Doble condición: sonido fuerte (RMS) Y frecuencia alta (ZCR)
  // -------------------------------------------------------------------------
  if (volumen > UMBRAL_RUIDO && zcr > UMBRAL_ZCR) {
    encenderLED(YELLOW_LED);
    delay(DURACION_ALERTA);
    apagarLED(YELLOW_LED);
  }

  // -------------------------------------------------------------------------
  // 3. LÓGICA DEL BOTÓN DE SINCRONIZACIÓN
  //    Presionado = LOW (pull-up INTERNO vía INPUT_PULLUP)
  // -------------------------------------------------------------------------
  if (digitalRead(BTN_SYNC) == LOW) {
    Serial.println("¡Botón presionado! Sincronización manual solicitada.");
    encenderLED(GREEN_LED);
  } else {
    apagarLED(GREEN_LED);
  }
}
