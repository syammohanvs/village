#pragma once

#include <cstdint>

namespace village {

// Wrap-safe elapsed test for millis().  Always compare with subtraction, never
// with "now > deadline", because millis() rolls over after ~49 days.
inline bool elapsed(uint32_t now, uint32_t since, uint32_t interval) {
  return static_cast<uint32_t>(now - since) >= interval;
}

inline uint32_t elapsedMs(uint32_t now, uint32_t since) {
  return static_cast<uint32_t>(now - since);
}

inline uint32_t remainingMs(uint32_t now, uint32_t deadline) {
  return static_cast<uint32_t>(deadline - now);
}

inline uint32_t minU32(uint32_t a, uint32_t b) { return a < b ? a : b; }
inline uint32_t maxU32(uint32_t a, uint32_t b) { return a > b ? a : b; }

}  // namespace village
