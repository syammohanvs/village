#include "village/api.h"

#include <ArduinoJson.h>

#include "village/config_json.h"
#include <WiFi.h>
#include <WebServer.h>

#include <cmath>
#include <cstring>

#include "village/build_config.h"
#include "village/core/irrigation.h"
#include "village/core/solar.h"
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

  JsonObject solar = sensors["solar"].to<JsonObject>();
  solar["installed"] = rt.config.solar.installed;
  solar["raw"] = rt.solar_raw;
  solar["millivolts"] = rt.solar_mv;
  solar["volts"] = static_cast<float>(rt.solar_mv) / 1000.0f;
  solar["junction_raw"] = rt.solar_junction_raw;
  solar["junction_millivolts"] = rt.solar_junction_mv;
  solar["sense_ohms"] = rt.config.solar.sense_ohms;
  const SolarPower power =
      computeSolarPower(rt.solar_mv, rt.solar_junction_mv, rt.config.solar.sense_ohms);
  solar["drop_millivolts"] = power.drop_mv;
  solar["current_ma"] = power.current_ma;
  solar["power_mw"] = power.power_mw;
  solar["valid"] = power.valid;

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

  // Test mode (Setup → Test outputs).  Reported so the panel can show what is
  // actually being driven, and how long the pump has left.
  JsonObject test = root["test"].to<JsonObject>();
  test["enabled"] = rt.test_enabled;
  test["active"] = rt.test_active;
  test["pump"] = rt.test_pump;
  JsonObject tled = test["leds"].to<JsonObject>();
  tled["organic"] = rt.test_led_organic;
  tled["plastic"] = rt.test_led_plastic;
  tled["paper"] = rt.test_led_paper;
  tled["streetlights"] = rt.test_streetlights;

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
  // A sensor that is deliberately not fitted is not a fault.  Reporting one
  // turned "no LDR on this build" into a fault line on every frame.
  if (light.installed && !light.valid) {
    faults.add(String("light: ") + (light.fault ? light.fault : "invalid"));
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
  board["waste_leds_always_on"] = VILLAGE_WASTE_LEDS_ALWAYS_ON == 1;
  board["pump_bench_drive"] = VILLAGE_PUMP_BENCH_DRIVE == 1;
  board["pump_drive_inverted"] = VILLAGE_PUMP_DRIVE_INVERTED == 1;

  JsonObject wifi = root["wifi"].to<JsonObject>();
  wifi["mode"] = networkMode();
  wifi["ssid"] = networkSsid();
  wifi["ip"] = networkIp();
  wifi["rssi"] = networkRssi();
  wifi["connected"] = networkConnected();

  root["pump_commissioned"] = VILLAGE_PUMP_COMMISSIONED == 1;
  root["free_heap"] = ESP.getFreeHeap();

  JsonObject ota = root["ota"].to<JsonObject>();
  ota["started"] = otaStarted();
  ota["port"] = 3232;
  ota["password_set"] = otaPasswordSet();

  JsonObject pm = root["pin_map"].to<JsonObject>();
  pm["soil_moisture_adc"] = pins::SOIL_MOISTURE_ADC;
  pm["reservoir_excite"] = pins::RESERVOIR_EXCITE;
  pm["reservoir_sense_adc"] = pins::RESERVOIR_SENSE_ADC;
  pm["ldr"] = pins::LDR_ADC;
  pm["solar_panel_adc"] = pins::SOLAR_PANEL_ADC;
  pm["solar_current_adc"] = pins::SOLAR_CURRENT_ADC;
  pm["pump_gate"] = pins::PUMP_GATE;
  // All lamps share one pin, so there is only one pin to report.
  JsonArray street = pm["streetlight_leds"].to<JsonArray>();
  street.add(pins::STREETLIGHT_LED_PIN);
  JsonObject waste = pm["waste_leds"].to<JsonObject>();
  waste["organic"] = pins::WASTE_LED_ORGANIC;
  waste["plastic"] = pins::WASTE_LED_PLASTIC;
  waste["paper"] = pins::WASTE_LED_PAPER;
}

void buildConfigDoc(JsonDocument& doc) {
  JsonObject root = doc.to<JsonObject>();
  root["protocol_version"] = VILLAGE_PROTOCOL_VERSION;
  root["device_id"] = g_device_id;
  root["config_revision"] = rt.config.revision;
  writeConfigJson(root["config"].to<JsonObject>(), rt.config);
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
  const char* parseError = nullptr;
  if (!readConfigJson(doc["config"].as<JsonObjectConst>(), incoming, &parseError)) {
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
  } else if (type == "TEST_MODE") {
    // The master switch above the five outputs.  Off releases everything it was
    // holding, so the normal drivers take the pins back on the next pass.
    const bool on = doc["parameters"]["on"] | false;
    rt.test_enabled = on;
    if (!on) {
      rt.test_active = false;
      rt.test_pump = false;
      rt.test_led_organic = false;
      rt.test_led_plastic = false;
      rt.test_led_paper = false;
      rt.test_streetlights = false;
      applyTestLeds(false, false, false, false);
    }
    result = CommandResult::Accepted;
    reason = on ? &reasons::kTestModeOn : &reasons::kTestModeOff;
  } else if (type == "TEST_OUTPUT") {
    // One switch per output, straight to the pin -- but only while the page's
    // master switch is on.  Past that there are no gates and no timers: the
    // operator asked to take the protection on themselves (2026-11-16).
    if (!rt.test_enabled) {
      result = CommandResult::Rejected;
      reason = &reasons::kTestDisabled;
    } else {
      const String output = doc["parameters"]["output"] | "";
      const bool on = doc["parameters"]["on"] | false;
      bool known = true;
      rt.test_active = true;
      if (output == "pump") {
        rt.test_pump = on;
      } else if (output == "led_organic") {
        rt.test_led_organic = on;
      } else if (output == "led_plastic") {
        rt.test_led_plastic = on;
      } else if (output == "led_paper") {
        rt.test_led_paper = on;
      } else if (output == "streetlights") {
        rt.test_streetlights = on;
      } else {
        known = false;
      }
      if (!known) {
        result = CommandResult::Rejected;
        reason = &reasons::kTestOutputUnknown;
      } else {
        result = CommandResult::Accepted;
        reason = on ? &reasons::kTestStarted : &reasons::kTestStopped;
        applyPump(rt.test_pump);
        applyTestLeds(rt.test_led_organic, rt.test_led_plastic, rt.test_led_paper,
                      rt.test_streetlights);
      }
    }
  }

  rt.events.add(now, reason->code, reason->text);
  rt.commands.remember(hash, result, reason->code, reason->text, now);
  saveCommandsToNvs(rt.commands);
  if (!rt.test_active) applyPump(rt.irrigation.pumpOn());

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
