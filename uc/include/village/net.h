#pragma once

#include <Arduino.h>

namespace village {

void startNetwork();
void networkLoop(uint32_t now);
void startOta();   // no-op until station mode is connected
// Diagnostics: what the OTA server is actually doing.  A board that answers
// :80 but refuses :3232 has no OTA server, and the only other way to learn that
// is the serial console -- which is exactly what is missing on a remote board.
bool otaStarted();
bool otaPasswordSet();
void otaLoop();

bool networkConnected();
const char* networkMode();  // "sta", "ap", "connecting"
String networkIp();
String networkSsid();
int networkRssi();

}  // namespace village
