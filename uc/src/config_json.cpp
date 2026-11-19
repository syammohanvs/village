#include "village/config_json.h"

#include <cstring>

namespace village {

void writeConfigJson(JsonObject out, const DeviceConfig& c) {
  // `revision` is deliberately NOT here.  It is the optimistic-concurrency
  // counter, not a setting: the HTTP route increments it on every save, so a
  // stored copy must not be able to overwrite that.  The NVS document keeps it
  // beside the settings instead.
  JsonObject soil = out["soil"].to<JsonObject>();
  soil["dry_raw"] = c.soil.dry_raw;
  soil["wet_raw"] = c.soil.wet_raw;
  soil["min_span_raw"] = c.soil.min_span_raw;
  soil["samples"] = c.soil.samples;
  soil["max_age_ms"] = c.soil.max_age_ms;
  soil["calibrated"] = c.soil.calibrated;
  // The flag decides which domain the two endpoints are stored in (false =
  // the reading is inverted, i.e. the endpoints are 4095 - raw).  It was in
  // the struct and in soilPercent but missing here, so it could never be set
  // or read back and every calibration silently took the inverted branch
  // (measured 2026-11-18: the first soil calibration on the board read 0 % in
  // wet soil).
  soil["rises_with_moisture"] = c.soil.rises_with_moisture;

  JsonObject res = out["reservoir"].to<JsonObject>();
  res["wet_threshold_mv"] = c.reservoir.wet_threshold_mv;
  res["dry_threshold_mv"] = c.reservoir.dry_threshold_mv;
  res["confirm_readings"] = c.reservoir.confirm_readings;
  res["max_age_ms"] = c.reservoir.max_age_ms;
  res["calibrated"] = c.reservoir.calibrated;

  JsonObject light = out["light"].to<JsonObject>();
  light["installed"] = c.light.installed;
  light["sensor_fitted"] = c.light.sensor_fitted;
  light["output_type"] = c.light.digital ? "digital" : "analog";
  light["analog_bright_high"] = c.light.analog_bright_high;
  light["digital_dark_when_high"] = c.light.digital_dark_when_high;
  light["dark_threshold"] = c.light.dark_threshold;
  light["bright_threshold"] = c.light.bright_threshold;
  light["stable_ms"] = c.light.stable_ms;
  light["max_age_ms"] = c.light.max_age_ms;

  JsonObject irr = out["irrigation"].to<JsonObject>();
  irr["auto_enabled"] = c.irrigation.auto_enabled;
  irr["pump_enabled"] = c.irrigation.pump_enabled;
  irr["dry_start_pct"] = c.irrigation.dry_start_pct;
  irr["stop_pct"] = c.irrigation.stop_pct;
  irr["dry_confirm_ms"] = c.irrigation.dry_confirm_ms;
  irr["pulse_ms"] = c.irrigation.pulse_ms;
  irr["max_pulse_ms"] = c.irrigation.max_pulse_ms;
  irr["soak_ms"] = c.irrigation.soak_ms;
  irr["max_cumulative_ms"] = c.irrigation.max_cumulative_ms;
  irr["max_pulses"] = c.irrigation.max_pulses;
  irr["cooldown_ms"] = c.irrigation.cooldown_ms;
  irr["link_timeout_ms"] = c.irrigation.link_timeout_ms;

  JsonObject waste = out["waste"].to<JsonObject>();
  waste["indicate_ms"] = c.waste.indicate_ms;

  JsonObject solar = out["solar"].to<JsonObject>();
  solar["installed"] = c.solar.installed;
  solar["sense_ohms"] = c.solar.sense_ohms;

  JsonObject wind = out["wind"].to<JsonObject>();
  wind["installed"] = c.wind.installed;
  wind["sense_ohms"] = c.wind.sense_ohms;
  wind["led_forward_mv"] = c.wind.led_forward_mv;
  wind["noise_floor_mv"] = c.wind.noise_floor_mv;
}

bool readConfigJson(JsonObjectConst c, DeviceConfig& out, const char** error) {
  if (c.isNull()) {
    *error = "missing config object";
    return false;
  }
  if (c["soil"].isNull() || c["reservoir"].isNull() || c["light"].isNull() ||
      c["irrigation"].isNull() || c["waste"].isNull()) {
    *error = "config must contain soil, reservoir, light, irrigation and waste";
    return false;
  }

  JsonObjectConst soil = c["soil"].as<JsonObjectConst>();
  out.soil.dry_raw = soil["dry_raw"] | out.soil.dry_raw;
  out.soil.wet_raw = soil["wet_raw"] | out.soil.wet_raw;
  out.soil.min_span_raw = soil["min_span_raw"] | out.soil.min_span_raw;
  out.soil.samples = soil["samples"] | out.soil.samples;
  out.soil.max_age_ms = soil["max_age_ms"] | out.soil.max_age_ms;
  out.soil.calibrated = soil["calibrated"] | out.soil.calibrated;
  out.soil.rises_with_moisture =
      soil["rises_with_moisture"] | out.soil.rises_with_moisture;

  JsonObjectConst res = c["reservoir"].as<JsonObjectConst>();
  out.reservoir.wet_threshold_mv =
      res["wet_threshold_mv"] | out.reservoir.wet_threshold_mv;
  out.reservoir.dry_threshold_mv =
      res["dry_threshold_mv"] | out.reservoir.dry_threshold_mv;
  out.reservoir.confirm_readings =
      res["confirm_readings"] | out.reservoir.confirm_readings;
  out.reservoir.max_age_ms =
      res["max_age_ms"] | out.reservoir.max_age_ms;
  out.reservoir.calibrated = res["calibrated"] | out.reservoir.calibrated;

  JsonObjectConst light = c["light"].as<JsonObjectConst>();
  out.light.installed = light["installed"] | out.light.installed;
  out.light.sensor_fitted = light["sensor_fitted"] | out.light.sensor_fitted;
  const char* output_type = light["output_type"] | "analog";
  out.light.digital = std::strcmp(output_type, "digital") == 0;
  out.light.analog_bright_high =
      light["analog_bright_high"] | out.light.analog_bright_high;
  out.light.digital_dark_when_high =
      light["digital_dark_when_high"] | out.light.digital_dark_when_high;
  out.light.dark_threshold =
      light["dark_threshold"] | out.light.dark_threshold;
  out.light.bright_threshold =
      light["bright_threshold"] | out.light.bright_threshold;
  out.light.stable_ms = light["stable_ms"] | out.light.stable_ms;
  out.light.max_age_ms = light["max_age_ms"] | out.light.max_age_ms;

  JsonObjectConst irr = c["irrigation"].as<JsonObjectConst>();
  out.irrigation.auto_enabled =
      irr["auto_enabled"] | out.irrigation.auto_enabled;
  out.irrigation.pump_enabled =
      irr["pump_enabled"] | out.irrigation.pump_enabled;
  out.irrigation.dry_start_pct =
      irr["dry_start_pct"] | out.irrigation.dry_start_pct;
  out.irrigation.stop_pct = irr["stop_pct"] | out.irrigation.stop_pct;
  out.irrigation.dry_confirm_ms =
      irr["dry_confirm_ms"] | out.irrigation.dry_confirm_ms;
  out.irrigation.pulse_ms = irr["pulse_ms"] | out.irrigation.pulse_ms;
  out.irrigation.max_pulse_ms =
      irr["max_pulse_ms"] | out.irrigation.max_pulse_ms;
  out.irrigation.soak_ms = irr["soak_ms"] | out.irrigation.soak_ms;
  out.irrigation.max_cumulative_ms =
      irr["max_cumulative_ms"] | out.irrigation.max_cumulative_ms;
  out.irrigation.max_pulses = irr["max_pulses"] | out.irrigation.max_pulses;
  out.irrigation.cooldown_ms = irr["cooldown_ms"] | out.irrigation.cooldown_ms;
  out.irrigation.link_timeout_ms =
      irr["link_timeout_ms"] | out.irrigation.link_timeout_ms;

  JsonObjectConst waste = c["waste"].as<JsonObjectConst>();
  out.waste.indicate_ms = waste["indicate_ms"] | out.waste.indicate_ms;

  // `solar` is optional: a configuration saved before this existed must still
  // load, and the defaults (not declared, 330 ohm) are the safe ones.
  JsonObjectConst wind = c["wind"].as<JsonObjectConst>();
  if (!wind.isNull()) {
    out.wind.installed = wind["installed"] | out.wind.installed;
    out.wind.sense_ohms = wind["sense_ohms"] | out.wind.sense_ohms;
    out.wind.led_forward_mv = wind["led_forward_mv"] | out.wind.led_forward_mv;
    out.wind.noise_floor_mv = wind["noise_floor_mv"] | out.wind.noise_floor_mv;
  }

  JsonObjectConst solar = c["solar"].as<JsonObjectConst>();
  if (!solar.isNull()) {
    out.solar.installed = solar["installed"] | out.solar.installed;
    out.solar.sense_ohms = solar["sense_ohms"] | out.solar.sense_ohms;
  }
  return true;
}

}  // namespace village
