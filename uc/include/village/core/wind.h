#pragma once

#include <cstdint>

namespace village {

// The turbine circuit, as wired on this board (2026-11-20):
//
//   generator + ──▶|── (blue LED) ──┬── ADC (GPIO 33)
//                                   │
//                                  [R] 47 Ω
//                                   │
//                                  GND
//
// So the ADC reads the voltage ACROSS THE RESISTOR, never the generator's own
// voltage.  The LED only conducts once the generator is above its forward
// voltage, which was measured at 2.8 V while it is lit; below that there is no
// current at all, and **this circuit cannot say what the generator voltage is**.
//
// From the resistor voltage:
//   current      I = Vr / R
//   generator V  = Vr + Vled        (only while the LED conducts)
//   power        P = V * I
//
// These are named constants because they are properties of the hardware, not
// tuning knobs; `WindConfig` carries them so a different resistor or LED can be
// measured and entered without a firmware change.
inline constexpr uint16_t kDefaultWindSenseOhms = 47;
inline constexpr uint16_t kDefaultWindLedForwardMv = 2800;
// Below this the reading is the ADC's own noise, not current.  A small value is
// deliberate: 20 mV across 47 Ω is 0.43 mA, and anything at or below it is shown
// as "no measurable output" rather than as a generator voltage invented from
// the LED's forward voltage.
inline constexpr uint16_t kDefaultWindNoiseFloorMv = 20;

struct WindPower {
  /** The configuration is usable (a non-zero resistor). */
  bool valid = false;
  /** The resistor voltage is above the noise floor, so current is flowing. */
  bool measuring = false;
  uint16_t resistor_mv = 0;
  /** The generator estimate, and whether it means anything. */
  uint16_t voltage_mv = 0;
  bool has_voltage = false;
  float current_ma = 0.0f;
  float power_mw = 0.0f;
};

/**
 * The whole wind calculation, in one place.
 *
 * Below the noise floor every output is zero and `has_voltage` is false: the LED
 * is not conducting, so there is no current to divide and no way to estimate the
 * generator voltage.  That is not "0 V" — it is "not measurable", and the page
 * shows a dash rather than 2.8 V for a stopped windmill.
 */
inline WindPower computeWindPower(uint16_t resistor_mv, uint16_t sense_ohms,
                                  uint16_t led_forward_mv,
                                  uint16_t noise_floor_mv) {
  WindPower out{};
  out.resistor_mv = resistor_mv;
  if (sense_ohms == 0) return out;  // invalid configuration, not a reading
  out.valid = true;
  out.measuring = resistor_mv > noise_floor_mv;
  if (!out.measuring) return out;
  out.current_ma = static_cast<float>(resistor_mv) / static_cast<float>(sense_ohms);
  out.voltage_mv = static_cast<uint16_t>(resistor_mv + led_forward_mv);
  out.has_voltage = true;
  // mV/1000 is volts and the current is already in mA, so V * mA / 1000 = mW.
  out.power_mw = (static_cast<float>(out.voltage_mv) / 1000.0f) * out.current_ma;
  return out;
}

}  // namespace village
