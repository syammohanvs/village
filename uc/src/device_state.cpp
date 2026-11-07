#include "village/device_state.h"

#include <esp_random.h>

#include <cstdio>

#include "village/pins.h"

namespace village {

Runtime rt;
char g_device_id[24] = "village-unknown";
char g_boot_id[20] = "b-00000000";

void initIdentity() {
  const uint64_t mac = ESP.getEfuseMac();
  std::snprintf(g_device_id, sizeof(g_device_id), "village-%06llx",
                static_cast<unsigned long long>(mac & 0xFFFFFFULL));
  std::snprintf(g_boot_id, sizeof(g_boot_id), "b-%08lx",
                static_cast<unsigned long>(esp_random()));
}

void markSample(uint32_t now) {
  ++rt.sample_seq;
  if (!rt.first_sample_seen) {
    rt.first_sample_seen = true;
    rt.first_sample_at_ms = now;
  }
}

}  // namespace village
