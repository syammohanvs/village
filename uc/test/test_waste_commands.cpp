#include <cstring>

#include "minitest.h"
#include "village/core/command_history.h"
#include "village/core/waste.h"

using namespace village;

TEST(waste_indicator_lights_only_a_known_category) {
  WasteConfig cfg;
  cfg.indicate_ms = 8000;
  WasteIndicator w;
  w.configure(cfg);
  CHECK(w.indicate(WasteCategory::Organic, 0, 1000));
  WasteLedState s = w.read(1000);
  CHECK(s.active);
  CHECK(s.category == WasteCategory::Organic);
  CHECK(s.remaining_ms == 8000);

  bool organic = false, plastic = false, paper = false;
  categoryLeds(s.category, organic, plastic, paper);
  CHECK(organic);
  CHECK(!plastic);
  CHECK(!paper);
}

TEST(waste_indicator_ignores_unknown_categories) {
  WasteConfig cfg;
  WasteIndicator w;
  w.configure(cfg);
  CHECK(!w.indicate(WasteCategory::Unknown, 0, 0));
  CHECK(!w.read(0).active);
  CHECK(!w.active());
}

TEST(waste_indicator_expires_and_replaces) {
  WasteConfig cfg;
  cfg.indicate_ms = 5000;
  WasteIndicator w;
  w.configure(cfg);
  CHECK(w.indicate(WasteCategory::Plastic, 0, 1000));
  CHECK(w.read(5999).active);
  w.tick(6000);
  CHECK(!w.read(6000).active);

  CHECK(w.indicate(WasteCategory::Organic, 0, 7000));
  CHECK(w.indicate(WasteCategory::Paper, 0, 7100));
  CHECK(w.read(7100).category == WasteCategory::Paper);
}

TEST(waste_indicator_duration_is_bounded) {
  WasteConfig cfg;
  cfg.indicate_ms = 8000;
  WasteIndicator w;
  w.configure(cfg);
  CHECK(w.indicate(WasteCategory::Organic, 200, 0));  // raised to 1000
  CHECK(w.read(999).active);
  CHECK(!w.read(1000).active);

  CHECK(w.indicate(WasteCategory::Organic, 20000, 2000));  // capped at 8000
  CHECK(w.read(2000).remaining_ms == 8000);
}

TEST(command_history_hashes_and_deduplicates) {
  CHECK(CommandHistory::hashId(nullptr) == 0);
  CHECK(CommandHistory::hashId("") == 0);
  const uint64_t a = CommandHistory::hashId("abc-123");
  CHECK(a != 0);
  CHECK(a == CommandHistory::hashId("abc-123"));
  CHECK(a != CommandHistory::hashId("abc-124"));

  CommandHistory h;
  h.remember(a, CommandResult::Accepted, "IRRIGATION_STARTED",
             "Soil is dry and water is available.", 1234);
  const CommandRecord* r = h.find(a);
  CHECK(r != nullptr);
  CHECK(r->result == CommandResult::Accepted);
  CHECK(std::strcmp(r->reason_code, "IRRIGATION_STARTED") == 0);
  CHECK(r->at_ms == 1234);

  // A repeated id keeps its original decision.
  h.remember(a, CommandResult::Rejected, "OTHER", "different", 9999);
  r = h.find(a);
  CHECK(r != nullptr);
  CHECK(r->result == CommandResult::Accepted);
  CHECK(r->at_ms == 1234);
}

TEST(command_history_is_bounded_and_persistable) {
  CommandHistory h;
  for (int i = 0; i < 14; ++i) {
    char id[16];
    std::snprintf(id, sizeof(id), "cmd-%d", i);
    h.remember(CommandHistory::hashId(id), CommandResult::Accepted,
               "IRRIGATION_STARTED", "ok", static_cast<uint32_t>(i));
  }
  CHECK(h.size() == CommandHistory::kCapacity);
  CHECK(h.find(CommandHistory::hashId("cmd-3")) == nullptr);
  CHECK(h.find(CommandHistory::hashId("cmd-4")) != nullptr);
  CHECK(h.find(CommandHistory::hashId("cmd-13")) != nullptr);

  CommandRecord saved[CommandHistory::kCapacity];
  for (std::size_t i = 0; i < h.size(); ++i) saved[i] = h.at(i);

  CommandHistory restored;
  restored.load(saved, h.size());
  CHECK(restored.size() == h.size());
  const CommandRecord* r = restored.find(CommandHistory::hashId("cmd-13"));
  CHECK(r != nullptr);
  CHECK(std::strcmp(r->reason_code, "IRRIGATION_STARTED") == 0);
}

TEST(command_history_load_ignores_corrupt_records) {
  CommandRecord rows[3]{};
  rows[0].hash = 0;
  rows[1].hash = 42;
  rows[1].result = static_cast<CommandResult>(9);
  rows[2].hash = 99;
  rows[2].result = CommandResult::Duplicate;
  std::strcpy(rows[2].reason_code, "DUPLICATE_COMMAND");
  CommandHistory h;
  h.load(rows, 3);
  CHECK(h.size() == 1);
  CHECK(h.find(42) == nullptr);
  CHECK(h.find(99) != nullptr);
}
