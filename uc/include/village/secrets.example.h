#pragma once

// Copy this file to `secrets.h` (same folder) and fill in the values.
// `secrets.h` is git-ignored.  Do not commit real Wi-Fi passwords or tokens.

#define VILLAGE_WIFI_SSID "YOUR_WIFI_NAME"
#define VILLAGE_WIFI_PASS "YOUR_WIFI_PASSWORD"

// Long random string shared with the backend's VILLAGE_DEVICE_TOKEN.
#define VILLAGE_DEVICE_TOKEN "replace-with-a-long-random-token"

// Fallback access point, used only when station mode fails at boot.
#define VILLAGE_ALLOW_AP_FALLBACK 1
#define VILLAGE_AP_SSID "Village-Setup"
#define VILLAGE_AP_PASS "village1234"
#define VILLAGE_AP_FALLBACK_AFTER_MS 15000

// Optional fixed address.  Leave commented out for DHCP.
// #define VILLAGE_STATIC_IP "192.168.1.50"
// #define VILLAGE_GATEWAY "192.168.1.1"
// #define VILLAGE_SUBNET "255.255.255.0"
