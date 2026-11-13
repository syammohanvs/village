#include "minitest.h"
#include <string>

#include "village/core/config.h"
#include "village/core/solar.h"

using namespace village;

namespace {
// 3.3 V panel, a red LED at about 2 V, 220 ohm series resistor.
// V across the resistor = 1.3 V, so I = 1300/220 = 5.909 mA and
// P = 3.3 V * 5.909 mA = 19.5 mW.
constexpr uint16_t kPanelMv = 3300;
constexpr uint16_t kJunctionMv = 2000;
constexpr uint16_t kSenseOhms = 220;
}  // namespace

TEST(solar_power_is_voltage_times_current) {
  const SolarPower p = computeSolarPower(kPanelMv, kJunctionMv, kSenseOhms);
  CHECK(p.valid);
  CHECK(p.drop_mv == 1300);
  CHECK(p.current_ma > 5.9f && p.current_ma < 5.92f);
  CHECK(p.power_mw > 19.4f && p.power_mw < 19.6f);
}

TEST(solar_power_is_zero_in_the_dark) {
  // No light: both taps read the same, so there is no drop and no power.
  const SolarPower p = computeSolarPower(0, 0, kSenseOhms);
  CHECK(p.valid);
  CHECK(p.drop_mv == 0);
  CHECK(p.current_ma == 0.0f);
  CHECK(p.power_mw == 0.0f);
}

TEST(solar_power_refuses_a_junction_above_the_panel) {
  // Swapped pins or a wiring fault: the junction cannot be above the panel.
  // The number is clamped rather than turned into a negative current, and
  // `valid` is false so the UI does not present it as a real reading.
  const SolarPower p = computeSolarPower(1000, 3000, kSenseOhms);
  CHECK(!p.valid);
  CHECK(p.drop_mv == 0);
  CHECK(p.current_ma == 0.0f);
}

TEST(solar_power_needs_a_resistor) {
  // A zero ohm sense resistor would divide by zero; report nothing instead.
  const SolarPower p = computeSolarPower(3300, 2000, 0);
  CHECK(!p.valid);
  CHECK(p.current_ma == 0.0f);
  CHECK(p.power_mw == 0.0f);
}

TEST(solar_power_scales_with_the_resistor) {
  // The same drop through 110 ohm is twice the current, and therefore twice
  // the power, which is what makes the measurement meaningful.
  const SolarPower half = computeSolarPower(kPanelMv, kJunctionMv, 220);
  const SolarPower double_ = computeSolarPower(kPanelMv, kJunctionMv, 110);
  CHECK(double_.current_ma > half.current_ma * 1.9f);
  CHECK(double_.current_ma < half.current_ma * 2.1f);
  CHECK(double_.power_mw > half.power_mw * 1.9f);
}

TEST(solar_sense_resistor_must_be_plausible) {
  DeviceConfig c;
  ConfigError err;
  CHECK(validateConfig(c, err));   // the default 220 ohm is valid

  c.solar.sense_ohms = 0;
  CHECK(!validateConfig(c, err));
  CHECK(err.field == std::string("solar.sense_ohms"));

  c.solar.sense_ohms = 20000;
  CHECK(!validateConfig(c, err));
}
