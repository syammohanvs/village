#include "minitest.h"
#include "village/pins.h"

using namespace village;

TEST(pin_map_has_eleven_unique_exposed_pins) {
  // Bins are indicator LEDs only, so the five rangefinder pins are gone.
  CHECK(pins::kAssignedPinCount == 11);
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
  CHECK(pins::isSafeAnalog(pins::SOLAR_PANEL_ADC));
  CHECK(pins::isSafeAnalog(pins::SOLAR_CURRENT_ADC));
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
}

TEST(pump_gate_shares_the_free_header_side) {
  // The pump-switch control sits on the free header side, beside the waste
  // LEDs.
  CHECK(pins::PUMP_GATE == 19);
  CHECK(pins::PUMP_GATE != pins::WASTE_LED_ORGANIC);
  CHECK(pins::PUMP_GATE != pins::WASTE_LED_PLASTIC);
  CHECK(pins::PUMP_GATE != pins::WASTE_LED_PAPER);
}

TEST(pin_map_outputs_are_sane) {
  CHECK(pins::isSafeOutput(pins::PUMP_GATE));
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
}

TEST(no_pin_is_asked_to_do_two_jobs) {
  // GPIO 36 is the solar current sense.  It used to be bin 1's echo, and the
  // collision went unnoticed because the solar pins were not in the
  // assignment list at all -- so the list is what this counts, not the names.
  int occurrences = 0;
  for (std::size_t i = 0; i < pins::kAssignedPinCount; ++i) {
    if (pins::kAssignedPins[i] == pins::SOLAR_CURRENT_ADC) ++occurrences;
  }
  CHECK(occurrences == 1);
  CHECK(pins::SOLAR_CURRENT_ADC == 36);
  // No analogue pin may be shared with anything else either.
  int solar_panel = 0;
  int solar_current = 0;
  for (std::size_t i = 0; i < pins::kAssignedPinCount; ++i) {
    if (pins::kAssignedPins[i] == pins::SOLAR_PANEL_ADC) ++solar_panel;
    if (pins::kAssignedPins[i] == pins::SOLAR_CURRENT_ADC) ++solar_current;
  }
  CHECK(solar_panel == 1);
  CHECK(solar_current == 1);
}

TEST(the_freed_rangefinder_pins_stay_free) {
  // GPIO 4/16 were the I2C bus and 17/18/26 the XSHUT lines.  Nothing uses
  // them now, and they must not creep into the assignment list unnoticed.
  for (int free : pins::kFreePins) {
    CHECK(pins::isExposed(free));
    for (std::size_t i = 0; i < pins::kAssignedPinCount; ++i) {
      CHECK(pins::kAssignedPins[i] != free);
    }
  }
}

TEST(the_three_bin_leds_are_the_only_bin_hardware) {
  CHECK(pins::isSafeOutput(pins::WASTE_LED_ORGANIC));
  CHECK(pins::isSafeOutput(pins::WASTE_LED_PLASTIC));
  CHECK(pins::isSafeOutput(pins::WASTE_LED_PAPER));
  CHECK(pins::WASTE_LED_ORGANIC != pins::WASTE_LED_PLASTIC);
  CHECK(pins::WASTE_LED_PLASTIC != pins::WASTE_LED_PAPER);
  CHECK(pins::WASTE_LED_ORGANIC != pins::WASTE_LED_PAPER);
}

TEST(the_free_pin_is_recorded) {
  // The solar panel voltage moved to VN (39), so D33 is the one genuinely
  // unassigned pin left.  It is output-capable, unlike the old spare, which is
  // why this test no longer insists on input-only.
  CHECK(pins::SPARE_INPUT == 33);
  CHECK(pins::SOLAR_PANEL_ADC == 39);
  CHECK(pins::isExposed(pins::SPARE_INPUT));
  // ...and it is genuinely free: not one of the assigned pins.
  for (std::size_t i = 0; i < pins::kAssignedPinCount; ++i) {
    CHECK(pins::kAssignedPins[i] != pins::SPARE_INPUT);
  }
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
