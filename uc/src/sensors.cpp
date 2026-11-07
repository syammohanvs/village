#include "village/sensors.h"

#include <cmath>

#include "village/build_config.h"
#include "village/core/time.h"
#include "village/device_state.h"
#include "village/pins.h"

namespace village {
namespace {

enum class ReservoirPhase { Idle, Settle, Sample };

constexpr uint32_t kSoilPeriodMs = 400;
constexpr uint32_t kLightPeriodMs = 500;
constexpr uint32_t kBinPeriodMs = 150;
constexpr uint32_t kReservoirPeriodMs = 2000;
constexpr uint32_t kReservoirSettleMs = 5;
constexpr uint8_t kReservoirSamples = 7;
constexpr float kCmPerMicrosecond = 1.0f / 58.0f;

uint32_t g_next_soil = 0;
uint32_t g_next_light = 0;
uint32_t g_next_bin = 0;
uint8_t g_bin_index = 0;

ReservoirPhase g_res_phase = ReservoirPhase::Idle;
uint32_t g_res_phase_ms = 0;
uint32_t g_res_next_ms = 0;
uint32_t g_res_sum = 0;
uint8_t g_res_count = 0;

void releaseReservoirExcitation() {
  digitalWrite(pins::RESERVOIR_EXCITE, LOW);
  pinMode(pins::RESERVOIR_EXCITE, INPUT);  // high impedance, no pull
}

void readBin(uint8_t i, uint32_t now) {
  const BinConfig& cfg = rt.config.bins[i];
  digitalWrite(pins::BIN_TRIG[i], LOW);
  delayMicroseconds(3);
  digitalWrite(pins::BIN_TRIG[i], HIGH);
  delayMicroseconds(10);
  digitalWrite(pins::BIN_TRIG[i], LOW);

  const unsigned long us =
      pulseIn(pins::BIN_ECHO[i], HIGH, cfg.timeout_us);
  if (us == 0) {
    rt.bins[i].observeTimeout(now);
  } else {
    const float cm = static_cast<float>(us) * kCmPerMicrosecond;
    rt.bins[i].observeDistance(cm, cfg, now);
  }
  markSample(now);
}

}  // namespace

void setupSensors() {
  analogReadResolution(12);
  analogSetPinAttenuation(pins::SOIL_MOISTURE_ADC, ADC_11db);
  analogSetPinAttenuation(pins::RESERVOIR_SENSE_ADC, ADC_11db);
  analogSetPinAttenuation(pins::LDR_ADC, ADC_11db);

  const uint32_t now = millis();
  g_next_soil = now;
  g_next_light = now;
  g_next_bin = now;
  g_res_next_ms = now;
  g_res_phase = ReservoirPhase::Idle;
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

  // --- light --------------------------------------------------------------
  if (static_cast<int32_t>(now - g_next_light) >= 0) {
    g_next_light = now + kLightPeriodMs;
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

  // --- bins, one at a time -------------------------------------------------
  if (static_cast<int32_t>(now - g_next_bin) >= 0) {
    g_next_bin = now + kBinPeriodMs;
    readBin(g_bin_index, now);
    g_bin_index = static_cast<uint8_t>((g_bin_index + 1) % 3);
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
  in.link_age_ms = rt.ever_contacted
                       ? static_cast<uint32_t>(now - rt.last_contact_ms)
                       : UINT32_MAX;
  return in;
}

void applyRuntimeConfig(uint32_t now) {
  rt.reservoir.setThresholds(rt.config.reservoir.wet_threshold_mv,
                             rt.config.reservoir.dry_threshold_mv,
                             rt.config.reservoir.confirm_readings);
  rt.lights.configure(rt.config.light);
  for (int i = 0; i < 3; ++i) rt.bins[i].configure(rt.config.bins[i]);
  rt.waste.configure(rt.config.waste);
  rt.irrigation.setConfig(now, rt.config.irrigation,
                          VILLAGE_PUMP_COMMISSIONED == 1);
}

}  // namespace village
