#pragma once

// Build-time switches.
//
// There is no commissioning gate any more (2026-11-17): the hardware is
// finished and the gate only produced "the pump is not commissioned" on a board
// whose pump is wired and tested.  Whether the pump may run is a runtime
// question now -- `config.irrigation.pump_enabled` for the automatic rules, and
// the manual Auto/On/Off switch beside it, whose only remaining check is the
// tank.

#define VILLAGE_FIRMWARE_VERSION "0.2.9"
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

// BENCH-ONLY: force the board into its access-point mode at boot.
//
// Normally the AP is a boot-time rescue only, started when station mode
// fails within VILLAGE_AP_FALLBACK_AFTER_MS.  With this flag set the board
// never tries station mode at all, which is useful for bench work on a laptop
// that is on a different network from the configured router.
//
// Set back to 0 for normal operation.
#ifndef VILLAGE_FORCE_AP
#define VILLAGE_FORCE_AP 0
#endif
static_assert(VILLAGE_FORCE_AP == 0 || VILLAGE_FORCE_AP == 1,
              "VILLAGE_FORCE_AP must be 0 or 1");

// BENCH-ONLY: drive the pump-switch control HIGH at boot with no commissioning.
//
// This exists so the pump switch can be checked with a dummy load while the
// pump is still disconnected: it proves the GPIO and the base resistor actually
// turn the 2N2222 on.  It bypasses BOTH pump safety gates, so:
//   * leave it 0 in every build that can be connected to a pump;
//   * the board reports it as board.pump_bench_drive and logs it at boot;
//   * set it back to 0 and reflash before the pump is wired.
#ifndef VILLAGE_PUMP_BENCH_DRIVE
#define VILLAGE_PUMP_BENCH_DRIVE 0
#endif
static_assert(VILLAGE_PUMP_BENCH_DRIVE == 0 || VILLAGE_PUMP_BENCH_DRIVE == 1,
              "VILLAGE_PUMP_BENCH_DRIVE must be 0 or 1");

// DEMO-ONLY: invert the pump-switch control level.
//
// The installed 2N2222 common-emitter driver is NON-inverting: GPIO HIGH feeds
// the base, the transistor conducts and the pump runs. This flag exists for an
// inverting driver (for example a transistor stage feeding a high-side switch),
// where GPIO HIGH would turn the pump OFF; it makes the firmware drive the pin
// the other way round so "pump on" still means "pump on" from the UI.
//
// It is a bench/demo concession, not the design: while the control is inverted,
// a reset leaves the pin floating, so the level is pulled HIGH and the pump runs
// for the few hundred milliseconds before setupOutputs() runs. The pump must
// stay submerged for the whole demo, and this flag is 0 on the exhibit with the
// 2N2222 fitted.
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
