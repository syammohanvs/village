#include "village/config_store.h"

#include <ArduinoJson.h>

#include <Preferences.h>
#include <cstring>

#include "village/config_json.h"

namespace village {

namespace {

constexpr uint32_t kCommandMagic = 0x564C4D44; // VLMD
constexpr uint16_t kCommandStoreVersion = 1;

// The configuration is stored as JSON, not as a raw struct dump.
//
// A dump was tied to sizeof(DeviceConfig) (and to every field's offset), so
// adding or removing one field made the stored bytes unreadable and the next
// boot silently discarded the whole configuration — including the soil and LDR
// calibration somebody had just measured.  That happened on 2026-11-13 (when
// the solar block was added) and again on 2026-11-15 (when the bin rangefinder
// settings were removed).  JSON is self-describing: a missing key keeps the
// default, so a field may come or go without losing the rest.
constexpr uint16_t kConfigStoreVersion = 2;

struct CommandBlob {
  uint32_t magic;
  uint16_t version;
  uint16_t count;
  CommandRecord records[CommandHistory::kCapacity];
};

const char* kNamespace = "village";
const char* kConfigKey = "config";
const char* kCommandsKey = "commands";

}  // namespace

bool loadStateFromNvs(DeviceConfig& config, CommandHistory& history) {
  bool loaded = false;
  Preferences prefs;
  if (!prefs.begin(kNamespace, true)) {
    config = DeviceConfig{};
    history.clear();
    return false;
  }

  const String stored = prefs.getString(kConfigKey, "");
  if (stored.length() > 0) {
    JsonDocument doc;
    if (deserializeJson(doc, stored) == DeserializationError::Ok) {
      DeviceConfig candidate = config;  // defaults are the fallback for a gap
      const char* parse_error = nullptr;
      ConfigError err;
      if (readConfigJson(doc["config"].as<JsonObjectConst>(), candidate,
                         &parse_error) &&
          validateConfig(candidate, err)) {
        // The revision is document metadata, so it survives a reboot and a
        // client's stale save is still refused after one.
        candidate.revision = doc["revision"] | candidate.revision;
        config = candidate;
        loaded = true;
      }
    }
  }

  if (prefs.getBytesLength(kCommandsKey) == sizeof(CommandBlob)) {
    CommandBlob blob{};
    if (prefs.getBytes(kCommandsKey, &blob, sizeof(blob)) == sizeof(blob) &&
        blob.magic == kCommandMagic && blob.version == kCommandStoreVersion &&
        blob.count <= CommandHistory::kCapacity) {
      history.load(blob.records, blob.count);
    }
  }

  prefs.end();
  if (!loaded) config = DeviceConfig{};
  return loaded;
}

bool saveConfigToNvs(const DeviceConfig& config) {
  Preferences prefs;
  if (!prefs.begin(kNamespace, false)) return false;
  JsonDocument doc;
  doc["version"] = kConfigStoreVersion;
  doc["revision"] = config.revision;
  writeConfigJson(doc["config"].to<JsonObject>(), config);
  String json;
  serializeJson(doc, json);
  const bool ok = prefs.putString(kConfigKey, json) == json.length();
  prefs.end();
  return ok;
}

bool saveCommandsToNvs(const CommandHistory& history) {
  Preferences prefs;
  if (!prefs.begin(kNamespace, false)) return false;
  CommandBlob blob{};
  blob.magic = kCommandMagic;
  blob.version = kCommandStoreVersion;
  blob.count = static_cast<uint16_t>(history.size());
  for (std::size_t i = 0; i < history.size() && i < CommandHistory::kCapacity;
       ++i) {
    blob.records[i] = history.at(i);
  }
  const bool ok =
      prefs.putBytes(kCommandsKey, &blob, sizeof(blob)) == sizeof(blob);
  prefs.end();
  return ok;
}

void eraseStoredState() {
  Preferences prefs;
  if (prefs.begin(kNamespace, false)) {
    prefs.clear();
    prefs.end();
  }
}

}  // namespace village
