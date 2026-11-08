#include "village/api.h"

#include <ArduinoJson.h>
#include <WiFi.h>
#include <WebServer.h>

#include <cmath>
#include <cstring>

#include "village/build_config.h"
#include "village/core/irrigation.h"
#include "village/core/time.h"
#include "village/device_state.h"
#include "village/net.h"
#include "village/outputs.h"
#include "village/pins.h"
#include "village/sensors.h"
#include "village/config_store.h"

#if __has_include("village/secrets.h")
#include "village/secrets.h"
#else
#error "Missing uc/include/village/secrets.h - copy secrets.example.h to secrets.h and fill it in."
#endif

namespace village {
namespace {

WebServer server(80);
const char* kAuthHeader = "X-Device-Token";

void touchContact(uint32_t now) {
  rt.last_contact_ms = now;
  rt.ever_contacted = true;
}

void sendJson(int status, const String& body) {
  server.send(status, "application/json", body);
}

void sendError(int status, const char* code, const String& message,
               const char* field = nullptr, int currentRevision = -1) {
  JsonDocument doc;
  JsonObject e = doc["error"].to<JsonObject>();
  e["code"] = code;
  e["message"] = message;
  if (field != nullptr) e["field"] = field;
  if (currentRevision >= 0) e["current_revision"] = currentRevision;
  String out;
  serializeJson(doc, out);
  sendJson(status, out);
}

bool requireAuth() {
  if (server.header(kAuthHeader) == VILLAGE_DEVICE_TOKEN) {
    touchContact(millis());
    return true;
  }
  sendError(401, "UNAUTHORIZED", "missing or invalid X-Device-Token");
  return false;
}

float round2(float v) {
  if (!std::isfinite(v)) return NAN;
  return std::round(v * 100.0f) / 100.0f;
}

void addNullableFloat(JsonObject obj, const char* key, float value) {
  if (std::isfinite(value)) {
    obj[key] = round2(value);
  } else {
    obj[key] = nullptr;
  }
}

void addReason(JsonObject obj, const Reason& r) {
  obj["reason_code"] = r.code;
  obj["reason"] = r.text;
}

void buildStatus(JsonDocument& doc) {
  const uint32_t now = millis();
  JsonObject root = doc.to<JsonObject>();
  root["protocol_version"] = VILLAGE_PROTOCOL_VERSION;
  root["device_id"] = g_device_id;
  root["boot_id"] = g_boot_id;
  root["firmware"] = VILLAGE_FIRMWARE_VERSION;
  root["uptime_ms"] = now;
  root["sample_seq"] = rt.sample_seq;
  root["config_revision"] = rt.config.revision;

  JsonObject sensors = root["sensors"].to<JsonObject>();
  const SoilReading soil = rt.soil.read(rt.config, now);
  JsonObject s = sensors["soil"].to<JsonObject>();
  s["valid"] = soil.valid;
  s["calibrated"] = soil.calibrated;
  s["raw"] = soil.raw;
  addNullableFloat(s, "percent", soil.percent);
  s["state"] = toString(soil.state);
  s["age_ms"] = soil.age_ms;
  if (soil.fault != nullptr) s["fault"] = soil.fault; else s["fault"] = nullptr;

  const ReservoirReading reservoir = rt.reservoir.read(rt.config, now);
  JsonObject r = sensors["reservoir"].to<JsonObject>();
  r["valid"] = reservoir.valid;
  r["calibrated"] = reservoir.calibrated;
  r["state"] = toString(reservoir.state);
  r["millivolts"] = reservoir.millivolts;
  r["conductive"] = reservoir.conductive;
  r["age_ms"] = reservoir.age_ms;
  if (reservoir.fault != nullptr) r["fault"] = reservoir.fault; else r["fault"] = nullptr;

  const LightReading light = rt.lights.read(rt.config, now);
  JsonObject l = sensors["light"].to<JsonObject>();
  l["installed"] = rt.config.light.sensor_fitted;
  l["valid"] = light.valid;
  if (light.installed) l["raw"] = light.raw; else l["raw"] = nullptr;
  l["brightness"] = toString(light.brightness);
  l["output_type"] = rt.config.light.digital ? "digital" : "analog";
  l["age_ms"] = light.age_ms;
  if (light.fault != nullptr) l["fault"] = light.fault; else l["fault"] = nullptr;

  JsonArray bins = sensors["bins"].to<JsonArray>();
  for (std::size_t i = 0; i < 3; ++i) {
    const BinReading b = rt.bins[i].read(rt.config, i, now);
    JsonObject o = bins.add<JsonObject>();
    o["id"] = binId(i);
    o["installed"] = b.installed;
    o["valid"] = b.valid;
    addNullableFloat(o, "distance_cm", b.distance_cm);
    addNullableFloat(o, "fill_pct_estimate", b.fill_pct);
    o["state"] = toString(b.state);
    o["age_ms"] = b.age_ms;
    if (b.fault != nullptr) o["fault"] = b.fault; else o["fault"] = nullptr;
    o["near_blind_zone"] = b.near_blind_zone;
  }

  const IrrigationStatus irr = rt.irrigation.status(now);
  JsonObject actuators = root["actuators"].to<JsonObject>();
  JsonObject pump = actuators["pump"].to<JsonObject>();
  pump["commanded"] = irr.pump_on;
  pump["commissioned"] = VILLAGE_PUMP_COMMISSIONED == 1;
  pump["enabled"] = rt.config.irrigation.pump_enabled;
  pump["feedback"] = "none";

  const LightOutput lights = rt.lights.output(rt.config, now);
  JsonObject sl = actuators["streetlights"].to<JsonObject>();
  sl["mode"] = toString(lights.mode);
  sl["commanded"] = lights.on;
  sl["led_count"] = pins::STREETLIGHT_LAMP_COUNT;
  sl["installed"] = rt.config.light.installed;
  sl["feedback"] = "none";

  const WasteLedState waste = rt.waste.read(now);
  JsonObject wi = actuators["waste_indicator"].to<JsonObject>();
  if (waste.active) wi["category"] = toString(waste.category); else wi["category"] = nullptr;
  wi["active"] = waste.active;
  wi["remaining_ms"] = waste.remaining_ms;

  JsonObject ir = root["irrigation"].to<JsonObject>();
  ir["auto_enabled"] = irr.auto_enabled;
  ir["pump_enabled"] = irr.pump_enabled;
  ir["commissioned"] = irr.commissioned;
  ir["failure_lockout"] = irr.failure_lockout;
  ir["state"] = toString(irr.state);
  ir["session"] = toString(irr.session);
  ir["pulses_done"] = irr.pulses_done;
  ir["pulse_limit"] = irr.pulse_limit;
  ir["cumulative_pump_ms"] = irr.cumulative_pump_ms;
  ir["max_cumulative_pump_ms"] = irr.max_cumulative_pump_ms;
  ir["cooldown_remaining_ms"] = irr.cooldown_remaining_ms;
  ir["session_elapsed_ms"] = irr.session_elapsed_ms;
  ir["pulse_remaining_ms"] = irr.pulse_remaining_ms;
  ir["soak_remaining_ms"] = irr.soak_remaining_ms;
  addReason(ir, *irr.reason);
  if (irr.last.present) {
    JsonObject last = ir["last_session"].to<JsonObject>();
    last["kind"] = toString(irr.last.kind);
    addReason(last, *irr.last.reason);
    last["at_uptime_ms"] = irr.last.at_ms;
    last["pulses"] = irr.last.pulses;
    last["pumped_ms"] = irr.last.pumped_ms;
  } else {
    ir["last_session"] = nullptr;
  }

  JsonArray faults = root["faults"].to<JsonArray>();
  if (!soil.valid) faults.add(String("soil: ") + (soil.fault ? soil.fault : "invalid"));
  if (!reservoir.valid) faults.add(String("reservoir: ") + (reservoir.fault ? reservoir.fault : "invalid"));
  if (!light.valid) faults.add(String("light: ") + (light.fault ? light.fault : "invalid"));
  for (std::size_t i = 0; i < 3; ++i) {
    const BinReading b = rt.bins[i].read(rt.config, i, now);
    if (!b.valid) {
      faults.add(String("bin ") + binId(i) + ": " + (b.fault ? b.fault : "invalid"));
    }
  }

  JsonArray events = root["recent_events"].to<JsonArray>();
  for (std::size_t i = 0; i < rt.events.size(); ++i) {
    const StoredEvent& e = rt.events.at(i);
    JsonObject o = events.add<JsonObject>();
    o["at_uptime_ms"] = e.at_ms;
    o["code"] = e.code;
    o["text"] = e.text;
  }
}

void buildHealth(JsonDocument& doc) {
  const uint32_t now = millis();
  JsonObject root = doc.to<JsonObject>();
  root["protocol_version"] = VILLAGE_PROTOCOL_VERSION;
  root["device_id"] = g_device_id;
  root["boot_id"] = g_boot_id;
  root["firmware"] = VILLAGE_FIRMWARE_VERSION;
  root["uptime_ms"] = now;
  root["sample_seq"] = rt.sample_seq;
  root["config_revision"] = rt.config.revision;

  JsonObject board = root["board"].to<JsonObject>();
  board["profile"] = pins::kBoardProfile;
  board["module"] = "ESP32-WROOM-32";
  board["description"] = pins::kBoardDescription;
  board["chip_model"] = ESP.getChipModel();
  board["revision"] = ESP.getChipRevision();
  board["flash_size"] = ESP.getFlashChipSize();
  board["mac"] = WiFi.macAddress();
  board["pin_map_version"] = pins::kPinMapVersion;

  JsonObject wifi = root["wifi"].to<JsonObject>();
  wifi["mode"] = networkMode();
  wifi["ssid"] = networkSsid();
  wifi["ip"] = networkIp();
  wifi["rssi"] = networkRssi();
  wifi["connected"] = networkConnected();

  root["pump_commissioned"] = VILLAGE_PUMP_COMMISSIONED == 1;
  root["free_heap"] = ESP.getFreeHeap();

  JsonObject pm = root["pin_map"].to<JsonObject>();
  pm["soil_moisture_adc"] = pins::SOIL_MOISTURE_ADC;
  pm["reservoir_excite"] = pins::RESERVOIR_EXCITE;
  pm["reservoir_sense_adc"] = pins::RESERVOIR_SENSE_ADC;
  pm["ldr"] = pins::LDR_ADC;
  pm["pump_gate"] = pins::PUMP_GATE;
  JsonArray street = pm["streetlight_leds"].to<JsonArray>();
  for (int i = 0; i < pins::STREETLIGHT_LAMP_COUNT; ++i) {
    street.add(pins::STREETLIGHT_LEDS[i]);
  }
  JsonObject waste = pm["waste_leds"].to<JsonObject>();
  waste["organic"] = pins::WASTE_LED_ORGANIC;
  waste["plastic"] = pins::WASTE_LED_PLASTIC;
  waste["paper"] = pins::WASTE_LED_PAPER;
  JsonArray trig = pm["bin_trig"].to<JsonArray>();
  JsonArray echo = pm["bin_echo"].to<JsonArray>();
  for (int i = 0; i < 3; ++i) {
    trig.add(pins::BIN_TRIG[i]);
    echo.add(pins::BIN_ECHO[i]);
  }
}

void writeConfig(JsonObject out, const DeviceConfig& c) {
  out["revision"] = c.revision;

  JsonObject soil = out["soil"].to<JsonObject>();
  soil["dry_raw"] = c.soil.dry_raw;
  soil["wet_raw"] = c.soil.wet_raw;
  soil["min_span_raw"] = c.soil.min_span_raw;
  soil["samples"] = c.soil.samples;
  soil["max_age_ms"] = c.soil.max_age_ms;
  soil["calibrated"] = c.soil.calibrated;

  JsonObject res = out["reservoir"].to<JsonObject>();
  res["wet_threshold_mv"] = c.reservoir.wet_threshold_mv;
  res["dry_threshold_mv"] = c.reservoir.dry_threshold_mv;
  res["confirm_readings"] = c.reservoir.confirm_readings;
  res["max_age_ms"] = c.reservoir.max_age_ms;
  res["calibrated"] = c.reservoir.calibrated;

  JsonObject light = out["light"].to<JsonObject>();
  light["installed"] = c.light.installed;
  light["sensor_fitted"] = c.light.sensor_fitted;
  light["output_type"] = c.light.digital ? "digital" : "analog";
  light["analog_bright_high"] = c.light.analog_bright_high;
  light["digital_dark_when_high"] = c.light.digital_dark_when_high;
  light["dark_threshold"] = c.light.dark_threshold;
  light["bright_threshold"] = c.light.bright_threshold;
  light["stable_ms"] = c.light.stable_ms;
  light["max_age_ms"] = c.light.max_age_ms;

  JsonArray bins = out["bins"].to<JsonArray>();
  for (int i = 0; i < 3; ++i) {
    const BinConfig& b = c.bins[i];
    JsonObject o = bins.add<JsonObject>();
    o["id"] = binId(i);
    o["installed"] = b.installed;
    o["empty_cm"] = b.empty_cm;
    o["full_cm"] = b.full_cm;
    o["near_full_pct"] = b.near_full_pct;
    o["full_pct"] = b.full_pct;
    o["median_samples"] = b.median_samples;
    o["confirm_readings"] = b.confirm_readings;
    o["timeout_us"] = b.timeout_us;
    o["blind_zone_cm"] = b.blind_zone_cm;
    o["max_range_cm"] = b.max_range_cm;
    o["max_age_ms"] = b.max_age_ms;
  }

  JsonObject irr = out["irrigation"].to<JsonObject>();
  irr["auto_enabled"] = c.irrigation.auto_enabled;
  irr["pump_enabled"] = c.irrigation.pump_enabled;
  irr["dry_start_pct"] = c.irrigation.dry_start_pct;
  irr["stop_pct"] = c.irrigation.stop_pct;
  irr["dry_confirm_ms"] = c.irrigation.dry_confirm_ms;
  irr["pulse_ms"] = c.irrigation.pulse_ms;
  irr["max_pulse_ms"] = c.irrigation.max_pulse_ms;
  irr["soak_ms"] = c.irrigation.soak_ms;
  irr["max_cumulative_ms"] = c.irrigation.max_cumulative_ms;
  irr["max_pulses"] = c.irrigation.max_pulses;
  irr["cooldown_ms"] = c.irrigation.cooldown_ms;
  irr["link_timeout_ms"] = c.irrigation.link_timeout_ms;

  JsonObject waste = out["waste"].to<JsonObject>();
  waste["indicate_ms"] = c.waste.indicate_ms;
}

void buildConfigDoc(JsonDocument& doc) {
  JsonObject root = doc.to<JsonObject>();
  root["protocol_version"] = VILLAGE_PROTOCOL_VERSION;
  root["device_id"] = g_device_id;
  root["config_revision"] = rt.config.revision;
  writeConfig(root["config"].to<JsonObject>(), rt.config);
}

bool parseConfig(JsonObjectConst c, DeviceConfig& out, String& err) {
  if (c.isNull()) {
    err = "missing config object";
    return false;
  }
  if (c["soil"].isNull() || c["reservoir"].isNull() || c["light"].isNull() ||
      c["bins"].isNull() || c["irrigation"].isNull() || c["waste"].isNull()) {
    err = "config must contain soil, reservoir, light, bins, irrigation and waste";
    return false;
  }

  JsonObjectConst soil = c["soil"].as<JsonObjectConst>();
  out.soil.dry_raw = soil["dry_raw"] | out.soil.dry_raw;
  out.soil.wet_raw = soil["wet_raw"] | out.soil.wet_raw;
  out.soil.min_span_raw = soil["min_span_raw"] | out.soil.min_span_raw;
  out.soil.samples = soil["samples"] | out.soil.samples;
  out.soil.max_age_ms = soil["max_age_ms"] | out.soil.max_age_ms;
  out.soil.calibrated = soil["calibrated"] | out.soil.calibrated;

  JsonObjectConst res = c["reservoir"].as<JsonObjectConst>();
  out.reservoir.wet_threshold_mv =
      res["wet_threshold_mv"] | out.reservoir.wet_threshold_mv;
  out.reservoir.dry_threshold_mv =
      res["dry_threshold_mv"] | out.reservoir.dry_threshold_mv;
  out.reservoir.confirm_readings =
      res["confirm_readings"] | out.reservoir.confirm_readings;
  out.reservoir.max_age_ms =
      res["max_age_ms"] | out.reservoir.max_age_ms;
  out.reservoir.calibrated = res["calibrated"] | out.reservoir.calibrated;

  JsonObjectConst light = c["light"].as<JsonObjectConst>();
  out.light.installed = light["installed"] | out.light.installed;
  out.light.sensor_fitted = light["sensor_fitted"] | out.light.sensor_fitted;
  const char* output_type = light["output_type"] | "analog";
  out.light.digital = std::strcmp(output_type, "digital") == 0;
  out.light.analog_bright_high =
      light["analog_bright_high"] | out.light.analog_bright_high;
  out.light.digital_dark_when_high =
      light["digital_dark_when_high"] | out.light.digital_dark_when_high;
  out.light.dark_threshold =
      light["dark_threshold"] | out.light.dark_threshold;
  out.light.bright_threshold =
      light["bright_threshold"] | out.light.bright_threshold;
  out.light.stable_ms = light["stable_ms"] | out.light.stable_ms;
  out.light.max_age_ms = light["max_age_ms"] | out.light.max_age_ms;

  JsonArrayConst bins = c["bins"].as<JsonArrayConst>();
  if (bins.isNull() || bins.size() != 3) {
    err = "bins must contain exactly three entries (organic, plastic, paper)";
    return false;
  }
  for (std::size_t i = 0; i < 3; ++i) {
    JsonObjectConst b = bins[i].as<JsonObjectConst>();
    if (b.isNull()) {
      err = "bin entry is not an object";
      return false;
    }
    out.bins[i].installed = b["installed"] | out.bins[i].installed;
    out.bins[i].empty_cm = b["empty_cm"] | out.bins[i].empty_cm;
    out.bins[i].full_cm = b["full_cm"] | out.bins[i].full_cm;
    out.bins[i].near_full_pct = b["near_full_pct"] | out.bins[i].near_full_pct;
    out.bins[i].full_pct = b["full_pct"] | out.bins[i].full_pct;
    out.bins[i].median_samples =
        b["median_samples"] | out.bins[i].median_samples;
    out.bins[i].confirm_readings =
        b["confirm_readings"] | out.bins[i].confirm_readings;
    out.bins[i].timeout_us = b["timeout_us"] | out.bins[i].timeout_us;
    out.bins[i].blind_zone_cm =
        b["blind_zone_cm"] | out.bins[i].blind_zone_cm;
    out.bins[i].max_range_cm = b["max_range_cm"] | out.bins[i].max_range_cm;
    out.bins[i].max_age_ms = b["max_age_ms"] | out.bins[i].max_age_ms;
  }

  JsonObjectConst irr = c["irrigation"].as<JsonObjectConst>();
  out.irrigation.auto_enabled =
      irr["auto_enabled"] | out.irrigation.auto_enabled;
  out.irrigation.pump_enabled =
      irr["pump_enabled"] | out.irrigation.pump_enabled;
  out.irrigation.dry_start_pct =
      irr["dry_start_pct"] | out.irrigation.dry_start_pct;
  out.irrigation.stop_pct = irr["stop_pct"] | out.irrigation.stop_pct;
  out.irrigation.dry_confirm_ms =
      irr["dry_confirm_ms"] | out.irrigation.dry_confirm_ms;
  out.irrigation.pulse_ms = irr["pulse_ms"] | out.irrigation.pulse_ms;
  out.irrigation.max_pulse_ms =
      irr["max_pulse_ms"] | out.irrigation.max_pulse_ms;
  out.irrigation.soak_ms = irr["soak_ms"] | out.irrigation.soak_ms;
  out.irrigation.max_cumulative_ms =
      irr["max_cumulative_ms"] | out.irrigation.max_cumulative_ms;
  out.irrigation.max_pulses = irr["max_pulses"] | out.irrigation.max_pulses;
  out.irrigation.cooldown_ms = irr["cooldown_ms"] | out.irrigation.cooldown_ms;
  out.irrigation.link_timeout_ms =
      irr["link_timeout_ms"] | out.irrigation.link_timeout_ms;

  JsonObjectConst waste = c["waste"].as<JsonObjectConst>();
  out.waste.indicate_ms = waste["indicate_ms"] | out.waste.indicate_ms;
  return true;
}

String ackJson(const String& id, const String& type, CommandResult result,
               const Reason& reason, uint32_t now) {
  JsonDocument doc;
  JsonObject root = doc.to<JsonObject>();
  root["protocol_version"] = VILLAGE_PROTOCOL_VERSION;
  root["command_id"] = id;
  root["type"] = type;
  root["result"] = toString(result);
  addReason(root, reason);
  root["at_uptime_ms"] = now;
  JsonObject irr = root["irrigation"].to<JsonObject>();
  const IrrigationStatus s = rt.irrigation.status(now);
  irr["state"] = toString(s.state);
  irr["pump_on"] = s.pump_on;
  irr["pulses_done"] = s.pulses_done;
  irr["pulse_limit"] = s.pulse_limit;
  String out;
  serializeJson(doc, out);
  return out;
}

void handleHealth() {
  JsonDocument doc;
  buildHealth(doc);
  String out;
  serializeJson(doc, out);
  sendJson(200, out);
}

void handleStatus() {
  if (!requireAuth()) return;
  JsonDocument doc;
  buildStatus(doc);
  String out;
  serializeJson(doc, out);
  sendJson(200, out);
}

void handleConfigGet() {
  if (!requireAuth()) return;
  JsonDocument doc;
  buildConfigDoc(doc);
  String out;
  serializeJson(doc, out);
  sendJson(200, out);
}

void handleConfigPut() {
  if (!requireAuth()) return;
  const String body = server.arg("plain");
  if (body.isEmpty()) {
    sendError(400, "INVALID_JSON", "request body is empty");
    return;
  }
  JsonDocument doc;
  const DeserializationError e = deserializeJson(doc, body);
  if (e) {
    sendError(400, "INVALID_JSON", e.c_str());
    return;
  }
  const int expected = doc["config_revision"] | -1;
  if (expected < 0) {
    sendError(400, "CONFIG_REVISION_REQUIRED",
              "config_revision is required for an update");
    return;
  }
  if (expected != static_cast<int>(rt.config.revision)) {
    sendError(409, "CONFIG_REVISION_CONFLICT",
              "the configuration changed since it was read; reload it before saving",
              "config_revision", static_cast<int>(rt.config.revision));
    return;
  }
  DeviceConfig incoming = rt.config;
  incoming.revision = rt.config.revision + 1;
  String parseError;
  if (!parseConfig(doc["config"].as<JsonObjectConst>(), incoming, parseError)) {
    sendError(400, "CONFIG_INVALID", parseError);
    return;
  }
  if (incoming.irrigation.pump_enabled && VILLAGE_PUMP_COMMISSIONED != 1) {
    sendError(400, "PUMP_NOT_COMMISSIONED",
              "the pump is disabled in this firmware build; complete the bench test and set VILLAGE_PUMP_COMMISSIONED 1",
              "irrigation.pump_enabled");
    return;
  }
  ConfigError ce;
  if (!validateConfig(incoming, ce)) {
    sendError(400, "CONFIG_INVALID", ce.message, ce.field);
    return;
  }
  if (!saveConfigToNvs(incoming)) {
    sendError(500, "NVS_WRITE_FAILED", "the controller could not save the configuration");
    return;
  }

  const uint32_t now = millis();
  rt.config = incoming;
  applyRuntimeConfig(now);
  rt.events.add(now, "CONFIG_SAVED", "Configuration saved and applied.");
  applyStreetlights(rt.lights.output(rt.config, now).on);
  applyPump(rt.irrigation.pumpOn());

  JsonDocument reply;
  buildConfigDoc(reply);
  reply["saved"] = true;
  String out;
  serializeJson(reply, out);
  sendJson(200, out);
}

void handleCommand() {
  if (!requireAuth()) return;
  const String body = server.arg("plain");
  if (body.isEmpty()) {
    sendError(400, "INVALID_JSON", "request body is empty");
    return;
  }
  JsonDocument doc;
  const DeserializationError e = deserializeJson(doc, body);
  if (e) {
    sendError(400, "INVALID_JSON", e.c_str());
    return;
  }
  if ((doc["protocol_version"] | 0) != VILLAGE_PROTOCOL_VERSION) {
    sendError(400, "UNSUPPORTED_PROTOCOL", "protocol_version must be 1");
    return;
  }
  const String id = doc["command_id"] | "";
  if (id.length() == 0 || id.length() > 64) {
    sendError(400, "COMMAND_ID_REQUIRED", "command_id must be 1..64 characters");
    return;
  }
  const String type = doc["type"] | "";
  if (type.length() == 0) {
    sendError(400, "COMMAND_TYPE_REQUIRED", "type is required");
    return;
  }

  const uint32_t now = millis();
  const uint64_t hash = CommandHistory::hashId(id.c_str());
  const CommandRecord* seen = rt.commands.find(hash);
  if (seen != nullptr) {
    const Reason previous{seen->reason_code, seen->reason};
    rt.events.add(now, "DUPLICATE_COMMAND", "A repeated command id was ignored.");
    server.send(200, "application/json",
                ackJson(id, type, CommandResult::Duplicate, previous, now));
    return;
  }

  CommandResult result = CommandResult::Rejected;
  const Reason* reason = &reasons::kCommandInvalid;

  if (type == "LIGHTS_ON" || type == "LIGHTS_OFF" || type == "LIGHTS_AUTO") {
    if (!rt.config.light.installed) {
      result = CommandResult::Rejected;
      reason = &reasons::kLightsNotInstalled;
    } else {
      if (type == "LIGHTS_ON") rt.lights.setMode(LightMode::ManualOn);
      if (type == "LIGHTS_OFF") rt.lights.setMode(LightMode::ManualOff);
      if (type == "LIGHTS_AUTO") rt.lights.setMode(LightMode::Auto);
      const LightOutput out = rt.lights.output(rt.config, now);
      result = CommandResult::Accepted;
      reason = out.reason;
      applyStreetlights(out.on);
    }
  } else if (type == "IRRIGATION_REQUEST") {
    const IrrigationDecision d =
        rt.irrigation.requestManual(now, buildIrrigationInputs(now));
    result = d.result;
    reason = d.reason;
    applyPump(rt.irrigation.pumpOn());
  } else if (type == "IRRIGATION_STOP") {
    const IrrigationDecision d = rt.irrigation.stopUser(now);
    result = d.result;
    reason = d.reason;
    applyPump(false);
  } else if (type == "INDICATE_WASTE") {
    const char* categoryText = doc["parameters"]["category"] | "";
    WasteCategory category = WasteCategory::Unknown;
    if (!parseWasteCategory(categoryText, category)) {
      result = CommandResult::Rejected;
      reason = &reasons::kWasteUnknown;
    } else {
      const uint32_t duration = doc["parameters"]["duration_ms"] | 0;
      if (!rt.waste.indicate(category, duration, now)) {
        result = CommandResult::Rejected;
        reason = &reasons::kWasteUnknown;
      } else {
        result = CommandResult::Accepted;
        if (category == WasteCategory::Organic) reason = &reasons::kWasteOrganic;
        if (category == WasteCategory::Plastic) reason = &reasons::kWastePlastic;
        if (category == WasteCategory::Paper) reason = &reasons::kWastePaper;
        applyWasteCategory(category);
      }
    }
  }

  rt.events.add(now, reason->code, reason->text);
  rt.commands.remember(hash, result, reason->code, reason->text, now);
  saveCommandsToNvs(rt.commands);
  applyPump(rt.irrigation.pumpOn());

  server.send(200, "application/json", ackJson(id, type, result, *reason, now));
}

void handleNotFound() {
  sendError(404, "NOT_FOUND", "unknown endpoint");
}

}  // namespace

void setupApi() {
  const char* headers[] = {kAuthHeader};
  server.collectHeaders(headers, 1);
  server.on("/api/v1/health", HTTP_GET, handleHealth);
  server.on("/api/v1/status", HTTP_GET, handleStatus);
  server.on("/api/v1/config", HTTP_GET, handleConfigGet);
  server.on("/api/v1/config", HTTP_PUT, handleConfigPut);
  server.on("/api/v1/commands", HTTP_POST, handleCommand);
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.println("[api] listening on :80");
}

void handleApi() { server.handleClient(); }

}  // namespace village
