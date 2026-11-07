#pragma once

#include <Arduino.h>

#include "village/core/irrigation.h"

namespace village {

void setupSensors();
void sampleSensors(uint32_t now);
IrrigationInputs buildIrrigationInputs(uint32_t now);

// Applies the current validated config to the live models.  Called after
// loading from NVS and after a successful PUT /config.
void applyRuntimeConfig(uint32_t now);

}  // namespace village
