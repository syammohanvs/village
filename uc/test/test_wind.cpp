#include "minitest.h"
#include "village/core/wind.h"

using namespace village;

// The exhibit's own numbers: 47 ohm, a blue LED measured at 2.8 V while lit.
static WindPower measure(uint16_t resistor_mv, uint16_t noise_mv = 20) {
  return computeWindPower(resistor_mv, kDefaultWindSenseOhms,
                          kDefaultWindLedForwardMv, noise_mv);
}

TEST(wind_resistor_voltage_becomes_current_voltage_and_power) {
  // 230 mV across 47 ohm = 4.8936 mA; the generator is that plus the lit LED's
  // 2.8 V = 3.03 V; power = 3.03 V x 4.8936 mA = 14.83 mW.  This is the example
  // the card shows, and every figure comes from the one measurement.
  const WindPower p = measure(230);
  CHECK(p.valid);
  CHECK(p.measuring);
  CHECK(p.has_voltage);
  CHECK(p.resistor_mv == 230);
  CHECK_NEAR(p.current_ma, 4.8936f, 0.001f);
  CHECK(p.voltage_mv == 3030);
  CHECK_NEAR(p.power_mw, 14.83f, 0.02f);
}

TEST(wind_below_the_noise_floor_has_no_voltage_at_all) {
  // A stopped windmill reads the ADC's own noise.  The LED is not conducting, so
  // 2.8 V must NOT be added: there is no current and no way to know the
  // generator's voltage from this circuit.
  for (uint16_t mv : {0, 5, 19, 20}) {
    const WindPower p = measure(mv);
    CHECK(p.valid);
    CHECK(!p.measuring);
    CHECK(!p.has_voltage);
    CHECK(p.voltage_mv == 0);
    CHECK(p.current_ma == 0.0f);
    CHECK(p.power_mw == 0.0f);
  }
}

TEST(wind_just_above_the_floor_is_a_real_reading) {
  // One millivolt over the floor is measurable: 21 mV / 47 = 0.4468 mA,
  // 2.821 V, 1.26 mW.
  const WindPower p = measure(21);
  CHECK(p.measuring);
  CHECK(p.has_voltage);
  CHECK_NEAR(p.current_ma, 0.4468f, 0.001f);
  CHECK(p.voltage_mv == 2821);
  CHECK_NEAR(p.power_mw, 1.26f, 0.02f);
}

TEST(wind_scale_is_linear_in_the_resistor_voltage) {
  const WindPower a = measure(100);
  const WindPower b = measure(200);
  CHECK(a.measuring && b.measuring);
  CHECK_NEAR(b.current_ma, a.current_ma * 2.0f, 0.001f);
  // The generator voltage is not proportional: two different resistor readings
  // differ by their own difference, with the same 2.8 V on top.
  CHECK(static_cast<int>(b.voltage_mv) - static_cast<int>(a.voltage_mv) == 100);
  CHECK_NEAR(b.power_mw,
             (static_cast<float>(b.voltage_mv) / 1000.0f) * b.current_ma, 0.01f);
}

TEST(wind_a_zero_resistor_is_invalid_not_a_reading) {
  const WindPower p = computeWindPower(230, 0, kDefaultWindLedForwardMv,
                                       kDefaultWindNoiseFloorMv);
  CHECK(!p.valid);
  CHECK(!p.measuring);
  CHECK(p.current_ma == 0.0f);
  CHECK(p.power_mw == 0.0f);
}
