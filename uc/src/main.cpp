#include <Arduino.h>

#include "village/api.h"
#include "village/build_config.h"
#include "village/core/reasons.h"
#include "village/core/time.h"
#include "village/device_state.h"
#include "village/net.h"
#include "village/outputs.h"
#include "village/pins.h"
#include "village/sensors.h"
#include "village/config_store.h"

using namespace village;

namespace {

void logCurrentState(uint32_t now) {
  const IrrigationStatus irr = rt.irrigation.status(now);
  rt.events.add(now, irr.reason->code, irr.reason->text);

  const LightOutput lights = rt.lights.output(rt.config, now);
  rt.events.add(now, lights.reason->code, lights.reason->text);
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
  if (!loaded) {
    // Say it out loud: a board that comes up uncalibrated looks like a broken
    // sensor, and the real answer ("no saved configuration was found") belongs
    // on the dashboard, not only in the serial log.
    rt.events.add(millis(), "CONFIG_DEFAULTS",
                  "No saved configuration was found, so defaults are in use. Save from Setup to keep the calibration.");
  }
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
                VILLAGE_PUMP_BENCH_DRIVE == 1
                    ? "BENCH DRIVE"
                    : (VILLAGE_PUMP_COMMISSIONED == 1 ? "commissioned"
                                                      : "DISABLED"));
  if (VILLAGE_PUMP_BENCH_DRIVE == 1) {
    Serial.println("[boot] BENCH DRIVE is on: the pump gate is HIGH with no "
                   "commissioning. The pump must be disconnected.");
  } else if (VILLAGE_PUMP_DRIVE_INVERTED == 1) {
    Serial.println("[boot] pump drive INVERTED for the NPN demo driver: "
                   "GPIO HIGH = pump off, GPIO LOW = pump on.");
  } else {
    Serial.printf("[boot] pump output is LOW; config revision %lu\n",
                  static_cast<unsigned long>(rt.config.revision));
  }
}

// Test page (Setup → Test outputs): one switch per output, straight to the pin.
// While its master switch is on the page owns all five outputs, so the normal
// drivers cannot pull a pin back down between writes.  The pump is written with
// applyPumpDirect(): the page's master switch is the gate, and the commissioning
// gate must not quietly veto a switch the operator pressed.
static void applyTestOutputs(uint32_t) {
  if (!rt.test_enabled) return;
  applyPumpDirect(rt.test_pump);
  applyTestLeds(rt.test_led_organic, rt.test_led_plastic, rt.test_led_paper,
                rt.test_streetlights);
}

void loop() {
  uint32_t now = millis();

  networkLoop(now);
  otaLoop();
  handleApi();
  // Re-read the clock: a handler may have stamped `last_contact_ms` or a
  // pulse start with a later millis() than the value sampled above, and every
  // age computed against the older stamp would look like a wrap.
  now = millis();
  sampleSensors(now);

  const IrrigationInputs inputs = buildIrrigationInputs(now);
  rt.irrigation.tick(now, inputs);
#if VILLAGE_PUMP_BENCH_DRIVE == 1
  // Hold the gate high on EVERY pass, not every 2 s.  The bench block used to
  // write HIGH once per report while the line above wrote pumpOn() (usually
  // false) on every other pass, so the pin chattered at loop rate and the motor
  // never turned -- "pin high indefinitely" needs this call to be the only one.
  applyPump(true);
#else
  // The test page owns the gate once it has driven anything; writing pumpOn()
  // here as well would drop the pin LOW for a moment every pass (relay chatter).
  if (!rt.test_enabled) applyPump(rt.irrigation.pumpOn());
#endif

#if VILLAGE_PUMP_BENCH_DRIVE == 1
  // Bench diagnostic.  The latch and the pad are two different facts: the code
  // can write HIGH on every pass while the pin reads LOW because the header
  // hole is not the one being written, or because the driver is damaged.  Only
  // a readback separates those, so the bench build prints both every 2 s.
  static uint32_t bench_report_ms = 0;
  if (now - bench_report_ms >= 2000) {
    bench_report_ms = now;
    const int readback = digitalRead(pins::PUMP_GATE);
    Serial.printf("[bench] pump gate GPIO %d: latch HIGH, pad %s (%d)\n",
                  pins::PUMP_GATE, readback == HIGH ? "HIGH" : "LOW", readback);
  }
#endif

  // Same for the four light outputs: once the test page has driven one, the
  // normal drivers stand down so the two cannot write the same pins every pass.
  const LightOutput lights = rt.lights.output(rt.config, now);
  if (!rt.test_enabled) applyStreetlights(lights.on);

  rt.waste.tick(now);
  const WasteLedState waste = rt.waste.read(now);
  if (!rt.test_enabled) {
    applyWasteCategory(waste.active ? waste.category : WasteCategory::Unknown);
  }

  applyTestOutputs(now);

  logCurrentState(now);

  delay(2);
}
