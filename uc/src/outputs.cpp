#include "village/outputs.h"

#include <Arduino.h>

#include "village/build_config.h"
#include "village/core/types.h"
#include "village/device_state.h"
#include "village/pins.h"

namespace village {

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
    digitalWrite(pin, LOW);
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
  digitalWrite(pins::WASTE_LED_ORGANIC, organic ? HIGH : LOW);
  digitalWrite(pins::WASTE_LED_PLASTIC, plastic ? HIGH : LOW);
  digitalWrite(pins::WASTE_LED_PAPER, paper ? HIGH : LOW);
}

void allOutputsOff() {
  digitalWrite(pins::PUMP_GATE, LOW);
  for (int i = 0; i < pins::STREETLIGHT_LAMP_COUNT; ++i) {
    digitalWrite(pins::STREETLIGHT_LEDS[i], LOW);
  }
  digitalWrite(pins::WASTE_LED_ORGANIC, LOW);
  digitalWrite(pins::WASTE_LED_PLASTIC, LOW);
  digitalWrite(pins::WASTE_LED_PAPER, LOW);
  for (int i = 0; i < 3; ++i) digitalWrite(pins::BIN_TRIG[i], LOW);
}

}  // namespace village
