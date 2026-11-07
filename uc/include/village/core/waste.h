#pragma once

#include <cstdint>

#include "village/core/config.h"
#include "village/core/reasons.h"
#include "village/core/time.h"
#include "village/core/types.h"

namespace village {

struct WasteLedState {
  WasteCategory category = WasteCategory::Unknown;
  bool active = false;
  uint32_t remaining_ms = 0;
};

// One category LED at a time, for a bounded duration.  Unknown categories do
// nothing at all.  There is no servo sorter in this build.
class WasteIndicator {
 public:
  void reset() {
    active_ = false;
    category_ = WasteCategory::Unknown;
    until_ms_ = 0;
    default_ms_ = 8000;
  }

  void configure(const WasteConfig& cfg) { default_ms_ = cfg.indicate_ms; }

  bool indicate(WasteCategory category, uint32_t requested_ms, uint32_t now) {
    if (!isKnownWasteCategory(category)) return false;
    uint32_t duration = requested_ms == 0 ? default_ms_ : requested_ms;
    if (duration < 1000) duration = 1000;
    if (duration > default_ms_) duration = default_ms_;
    if (duration > 30000) duration = 30000;
    active_ = true;
    category_ = category;
    until_ms_ = now + duration;
    return true;
  }

  void tick(uint32_t now) {
    if (active_ && static_cast<int32_t>(now - until_ms_) >= 0) {
      active_ = false;
      category_ = WasteCategory::Unknown;
    }
  }

  WasteLedState read(uint32_t now) const {
    WasteLedState s;
    if (!active_) return s;
    if (static_cast<int32_t>(now - until_ms_) >= 0) return s;
    s.active = true;
    s.category = category_;
    s.remaining_ms = until_ms_ - now;
    return s;
  }

  bool active() const { return active_; }
  WasteCategory category() const { return category_; }

 private:
  bool active_ = false;
  WasteCategory category_ = WasteCategory::Unknown;
  uint32_t until_ms_ = 0;
  uint16_t default_ms_ = 8000;
};

inline void categoryLeds(WasteCategory category, bool& organic, bool& plastic,
                         bool& paper) {
  organic = category == WasteCategory::Organic;
  plastic = category == WasteCategory::Plastic;
  paper = category == WasteCategory::Paper;
}

}  // namespace village
