#pragma once

#include "village/core/command_history.h"
#include "village/core/config.h"

namespace village {

// Loads the persisted config and recent command ids.  An invalid or missing
// config falls back to conservative defaults; a corrupt command blob is
// ignored (never guessed at).
bool loadStateFromNvs(DeviceConfig& config, CommandHistory& history);

// Writes only configuration, never actuator state.
bool saveConfigToNvs(const DeviceConfig& config);

// Writes the small recent-command ring so a retry after a reboot is a
// DUPLICATE.  This is deliberately separate from the config blob.
bool saveCommandsToNvs(const CommandHistory& history);

void eraseStoredState();

}  // namespace village
