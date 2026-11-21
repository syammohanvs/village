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
  // Deliberately false until the real probe endpoints have been captured and
  // confirmed.  Valid-looking default endpoints must not claim calibration.
  bool calibrated = false;
  // true  = raw reading rises with moisture (probe on the 3.3 V side)
  // false = raw reading falls with moisture (resistor on the 3.3 V side,
  //         probe to GND).  The firmware inverts the reading when this is
  //         false so the calibration endpoints keep their original meaning.
  bool rises_with_moisture = false;
};

struct ReservoirConfig {
  uint16_t wet_threshold_mv = 1200;
  uint16_t dry_threshold_mv = 2400;
  uint8_t confirm_readings = 3;
  uint16_t max_age_ms = 5000;
  bool calibrated = false;
};

struct LightConfig {
  // Two independent hardware facts, deliberately separate:
  //   installed      - the five streetlight lamps are wired
  //   sensor_fitted  - the LDR is wired
  // A board with no LDR must not report a brightness (a floating ADC pin reads
  // plausible noise), and a board with no lamps must not drive the outputs.
  bool installed = false;
  bool sensor_fitted = false;
  bool digital = false;              // false = analogue AO, true = digital DO
  bool analog_bright_high = false;   // resistor to 3V3, LDR to GND: voltage falls with light
  bool digital_dark_when_high = true;  // typical LDR module DO
  // Metric units (brightness = 4095 - raw for the pull-up wiring), dark at
  // or below.  1800 is measured on this build: a hand over the bare LDR
  // reaches raw ~2560 (metric ~1536), so the 1500 default was 36 counts
  // too tight and covering the sensor did nothing.
  uint16_t dark_threshold = 1800;
  uint16_t bright_threshold = 2800;  // metric units, bright at or above
  uint16_t stable_ms = 4000;
  uint16_t max_age_ms = 5000;
};

struct IrrigationConfig {
  bool auto_enabled = true;
  bool pump_enabled = false;
  uint16_t dry_start_pct = 35;
  uint16_t stop_pct = 55;
  // Exhibition timings (2026-11-20): short enough that a visitor sees a whole
  // automatic cycle -- dry confirmation, pulse, soak, re-check -- in one
  // demonstration, and there is deliberately **no cooldown**, so a soil that
  // stays dry is watered again after the 3 s confirmation.  The pulse and
  // cumulative limits end a session; **there is no failure lockout** (removed
  // 2026-11-21 for the exhibition), so the next session starts after the dry
  // confirmation instead of the controller refusing to water.
  uint32_t dry_confirm_ms = 3000;   // 3 s
  uint32_t pulse_ms = 4000;         // 4 s ON
  uint32_t max_pulse_ms = 8000;
  uint32_t soak_ms = 8000;          // 8 s OFF between pulses
  uint32_t max_cumulative_ms = 45000;
  uint8_t max_pulses = 10;
  uint32_t cooldown_ms = 0;         // no wait between sessions (exhibition)
  uint32_t link_timeout_ms = 30000;
};

struct WasteConfig {
  uint16_t indicate_ms = 8000;
};

// Solar panel: one ADC on the panel side of a series resistor, one on the
// junction between that resistor and the LED.  The voltage across the resistor
// gives the current (I = V/R) and the panel voltage times that current is the
// power it is delivering.
// Wind generator: ONE ADC tap (GPIO 33), but it is placed where the current
// flows -- across a 47 ohm resistor in series with the generator's blue LED --
// so one measurement gives all three figures: I = V/R, the generator voltage is
// that plus the LED's forward voltage, and power is V x I.  See wind.h.
struct WindConfig {
  bool installed = false;
  // The circuit (2026-11-20): generator + -> blue LED -> ADC junction ->
  // 47 ohm -> GND.  The ADC reads the resistor, so the three numbers below are
  // the hardware: the resistor it divides by, the LED's measured forward
  // voltage, and the noise floor below which nothing is flowing.
  uint16_t sense_ohms = 47;
  uint16_t led_forward_mv = 2800;
  uint16_t noise_floor_mv = 150;
};

struct SolarConfig {
  bool installed = false;
  // The resistor the LED current actually flows through (the 330 ohm in
  // docs/wiring.md 10).  The 10k in front of each ADC pin is protection and
  // is deliberately NOT this value: it carries no current.
  uint16_t sense_ohms = 330;
};

struct DeviceConfig {
  uint32_t revision = 1;
  SoilConfig soil;
  ReservoirConfig reservoir;
  LightConfig light;
  IrrigationConfig irrigation;
  WasteConfig waste;
  SolarConfig solar;
  WindConfig wind;
};

struct ConfigError {
  const char* field = "";
  const char* message = "";
};

inline bool soilEndpointsValid(const SoilConfig& c) {
  if (c.dry_raw > 4095 || c.wet_raw > 4095) return false;
  if (c.min_span_raw < 100) return false;
  const int diff = static_cast<int>(c.dry_raw) - static_cast<int>(c.wet_raw);
  const int span = diff < 0 ? -diff : diff;
  return span >= static_cast<int>(c.min_span_raw);
}

inline bool soilCalibrated(const SoilConfig& c) {
  return c.calibrated && soilEndpointsValid(c);
}

// Maps a raw ADC reading to 0..100 % with either sensor polarity.  Returns
// false when the calibration is unusable; the caller must then show
// "uncalibrated" rather than a percentage.
inline bool soilPercent(const SoilConfig& c, uint16_t raw, float& out) {
  if (!soilCalibrated(c)) return false;
  uint16_t effective = raw;
  if (!c.rises_with_moisture) {
    effective = static_cast<uint16_t>(4095 - raw);
  }
  const float span = static_cast<float>(c.wet_raw) - static_cast<float>(c.dry_raw);
  float pct = (static_cast<float>(effective) - static_cast<float>(c.dry_raw)) / span * 100.0f;
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
  if (!soilEndpointsValid(c.soil)) {
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
  // The series resistor sets the current scale; zero would divide by zero and
  // an absurd value would silently report nonsense.
  if (!inRange(c.solar.sense_ohms, 1, 10000)) {
    return fail("solar.sense_ohms", "Solar sense resistor must be 1..10000 ohms.");
  }

  // The wind circuit's three numbers are hardware: a resistor of 0 would divide
  // by nothing, an LED forward voltage outside 0.5..5 V is not a blue LED, and a
  // noise floor above 1 V would refuse every real reading.
  if (!inRange(static_cast<int>(c.wind.sense_ohms), 1, 10000)) {
    return fail("wind.sense_ohms", "Wind sense resistor must be 1..10000 ohms.");
  }
  if (!inRange(static_cast<int>(c.wind.led_forward_mv), 500, 5000)) {
    return fail("wind.led_forward_mv", "Wind LED forward voltage must be 500..5000 mV.");
  }
  if (!inRange(static_cast<int>(c.wind.noise_floor_mv), 0, 1000)) {
    return fail("wind.noise_floor_mv", "Wind noise floor must be 0..1000 mV.");
  }

  err = ConfigError{};
  return true;
}

}  // namespace village
