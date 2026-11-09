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
}  // namespace

void setupOutputs() {
  // Pump first: LOW before the pin becomes an output.
  digitalWrite(pins::PUMP_GATE, LOW);
  pinMode(pins::PUMP_GATE, OUTPUT);

  for (int i = 0; i < pins::STREETLIGHT_LAMP_COUNT; ++i) {
    digitalWrite(pins::STREETLIGHT_LEDS[i], LOW);
    pinMode(pins::STREETLIGHT_LEDS[i], OUTPUT);
  }
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
  const bool allowed = on && VILLAGE_PUMP_COMMISSIONED == 1 &&
                       rt.config.irrigation.pump_enabled;
  digitalWrite(pins::PUMP_GATE, allowed ? HIGH : LOW);
}

void applyStreetlights(bool on) {
  const bool allowed = on && rt.config.light.installed;
  for (int i = 0; i < pins::STREETLIGHT_LAMP_COUNT; ++i) {
    digitalWrite(pins::STREETLIGHT_LEDS[i], allowed ? HIGH : LOW);
  }
}

void applyWasteCategory(WasteCategory category) {
  bool organic = false, plastic = false, paper = false;
  categoryLeds(category, organic, plastic, paper);
  digitalWrite(pins::WASTE_LED_ORGANIC, wasteLedLevel(organic));
  digitalWrite(pins::WASTE_LED_PLASTIC, wasteLedLevel(plastic));
  digitalWrite(pins::WASTE_LED_PAPER, wasteLedLevel(paper));
}

void allOutputsOff() {
  digitalWrite(pins::PUMP_GATE, LOW);
  for (int i = 0; i < pins::STREETLIGHT_LAMP_COUNT; ++i) {
    digitalWrite(pins::STREETLIGHT_LEDS[i], LOW);
  }
  digitalWrite(pins::WASTE_LED_ORGANIC, wasteLedLevel(false));
  digitalWrite(pins::WASTE_LED_PLASTIC, wasteLedLevel(false));
  digitalWrite(pins::WASTE_LED_PAPER, wasteLedLevel(false));
  for (int i = 0; i < 3; ++i) digitalWrite(pins::BIN_TRIG[i], LOW);
}

}  // namespace village
