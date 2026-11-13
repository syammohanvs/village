// Bounds for the VL53L0X time-of-flight bin rangefinders.
//
// The sensor work itself needs Arduino I2C and cannot run on the host, but the
// two numbers that decide whether a reading is believable can live here where
// they are testable.
#pragma once

#include <cstdint>

namespace village {

// A VL53L0X measurement takes about 33 ms by default. The library's own bus
// timeout is in milliseconds while the stored config keeps microseconds, so a
// 30 000 us setting would become 30 ms -- short enough to report a fault on a
// reading that was about to arrive. Anything at or below this floor is raised.
inline constexpr uint32_t kTofMinTimeoutMs = 50;
// A stuck bus must not stall the control loop for longer than this.
inline constexpr uint32_t kTofMaxTimeoutMs = 200;

// Convert the configured timeout (microseconds) into the milliseconds the
// library wants, inside the band above.
inline uint16_t tofBusTimeoutMs(uint32_t timeout_us) {
  uint32_t ms = timeout_us / 1000u;
  if (ms < kTofMinTimeoutMs) ms = kTofMinTimeoutMs;
  if (ms > kTofMaxTimeoutMs) ms = kTofMaxTimeoutMs;
  return static_cast<uint16_t>(ms);
}

// The sensor reports 8190 mm when it cannot see a target. That is a sentinel,
// not a distance, and must never be turned into a fill percentage.
inline constexpr uint16_t kTofNoTargetMm = 8190;

inline bool tofReadingIsADistance(uint16_t millimetres) {
  return millimetres != 0 && millimetres < kTofNoTargetMm;
}

}  // namespace village
