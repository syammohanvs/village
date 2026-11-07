#include "village/config_store.h"

#include <Preferences.h>
#include <cstring>

namespace village {

namespace {

constexpr uint32_t kConfigMagic = 0x564C4347;  // VLCG
constexpr uint32_t kCommandMagic = 0x564C4D44; // VLMD
constexpr uint16_t kStoreVersion = 1;

struct ConfigBlob {
  uint32_t magic;
  uint16_t version;
  uint16_t size;
  DeviceConfig config;
};

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

  if (prefs.getBytesLength(kConfigKey) == sizeof(ConfigBlob)) {
    ConfigBlob blob{};
    if (prefs.getBytes(kConfigKey, &blob, sizeof(blob)) == sizeof(blob) &&
        blob.magic == kConfigMagic && blob.version == kStoreVersion &&
        blob.size == sizeof(DeviceConfig)) {
      ConfigError err;
      if (validateConfig(blob.config, err)) {
        config = blob.config;
        loaded = true;
      }
    }
  }

  if (prefs.getBytesLength(kCommandsKey) == sizeof(CommandBlob)) {
    CommandBlob blob{};
    if (prefs.getBytes(kCommandsKey, &blob, sizeof(blob)) == sizeof(blob) &&
        blob.magic == kCommandMagic && blob.version == kStoreVersion &&
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
  ConfigBlob blob{};
  blob.magic = kConfigMagic;
  blob.version = kStoreVersion;
  blob.size = sizeof(DeviceConfig);
  blob.config = config;
  const bool ok =
      prefs.putBytes(kConfigKey, &blob, sizeof(blob)) == sizeof(blob);
  prefs.end();
  return ok;
}

bool saveCommandsToNvs(const CommandHistory& history) {
  Preferences prefs;
  if (!prefs.begin(kNamespace, false)) return false;
  CommandBlob blob{};
  blob.magic = kCommandMagic;
  blob.version = kStoreVersion;
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
