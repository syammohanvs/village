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
  WiFi.mode(WIFI_AP);
  const bool ok = WiFi.softAP(VILLAGE_AP_SSID, VILLAGE_AP_PASS);
  rt.ap_mode = true;
  g_fallback_done = true;
  Serial.printf("[net] station mode failed; AP fallback %s, SSID '%s', IP %s\n",
                ok ? "started" : "FAILED", VILLAGE_AP_SSID,
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

  WiFi.begin(VILLAGE_WIFI_SSID, VILLAGE_WIFI_PASS);
  g_sta_started_ms = millis();
  g_sta_started = true;
  rt.network_started = true;
  Serial.printf("[net] connecting to '%s'...\n", VILLAGE_WIFI_SSID);
}

void networkLoop(uint32_t now) {
  if (!g_sta_started || rt.ap_mode) return;

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
