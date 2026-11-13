// Solar panel power from two ADC readings.
//
// The panel feeds a series resistor and then the LED.  One ADC reads the panel
// side of that resistor, the other the junction between the resistor and the
// LED, so the voltage across the resistor is the difference and the current is
// I = V / R.  Panel voltage times current is the power the panel is delivering.
//
// Kept in the portable core (no Arduino headers) so the arithmetic can be
// tested on the host and the API only has to read two numbers.
#pragma once

#include <cstdint>

namespace village {

struct SolarPower {
  int32_t drop_mv;    // voltage across the sense resistor
  float current_ma;   // milliamps through the LED
  float power_mw;     // milliwatts delivered by the panel
  bool valid;         // false when the junction reads above the panel
};

inline SolarPower computeSolarPower(uint16_t panel_mv, uint16_t junction_mv,
                                    uint16_t sense_ohms) {
  SolarPower out{};
  out.drop_mv = static_cast<int32_t>(panel_mv) - static_cast<int32_t>(junction_mv);
  // A junction above the panel means the wiring is wrong or the pins are
  // swapped.  Clamping is deliberate: a negative current would become a
  // nonsense power figure, and the `valid` flag tells the UI not to trust it.
  out.valid = out.drop_mv >= 0 && sense_ohms > 0;
  if (out.drop_mv < 0) out.drop_mv = 0;
  if (sense_ohms == 0) {
    out.current_ma = 0.0f;
    out.power_mw = 0.0f;
    return out;
  }
  out.current_ma = static_cast<float>(out.drop_mv) / static_cast<float>(sense_ohms);
  // mV/1000 is volts and current is already in mA, so V * mA / 1000 = mW.
  out.power_mw = (static_cast<float>(panel_mv) / 1000.0f) * out.current_ma;
  return out;
}

}  // namespace village
