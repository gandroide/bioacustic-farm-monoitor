// =============================================================================
// Proyecto: BIO-ALERT (AXIS.ops)
// Nodo: BIO-ACOUSTIC-BREAD (Módulo de Cría / Maternidad)
// Estado: PLACEHOLDER / EN ESPERA
// =============================================================================
//
// Este archivo main.cpp es un esqueleto estructural para el futuro
// desarrollo de la lógica del nodo "Bread".
//
// A diferencia del nodo "Health" (que monitorea chillidos y alertas
// respiratorias), este nodo estará enfocado en el entorno de cría.
//
// FUTURAS IMPLEMENTACIONES:
// - [ ] Definir pines para sensores ambientales (Temperatura, Humedad).
// - [ ] Lógica de recolección de datos específica para maternidad.
// - [ ] Protocolo de comunicación con el Data-Mule o directo a Supabase.
// - [ ] Gestión de energía optimizada.
// =============================================================================

#include <Arduino.h>

void setup() {
  // Iniciar comunicación serial para telemetría
  Serial.begin(115200);

  // Pequeña pausa para dar tiempo a que el Mac abra el puerto USB
  delay(2000);

  Serial.println("=========================================");
  Serial.println("  BIO-ALERT | Nodo: BIO-ACOUSTIC-BREAD");
  Serial.println("  Estado: Modulo base inicializado (Vacio)");
  Serial.println("=========================================");
}

void loop() {
  // El bucle principal está inactivo por ahora.
  // Aquí vivirá la lógica de monitoreo en el futuro.

  Serial.println("[BREAD] Nodo en espera de programación de hardware...");

  // Pausa de 5 segundos para no saturar la consola
  delay(5000);
}