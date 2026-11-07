#pragma once

#include "village/core/types.h"
#include "village/pins.h"

namespace village {

// Sets every output to a safe state.  Called before Wi-Fi, sampling or HTTP.
void setupOutputs();

// These apply the final hardware gate.  The pump can only be HIGH when the
// compile-time commissioning flag and the runtime config both agree.
void applyPump(bool on);
void applyStreetlights(bool on);
void applyWasteCategory(WasteCategory category);
void allOutputsOff();

}  // namespace village
