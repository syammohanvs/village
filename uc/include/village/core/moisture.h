#pragma once

#include <cmath>
#include <cstdint>

#include "village/core/config.h"
#include "village/core/median.h"
#include "village/core/time.h"
#include "village/core/types.h"

namespace village {

struct SoilReading {
  bool valid = false;
  bool calibrated = false;
  uint16_t raw = 0;
  float percent = NAN;
  SoilState state = SoilState::Unavailable;
  uint32_t age_ms = 0;
  const char* fault = "no sample";
};

// Holds the raw ADC history and turns it into a calibrated relative moisture
// reading.  It deliberately does not own the ADC; the firmware feeds it.
class SoilModel {
 public:
  void reset() { window_.clear(); has_sample_ = false; last_ms_ = 0; }

  void observe(uint16_t raw, uint32_t now) {
    if (raw > 4095) return;
    window_.push(raw);
    has_sample_ = true;
    last_ms_ = now;
  }

  bool hasSample() const { return has_sample_; }

  SoilReading read(const DeviceConfig& cfg, uint32_t now) const {
    SoilReading r;
    r.calibrated = soilCalibrated(cfg.soil);
    if (!has_sample_) {
      r.valid = false;
      r.state = SoilState::Unavailable;
      r.fault = "no sample";
      return r;
    }
    r.age_ms = elapsedMs(now, last_ms_);
    r.valid = r.age_ms <= cfg.soil.max_age_ms;
    r.raw = window_.medianOf(cfg.soil.samples);

    if (!r.valid) {
      r.state = SoilState::Unavailable;
      r.fault = "stale";
      return r;
    }
    if (!r.calibrated) {
      r.state = SoilState::Uncalibrated;
      r.fault = "not calibrated";
      return r;
    }
    if (!soilPercent(cfg.soil, r.raw, r.percent)) {
      r.state = SoilState::Uncalibrated;
      r.fault = "not calibrated";
      return r;
    }
    r.fault = nullptr;
    if (r.percent <= static_cast<float>(cfg.irrigation.dry_start_pct)) {
      r.state = SoilState::Dry;
    } else if (r.percent >= static_cast<float>(cfg.irrigation.stop_pct)) {
      r.state = SoilState::Wet;
    } else {
      r.state = SoilState::Adequate;
    }
    return r;
  }

 private:
  MedianWindow<uint16_t, 21> window_;
  bool has_sample_ = false;
  uint32_t last_ms_ = 0;
};

}  // namespace village
