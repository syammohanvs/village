#pragma once

#include <Arduino.h>
#include <cstddef>
#include <cstdint>
#include <cstring>

#include "village/core/command_history.h"
#include "village/core/config.h"
#include "village/core/irrigation.h"
#include "village/core/lights.h"
#include "village/core/moisture.h"
#include "village/core/reasons.h"
#include "village/core/reservoir.h"
#include "village/core/waste.h"

namespace village {

constexpr std::size_t kEventLogSize = 12;

struct StoredEvent {
  uint32_t at_ms = 0;
  char code[40]{};
  char text[96]{};
};

class EventLog {
 public:
  void add(uint32_t now, const char* code, const char* text) {
    if (count_ > 0) {
      const StoredEvent& last = items_[count_ - 1];
      if (std::strcmp(last.code, code) == 0) return;
    }
    if (count_ == kEventLogSize) {
      for (std::size_t i = 1; i < kEventLogSize; ++i) items_[i - 1] = items_[i];
      --count_;
    }
    StoredEvent& e = items_[count_++];
    e = StoredEvent{};
    e.at_ms = now;
    copy(e.code, sizeof(e.code), code);
    copy(e.text, sizeof(e.text), text);
  }

  std::size_t size() const { return count_; }
  const StoredEvent& at(std::size_t i) const { return items_[i]; }

 private:
  static void copy(char* dst, std::size_t size, const char* src) {
    if (src == nullptr) {
      dst[0] = '\0';
      return;
    }
    std::size_t i = 0;
    while (src[i] != '\0' && i + 1 < size) {
      dst[i] = src[i];
      ++i;
    }
    dst[i] = '\0';
  }

  StoredEvent items_[kEventLogSize]{};
  std::size_t count_ = 0;
};

struct Runtime {
  DeviceConfig config;
  IrrigationController irrigation;
  SoilModel soil;
  ReservoirModel reservoir;
  LightsModel lights;
  WasteIndicator waste;
  CommandHistory commands;
  EventLog events;

  // Solar panel (instantaneous voltage on VN / GPIO 39, ADC1).
  uint16_t wind_raw = 0;
  uint16_t wind_mv = 0;
  uint16_t solar_raw = 0;
  uint16_t solar_mv = 0;
  // Junction between the series resistor and the LED (GPIO 36, ADC1).
  uint16_t solar_junction_raw = 0;
  uint16_t solar_junction_mv = 0;

  uint32_t sample_seq = 0;
  uint32_t boot_ms = 0;
  uint32_t last_contact_ms = 0;
  bool ever_contacted = false;
  bool ap_mode = false;
  bool network_started = false;
  uint32_t first_sample_at_ms = 0;
  bool first_sample_seen = false;

  // --- test page (Setup → Test outputs) ------------------------------------
  // ONE master switch, session-only (a reboot puts the outputs back under
  // normal control, so a forgotten switch cannot survive a power cycle).
  //   * ON  takes all five outputs away from the normal drivers and forces
  //         them OFF, so the bench starts from a known state -- a dark room
  //         leaves the streetlights on, and test mode must not inherit that;
  //   * OFF clears the five switches, releases the pins and hands the outputs
  //         back to the controller.
  // While it is on there are no further gates and no timers: the operator asked
  // to take the protection on themselves (2026-11-16).
  bool test_enabled = false;
  bool test_pump = false;
  bool test_led_organic = false;
  bool test_led_plastic = false;
  bool test_led_paper = false;
  bool test_streetlights = false;
};

extern Runtime rt;
extern char g_device_id[24];
extern char g_boot_id[20];

void initIdentity();
void markSample(uint32_t now);

}  // namespace village
