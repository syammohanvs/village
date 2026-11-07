#pragma once

#include <cstdint>

#include "village/core/config.h"
#include "village/core/median.h"
#include "village/core/time.h"
#include "village/core/types.h"

namespace village {

struct ReservoirReading {
  bool valid = false;
  bool calibrated = false;
  ReservoirState state = ReservoirState::Unavailable;
  uint16_t millivolts = 0;
  bool conductive = false;
  uint32_t age_ms = 0;
  const char* fault = "no sample";
};

// Two wire probes at one minimum-water level.  The excitation pin is driven
// only while measuring; this model receives the averaged millivolts and
// applies a dead band plus a confirmation count.  It never reports a volume,
// percentage or capacity.
class ReservoirModel {
 public:
  void reset() {
    window_.clear();
    has_sample_ = false;
    last_ms_ = 0;
    has_stable_ = false;
    stable_ = ReservoirState::Unavailable;
    last_candidate_valid_ = false;
    confirm_ = 0;
  }

  void observe(uint16_t millivolts, uint32_t now) {
    if (millivolts > 5000) return;
    window_.push(millivolts);
    has_sample_ = true;
    last_ms_ = now;

    const uint16_t mv = window_.medianOf(3);
    ReservoirState candidate;
    bool candidate_valid = true;
    if (mv <= wet_threshold_mv_) {
      candidate = ReservoirState::Available;
    } else if (mv >= dry_threshold_mv_) {
      candidate = ReservoirState::Low;
    } else {
      // Deliberate dead band: do not guess between "wet" and "dry".
      candidate = ReservoirState::Unavailable;
      candidate_valid = false;
    }

    if (!candidate_valid) {
      last_candidate_valid_ = false;
      confirm_ = 0;
      return;
    }
    if (last_candidate_valid_ && candidate == last_candidate_) {
      if (confirm_ < 255) ++confirm_;
    } else {
      last_candidate_ = candidate;
      last_candidate_valid_ = true;
      confirm_ = 1;
    }
    if (confirm_ >= confirm_readings_) {
      stable_ = candidate;
      has_stable_ = true;
    }
  }

  // Thresholds are copied from the validated config before sampling starts.
  void setThresholds(uint16_t wet_mv, uint16_t dry_mv, uint8_t confirm_readings) {
    wet_threshold_mv_ = wet_mv;
    dry_threshold_mv_ = dry_mv;
    confirm_readings_ = confirm_readings;
    // A threshold change invalidates the old stable classification.
    has_stable_ = false;
    last_candidate_valid_ = false;
    confirm_ = 0;
  }

  ReservoirReading read(const DeviceConfig& cfg, uint32_t now) const {
    ReservoirReading r;
    r.calibrated = cfg.reservoir.calibrated;
    if (!has_sample_) {
      r.fault = "no sample";
      return r;
    }
    r.age_ms = elapsedMs(now, last_ms_);
    r.valid = r.age_ms <= cfg.reservoir.max_age_ms;
    r.millivolts = window_.median();
    if (!r.valid) {
      r.fault = "stale";
      r.state = ReservoirState::Unavailable;
      r.conductive = false;
      return r;
    }
    if (!r.calibrated) {
      r.fault = "not calibrated";
      r.state = ReservoirState::Uncalibrated;
      r.conductive = false;
      return r;
    }
    if (!has_stable_) {
      r.fault = "waiting for stable reading";
      r.state = ReservoirState::Unavailable;
      r.conductive = false;
      return r;
    }
    r.fault = nullptr;
    r.state = stable_;
    r.conductive = stable_ == ReservoirState::Available;
    return r;
  }

 private:
  MedianWindow<uint16_t, 5> window_;
  bool has_sample_ = false;
  uint32_t last_ms_ = 0;
  uint16_t wet_threshold_mv_ = 1200;
  uint16_t dry_threshold_mv_ = 2400;
  uint8_t confirm_readings_ = 3;
  bool has_stable_ = false;
  ReservoirState stable_ = ReservoirState::Unavailable;
  ReservoirState last_candidate_ = ReservoirState::Unavailable;
  bool last_candidate_valid_ = false;
  uint8_t confirm_ = 0;
};

}  // namespace village
