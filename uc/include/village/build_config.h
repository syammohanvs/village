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
