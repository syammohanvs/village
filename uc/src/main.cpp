#include <Arduino.h>

#include "village/api.h"
#include "village/build_config.h"
#include "village/core/time.h"
#include "village/device_state.h"
#include "village/net.h"
#include "village/outputs.h"
#include "village/sensors.h"
#include "village/config_store.h"

using namespace village;

namespace {

void logCurrentState(uint32_t now) {
  const IrrigationStatus irr = rt.irrigation.status(now);
  rt.events.add(now, irr.reason->code, irr.reason->text);

  const LightOutput lights = rt.lights.output(rt.config, now);
  rt.events.add(now, lights.reason->code, lights.reason->text);

  for (std::size_t i = 0; i < 3; ++i) {
    const BinReading b = rt.bins[i].read(rt.config, i, now);
    char code[48];
    char text[96];
    std::snprintf(code, sizeof(code), "BIN_%s_%s", binId(i),
                  toString(b.state));
    std::snprintf(text, sizeof(text), "%s bin: %s", binId(i),
                  toString(b.state));
    rt.events.add(now, code, text);
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(80);
  Serial.println();
  Serial.println("=== Our AI-Powered Smart Green Village ===");
  Serial.printf("firmware %s, protocol %d\n", VILLAGE_FIRMWARE_VERSION,
                VILLAGE_PROTOCOL_VERSION);

  initIdentity();
  rt.boot_ms = millis();

  const bool loaded = loadStateFromNvs(rt.config, rt.commands);
  setupOutputs();
  setupSensors();
  rt.irrigation.begin(millis(), rt.config.irrigation,
                      VILLAGE_PUMP_COMMISSIONED == 1);
  applyRuntimeConfig(millis());

  startNetwork();
  setupApi();

  const uint32_t now = millis();
  rt.events.add(now, "IDLE_BOOT",
                loaded ? "Controller started from saved configuration. Pump is off."
                       : "Controller started with default configuration. Pump is off.");
  Serial.printf("[boot] %s, boot %s, pump gate %s\n", g_device_id, g_boot_id,
                VILLAGE_PUMP_COMMISSIONED == 1 ? "commissioned" : "DISABLED");
  Serial.printf("[boot] pump output is LOW; config revision %lu\n",
                static_cast<unsigned long>(rt.config.revision));
}

void loop() {
  const uint32_t now = millis();

  networkLoop(now);
  handleApi();
  sampleSensors(now);

  const IrrigationInputs inputs = buildIrrigationInputs(now);
  rt.irrigation.tick(now, inputs);
  applyPump(rt.irrigation.pumpOn());

  const LightOutput lights = rt.lights.output(rt.config, now);
  applyStreetlights(lights.on);

  rt.waste.tick(now);
  const WasteLedState waste = rt.waste.read(now);
  applyWasteCategory(waste.active ? waste.category : WasteCategory::Unknown);

  logCurrentState(now);

  delay(2);
}
