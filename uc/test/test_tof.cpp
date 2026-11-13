#include "minitest.h"
#include "village/core/tof.h"

using namespace village;

TEST(tof_timeout_is_raised_above_the_measurement_time) {
  // A VL53L0X takes about 33 ms per measurement, and the stored config field
  // still says 30000 microseconds from the ultrasonic era.  Passing 30 ms to
  // the library would report a fault on readings that were about to arrive.
  CHECK(tofBusTimeoutMs(30000) == kTofMinTimeoutMs);
  CHECK(tofBusTimeoutMs(30000) == 50);
  // Anything even shorter is raised to the same floor.
  CHECK(tofBusTimeoutMs(1000) == 50);
  CHECK(tofBusTimeoutMs(0) == 50);
}

TEST(tof_timeout_has_a_ceiling) {
  // A stuck bus must not hold the loop: the ceiling is the whole point.
  CHECK(tofBusTimeoutMs(200000) == kTofMaxTimeoutMs);
  CHECK(tofBusTimeoutMs(200000) == 200);
  CHECK(tofBusTimeoutMs(500000) == 200);
}

TEST(tof_timeout_passes_through_the_useful_band) {
  // Inside the band the configured number is honoured as written.
  CHECK(tofBusTimeoutMs(60000) == 60);
  CHECK(tofBusTimeoutMs(100000) == 100);
  CHECK(tofBusTimeoutMs(199000) == 199);
}

TEST(tof_no_target_is_not_a_distance) {
  // 8190 mm is the sensor's "I see nothing" sentinel.  Treating it as a
  // distance would estimate a fill height from a number that means the
  // opposite.
  CHECK(!tofReadingIsADistance(kTofNoTargetMm));
  CHECK(!tofReadingIsADistance(8191));
  CHECK(!tofReadingIsADistance(65535));
  // Zero is the driver's "no measurement", not a target touching the lens.
  CHECK(!tofReadingIsADistance(0));
  // Real readings are distances.
  CHECK(tofReadingIsADistance(30));    // 3 cm, just inside the blind zone
  CHECK(tofReadingIsADistance(600));   // 60 cm, an empty bin
  CHECK(tofReadingIsADistance(8189));  // the longest believable reading
}
