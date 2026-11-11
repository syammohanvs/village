#include "village/outputs.h"

#include <Arduino.h>

#include "village/build_config.h"
#include "village/core/types.h"
#include "village/device_state.h"
#include "village/pins.h"

namespace village {

namespace {
// The waste pins are normally dark until a category is commanded.  The
// bench-test override (VILLAGE_WASTE_LEDS_ALWAYS_ON) holds all three lit so a
// freshly connected LED lights immediately; it never touches the pump.
inline int wasteLedLevel(bool on) {
  return (VILLAGE_WASTE_LEDS_ALWAYS_ON == 1 || on) ? HIGH : LOW;
}

// The pump gate is LOW unless the two commissioning gates allow it.  The
// bench-drive build (VILLAGE_PUMP_BENCH_DRIVE) holds it HIGH so the MOSFET can
// be measured with a dummy load; that build must never see a real pump.
inline int pumpGateLevel(bool on) {
  const bool active = VILLAGE_PUMP_BENCH_DRIVE == 1 || on;
  const bool level = VILLAGE_PUMP_DRIVE_INVERTED == 1 ? !active : active;
  return level ? HIGH : LOW;
}
}  // namespace

void setupOutputs() {
  // Pump first: the gate level is written before the pin becomes an output.
  // In a normal build that level is LOW; the bench-drive build holds HIGH.
  digitalWrite(pins::PUMP_GATE, pumpGateLevel(false));
  pinMode(pins::PUMP_GATE, OUTPUT);

  // All five lamps share one pin, so one write drives them all.
  digitalWrite(pins::STREETLIGHT_LED_PIN, LOW);
  pinMode(pins::STREETLIGHT_LED_PIN, OUTPUT);
  const int waste[] = {pins::WASTE_LED_ORGANIC, pins::WASTE_LED_PLASTIC,
                       pins::WASTE_LED_PAPER};
  for (int pin : waste) {
    digitalWrite(pin, wasteLedLevel(false));
    pinMode(pin, OUTPUT);
  }

  for (int i = 0; i < 3; ++i) {
    digitalWrite(pins::BIN_TRIG[i], LOW);
    pinMode(pins::BIN_TRIG[i], OUTPUT);
    pinMode(pins::BIN_ECHO[i], INPUT);
  }

  // The reservoir excitation pin is high impedance except during a
  // measurement.  No pull-up or pull-down is used.
  pinMode(pins::RESERVOIR_EXCITE, INPUT);

  pinMode(pins::SOIL_MOISTURE_ADC, INPUT);
  pinMode(pins::LDR_ADC, INPUT);
  analogSetPinAttenuation(pins::SOIL_MOISTURE_ADC, ADC_11db);
  analogSetPinAttenuation(pins::RESERVOIR_SENSE_ADC, ADC_11db);
  analogSetPinAttenuation(pins::LDR_ADC, ADC_11db);

  allOutputsOff();
}

void applyPump(bool on) {
  const bool allowed =
      VILLAGE_PUMP_BENCH_DRIVE == 1 ||
      (on && VILLAGE_PUMP_COMMISSIONED == 1 && rt.config.irrigation.pump_enabled);
  digitalWrite(pins::PUMP_GATE, pumpGateLevel(allowed));
}

void applyStreetlights(bool on) {
  const bool allowed = on && rt.config.light.installed;
  // All five lamps share one pin, so one write drives them all.
  digitalWrite(pins::STREETLIGHT_LED_PIN, allowed ? HIGH : LOW);
}

void applyWasteCategory(WasteCategory category) {
  bool organic = false, plastic = false, paper = false;
  categoryLeds(category, organic, plastic, paper);
  digitalWrite(pins::WASTE_LED_ORGANIC, wasteLedLevel(organic));
  digitalWrite(pins::WASTE_LED_PLASTIC, wasteLedLevel(plastic));
  digitalWrite(pins::WASTE_LED_PAPER, wasteLedLevel(paper));
}

void allOutputsOff() {
  digitalWrite(pins::PUMP_GATE, pumpGateLevel(false));
  digitalWrite(pins::STREETLIGHT_LED_PIN, LOW);
  digitalWrite(pins::WASTE_LED_ORGANIC, wasteLedLevel(false));
  digitalWrite(pins::WASTE_LED_PLASTIC, wasteLedLevel(false));
  digitalWrite(pins::WASTE_LED_PAPER, wasteLedLevel(false));
  for (int i = 0; i < 3; ++i) digitalWrite(pins::BIN_TRIG[i], LOW);
}

}  // namespace village
