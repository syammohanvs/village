#pragma once

#include "village/core/types.h"
#include "village/pins.h"

namespace village {

// Sets every output to a safe state.  Called before Wi-Fi, sampling or HTTP.
void setupOutputs();

// Applies the pump safety gate.  The pump output can only be HIGH when the
// saved configuration enables the pump and the controller's rules allow it.
void applyPump(bool on);

// The test page's pump switch.  Writes the control signal with none of
// applyPump()'s checks, because the page's master switch is the safety gate
// there and the operator takes the protection on themselves.  Every other
// caller must keep using applyPump().
void applyPumpDirect(bool on);
void applyStreetlights(bool on);
void applyWasteCategory(WasteCategory category);
void allOutputsOff();

// Test mode: drive the three indicator LEDs and the streetlight pin by hand.
// Cleared by calling applyWasteCategory/applyStreetlights again, which every
// pass of the main loop does.
void applyTestLeds(bool organic, bool plastic, bool paper, bool streetlights);

}  // namespace village
