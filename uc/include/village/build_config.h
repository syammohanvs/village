#pragma once

// Build-time switches.  These are deliberately separate from the runtime
// configuration so the pump needs two independent keys before it can run.
//
// The pump is DISABLED unless BOTH are true:
//   1. VILLAGE_PUMP_COMMISSIONED == 1 (this file, changed after the bench test)
//   2. config.irrigation.pump_enabled == true (saved in NVS from the UI)
#ifndef VILLAGE_PUMP_COMMISSIONED
#define VILLAGE_PUMP_COMMISSIONED 0
#endif

#define VILLAGE_FIRMWARE_VERSION "0.1.0"
#define VILLAGE_PROTOCOL_VERSION 1

// How long the controller refuses any irrigation start after boot.  It also
// guarantees the pump output is LOW while the rest of the system settles.
#define VILLAGE_BOOT_GUARD_MS 5000

// Set to 0 to disable mDNS.  The IP printed on the serial console is always
// authoritative.
#ifndef VILLAGE_ENABLE_MDNS
#define VILLAGE_ENABLE_MDNS 1
#endif

// Password-protected over-the-air firmware updates.  Enabled by default so a
// mounted board can be updated without the USB cable, but it only starts once
// station mode is connected, and it always requires VILLAGE_OTA_PASSWORD.
#ifndef VILLAGE_ENABLE_OTA
#define VILLAGE_ENABLE_OTA 1
#endif

// BENCH-ONLY: drive the pump gate HIGH at boot with no commissioning.
//
// This exists so the MOSFET can be measured with a dummy load while the pump
// is still disconnected: it proves the GPIO, the series resistor and the gate
// pull-down actually switch the channel.  It bypasses BOTH pump gates, so:
//   * leave it 0 in every build that can be connected to a pump;
//   * the board reports it as board.pump_bench_drive and logs it at boot;
//   * set it back to 0 and reflash before the pump is wired.
#ifndef VILLAGE_PUMP_BENCH_DRIVE
#define VILLAGE_PUMP_BENCH_DRIVE 0
#endif
static_assert(VILLAGE_PUMP_BENCH_DRIVE == 0 || VILLAGE_PUMP_BENCH_DRIVE == 1,
              "VILLAGE_PUMP_BENCH_DRIVE must be 0 or 1");

// DEMO-ONLY: invert the pump gate level.
//
// A single NPN between the GPIO and the gate is an inverting driver: GPIO
// HIGH pulls the gate LOW. This flag makes the firmware drive the pin the
// other way round so "pump on" still means "pump on" from the UI.
//
// It is a bench/demo concession, not a design: while the gate is inverted, a
// reset leaves the pin floating, so the gate is pulled HIGH and the pump runs
// for the few hundred milliseconds before setupOutputs() runs. The pump must
// stay submerged for the whole demo, and this flag goes back to 0 with a
// proper logic-level MOSFET.
#ifndef VILLAGE_PUMP_DRIVE_INVERTED
#define VILLAGE_PUMP_DRIVE_INVERTED 0
#endif
static_assert(VILLAGE_PUMP_DRIVE_INVERTED == 0 ||
                  VILLAGE_PUMP_DRIVE_INVERTED == 1,
              "VILLAGE_PUMP_DRIVE_INVERTED must be 0 or 1");

// BENCH-TEST OVERRIDE — all three waste indicator LEDs held lit.
//
// Set to 1 while the three indicator LEDs are being wired: the pins are
// driven HIGH at boot and stay HIGH, so an LED lights the moment it is
// connected, without waiting for an INDICATE_WASTE command.  Set back to 0
// for the exhibit, where the indicators follow the recognised category and
// are otherwise dark.
//
// This only affects the LED pins.  It cannot enable the pump, and the pump
// keeps its own two independent gates.
#ifndef VILLAGE_WASTE_LEDS_ALWAYS_ON
#define VILLAGE_WASTE_LEDS_ALWAYS_ON 0
#endif
static_assert(VILLAGE_WASTE_LEDS_ALWAYS_ON == 0 ||
                  VILLAGE_WASTE_LEDS_ALWAYS_ON == 1,
              "VILLAGE_WASTE_LEDS_ALWAYS_ON must be 0 or 1");
