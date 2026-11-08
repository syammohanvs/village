#include "minitest.h"
#include "village/core/config.h"

using namespace village;

namespace {
DeviceConfig defaults() { return DeviceConfig{}; }
}  // namespace

TEST(config_defaults_are_valid_and_conservative) {
  DeviceConfig c = defaults();
  ConfigError err;
  CHECK(validateConfig(c, err));
  CHECK(c.irrigation.pump_enabled == false);
  CHECK(c.irrigation.auto_enabled == true);
  CHECK(c.reservoir.calibrated == false);
  CHECK(!soilCalibrated(c.soil));
  c.soil.calibrated = true;
  CHECK(soilCalibrated(c.soil));
}

TEST(config_rejects_identical_or_too_close_soil_endpoints) {
  DeviceConfig c = defaults();
  ConfigError err;
  c.soil.wet_raw = c.soil.dry_raw;
  CHECK(!validateConfig(c, err));
  CHECK(err.field != nullptr);

  c = defaults();
  c.soil.wet_raw = 2600;  // only 200 apart, min span 400
  CHECK(!validateConfig(c, err));

  c = defaults();
  c.soil.wet_raw = 4000;
  c.soil.dry_raw = 0;
  CHECK(validateConfig(c, err));
}

TEST(config_accepts_either_soil_polarity) {
  DeviceConfig c = defaults();
  ConfigError err;
  c.soil.dry_raw = 1100;
  c.soil.wet_raw = 2800;
  c.soil.calibrated = true;
  CHECK(validateConfig(c, err));

  float pct = -1;
  c.soil.dry_raw = 2800;
  c.soil.wet_raw = 1100;
  CHECK(soilPercent(c.soil, 2800, pct));
  CHECK_NEAR(pct, 0.0, 0.001);
  CHECK(soilPercent(c.soil, 1100, pct));
  CHECK_NEAR(pct, 100.0, 0.001);
  CHECK(soilPercent(c.soil, 1950, pct));
  CHECK_NEAR(pct, 50.0, 0.001);

  c.soil.dry_raw = 1100;
  c.soil.wet_raw = 2800;
  CHECK(soilPercent(c.soil, 1100, pct));
  CHECK_NEAR(pct, 0.0, 0.001);
  CHECK(soilPercent(c.soil, 2800, pct));
  CHECK_NEAR(pct, 100.0, 0.001);
}

TEST(config_clamps_soil_percentage_and_rejects_bad_span) {
  DeviceConfig c = defaults();
  c.soil.calibrated = true;
  float pct = -1;
  CHECK(soilPercent(c.soil, 0, pct));
  CHECK_NEAR(pct, 100.0, 0.001);
  CHECK(soilPercent(c.soil, 4095, pct));
  CHECK_NEAR(pct, 0.0, 0.001);

  c.soil.calibrated = true;
  c.soil.min_span_raw = 4000;
  CHECK(!soilCalibrated(c.soil));
  CHECK(!soilPercent(c.soil, 2000, pct));
}

TEST(config_rejects_bad_irrigation_relation) {
  DeviceConfig c = defaults();
  ConfigError err;
  c.irrigation.dry_start_pct = 60;
  c.irrigation.stop_pct = 55;
  CHECK(!validateConfig(c, err));

  c = defaults();
  c.irrigation.max_pulse_ms = 1000;
  c.irrigation.pulse_ms = 4000;
  CHECK(!validateConfig(c, err));

  c = defaults();
  c.irrigation.max_cumulative_ms = 4000;
  c.irrigation.pulse_ms = 8000;
  CHECK(!validateConfig(c, err));
}

TEST(config_rejects_bad_bin_geometry) {
  DeviceConfig c = defaults();
  ConfigError err;
  c.bins[1].full_cm = 59;
  c.bins[1].empty_cm = 60;
  CHECK(!validateConfig(c, err));

  c = defaults();
  c.bins[2].near_full_pct = 95;
  c.bins[2].full_pct = 90;
  CHECK(!validateConfig(c, err));

  c = defaults();
  c.bins[0].max_range_cm = 30;
  c.bins[0].empty_cm = 60;
  CHECK(!validateConfig(c, err));
}

TEST(config_rejects_inverted_reservoir_and_light_thresholds) {
  DeviceConfig c = defaults();
  ConfigError err;
  c.reservoir.wet_threshold_mv = 2500;
  c.reservoir.dry_threshold_mv = 1000;
  CHECK(!validateConfig(c, err));

  c = defaults();
  c.light.dark_threshold = 2500;
  c.light.bright_threshold = 1600;
  CHECK(!validateConfig(c, err));

  c = defaults();
  c.waste.indicate_ms = 40000;
  CHECK(!validateConfig(c, err));
}
