#pragma once

#include <Arduino.h>
#include <cstddef>
#include <cstdint>
#include <cstring>

#include "village/core/bins.h"
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
  BinModel bins[3];
  WasteIndicator waste;
  CommandHistory commands;
  EventLog events;

  uint32_t sample_seq = 0;
  uint32_t boot_ms = 0;
  uint32_t last_contact_ms = 0;
  bool ever_contacted = false;
  bool ap_mode = false;
  bool network_started = false;
  uint32_t first_sample_at_ms = 0;
  bool first_sample_seen = false;
};

extern Runtime rt;
extern char g_device_id[24];
extern char g_boot_id[20];

void initIdentity();
void markSample(uint32_t now);

}  // namespace village
