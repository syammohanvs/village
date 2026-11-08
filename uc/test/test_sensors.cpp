#include <cmath>

#include "minitest.h"
#include "village/core/bins.h"
#include "village/core/config.h"
#include "village/core/lights.h"
#include "village/core/moisture.h"
#include "village/core/reservoir.h"

using namespace village;

namespace {
DeviceConfig tunedSoil() {
  DeviceConfig c;
  c.soil.dry_raw = 2800;
  c.soil.wet_raw = 1100;
  c.soil.min_span_raw = 400;
  c.soil.samples = 3;
  c.soil.max_age_ms = 5000;
  c.soil.calibrated = true;
  c.irrigation.dry_start_pct = 35;
  c.irrigation.stop_pct = 55;
  return c;
}
}  // namespace

TEST(soil_starts_unavailable_before_any_sample) {
  DeviceConfig c = tunedSoil();
  SoilModel m;
  SoilReading r = m.read(c, 0);
  CHECK(!r.valid);
  CHECK(r.state == SoilState::Unavailable);
  CHECK(r.fault != nullptr);
}

TEST(soil_uncalibrated_reports_no_percentage) {
  DeviceConfig c = tunedSoil();
  c.soil.wet_raw = c.soil.dry_raw;
  SoilModel m;
  m.observe(2000, 1000);
  SoilReading r = m.read(c, 1100);
  CHECK(r.valid);
  CHECK(!r.calibrated);
  CHECK(r.state == SoilState::Uncalibrated);
  CHECK(std::isnan(r.percent));
}

TEST(soil_classifies_dry_adequate_and_wet) {
  DeviceConfig c = tunedSoil();
  SoilModel m;
  const uint16_t raw30 = static_cast<uint16_t>(2800 - 0.30 * 1700);
  const uint16_t raw45 = static_cast<uint16_t>(2800 - 0.45 * 1700);
  const uint16_t raw60 = static_cast<uint16_t>(2800 - 0.60 * 1700);

  m.observe(raw30, 0);
  SoilReading r = m.read(c, 100);
  CHECK(r.state == SoilState::Dry);
  CHECK_NEAR(r.percent, 30.0, 1.0);

  m.reset();
  m.observe(raw45, 0);
  r = m.read(c, 100);
  CHECK(r.state == SoilState::Adequate);
  CHECK_NEAR(r.percent, 45.0, 1.0);

  m.reset();
  m.observe(raw60, 0);
  r = m.read(c, 100);
  CHECK(r.state == SoilState::Wet);
  CHECK_NEAR(r.percent, 60.0, 1.0);
}

TEST(soil_median_filter_ignores_a_spike) {
  DeviceConfig c = tunedSoil();
  c.soil.samples = 5;
  SoilModel m;
  m.observe(2800, 0);
  m.observe(2800, 100);
  m.observe(100, 200);
  m.observe(2800, 300);
  m.observe(2800, 400);
  SoilReading r = m.read(c, 500);
  CHECK_NEAR(r.percent, 0.0, 0.5);
  CHECK(r.raw == 2800);
}

TEST(soil_goes_unavailable_when_the_reading_is_stale) {
  DeviceConfig c = tunedSoil();
  SoilModel m;
  m.observe(2000, 1000);
  SoilReading r = m.read(c, 7000);
  CHECK(!r.valid);
  CHECK(r.state == SoilState::Unavailable);
  CHECK(r.fault != nullptr);
}

TEST(reservoir_needs_confirmation_and_reports_only_states) {
  DeviceConfig c;
  c.reservoir.calibrated = true;
  c.reservoir.wet_threshold_mv = 1200;
  c.reservoir.dry_threshold_mv = 2400;
  c.reservoir.confirm_readings = 3;
  ReservoirModel m;
  m.setThresholds(1200, 2400, 3);

  m.observe(600, 0);
  ReservoirReading r = m.read(c, 10);
  CHECK(r.valid);
  CHECK(r.state == ReservoirState::Unavailable);  // still confirming

  m.observe(600, 1000);
  r = m.read(c, 1010);
  CHECK(r.state == ReservoirState::Unavailable);

  m.observe(600, 2000);
  r = m.read(c, 2010);
  CHECK(r.state == ReservoirState::Available);
  CHECK(r.conductive);
  CHECK(r.millivolts == 600);
}

TEST(reservoir_dry_and_dead_band_hysteresis) {
  DeviceConfig c;
  c.reservoir.calibrated = true;
  ReservoirModel m;
  m.setThresholds(1200, 2400, 3);
  for (int i = 0; i < 3; ++i) m.observe(600, i * 200);
  CHECK(m.read(c, 1000).state == ReservoirState::Available);

  // Into the dead band keeps the stable classification.
  for (int i = 0; i < 3; ++i) m.observe(1800, 2000 + i * 200);
  ReservoirReading held = m.read(c, 3000);
  CHECK(held.state == ReservoirState::Available);

  for (int i = 0; i < 4; ++i) m.observe(2800, 4000 + i * 200);
  ReservoirReading dry = m.read(c, 5000);
  CHECK(dry.state == ReservoirState::Low);
  CHECK(!dry.conductive);
}

