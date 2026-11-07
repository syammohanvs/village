#pragma once

#include <cstdint>

namespace village {

// Every state transition and every command acknowledgement carries a stable
// machine-readable code plus one human-readable sentence.  The dashboard shows
// the sentence in the "What the village is doing and why" panel and uses the
// code for stable styling and tests.
struct Reason {
  const char* code;
  const char* text;
};

namespace reasons {

// --- idle / blocked -------------------------------------------------------
inline constexpr Reason kIdleBoot{
    "IDLE_BOOT", "Controller started. The pump is off until a new decision."};
inline constexpr Reason kIdleAutoOff{
    "IDLE_AUTO_OFF", "Automatic irrigation is switched off. Manual requests are still checked."};
inline constexpr Reason kIdleSoilAdequate{
    "IDLE_SOIL_ADEQUATE", "Soil moisture is adequate. No watering is needed."};
inline constexpr Reason kIdleSoilDryWaiting{
    "IDLE_SOIL_DRY_WAITING",
    "Soil is dry and water is available. Confirming the reading before watering."};
inline constexpr Reason kIdleWaterLow{
    "IDLE_WATER_LOW", "Irrigation blocked: reservoir water is low."};
inline constexpr Reason kIdleWaterUnknown{
    "IDLE_WATER_UNKNOWN", "Irrigation blocked: reservoir water state is unknown."};
inline constexpr Reason kIdleSoilUncalibrated{
    "IDLE_SOIL_UNCALIBRATED", "Irrigation blocked: soil moisture is not calibrated."};
inline constexpr Reason kIdleSensorInvalid{
    "IDLE_SENSOR_INVALID", "Irrigation blocked: a required sensor reading is invalid."};
inline constexpr Reason kIdleCooldown{
    "IDLE_COOLDOWN", "Waiting before the next watering session."};
inline constexpr Reason kIdleFailureLockout{
    "IDLE_FAILURE_LOCKOUT",
    "Irrigation is locked out after repeated watering with no moisture rise. Check the probe, the water and the soil."};
inline constexpr Reason kIdlePumpNotCommissioned{
    "IDLE_PUMP_NOT_COMMISSIONED",
    "Soil is dry and water is available, but the pump is not commissioned."};
inline constexpr Reason kIdleAlreadyStopped{
    "IDLE_ALREADY_STOPPED", "Irrigation is already stopped. The pump is off."};

// --- command refusals -----------------------------------------------------
inline constexpr Reason kBlockedSoilWet{
    "IRRIGATION_BLOCKED_SOIL_WET", "Irrigation blocked: the soil is already wet enough."};
inline constexpr Reason kBlockedSoilUncalibrated{
    "IRRIGATION_BLOCKED_SOIL_UNCALIBRATED",
    "Irrigation blocked: soil moisture calibration is missing or invalid."};
inline constexpr Reason kBlockedSensorInvalid{
    "IRRIGATION_BLOCKED_SENSOR_INVALID",
    "Irrigation blocked: a required sensor reading is stale or invalid."};
inline constexpr Reason kBlockedWaterLow{
    "IRRIGATION_BLOCKED_WATER_LOW", "Irrigation blocked: reservoir water is low."};
inline constexpr Reason kBlockedWaterUnknown{
    "IRRIGATION_BLOCKED_WATER_UNKNOWN",
    "Irrigation blocked: the reservoir state is uncalibrated or unavailable."};
inline constexpr Reason kBlockedPumpNotCommissioned{
    "IRRIGATION_BLOCKED_PUMP_NOT_COMMISSIONED",
    "Irrigation blocked: the pump has not been commissioned."};
inline constexpr Reason kBlockedAlreadyActive{
    "IRRIGATION_BLOCKED_ALREADY_ACTIVE",
    "Irrigation blocked: a watering session is already running."};
inline constexpr Reason kBlockedCooldown{
    "IRRIGATION_BLOCKED_COOLDOWN",
    "Irrigation blocked: the post-session lockout is still active."};
inline constexpr Reason kBlockedLockout{
    "IRRIGATION_BLOCKED_LOCKOUT",
    "Irrigation blocked: repeated watering produced no moisture rise, so the controller is locked out."};
inline constexpr Reason kBlockedBootGuard{
    "IRRIGATION_BLOCKED_BOOT_GUARD",
    "Irrigation blocked: the controller is still in its post-boot guard."};

// --- session --------------------------------------------------------------
inline constexpr Reason kStarted{
    "IRRIGATION_STARTED", "Soil is dry and water is available. Watering for a short pulse."};
inline constexpr Reason kPulse{
    "IRRIGATION_PULSE", "Soil is dry and water is available. Watering for a short pulse."};
inline constexpr Reason kSoaking{
    "IRRIGATION_SOAKING", "Waiting for water to soak into the soil."};
inline constexpr Reason kCompleteMoisture{
    "IRRIGATION_COMPLETE_MOISTURE",
    "Soil moisture reached the stop level. Watering finished."};
inline constexpr Reason kStoppedMaxPulses{
    "IRRIGATION_STOPPED_MAX_PULSES",
    "No moisture rise after the allowed pulses. Watering is locked out."};
inline constexpr Reason kStoppedMaxRuntime{
    "IRRIGATION_STOPPED_MAX_RUNTIME",
    "The maximum pump-on time for this session was reached."};
inline constexpr Reason kStoppedLowWater{
    "IRRIGATION_STOPPED_LOW_WATER", "Irrigation stopped: reservoir water is low."};
inline constexpr Reason kStoppedSensorInvalid{
    "IRRIGATION_STOPPED_SENSOR_INVALID",
    "Irrigation stopped: a required sensor reading became invalid."};
inline constexpr Reason kStoppedLinkLost{
    "IRRIGATION_STOPPED_LINK_LOST",
    "Irrigation stopped: laptop communication was lost during a manual session."};
inline constexpr Reason kStoppedUser{
    "IRRIGATION_STOPPED_USER", "Irrigation stopped by the operator."};
inline constexpr Reason kStoppedPumpDisabled{
    "IRRIGATION_STOPPED_PUMP_DISABLED",
    "Irrigation stopped: the pump was disabled in the configuration."};

// --- streetlights ---------------------------------------------------------
inline constexpr Reason kLightsAutoDark{
    "LIGHTS_AUTO_DARK", "It is dark. Streetlights switched on."};
inline constexpr Reason kLightsAutoBright{
    "LIGHTS_AUTO_BRIGHT", "It is bright. Streetlights are off."};
inline constexpr Reason kLightsAutoUnknown{
    "LIGHTS_AUTO_UNKNOWN",
    "The light sensor is not ready, so the streetlights stay off."};
inline constexpr Reason kLightsManualOn{
    "LIGHTS_MANUAL_ON", "Streetlights switched on manually."};
inline constexpr Reason kLightsManualOff{
    "LIGHTS_MANUAL_OFF", "Streetlights switched off manually."};
inline constexpr Reason kLightsNotInstalled{
    "LIGHTS_NOT_INSTALLED", "Streetlights are not installed in this build."};

// --- waste ----------------------------------------------------------------
inline constexpr Reason kWasteOrganic{
    "WASTE_INDICATED_ORGANIC", "Organic waste recognised. Organic-bin indicator activated."};
inline constexpr Reason kWastePlastic{
    "WASTE_INDICATED_PLASTIC", "Plastic recognised. Plastic-bin indicator activated."};
inline constexpr Reason kWastePaper{
    "WASTE_INDICATED_PAPER", "Paper recognised. Paper-bin indicator activated."};
inline constexpr Reason kWasteUnknown{
    "WASTE_UNKNOWN_CATEGORY",
    "Unknown waste category. No category indicator was activated."};
inline constexpr Reason kDuplicate{
    "DUPLICATE_COMMAND", "This command was already processed. No second action was taken."};
inline constexpr Reason kCommandInvalid{
    "COMMAND_INVALID", "The command type or parameters were not recognised."};

}  // namespace reasons
}  // namespace village
