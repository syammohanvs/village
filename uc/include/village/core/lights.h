#pragma once

#include <cstdint>

#include "village/core/config.h"
#include "village/core/reasons.h"
#include "village/core/time.h"
#include "village/core/types.h"

namespace village {

struct LightReading {
  bool installed = true;
  bool valid = false;
  bool digital = false;
  Brightness brightness = Brightness::Unknown;
  uint16_t raw = 0;
  uint32_t age_ms = 0;
  const char* fault = "no sample";
};

struct LightOutput {
  LightMode mode = LightMode::Auto;
  bool on = false;
  Brightness brightness = Brightness::Unknown;
  bool sensor_valid = false;
  const Reason* reason = &reasons::kLightsAutoUnknown;
};

// LDR hysteresis and stable-state delay.  Auto mode fails safe: if the light
// sensor is stale or still unknown, the LEDs stay off rather than guessing.
class LightsModel {
 public:
  void reset() {
    mode_ = LightMode::Auto;
    has_sample_ = false;
    last_ms_ = 0;
    raw_ = 0;
    digital_level_ = false;
    stable_ = Brightness::Unknown;
    pending_ = Brightness::Unknown;
    pending_valid_ = false;
    pending_since_ = 0;
  }

  void configure(const LightConfig& cfg) {
    // A changed threshold invalidates the old classification.  The next
    // sample re-establishes it after the stable delay.
    stable_ = Brightness::Unknown;
    pending_valid_ = false;
    stable_ms_ = cfg.stable_ms;
  }

  void setMode(LightMode mode) { mode_ = mode; }
  LightMode mode() const { return mode_; }

  void observeAnalog(uint16_t raw, uint32_t now, const LightConfig& cfg) {
    raw_ = raw;
    digital_ = false;
    has_sample_ = true;
    last_ms_ = now;
    const int metric = cfg.analog_bright_high ? static_cast<int>(raw)
                                              : 4095 - static_cast<int>(raw);
    Brightness instant;
    if (stable_ == Brightness::Unknown) {
      if (metric <= static_cast<int>(cfg.dark_threshold)) {
        instant = Brightness::Dark;
      } else if (metric >= static_cast<int>(cfg.bright_threshold)) {
        instant = Brightness::Bright;
      } else {
        instant = Brightness::Unknown;
      }
    } else if (stable_ == Brightness::Bright) {
      instant = metric <= static_cast<int>(cfg.dark_threshold) ? Brightness::Dark
                                                               : Brightness::Bright;
    } else {
      instant = metric >= static_cast<int>(cfg.bright_threshold) ? Brightness::Bright
                                                                 : Brightness::Dark;
    }
    apply(instant, now, cfg.stable_ms);
  }

  void observeDigital(bool high, uint32_t now, const LightConfig& cfg) {
    digital_ = true;
    has_sample_ = true;
    last_ms_ = now;
    raw_ = high ? 4095 : 0;
    const bool dark = cfg.digital_dark_when_high ? high : !high;
    apply(dark ? Brightness::Dark : Brightness::Bright, now, cfg.stable_ms);
  }

  LightReading read(const DeviceConfig& cfg, uint32_t now) const {
    LightReading r;
    r.installed = cfg.light.installed;
    r.digital = cfg.light.digital;
    if (!cfg.light.installed) {
      // No LDR is wired: a floating ADC pin still reads noise, so reporting a
      // brightness here would be an invented observation. Report nothing.
      r.valid = false;
      r.brightness = Brightness::Unknown;
      r.fault = "not installed";
      return r;
    }
    r.raw = raw_;
    if (!has_sample_) {
      r.fault = "no sample";
      return r;
    }
    r.age_ms = elapsedMs(now, last_ms_);
    r.valid = r.age_ms <= cfg.light.max_age_ms;
    if (!r.valid) {
      r.fault = "stale";
      r.brightness = Brightness::Unknown;
      return r;
    }
    r.fault = nullptr;
    r.brightness = stable_;
    return r;
  }

  LightOutput output(const DeviceConfig& cfg, uint32_t now) const {
    LightOutput out;
    out.mode = mode_;
    const LightReading r = read(cfg, now);
    out.brightness = r.brightness;
    out.sensor_valid = r.valid;
    if (!cfg.light.installed) {
      out.on = false;
      out.reason = &reasons::kLightsNotInstalled;
      return out;
    }
    switch (mode_) {
      case LightMode::ManualOn:
        out.on = true;
        out.reason = &reasons::kLightsManualOn;
        return out;
      case LightMode::ManualOff:
        out.on = false;
        out.reason = &reasons::kLightsManualOff;
        return out;
      case LightMode::Auto:
        if (!r.valid || r.brightness == Brightness::Unknown) {
          out.on = false;
          out.reason = &reasons::kLightsAutoUnknown;
        } else if (r.brightness == Brightness::Dark) {
          out.on = true;
          out.reason = &reasons::kLightsAutoDark;
        } else {
          out.on = false;
          out.reason = &reasons::kLightsAutoBright;
        }
        return out;
    }
    out.on = false;
    out.reason = &reasons::kLightsAutoUnknown;
    return out;
  }

 private:
  void apply(Brightness instant, uint32_t now, uint16_t stable_ms) {
    if (instant == Brightness::Unknown) {
      pending_valid_ = false;
      return;
    }
    if (instant == stable_) {
      pending_valid_ = false;
      return;
    }
    if (!pending_valid_ || pending_ != instant) {
      pending_ = instant;
      pending_since_ = now;
      pending_valid_ = true;
      if (stable_ms == 0) {
        stable_ = instant;
        pending_valid_ = false;
      }
      return;
    }
    if (elapsed(now, pending_since_, stable_ms)) {
      stable_ = instant;
      pending_valid_ = false;
    }
  }

  LightMode mode_ = LightMode::Auto;
  bool has_sample_ = false;
  bool digital_ = false;
  uint32_t last_ms_ = 0;
  uint16_t raw_ = 0;
  bool digital_level_ = false;
  Brightness stable_ = Brightness::Unknown;
  Brightness pending_ = Brightness::Unknown;
  bool pending_valid_ = false;
  uint32_t pending_since_ = 0;
  uint16_t stable_ms_ = 4000;
};

}  // namespace village
