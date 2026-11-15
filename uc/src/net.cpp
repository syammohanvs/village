#include "village/net.h"

#include <ESPmDNS.h>
#include <WiFi.h>

#include "village/build_config.h"
#include "village/device_state.h"
#include "village/outputs.h"

#if VILLAGE_ENABLE_OTA
#include <ArduinoOTA.h>
#endif

#if __has_include("village/secrets.h")
#include "village/secrets.h"
#else
#error "Missing uc/include/village/secrets.h - copy secrets.example.h to secrets.h and fill it in."
#endif

#ifndef VILLAGE_ALLOW_AP_FALLBACK
#define VILLAGE_ALLOW_AP_FALLBACK 1
#endif
#ifndef VILLAGE_AP_FALLBACK_AFTER_MS
#define VILLAGE_AP_FALLBACK_AFTER_MS 15000
#endif

namespace village {
namespace {

uint32_t g_sta_started_ms = 0;
bool g_sta_started = false;
bool g_sta_was_connected = false;
bool g_fallback_done = false;
bool g_ota_started = false;

void startMdns() {
#if VILLAGE_ENABLE_MDNS
  if (MDNS.begin("village")) {
    MDNS.addService("http", "tcp", 80);
    Serial.println("[net] mDNS: http://village.local/");
  }
#endif
}

void startAccessPoint() {
  // Read the status BEFORE changing mode: `WiFi.mode(...)` resets the station
  // status, so asking afterwards answers 255 (WL_NO_SHIELD) and says nothing.
  const wl_status_t st = WiFi.status();
  WiFi.mode(WIFI_AP);
  const bool ok = WiFi.softAP(VILLAGE_AP_SSID, VILLAGE_AP_PASS);
  rt.ap_mode = true;
  g_fallback_done = true;
  // Say WHY station mode failed.  Without this the log only ever said "station
  // mode failed", which is the same sentence for a network that is not visible,
  // a wrong password and a security type the board cannot do -- and the venue
  // spent a whole session guessing between them (2026-11-15).
  const char* why =
      (st == WL_NO_SSID_AVAIL)   ? "network not found -- check the name and that it is 2.4 GHz"
      : (st == WL_CONNECT_FAILED) ? "rejected -- wrong password, or a security type this board cannot do"
      : (st == WL_CONNECTION_LOST) ? "connection lost after joining"
      : (st == WL_DISCONNECTED)    ? "disconnected"
      : (st == WL_IDLE_STATUS)     ? "never started"
                                   : "see the status code";
  Serial.printf("[net] station mode failed (status %d: %s); AP fallback %s, SSID '%s', IP %s\n",
                static_cast<int>(st), why, ok ? "started" : "FAILED", VILLAGE_AP_SSID,
                WiFi.softAPIP().toString().c_str());
}

}  // namespace

void startOta() {
#if VILLAGE_ENABLE_OTA
  if (g_ota_started) return;
  if (WiFi.status() != WL_CONNECTED) return;
#ifndef VILLAGE_OTA_PASSWORD
#error "VILLAGE_OTA_PASSWORD must be defined in secrets.h when OTA is enabled."
#endif
  ArduinoOTA.setHostname("village");
  ArduinoOTA.setPort(3232);
  ArduinoOTA.setPassword(VILLAGE_OTA_PASSWORD);
  // Our own responder already owns village.local; enabling OTA's would try to
  // initialise mDNS a second time.  The IP is what an upload targets anyway.
  ArduinoOTA.setMdnsEnabled(false);
  ArduinoOTA.onStart([]() {
    // An update reboots the board, so nothing may be left running: force the
    // pump and the lamps off before the flash is written.
    applyPump(false);
    applyStreetlights(false);
    Serial.println("[ota] update starting; pump and lamps forced off");
  });
  ArduinoOTA.onEnd([]() { Serial.println("[ota] update written; rebooting"); });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    static unsigned int lastDecile = 100;
    if (!total) return;
    const unsigned int decile = (progress * 10u) / total;
    if (decile != lastDecile) {
      lastDecile = decile;
      Serial.printf("[ota] %u%%\n", decile * 10u);
    }
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("[ota] failed, code %u\n", static_cast<unsigned>(error));
  });
  ArduinoOTA.begin();
  g_ota_started = true;
  Serial.printf("[ota] ready on %s port 3232 (password required)\n",
                WiFi.localIP().toString().c_str());
#endif
}

bool otaStarted() { return g_ota_started; }

bool otaPasswordSet() {
#ifdef VILLAGE_OTA_PASSWORD
  return VILLAGE_OTA_PASSWORD[0] != '\0';
#else
  return false;
#endif
}

void otaLoop() {
#if VILLAGE_ENABLE_OTA
  if (g_ota_started) ArduinoOTA.handle();
#endif
}

