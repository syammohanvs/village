#pragma once

#include <Arduino.h>

namespace village {

void startNetwork();
void networkLoop(uint32_t now);

bool networkConnected();
const char* networkMode();  // "sta", "ap", "connecting"
String networkIp();
String networkSsid();
int networkRssi();

}  // namespace village
