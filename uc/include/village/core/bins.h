#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>

#include "village/core/config.h"
#include "village/core/median.h"
#include "village/core/time.h"
#include "village/core/types.h"

namespace village {

inline const char* binId(std::size_t index) {
  switch (index) {
    case 0: return "organic";
    case 1: return "plastic";
    case 2: return "paper";
    default: return "unknown";
  }
}

struct BinReading {
  bool installed = true;
  bool valid = false;
  float distance_cm = NAN;
  float fill_pct = NAN;
  BinState state = BinState::Unavailable;
  uint32_t age_ms = 0;
  const char* fault = "no reading";
  bool near_blind_zone = false;
};

// One ultrasonic bin.  The firmware reads the sensors sequentially and calls
// observeDistance() or observeTimeout(); this class only filters and
// classifies.  A missing echo is never an empty bin.
class BinModel {
 public:
  void reset() {
    window_.clear();
    has_good_ = false;
    last_good_ms_ = 0;
    consecutive_timeouts_ = 0;
    last_distance_cm_ = NAN;
    last_fill_pct_ = NAN;
    near_blind_ = false;
    has_state_ = false;
    stable_ = BinState::Unavailable;
    pending_ = BinState::Unavailable;
    pending_count_ = 0;
    pending_valid_ = false;
  }

  void configure(const BinConfig&) { reset(); }

  void observeDistance(float distance_cm, const BinConfig& cfg, uint32_t now) {
    if (!std::isfinite(distance_cm) || distance_cm <= 0.0f ||
        distance_cm > static_cast<float>(cfg.max_range_cm)) {
      observeTimeout(now);
      return;
    }
    consecutive_timeouts_ = 0;
    has_good_ = true;
    last_good_ms_ = now;
    window_.push(distance_cm);

    const float d = window_.medianOf(cfg.median_samples);
    last_distance_cm_ = d;
    near_blind_ = d <= static_cast<float>(cfg.blind_zone_cm);

    const float span = static_cast<float>(cfg.empty_cm) - static_cast<float>(cfg.full_cm);
    float fill = (static_cast<float>(cfg.empty_cm) - d) / span * 100.0f;
    if (fill < 0.0f) fill = 0.0f;
    if (fill > 100.0f) fill = 100.0f;
    last_fill_pct_ = fill;

    BinState instant = BinState::Available;
    if (near_blind_ || fill >= static_cast<float>(cfg.full_pct)) {
      instant = BinState::Full;
    } else if (fill >= static_cast<float>(cfg.near_full_pct)) {
      instant = BinState::NearlyFull;
    }

    if (has_state_ && instant == stable_) {
      pending_valid_ = false;
      pending_count_ = 0;
      return;
    }
    if (!pending_valid_ || instant != pending_) {
      pending_ = instant;
      pending_count_ = 1;
      pending_valid_ = true;
    } else if (pending_count_ < 255) {
      ++pending_count_;
    }
    if (pending_count_ >= cfg.confirm_readings) {
      stable_ = instant;
      has_state_ = true;
      pending_valid_ = false;
    }
  }

  void observeTimeout(uint32_t now) {
    (void)now;
    if (consecutive_timeouts_ < 255) ++consecutive_timeouts_;
  }

  BinReading read(const DeviceConfig& cfg, std::size_t index, uint32_t now) const {
    BinReading r;
    if (index > 2) {
      r.fault = "unknown bin";
      return r;
    }
    const BinConfig& c = cfg.bins[index];
    r.installed = c.installed;
    if (!c.installed) {
      r.state = BinState::NotInstalled;
      r.fault = "not installed";
      return r;
    }
    if (!has_good_) {
      r.state = BinState::Unavailable;
      r.fault = "no reading";
      return r;
    }
    r.age_ms = elapsedMs(now, last_good_ms_);
    if (consecutive_timeouts_ >= 2) {
      r.state = BinState::Unavailable;
      r.fault = "no echo";
      r.near_blind_zone = near_blind_;
      return r;
    }
    if (r.age_ms > c.max_age_ms) {
      r.state = BinState::Unavailable;
      r.fault = "stale";
      r.near_blind_zone = near_blind_;
      return r;
    }
    r.valid = true;
    r.distance_cm = last_distance_cm_;
    r.fill_pct = last_fill_pct_;
    r.near_blind_zone = near_blind_;
    if (!has_state_) {
      r.state = BinState::Unavailable;
      r.fault = "confirming";
      return r;
    }
    r.state = stable_;
    r.fault = nullptr;
    return r;
  }

  bool hasState() const { return has_state_; }

 private:
  MedianWindow<float, 9> window_;
  bool has_good_ = false;
  uint32_t last_good_ms_ = 0;
  uint8_t consecutive_timeouts_ = 0;
  float last_distance_cm_ = NAN;
  float last_fill_pct_ = NAN;
  bool near_blind_ = false;
  bool has_state_ = false;
  BinState stable_ = BinState::Unavailable;
  BinState pending_ = BinState::Unavailable;
  uint8_t pending_count_ = 0;
  bool pending_valid_ = false;
};

}  // namespace village
