#pragma once

#include <ArduinoJson.h>

#include "village/core/config.h"

namespace village {

// The ONE conversion between a DeviceConfig and JSON.  The HTTP API and the NVS
// store both call these, so a setting cannot exist on the wire and be missing
// from disk.
//
// `out` is the caller's current config, and every field is a fallback: a stored
// document that predates a field still loads, with the new field taking its
// default.  That property is why the config is stored as JSON at all — the
// previous raw struct dump was tied to sizeof(DeviceConfig), so adding or
// removing a field silently reset every calibration on the next boot.
void writeConfigJson(JsonObject out, const DeviceConfig& config);
bool readConfigJson(JsonObjectConst in, DeviceConfig& out, const char** error);

}  // namespace village
