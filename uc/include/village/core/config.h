#pragma once

#include <cmath>
#include <cstdint>

namespace village {

struct SoilConfig {
  uint16_t dry_raw = 2800;
  uint16_t wet_raw = 1100;
  uint16_t min_span_raw = 400;
  uint8_t samples = 9;
  uint16_t max_age_ms = 5000;
};

struct ReservoirConfig {
  uint16_t wet_threshold_mv = 1200;
  uint16_t dry_threshold_mv = 2400;
  uint8_t confirm_readings = 3;
  uint16_t max_age_ms = 5000;
  bool calibrated = false;
};

struct LightConfig {
  bool installed = true;
  bool digital = false;              // false = analogue AO, true = digital DO
  bool analog_bright_high = true;    // module AO rises with light
  bool digital_dark_when_high = true;  // typical LDR module DO
  uint16_t dark_threshold = 1600;    // metric units, dark at or below
  uint16_t bright_threshold = 2400;  // metric units, bright at or above
  uint16_t stable_ms = 4000;
  uint16_t max_age_ms = 5000;
};

struct BinConfig {
  bool installed = true;
  uint16_t empty_cm = 60;
  uint16_t full_cm = 12;
  uint8_t near_full_pct = 75;
  uint8_t full_pct = 90;
  uint8_t median_samples = 5;
  uint8_t confirm_readings = 3;
  uint16_t timeout_us = 30000;
  uint8_t blind_zone_cm = 3;
  uint16_t max_range_cm = 400;
  uint16_t max_age_ms = 3000;
};

struct IrrigationConfig {
  bool auto_enabled = true;
  bool pump_enabled = false;
  uint16_t dry_start_pct = 35;
  uint16_t stop_pct = 55;
  uint32_t dry_confirm_ms = 30000;
  uint32_t pulse_ms = 4000;
  uint32_t max_pulse_ms = 8000;
  uint32_t soak_ms = 45000;
  uint32_t max_cumulative_ms = 15000;
  uint8_t max_pulses = 4;
  uint32_t cooldown_ms = 300000;    // 5 minutes
  uint32_t link_timeout_ms = 30000;
};

struct WasteConfig {
  uint16_t indicate_ms = 8000;
};

struct DeviceConfig {
  uint32_t revision = 1;
  SoilConfig soil;
  ReservoirConfig reservoir;
  LightConfig light;
  BinConfig bins[3];
  IrrigationConfig irrigation;
  WasteConfig waste;
};

struct ConfigError {
  const char* field = "";
  const char* message = "";
};

inline bool soilCalibrated(const SoilConfig& c) {
  if (c.dry_raw > 4095 || c.wet_raw > 4095) return false;
  if (c.min_span_raw < 100) return false;
  const int diff = static_cast<int>(c.dry_raw) - static_cast<int>(c.wet_raw);
  const int span = diff < 0 ? -diff : diff;
  return span >= static_cast<int>(c.min_span_raw);
}

// Maps a raw ADC reading to 0..100 % with either sensor polarity.  Returns
// false when the calibration is unusable; the caller must then show
// "uncalibrated" rather than a percentage.
inline bool soilPercent(const SoilConfig& c, uint16_t raw, float& out) {
  if (!soilCalibrated(c)) return false;
  const float span = static_cast<float>(c.wet_raw) - static_cast<float>(c.dry_raw);
  float pct = (static_cast<float>(raw) - static_cast<float>(c.dry_raw)) / span * 100.0f;
  if (!std::isfinite(pct)) return false;
  if (pct < 0.0f) pct = 0.0f;
  if (pct > 100.0f) pct = 100.0f;
  out = pct;
  return true;
}

inline bool inRange(int v, int lo, int hi) { return v >= lo && v <= hi; }

// Validate a complete configuration.  Returns the first problem, naming the
// field, so the dashboard can show it beside the box that is wrong.  This is
// the same rule the firmware applies before saving to NVS.
inline bool validateConfig(const DeviceConfig& c, ConfigError& err) {
  auto fail = [&err](const char* field, const char* message) {
    err.field = field;
    err.message = message;
    return false;
  };

  // Soil
  if (!inRange(c.soil.dry_raw, 0, 4095) || !inRange(c.soil.wet_raw, 0, 4095)) {
    return fail("soil.dry_raw/wet_raw", "Raw calibration endpoints must be 0..4095.");
  }
  if (!inRange(c.soil.min_span_raw, 100, 4000)) {
    return fail("soil.min_span_raw", "Minimum span must be 100..4000 raw counts.");
  }
  if (!soilCalibrated(c.soil)) {
    return fail("soil.dry_raw/wet_raw",
                "Dry and wet endpoints are too close or identical. They must differ by at least the minimum span.");
  }
  if (!inRange(c.soil.samples, 1, 21)) {
    return fail("soil.samples", "Soil samples must be 1..21.");
  }
  if (!inRange(c.soil.max_age_ms, 500, 60000)) {
    return fail("soil.max_age_ms", "Soil reading age limit must be 500..60000 ms.");
  }

  // Reservoir
  if (!inRange(c.reservoir.wet_threshold_mv, 50, 3200) ||
      !inRange(c.reservoir.dry_threshold_mv, 50, 3200)) {
    return fail("reservoir thresholds", "Reservoir thresholds must be 50..3200 mV.");
  }
  if (static_cast<int>(c.reservoir.dry_threshold_mv) -
          static_cast<int>(c.reservoir.wet_threshold_mv) <
      100) {
    return fail("reservoir.wet/dry", "The dry threshold must be at least 100 mV above the wet threshold.");
  }
  if (!inRange(c.reservoir.confirm_readings, 1, 10)) {
    return fail("reservoir.confirm_readings", "Reservoir confirmation must be 1..10 readings.");
  }
  if (!inRange(c.reservoir.max_age_ms, 500, 60000)) {
    return fail("reservoir.max_age_ms", "Reservoir reading age limit must be 500..60000 ms.");
  }

  // Light
  if (!inRange(c.light.dark_threshold, 0, 4095) ||
      !inRange(c.light.bright_threshold, 0, 4095)) {
    return fail("light thresholds", "Light thresholds must be 0..4095.");
  }
  if (c.light.bright_threshold <= c.light.dark_threshold) {
    return fail("light.bright_threshold",
                "The bright threshold must be above the dark threshold (hysteresis).");
  }
  if (!inRange(c.light.stable_ms, 0, 60000)) {
    return fail("light.stable_ms", "Light stable delay must be 0..60000 ms.");
  }
  if (!inRange(c.light.max_age_ms, 500, 60000)) {
    return fail("light.max_age_ms", "Light reading age limit must be 500..60000 ms.");
  }

  // Bins
  static const char* kBinNames[3] = {"organic", "plastic", "paper"};
  static const char* kFields[10] = {
      "bins[].empty_cm",        "bins[].full_cm",       "bins[].near_full_pct",
      "bins[].full_pct",        "bins[].median_samples", "bins[].confirm_readings",
      "bins[].timeout_us",      "bins[].blind_zone_cm",  "bins[].max_range_cm",
      "bins[].max_age_ms"};
  (void)kBinNames;
  for (int i = 0; i < 3; ++i) {
    const BinConfig& b = c.bins[i];
    if (!inRange(b.empty_cm, 5, 400)) return fail(kFields[0], "Empty distance must be 5..400 cm.");
    if (!inRange(b.full_cm, 2, 398)) return fail(kFields[1], "Full distance must be 2..398 cm.");
    if (b.full_cm + 2 > b.empty_cm) {
      return fail(kFields[1], "Full distance must be at least 2 cm below the empty distance.");
    }
    if (!inRange(b.near_full_pct, 10, 98)) {
      return fail(kFields[2], "Nearly-full percentage must be 10..98.");
    }
    if (!inRange(b.full_pct, 11, 100) || b.full_pct <= b.near_full_pct) {
      return fail(kFields[3], "Full percentage must be above nearly-full and at most 100.");
    }
    if (!inRange(b.median_samples, 1, 9)) {
      return fail(kFields[4], "Bin median samples must be 1..9.");
    }
    if (!inRange(b.confirm_readings, 1, 10)) {
      return fail(kFields[5], "Bin confirmation must be 1..10 readings.");
    }
    if (!inRange(b.timeout_us, 1000, 200000)) {
      return fail(kFields[6], "Echo timeout must be 1000..200000 microseconds.");
    }
    if (!inRange(b.blind_zone_cm, 1, 10)) {
      return fail(kFields[7], "Blind-zone distance must be 1..10 cm.");
    }
    if (!inRange(b.max_range_cm, 20, 400) ||
        b.max_range_cm < b.empty_cm) {
      return fail(kFields[8], "Maximum range must be 20..400 cm and not below the empty distance.");
    }
    if (!inRange(b.max_age_ms, 500, 60000)) {
      return fail(kFields[9], "Bin reading age limit must be 500..60000 ms.");
    }
  }

  // Irrigation
  if (!inRange(c.irrigation.dry_start_pct, 5, 80)) {
    return fail("irrigation.dry_start_pct", "Dry-start threshold must be 5..80 %.");
  }
  if (!inRange(c.irrigation.stop_pct, 11, 95) ||
      c.irrigation.stop_pct < c.irrigation.dry_start_pct + 5) {
    return fail("irrigation.stop_pct",
                "Stop threshold must be at least 5 points above dry-start and at most 95 %.");
  }
  if (!inRange(static_cast<int>(c.irrigation.dry_confirm_ms), 0, 600000)) {
    return fail("irrigation.dry_confirm_ms", "Dry confirmation must be 0..600000 ms.");
  }
  if (!inRange(static_cast<int>(c.irrigation.pulse_ms), 500, 15000)) {
    return fail("irrigation.pulse_ms", "Pulse length must be 500..15000 ms.");
  }
  if (!inRange(static_cast<int>(c.irrigation.max_pulse_ms), 500, 30000) ||
      c.irrigation.max_pulse_ms < c.irrigation.pulse_ms) {
    return fail("irrigation.max_pulse_ms",
                "Maximum pulse must be at least the pulse length and at most 30000 ms.");
  }
  if (!inRange(static_cast<int>(c.irrigation.soak_ms), 1000, 600000)) {
    return fail("irrigation.soak_ms", "Soak interval must be 1000..600000 ms.");
  }
  if (!inRange(static_cast<int>(c.irrigation.max_cumulative_ms), 5000, 120000) ||
      c.irrigation.max_cumulative_ms < c.irrigation.pulse_ms) {
    return fail("irrigation.max_cumulative_ms",
                "Maximum cumulative pump time must be at least one pulse and at most 120000 ms.");
  }
  if (!inRange(c.irrigation.max_pulses, 1, 10)) {
    return fail("irrigation.max_pulses", "Pulse limit must be 1..10.");
  }
  if (!inRange(static_cast<int>(c.irrigation.cooldown_ms), 0, 86400000)) {
    return fail("irrigation.cooldown_ms", "Cooldown must be 0..24 hours.");
  }
  if (!inRange(static_cast<int>(c.irrigation.link_timeout_ms), 5000, 300000)) {
    return fail("irrigation.link_timeout_ms", "Manual link timeout must be 5..300 seconds.");
  }

  if (!inRange(c.waste.indicate_ms, 1000, 30000)) {
    return fail("waste.indicate_ms", "Waste indicator duration must be 1000..30000 ms.");
  }

  err = ConfigError{};
  return true;
}

}  // namespace village