TEST(reservoir_uncalibrated_and_stale) {
  DeviceConfig c;
  c.reservoir.calibrated = false;
  ReservoirModel m;
  m.setThresholds(1200, 2400, 1);
  m.observe(600, 1000);
  ReservoirReading r = m.read(c, 1100);
  CHECK(r.valid);
  CHECK(r.state == ReservoirState::Uncalibrated);
  CHECK(r.millivolts == 600);
  CHECK(!r.conductive);

  c.reservoir.calibrated = true;
  r = m.read(c, 7000);
  CHECK(!r.valid);
  CHECK(r.state == ReservoirState::Unavailable);
  CHECK(!r.conductive);
}

TEST(reservoir_threshold_change_invalidates_the_old_state) {
  DeviceConfig c;
  c.reservoir.calibrated = true;
  ReservoirModel m;
  m.setThresholds(1200, 2400, 1);
  m.observe(600, 0);
  CHECK(m.read(c, 10).state == ReservoirState::Available);
  m.setThresholds(700, 2000, 1);
  CHECK(m.read(c, 20).state == ReservoirState::Unavailable);
}

TEST(lights_auto_has_hysteresis_and_delay) {
  DeviceConfig c;
  c.light.installed = true;
  c.light.dark_threshold = 1600;
  c.light.bright_threshold = 2400;
  c.light.stable_ms = 4000;
  LightsModel m;
  m.observeAnalog(1000, 0, c.light);
  LightReading r = m.read(c, 0);
  CHECK(r.brightness == Brightness::Unknown);
  m.observeAnalog(1000, 4000, c.light);
  r = m.read(c, 4000);
  CHECK(r.brightness == Brightness::Dark);
  CHECK(m.output(c, 4000).on);

  // Between the thresholds: stays dark because it was dark.
  m.observeAnalog(2000, 8000, c.light);
  CHECK(m.read(c, 8000).brightness == Brightness::Dark);
  // Above the bright threshold, but only after the stable delay.
  m.observeAnalog(3000, 12000, c.light);
  CHECK(m.read(c, 12000).brightness == Brightness::Dark);
  m.observeAnalog(3000, 16000, c.light);
  CHECK(m.read(c, 16000).brightness == Brightness::Bright);
  CHECK(!m.output(c, 16000).on);

  // A short dark blip does not flip it.
  m.observeAnalog(1000, 20000, c.light);
  m.observeAnalog(3000, 20500, c.light);
  CHECK(m.read(c, 20500).brightness == Brightness::Bright);
}

TEST(lights_stale_sensor_fails_safe_in_auto) {
  DeviceConfig c;
  c.light.installed = true;
  c.light.stable_ms = 0;
  c.light.max_age_ms = 5000;
  LightsModel m;
  m.observeAnalog(3000, 1000, c.light);
  CHECK(m.read(c, 1000).brightness == Brightness::Bright);
  LightReading stale = m.read(c, 7000);
  CHECK(!stale.valid);
  CHECK(stale.brightness == Brightness::Unknown);
  LightOutput out = m.output(c, 7000);
  CHECK(!out.on);
  CHECK(out.reason == &reasons::kLightsAutoUnknown);
}

TEST(lights_digital_mode_and_not_installed) {
  DeviceConfig c;
  c.light.installed = true;
  c.light.digital = true;
  c.light.digital_dark_when_high = true;
  c.light.stable_ms = 0;
  LightsModel m;
  m.observeDigital(true, 0, c.light);
  CHECK(m.read(c, 0).brightness == Brightness::Dark);

  c.light.installed = false;
  LightReading missing = m.read(c, 0);
  CHECK(!missing.installed);
  CHECK(!missing.valid);
  CHECK(missing.brightness == Brightness::Unknown);
  CHECK(missing.raw == 0);
  LightOutput out = m.output(c, 0);
  CHECK(!out.on);
  CHECK(out.reason == &reasons::kLightsNotInstalled);
}

TEST(light_defaults_to_not_installed_and_points_at_the_wiring_docs) {
  DeviceConfig c;
  CHECK(!c.light.installed);
  LightsModel m;
  m.observeAnalog(3000, 1000, c.light);
  LightReading r = m.read(c, 1000);
  CHECK(!r.installed);
  CHECK(!r.valid);
  CHECK(r.brightness == Brightness::Unknown);
  CHECK(r.raw == 0);
  LightOutput out = m.output(c, 1000);
  CHECK(!out.on);
  CHECK(out.reason == &reasons::kLightsNotInstalled);
}

TEST(lights_manual_modes_work_without_a_sensor) {
  DeviceConfig c;
  c.light.installed = true;
  c.light.max_age_ms = 1000;
  LightsModel m;
  m.setMode(LightMode::ManualOn);
  LightOutput on = m.output(c, 999999);
  CHECK(on.on);
  CHECK(on.reason == &reasons::kLightsManualOn);
  m.setMode(LightMode::ManualOff);
  LightOutput off = m.output(c, 999999);
  CHECK(!off.on);
  CHECK(off.reason == &reasons::kLightsManualOff);
}