void startNetwork() {
  initIdentity();
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);

#ifdef VILLAGE_STATIC_IP
  IPAddress ip, gateway, subnet;
  if (ip.fromString(VILLAGE_STATIC_IP) && gateway.fromString(VILLAGE_GATEWAY) &&
      subnet.fromString(VILLAGE_SUBNET)) {
    WiFi.config(ip, gateway, subnet);
    Serial.printf("[net] static IP %s\n", VILLAGE_STATIC_IP);
  }
#endif

#if VILLAGE_FORCE_AP
  // Skip station mode entirely: start the rescue AP immediately.
  startAccessPoint();
  return;
#else
  // One scan at boot, before any join attempt, listing what the radio can see.
  // A scan during a join fails with -2 (WIFI_SCAN_FAILED), which is why this
  // lives here and not in the failure path.  Reported at the venue: the phone's
  // hotspot was visible to the laptop at 89% and the board said "network not
  // found" -- the only way to tell a spelling difference from a radio problem
  // is to print what the board itself sees, with the name's exact length.
  const int seen = WiFi.scanNetworks();
  Serial.printf("[net] scan: %d network(s) visible\n", seen);
  for (int i = 0; i < seen && i < 12; ++i) {
    const String name = WiFi.SSID(i);
    Serial.printf("[net]   '%s' (len %u) rssi %d ch %d enc %d\n", name.c_str(),
                  static_cast<unsigned>(name.length()), static_cast<int>(WiFi.RSSI(i)),
                  static_cast<int>(WiFi.channel(i)),
                  static_cast<int>(WiFi.encryptionType(i)));
  }
  WiFi.scanDelete();
  WiFi.begin(VILLAGE_WIFI_SSID, VILLAGE_WIFI_PASS);
  g_sta_started_ms = millis();
#endif
  g_sta_started = true;
  rt.network_started = true;
  Serial.printf("[net] connecting to '%s'...\n", VILLAGE_WIFI_SSID);
}

void networkLoop(uint32_t now) {
  // In AP mode, retry station mode periodically when no client is connected.
  // This prevents a transient boot-time failure from trapping the board in AP
  // mode forever — a single bad join at boot must not require a power cycle.
  if (rt.ap_mode) {
    if (WiFi.softAPgetStationNum() > 0) return;  // a client is using the AP
    static uint32_t g_last_retry_ms = 0;
    if (static_cast<uint32_t>(now - g_last_retry_ms) < 60000) return;
    g_last_retry_ms = now;
    Serial.printf("[net] AP mode: retrying station mode ('%s')...\n", VILLAGE_WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(VILLAGE_WIFI_SSID, VILLAGE_WIFI_PASS);
    const uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED &&
           static_cast<uint32_t>(millis() - start) < 15000) {
      delay(100);
    }
    if (WiFi.status() == WL_CONNECTED) {
      WiFi.softAPdisconnect(true);
      rt.ap_mode = false;
      g_sta_started = true;
      g_sta_was_connected = true;
      g_fallback_done = false;
      g_sta_started_ms = millis();
      Serial.printf("[net] reconnected: IP %s, RSSI %d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
      startMdns();
      startOta();
    } else {
      WiFi.mode(WIFI_AP);
      WiFi.softAP(VILLAGE_AP_SSID, VILLAGE_AP_PASS);
      Serial.println("[net] station retry failed; AP restored");
    }
    return;
  }

  if (!g_sta_started) return;

  if (WiFi.status() == WL_CONNECTED) {
    if (!g_sta_was_connected) {
      g_sta_was_connected = true;
      Serial.printf("[net] connected: IP %s, RSSI %d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
      startMdns();
      startOta();
    }
    return;
  }

  // Never move from a working station link to the fallback AP.  The fallback
  // is a boot-time rescue only, so a demonstration cannot change networks
  // unexpectedly.
  if (g_sta_was_connected) return;

  if (VILLAGE_ALLOW_AP_FALLBACK && !g_fallback_done &&
      static_cast<uint32_t>(now - g_sta_started_ms) >=
          VILLAGE_AP_FALLBACK_AFTER_MS) {
    startAccessPoint();
  }
}

bool networkConnected() { return WiFi.status() == WL_CONNECTED; }

const char* networkMode() {
  if (rt.ap_mode) return "ap";
  if (WiFi.status() == WL_CONNECTED) return "sta";
  return "connecting";
}

String networkIp() {
  if (rt.ap_mode) return WiFi.softAPIP().toString();
  return WiFi.localIP().toString();
}

String networkSsid() {
  if (rt.ap_mode) return String(VILLAGE_AP_SSID);
  return String(VILLAGE_WIFI_SSID);
}

int networkRssi() {
  if (WiFi.status() == WL_CONNECTED) return WiFi.RSSI();
  return 0;
}

}  // namespace village
