#pragma once

#include <cstdint>

namespace village {

enum class SoilState : uint8_t { Unavailable, Uncalibrated, Dry, Adequate, Wet };
enum class ReservoirState : uint8_t { Unavailable, Uncalibrated, Low, Available };
enum class Brightness : uint8_t { Unknown, Bright, Dark };
enum class LightMode : uint8_t { Auto, ManualOn, ManualOff };
enum class BinState : uint8_t { Unavailable, NotInstalled, Available, NearlyFull, Full };
enum class IrrigationState : uint8_t { Idle, Pumping, Soaking };
enum class SessionKind : uint8_t { None, Auto, Manual };
enum class CommandResult : uint8_t { Accepted, Rejected, Duplicate };
enum class WasteCategory : uint8_t { Unknown, Organic, Plastic, Paper };

inline const char* toString(SoilState s) {
  switch (s) {
    case SoilState::Dry: return "dry";
    case SoilState::Adequate: return "adequate";
    case SoilState::Wet: return "wet";
    case SoilState::Uncalibrated: return "uncalibrated";
    case SoilState::Unavailable: return "unavailable";
  }
  return "unavailable";
}

inline const char* toString(ReservoirState s) {
  switch (s) {
    case ReservoirState::Available: return "available";
    case ReservoirState::Low: return "low";
    case ReservoirState::Uncalibrated: return "uncalibrated";
    case ReservoirState::Unavailable: return "unavailable";
  }
  return "unavailable";
}

inline const char* toString(Brightness b) {
  switch (b) {
    case Brightness::Bright: return "bright";
    case Brightness::Dark: return "dark";
    case Brightness::Unknown: return "unknown";
  }
  return "unknown";
}

inline const char* toString(LightMode m) {
  switch (m) {
    case LightMode::Auto: return "auto";
    case LightMode::ManualOn: return "manual_on";
    case LightMode::ManualOff: return "manual_off";
  }
  return "auto";
}

inline const char* toString(BinState s) {
  switch (s) {
    case BinState::Available: return "available";
    case BinState::NearlyFull: return "nearly_full";
    case BinState::Full: return "full";
    case BinState::NotInstalled: return "not_installed";
    case BinState::Unavailable: return "unavailable";
  }
  return "unavailable";
}

inline const char* toString(IrrigationState s) {
  switch (s) {
    case IrrigationState::Idle: return "idle";
    case IrrigationState::Pumping: return "pumping";
    case IrrigationState::Soaking: return "soaking";
  }
  return "idle";
}

inline const char* toString(SessionKind k) {
  switch (k) {
    case SessionKind::Auto: return "auto";
    case SessionKind::Manual: return "manual";
    case SessionKind::None: return "none";
  }
  return "none";
}

inline const char* toString(CommandResult r) {
  switch (r) {
    case CommandResult::Accepted: return "ACCEPTED";
    case CommandResult::Rejected: return "REJECTED";
    case CommandResult::Duplicate: return "DUPLICATE";
  }
  return "REJECTED";
}

inline const char* toString(WasteCategory c) {
  switch (c) {
    case WasteCategory::Organic: return "organic";
    case WasteCategory::Plastic: return "plastic";
    case WasteCategory::Paper: return "paper";
    case WasteCategory::Unknown: return "unknown";
  }
  return "unknown";
}

inline bool parseWasteCategory(const char* text, WasteCategory& out) {
  if (text == nullptr) return false;
  if (text[0] == 'o' || text[0] == 'O') { out = WasteCategory::Organic; return true; }
  if (text[0] == 'p' || text[0] == 'P') {
    if (text[1] == 'l' || text[1] == 'L') { out = WasteCategory::Plastic; return true; }
    if (text[1] == 'a' || text[1] == 'A') { out = WasteCategory::Paper; return true; }
    return false;
  }
  return false;
}

inline bool isKnownWasteCategory(WasteCategory c) {
  return c == WasteCategory::Organic || c == WasteCategory::Plastic ||
         c == WasteCategory::Paper;
}

}  // namespace village
