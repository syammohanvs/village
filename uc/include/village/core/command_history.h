#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

#include "village/core/types.h"

namespace village {

// A small persisted record of processed command ids.  Only the id hash and
// the decision are stored: no pump-ON state, no session state.  This is what
// makes a retry after a reboot a DUPLICATE instead of a second watering.
struct CommandRecord {
  uint64_t hash = 0;
  CommandResult result = CommandResult::Rejected;
  char reason_code[48]{};
  char reason[120]{};
  uint32_t at_ms = 0;
};

static_assert(std::is_trivially_copyable<CommandRecord>::value,
              "CommandRecord is stored as a raw NVS blob");

class CommandHistory {
 public:
  static constexpr std::size_t kCapacity = 10;

  void clear() {
    count_ = 0;
    for (std::size_t i = 0; i < kCapacity; ++i) records_[i] = CommandRecord{};
  }

  const CommandRecord* find(uint64_t hash) const {
    if (hash == 0) return nullptr;
    for (std::size_t i = 0; i < count_; ++i) {
      if (records_[i].hash == hash) return &records_[i];
    }
    return nullptr;
  }

  void remember(uint64_t hash, CommandResult result, const char* reason_code,
                const char* reason, uint32_t at_ms) {
    if (hash == 0) return;
    // A repeated id keeps its first decision; callers normally check find()
    // first, but this makes the class safe on its own.
    if (find(hash) != nullptr) return;
    if (count_ == kCapacity) {
      for (std::size_t i = 1; i < kCapacity; ++i) records_[i - 1] = records_[i];
      --count_;
    }
    CommandRecord& r = records_[count_++];
    r = CommandRecord{};
    r.hash = hash;
    r.result = result;
    copyText(r.reason_code, sizeof(r.reason_code), reason_code);
    copyText(r.reason, sizeof(r.reason), reason);
    r.at_ms = at_ms;
  }

  void load(const CommandRecord* records, std::size_t n) {
    clear();
    if (records == nullptr) return;
    const std::size_t limit = n < kCapacity ? n : kCapacity;
    for (std::size_t i = 0; i < limit; ++i) {
      if (records[i].hash == 0) continue;
      if (static_cast<uint8_t>(records[i].result) > 2) continue;
      CommandRecord r = records[i];
      r.reason_code[sizeof(r.reason_code) - 1] = '\0';
      r.reason[sizeof(r.reason) - 1] = '\0';
      if (count_ < kCapacity) records_[count_++] = r;
    }
  }

  std::size_t size() const { return count_; }
  const CommandRecord& at(std::size_t index) const { return records_[index]; }

  static uint64_t hashId(const char* id) {
    if (id == nullptr || id[0] == '\0') return 0;
    uint64_t h = 1469598103934665603ULL;  // FNV-1a offset basis
    for (const unsigned char* p = reinterpret_cast<const unsigned char*>(id); *p;
         ++p) {
      h ^= static_cast<uint64_t>(*p);
      h *= 1099511628211ULL;
    }
    return h == 0 ? 1 : h;
  }

 private:
  static void copyText(char* dst, std::size_t size, const char* src) {
    if (dst == nullptr || size == 0) return;
    if (src == nullptr) {
      dst[0] = '\0';
      return;
    }
    std::size_t n = 0;
    while (src[n] != '\0' && n + 1 < size) {
      dst[n] = src[n];
      ++n;
    }
    dst[n] = '\0';
  }

  CommandRecord records_[kCapacity]{};
  std::size_t count_ = 0;
};

}  // namespace village