// ---------------------------------------------------------------------------
// Bins
// ---------------------------------------------------------------------------

namespace {
DeviceConfig binConfig() {
  DeviceConfig c;
  c.bins[0].installed = true;
  c.bins[0].empty_cm = 60;
  c.bins[0].full_cm = 12;
  c.bins[0].near_full_pct = 75;
  c.bins[0].full_pct = 90;
  c.bins[0].median_samples = 5;
  c.bins[0].confirm_readings = 3;
  c.bins[0].max_age_ms = 3000;
  c.bins[0].blind_zone_cm = 3;
  c.bins[0].max_range_cm = 400;
  return c;
}
}  // namespace

TEST(bin_empty_is_available_after_confirmation) {
  DeviceConfig c = binConfig();
  BinModel m;
  for (int i = 0; i < 3; ++i) m.observeDistance(50.0f, c.bins[0], i * 200);
  BinReading r = m.read(c, 0, 500);
  CHECK(r.valid);
  CHECK(r.state == BinState::Available);
  CHECK_NEAR(r.fill_pct, 20.833, 0.1);
  CHECK(r.fault == nullptr);
}

TEST(bin_nearly_full_and_full_thresholds) {
  DeviceConfig c = binConfig();
  BinModel m;
  for (int i = 0; i < 3; ++i) m.observeDistance(20.0f, c.bins[0], i * 200);
  BinReading r = m.read(c, 0, 500);
  CHECK(r.state == BinState::NearlyFull);
  CHECK_NEAR(r.fill_pct, 83.333, 0.2);

  BinModel full;
  for (int i = 0; i < 3; ++i) full.observeDistance(13.0f, c.bins[0], i * 200);
  r = full.read(c, 0, 500);
  CHECK(r.state == BinState::Full);
  CHECK_NEAR(r.fill_pct, 97.916, 0.2);
}

TEST(bin_state_changes_only_after_repeated_readings) {
  DeviceConfig c = binConfig();
  BinModel m;
  for (int i = 0; i < 3; ++i) m.observeDistance(50.0f, c.bins[0], i * 200);
  CHECK(m.read(c, 0, 600).state == BinState::Available);

  m.observeDistance(13.0f, c.bins[0], 800);
  CHECK(m.read(c, 0, 900).state == BinState::Available);
  m.observeDistance(13.0f, c.bins[0], 1000);
  CHECK(m.read(c, 0, 1100).state == BinState::Available);
  m.observeDistance(13.0f, c.bins[0], 1200);
  CHECK(m.read(c, 0, 1300).state == BinState::Available);
  // The 5-sample median needs two more full readings before the state can
  // accumulate its three confirmations.
  m.observeDistance(13.0f, c.bins[0], 1400);
  CHECK(m.read(c, 0, 1500).state == BinState::Available);
  m.observeDistance(13.0f, c.bins[0], 1600);
  CHECK(m.read(c, 0, 1700).state == BinState::Full);
}

TEST(bin_missing_echo_is_unavailable_not_empty) {
  DeviceConfig c = binConfig();
  BinModel m;
  for (int i = 0; i < 3; ++i) m.observeDistance(50.0f, c.bins[0], i * 200);
  CHECK(m.read(c, 0, 600).valid);

  m.observeTimeout(700);
  CHECK(m.read(c, 0, 800).valid);  // one miss does not invalidate
  m.observeTimeout(900);
  BinReading r = m.read(c, 0, 1000);
  CHECK(!r.valid);
  CHECK(r.state == BinState::Unavailable);
  CHECK(std::isnan(r.distance_cm));
  CHECK(std::isnan(r.fill_pct));
  CHECK(r.fault != nullptr);
}

TEST(bin_out_of_range_and_blind_zone) {
  DeviceConfig c = binConfig();
  BinModel m;
  for (int i = 0; i < 3; ++i) m.observeDistance(2.0f, c.bins[0], i * 200);
  BinReading r = m.read(c, 0, 500);
  CHECK(r.state == BinState::Full);
  CHECK(r.near_blind_zone);

  BinModel far;
  far.observeDistance(500.0f, c.bins[0], 0);
  far.observeDistance(500.0f, c.bins[0], 200);
  r = far.read(c, 0, 400);
  CHECK(!r.valid);
  CHECK(r.fault != nullptr);
}

TEST(bin_goes_stale_and_not_installed) {
  DeviceConfig c = binConfig();
  BinModel m;
  for (int i = 0; i < 3; ++i) m.observeDistance(50.0f, c.bins[0], i * 200);
  BinReading r = m.read(c, 0, 5000);
  CHECK(!r.valid);
  CHECK(r.state == BinState::Unavailable);

  c.bins[0].installed = false;
  r = m.read(c, 0, 500);
  CHECK(!r.valid);
  CHECK(r.state == BinState::NotInstalled);
}
