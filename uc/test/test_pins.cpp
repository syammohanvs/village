#include "minitest.h"
#include "village/pins.h"

using namespace village;

TEST(pin_map_has_eighteen_unique_exposed_pins) {
  CHECK(pins::kAssignedPinCount == 18);
  CHECK(pins::assignedPinsAreUnique());
  for (std::size_t i = 0; i < pins::kAssignedPinCount; ++i) {
    CHECK(pins::isExposed(pins::kAssignedPins[i]));
    CHECK(!pins::isFlashPin(pins::kAssignedPins[i]));
  }
}

TEST(pin_map_uses_adc1_only_for_analogue) {
  CHECK(pins::isSafeAnalog(pins::SOIL_MOISTURE_ADC));
  CHECK(pins::isSafeAnalog(pins::RESERVOIR_SENSE_ADC));
  CHECK(pins::isSafeAnalog(pins::LDR_ADC));
  CHECK(!pins::isAdc2(pins::SOIL_MOISTURE_ADC));
  CHECK(!pins::isAdc2(pins::RESERVOIR_SENSE_ADC));
  CHECK(!pins::isAdc2(pins::LDR_ADC));
  // ADC2 pins can still be digital outputs.
  CHECK(pins::isAdc2(pins::RESERVOIR_EXCITE));
  CHECK(pins::isSafeOutput(pins::RESERVOIR_EXCITE));
}

TEST(pin_map_avoids_strapping_flash_and_input_only_outputs) {
  CHECK(!pins::isSafeOutput(0));
  CHECK(!pins::isSafeOutput(2));
  CHECK(!pins::isSafeOutput(5));
  CHECK(!pins::isSafeOutput(12));
  CHECK(!pins::isSafeOutput(15));
  CHECK(!pins::isSafeOutput(6));
  CHECK(!pins::isSafeOutput(10));
  CHECK(!pins::isSafeOutput(34));
  CHECK(!pins::isSafeOutput(35));
  CHECK(!pins::isSafeOutput(36));
  CHECK(!pins::isSafeOutput(39));
  CHECK(!pins::isSafeOutput(1));
  CHECK(!pins::isSafeOutput(3));
}

TEST(waste_leds_share_the_free_header_side) {
  // The three indicators are wired together on the free header edge.
  CHECK(pins::WASTE_LED_ORGANIC == 21);
  CHECK(pins::WASTE_LED_PLASTIC == 22);
  CHECK(pins::WASTE_LED_PAPER == 23);
  // Moved off the old ADC-capable pin so the lamps and the LDR keep D32/D33.
  CHECK(pins::WASTE_LED_ORGANIC != 33);
  // The named spare stays free.
  CHECK(pins::SPARE_SAFE_OUTPUT != pins::WASTE_LED_ORGANIC);
  CHECK(pins::SPARE_SAFE_OUTPUT != pins::WASTE_LED_PLASTIC);
  CHECK(pins::SPARE_SAFE_OUTPUT != pins::WASTE_LED_PAPER);
}

TEST(pump_gate_shares_the_free_header_side) {
  // The pump gate sits on the free header side, beside the waste LEDs.
  CHECK(pins::PUMP_GATE == 19);
  CHECK(pins::SPARE_SAFE_OUTPUT == 26);
  CHECK(pins::PUMP_GATE != 26);
  CHECK(pins::PUMP_GATE != pins::WASTE_LED_ORGANIC);
  CHECK(pins::PUMP_GATE != pins::WASTE_LED_PLASTIC);
  CHECK(pins::PUMP_GATE != pins::WASTE_LED_PAPER);
}

TEST(pin_map_outputs_and_echoes_are_sane) {
  CHECK(pins::isSafeOutput(pins::PUMP_GATE));
  CHECK(pins::isSafeOutput(pins::BIN_TRIG[0]));
  CHECK(pins::isSafeOutput(pins::BIN_TRIG[1]));
  CHECK(pins::isSafeOutput(pins::BIN_TRIG[2]));
  // All five lamps now share one pin (D13), so there is only one pin to
  // check rather than one per lamp.
  CHECK(pins::isSafeLampOutput(pins::STREETLIGHT_LED_PIN));
  CHECK(pins::STREETLIGHT_LED_PIN == 13);
  CHECK(pins::STREETLIGHT_LAMP_COUNT == 5);
  // GPIO12 is a strapping pin: still banned as a general output, but
  // allowed as a lamp output when wired source-side (kept as a function
  // check even though it is no longer used for a lamp).
  CHECK(!pins::isSafeOutput(12));
  CHECK(pins::isSafeLampOutput(12));
  CHECK(pins::isSafeLampOutput(13));
  CHECK(!pins::isSafeLampOutput(2));
  CHECK(!pins::isSafeLampOutput(5));
  CHECK(!pins::isSafeLampOutput(15));
  CHECK(pins::isSafeOutput(pins::WASTE_LED_ORGANIC));
  CHECK(pins::isSafeOutput(pins::WASTE_LED_PLASTIC));
  CHECK(pins::isSafeOutput(pins::WASTE_LED_PAPER));
  // Echo pins may be input-only, but they must be exposed and non-flash.
  for (int i = 0; i < 3; ++i) {
    CHECK(pins::isExposed(pins::BIN_ECHO[i]));
    CHECK(!pins::isFlashPin(pins::BIN_ECHO[i]));
  }
  // The one remaining safe output is deliberately spare.
  CHECK(pins::isSafeOutput(pins::SPARE_SAFE_OUTPUT));
  CHECK(pins::SPARE_SAFE_OUTPUT != pins::PUMP_GATE);
}

TEST(pin_map_leaves_uart_and_boot_pins_alone) {
  for (std::size_t i = 0; i < pins::kAssignedPinCount; ++i) {
    CHECK(pins::kAssignedPins[i] != 1);
    CHECK(pins::kAssignedPins[i] != 3);
    CHECK(pins::kAssignedPins[i] != 0);
  }
  CHECK(pins::kBoardProfile != nullptr);
  CHECK(pins::kPinMapVersion != nullptr);
}
