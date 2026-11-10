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

// An age computed as `now - stamp` is nonsense when the stamp is a few
// milliseconds *ahead* of `now`.  That happens whenever a request handler
// reacts between the loop sampling `now` and the loop using it: the handler
// stamps the contact time with a later millis(), and the raw subtraction then
// reports ~49 days.  Long enough to trip every timeout in the controller - a
// manual watering session ended on its very first tick as "laptop
// communication was lost".  Such a stamp can only be that same-tick skew, so
// report zero rather than a bogus age.
inline uint32_t ageMs(uint32_t now, uint32_t since) {
  const uint32_t delta = static_cast<uint32_t>(now - since);
  return delta > 0x80000000u ? 0u : delta;
}

inline uint32_t remainingMs(uint32_t now, uint32_t deadline) {
  return static_cast<uint32_t>(deadline - now);
}

inline uint32_t minU32(uint32_t a, uint32_t b) { return a < b ? a : b; }
inline uint32_t maxU32(uint32_t a, uint32_t b) { return a > b ? a : b; }

}  // namespace village
