#pragma once

#include <Arduino.h>

namespace village {

void startNetwork();
void networkLoop(uint32_t now);
void startOta();   // no-op until station mode is connected
void otaLoop();

bool networkConnected();
const char* networkMode();  // "sta", "ap", "connecting"
String networkIp();
String networkSsid();
int networkRssi();

}  // namespace village
