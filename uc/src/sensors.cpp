#include "village/sensors.h"

#include "village/build_config.h"
#include "village/core/time.h"
#include "village/device_state.h"
#include "village/pins.h"

namespace village {
namespace {

enum class ReservoirPhase { Idle, Settle, Sample };

constexpr uint32_t kSoilPeriodMs = 400;
constexpr uint32_t kLightPeriodMs = 500;
constexpr uint32_t kReservoirPeriodMs = 2000;
constexpr uint32_t kReservoirSettleMs = 5;
constexpr uint8_t kReservoirSamples = 7;
constexpr uint32_t kSolarPeriodMs = 1000;

uint32_t g_next_soil = 0;
uint32_t g_next_light = 0;
bool g_light_digital = false;
bool g_light_mode_known = false;

ReservoirPhase g_res_phase = ReservoirPhase::Idle;
uint32_t g_res_phase_ms = 0;
uint32_t g_res_next_ms = 0;
uint32_t g_res_sum = 0;
uint8_t g_res_count = 0;

// Solar panel next read time.
uint32_t g_next_solar = 0;

// analogRead() leaves the pad configured for the ADC, after which digitalRead()
// returns 0 for ever.  Every switch between analog and digital light sensing
// must therefore restore the pin mode, not just change the config flag.
void ensureLightPinMode() {
  const bool digital = rt.config.light.digital;
  if (g_light_mode_known && g_light_digital == digital) return;
  pinMode(pins::LDR_ADC, digital ? INPUT : ANALOG);
  g_light_digital = digital;
  g_light_mode_known = true;
}

void releaseReservoirExcitation() {
  digitalWrite(pins::RESERVOIR_EXCITE, LOW);
  pinMode(pins::RESERVOIR_EXCITE, INPUT);  // high impedance, no pull
}

}  // namespace

void setupSensors() {
  analogReadResolution(12);
  analogSetPinAttenuation(pins::SOIL_MOISTURE_ADC, ADC_11db);
  analogSetPinAttenuation(pins::RESERVOIR_SENSE_ADC, ADC_11db);
  analogSetPinAttenuation(pins::LDR_ADC, ADC_11db);
  analogSetPinAttenuation(pins::SOLAR_PANEL_ADC, ADC_11db);
  analogSetPinAttenuation(pins::SOLAR_CURRENT_ADC, ADC_11db);
  ensureLightPinMode();
  const uint32_t now = millis();
  g_next_soil = now;
  g_next_light = now;
  g_res_next_ms = now;
  g_res_phase = ReservoirPhase::Idle;
  g_next_solar = now;
  releaseReservoirExcitation();
}

void sampleSensors(uint32_t now) {
  // --- soil ---------------------------------------------------------------
  if (static_cast<int32_t>(now - g_next_soil) >= 0) {
    g_next_soil = now + kSoilPeriodMs;
    const uint16_t raw = static_cast<uint16_t>(analogRead(pins::SOIL_MOISTURE_ADC));
    rt.soil.observe(raw, now);
    markSample(now);
  }

  // --- solar panel -------------------------------------------------------
  if (static_cast<int32_t>(now - g_next_solar) >= 0) {
    g_next_solar = now + kSolarPeriodMs;
    rt.solar_raw = static_cast<uint16_t>(analogRead(pins::SOLAR_PANEL_ADC));
    rt.solar_mv = static_cast<uint16_t>(analogReadMilliVolts(pins::SOLAR_PANEL_ADC));
    rt.solar_junction_raw = static_cast<uint16_t>(analogRead(pins::SOLAR_CURRENT_ADC));
    rt.solar_junction_mv = static_cast<uint16_t>(analogReadMilliVolts(pins::SOLAR_CURRENT_ADC));
    // Wind shares the solar sampling period: one more ADC read on the last free
    // ADC1 pin, and it is the same kind of slow signal.
    rt.wind_raw = static_cast<uint16_t>(analogRead(pins::WIND_ADC));
    rt.wind_mv = static_cast<uint16_t>(analogReadMilliVolts(pins::WIND_ADC));
    markSample(now);
  }

  if (static_cast<int32_t>(now - g_next_light) >= 0) {
    g_next_light = now + kLightPeriodMs;
    ensureLightPinMode();
    if (rt.config.light.digital) {
      rt.lights.observeDigital(digitalRead(pins::LDR_ADC) == HIGH, now,
                               rt.config.light);
    } else {
      const uint16_t raw = static_cast<uint16_t>(analogRead(pins::LDR_ADC));
      rt.lights.observeAnalog(raw, now, rt.config.light);
    }
    markSample(now);
  }

  // --- reservoir (nonblocking state machine) ------------------------------
  if (g_res_phase == ReservoirPhase::Idle) {
    if (static_cast<int32_t>(now - g_res_next_ms) >= 0) {
      digitalWrite(pins::RESERVOIR_EXCITE, HIGH);
      pinMode(pins::RESERVOIR_EXCITE, OUTPUT);
      g_res_phase = ReservoirPhase::Settle;
      g_res_phase_ms = now;
    }
  } else if (g_res_phase == ReservoirPhase::Settle) {
    if (elapsed(now, g_res_phase_ms, kReservoirSettleMs)) {
      g_res_sum = 0;
      g_res_count = 0;
      g_res_phase = ReservoirPhase::Sample;
      g_res_phase_ms = now;
    }
  } else if (g_res_phase == ReservoirPhase::Sample) {
    if (elapsed(now, g_res_phase_ms, 1)) {
      g_res_phase_ms = now;
      g_res_sum += analogReadMilliVolts(pins::RESERVOIR_SENSE_ADC);
      ++g_res_count;
      if (g_res_count >= kReservoirSamples) {
        const uint16_t avg = static_cast<uint16_t>(g_res_sum / g_res_count);
        rt.reservoir.observe(avg, now);
        releaseReservoirExcitation();
        g_res_phase = ReservoirPhase::Idle;
        g_res_next_ms = now + kReservoirPeriodMs;
        markSample(now);
      }
    }
  }
}

IrrigationInputs buildIrrigationInputs(uint32_t now) {
  const SoilReading soil = rt.soil.read(rt.config, now);
  const ReservoirReading reservoir = rt.reservoir.read(rt.config, now);

  IrrigationInputs in;
  in.soil_valid = soil.valid;
  in.soil_calibrated = soil.calibrated;
  in.soil_percent = soil.percent;
  in.reservoir_valid = reservoir.valid;
  in.reservoir_available = reservoir.state == ReservoirState::Available;
  // ageMs, not a raw subtraction: a command handler stamps the contact time
  // with a later millis() than the `now` this loop sampled, and the unsigned
  // difference would read as ~49 days - which stopped every manual session on
  // its first tick as "laptop communication lost".
  in.link_age_ms = rt.ever_contacted ? ageMs(now, rt.last_contact_ms) : UINT32_MAX;
  return in;
}

void applyRuntimeConfig(uint32_t now) {
  rt.reservoir.setThresholds(rt.config.reservoir.wet_threshold_mv,
                             rt.config.reservoir.dry_threshold_mv,
                             rt.config.reservoir.confirm_readings);
  rt.lights.configure(rt.config.light);
  rt.waste.configure(rt.config.waste);
  rt.irrigation.setConfig(now, rt.config.irrigation);
}

}  // namespace village
