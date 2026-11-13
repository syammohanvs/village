#include "village/sensors.h"

#include <VL53L0X.h>
#include <Wire.h>

#include <cmath>

#include "village/build_config.h"
#include "village/core/time.h"
#include "village/core/tof.h"
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
constexpr uint32_t kSolarPeriodMs = 1000;
// How long an XSHUT line is held before a module is expected to answer.
constexpr uint32_t kTofBootMs = 10;

uint32_t g_next_soil = 0;
uint32_t g_next_light = 0;
bool g_light_digital = false;
bool g_light_mode_known = false;
uint32_t g_next_bin = 0;
uint8_t g_bin_index = 0;

// One sensor object per bin.  They all power up at the same I2C address, so
// they are only usable once beginTof() has given each its own.
VL53L0X g_tof[3];
bool g_tof_ready[3] = {false, false, false};

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

// The stored timeout is in microseconds (the field outlived the ultrasonic
// echo timer); tof.h converts it to what the library wants and keeps it inside
// a band where a slow measurement is not mistaken for a fault.
uint16_t tofTimeoutMs(std::size_t i) {
  return tofBusTimeoutMs(rt.config.bins[i].timeout_us);
}

// Every module boots at address 0x29, so they are released from reset one at a
// time: hold all XSHUT low, raise one, claim 0x29 for it, give it its own
// address, move on.  A module that does not answer stays in reset and is
// reported as a missing sensor rather than as an empty bin.
void beginTof() {
  Wire.begin(pins::I2C_SDA, pins::I2C_SCL);
  Wire.setClock(400000);

  for (int i = 0; i < 3; ++i) {
    pinMode(pins::TOF_XSHUT[i], OUTPUT);
    digitalWrite(pins::TOF_XSHUT[i], LOW);
    g_tof[i].setBus(&Wire);
    g_tof[i].setTimeout(kTofMaxTimeoutMs);
    g_tof_ready[i] = false;
  }
  delay(kTofBootMs);

  for (int i = 0; i < 3; ++i) {
    digitalWrite(pins::TOF_XSHUT[i], HIGH);
    delay(kTofBootMs);
    g_tof[i].setTimeout(tofTimeoutMs(i));
    if (!g_tof[i].init()) {
      digitalWrite(pins::TOF_XSHUT[i], LOW);
      continue;
    }
    g_tof[i].setAddress(pins::TOF_ADDRESS[i]);
    g_tof[i].setTimeout(tofTimeoutMs(i));
    g_tof_ready[i] = g_tof[i].getAddress() == pins::TOF_ADDRESS[i];
    // A module that kept the factory address would answer at the same address
    // as the next one we release, so it goes back into reset instead.
    if (!g_tof_ready[i]) digitalWrite(pins::TOF_XSHUT[i], LOW);
  }
}

void readBin(uint8_t i, uint32_t now) {
  const BinConfig& cfg = rt.config.bins[i];
  if (!g_tof_ready[i]) {
    // No usable sensor: a fault, never "the bin is empty".
    rt.bins[i].observeTimeout(now);
    markSample(now);
    return;
  }

  const uint16_t mm = g_tof[i].readRangeSingleMillimeters();
  if (g_tof[i].timeoutOccurred() || !tofReadingIsADistance(mm)) {
    rt.bins[i].observeTimeout(now);
  } else {
    rt.bins[i].observeDistance(static_cast<float>(mm) / 10.0f, cfg, now);
  }
  markSample(now);
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
  beginTof();

  const uint32_t now = millis();
  g_next_soil = now;
  g_next_light = now;
  g_next_bin = now;
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
  for (int i = 0; i < 3; ++i) rt.bins[i].configure(rt.config.bins[i]);
  rt.waste.configure(rt.config.waste);
  rt.irrigation.setConfig(now, rt.config.irrigation,
                          VILLAGE_PUMP_COMMISSIONED == 1);
}

}  // namespace village
