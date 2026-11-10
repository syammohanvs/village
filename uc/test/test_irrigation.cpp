#include "minitest.h"
#include "village/core/irrigation.h"

using namespace village;

namespace {

IrrigationConfig manualCfg() {
  IrrigationConfig c;
  c.auto_enabled = false;
  c.pump_enabled = true;
  c.dry_start_pct = 35;
  c.stop_pct = 55;
  c.dry_confirm_ms = 1000;
  c.pulse_ms = 4000;
  c.max_pulse_ms = 8000;
  c.soak_ms = 1000;
  c.max_cumulative_ms = 15000;
  c.max_pulses = 4;
  c.cooldown_ms = 60000;
  c.link_timeout_ms = 30000;
  return c;
}

IrrigationConfig autoCfg() {
  IrrigationConfig c = manualCfg();
  c.auto_enabled = true;
  c.dry_confirm_ms = 0;
  return c;
}

IrrigationInputs dryInputs() {
  IrrigationInputs in;
  in.soil_valid = true;
  in.soil_calibrated = true;
  in.soil_percent = 20.0f;
  in.reservoir_valid = true;
  in.reservoir_available = true;
  in.link_age_ms = 100;
  return in;
}

}  // namespace

TEST(irrigation_boot_leaves_pump_off_and_guards_requests) {
  IrrigationController c;
  c.begin(0, manualCfg(), true);
  IrrigationStatus s = c.status(0);
  CHECK(!s.pump_on);
  CHECK(s.state == IrrigationState::Idle);
  CHECK(s.reason == &reasons::kIdleBoot);

  IrrigationDecision d = c.requestManual(1000, dryInputs());
  CHECK(d.result == CommandResult::Rejected);
  CHECK(d.reason == &reasons::kBlockedBootGuard);

  c.tick(1000, dryInputs());
  CHECK(!c.pumpOn());
  CHECK(c.status(1000).reason == &reasons::kIdleBoot);

  d = c.requestManual(5000, dryInputs());
  CHECK(d.result == CommandResult::Accepted);
  CHECK(c.pumpOn());
}

TEST(irrigation_manual_start_and_user_stop) {
  IrrigationController c;
  c.begin(0, manualCfg(), true);
  IrrigationDecision d = c.requestManual(6000, dryInputs());
  CHECK(d.result == CommandResult::Accepted);
  CHECK(d.reason == &reasons::kStarted);

  IrrigationStatus s = c.status(6000);
  CHECK(s.pump_on);
  CHECK(s.state == IrrigationState::Pumping);
  CHECK(s.pulses_done == 1);
  CHECK(s.pulse_remaining_ms == 4000);

  c.tick(7000, dryInputs());
  CHECK(c.pumpOn());
  CHECK(c.status(7000).pulse_remaining_ms == 3000);

  d = c.stopUser(7000);
  CHECK(d.result == CommandResult::Accepted);
  CHECK(d.reason == &reasons::kStoppedUser);
  CHECK(!c.pumpOn());
  s = c.status(7000);
  CHECK(s.cumulative_pump_ms == 1000);
  CHECK(s.last.present);
  CHECK(s.last.kind == SessionKind::Manual);
  CHECK(s.last.reason == &reasons::kStoppedUser);
  CHECK(s.cooldown_remaining_ms == 1000);

  // A repeated stop is accepted and harmless.
  d = c.stopUser(7200);
  CHECK(d.result == CommandResult::Accepted);
  CHECK(d.reason == &reasons::kIdleAlreadyStopped);

  // The short operator cooldown expires at 8000.
  d = c.requestManual(7900, dryInputs());
  CHECK(d.result == CommandResult::Rejected);
  CHECK(d.reason == &reasons::kBlockedCooldown);
  d = c.requestManual(8000, dryInputs());
  CHECK(d.result == CommandResult::Accepted);
}

TEST(irrigation_blocks_wet_soil_and_bad_readings) {
  IrrigationController c;
  c.begin(0, manualCfg(), true);

  IrrigationInputs in = dryInputs();
  in.soil_percent = 40.0f;
  CHECK(c.requestManual(6000, in).reason == &reasons::kBlockedSoilWet);

  in = dryInputs();
  in.soil_valid = false;
  CHECK(c.requestManual(6000, in).reason == &reasons::kBlockedSensorInvalid);

  in = dryInputs();
  in.soil_percent = NAN;
  CHECK(c.requestManual(6000, in).reason == &reasons::kBlockedSensorInvalid);

  in = dryInputs();
  in.soil_calibrated = false;
  CHECK(c.requestManual(6000, in).reason == &reasons::kBlockedSoilUncalibrated);

  in = dryInputs();
  in.reservoir_valid = false;
  CHECK(c.requestManual(6000, in).reason == &reasons::kBlockedWaterUnknown);

  in = dryInputs();
  in.reservoir_available = false;
  CHECK(c.requestManual(6000, in).reason == &reasons::kBlockedWaterLow);

  CHECK(!c.pumpOn());
}

TEST(irrigation_requires_both_commissioning_gates) {
  IrrigationController c;
  IrrigationConfig cfg = manualCfg();
  cfg.pump_enabled = false;
  c.begin(0, cfg, true);
  CHECK(c.requestManual(6000, dryInputs()).reason ==
        &reasons::kBlockedPumpNotCommissioned);

  c.begin(0, manualCfg(), false);
  CHECK(c.requestManual(6000, dryInputs()).reason ==
        &reasons::kBlockedPumpNotCommissioned);
  CHECK(!c.pumpOn());
}

TEST(irrigation_stops_on_low_water_mid_pulse) {
  IrrigationController c;
  c.begin(0, manualCfg(), true);
  c.requestManual(6000, dryInputs());
  c.tick(7000, dryInputs());
  CHECK(c.pumpOn());

  IrrigationInputs in = dryInputs();
  in.reservoir_available = false;
  c.tick(7500, in);
  CHECK(!c.pumpOn());
  IrrigationStatus s = c.status(7500);
  CHECK(s.reason == &reasons::kStoppedLowWater);
  CHECK(s.cumulative_pump_ms == 1500);
  CHECK(s.last.reason == &reasons::kStoppedLowWater);
  CHECK(!s.failure_lockout);
}

TEST(irrigation_stops_on_invalid_sensor_during_soak) {
  IrrigationController c;
  c.begin(0, manualCfg(), true);
  c.requestManual(6000, dryInputs());
  c.tick(10000, dryInputs());
  CHECK(c.status(10000).state == IrrigationState::Soaking);

  IrrigationInputs in = dryInputs();
  in.soil_valid = false;
  c.tick(10500, in);
  IrrigationStatus s = c.status(10500);
  CHECK(!s.pump_on);
  CHECK(s.reason == &reasons::kStoppedSensorInvalid);
  CHECK(s.cumulative_pump_ms == 4000);
}

TEST(irrigation_max_cumulative_accounts_exactly_once) {
  IrrigationConfig cfg = manualCfg();
  cfg.pulse_ms = 4000;
  cfg.max_pulse_ms = 4000;
  cfg.soak_ms = 1000;
  cfg.max_cumulative_ms = 6000;
  cfg.max_pulses = 4;

  IrrigationController c;
  c.begin(0, cfg, true);
  c.requestManual(6000, dryInputs());
  c.tick(10000, dryInputs());
  CHECK(c.status(10000).state == IrrigationState::Soaking);
  CHECK(c.status(10000).cumulative_pump_ms == 4000);

  c.tick(11000, dryInputs());
  IrrigationStatus mid = c.status(11000);
  CHECK(mid.state == IrrigationState::Pumping);
  CHECK(mid.pulses_done == 2);
  CHECK(mid.pulse_remaining_ms == 2000);

  c.tick(13000, dryInputs());
  IrrigationStatus s = c.status(13000);
  CHECK(!s.pump_on);
  CHECK(s.state == IrrigationState::Idle);
  CHECK(s.reason == &reasons::kStoppedMaxRuntime);
  CHECK(s.cumulative_pump_ms == 6000);
  CHECK(s.last.pumped_ms == 6000);  // not double-counted
  CHECK(s.failure_lockout);
  CHECK(s.cooldown_remaining_ms >= IrrigationController::kFailureLockoutMs);
}

TEST(irrigation_max_pulses_locks_out_and_wet_soil_clears_it) {
  IrrigationConfig cfg = manualCfg();
  cfg.pulse_ms = 1000;
  cfg.max_pulse_ms = 1000;
  cfg.soak_ms = 1000;
  cfg.max_cumulative_ms = 12000;
  cfg.max_pulses = 2;

  IrrigationController c;
  c.begin(0, cfg, true);
  c.requestManual(6000, dryInputs());
  c.tick(7000, dryInputs());
  c.tick(8000, dryInputs());
  CHECK(c.status(8000).pulses_done == 2);
  c.tick(9000, dryInputs());
  c.tick(10000, dryInputs());

  IrrigationStatus s = c.status(10000);
  CHECK(!s.pump_on);
  CHECK(s.reason == &reasons::kStoppedMaxPulses);
  CHECK(s.failure_lockout);
  CHECK(s.cumulative_pump_ms == 2000);

  CHECK(c.requestManual(10001, dryInputs()).reason == &reasons::kBlockedLockout);

  IrrigationInputs wet = dryInputs();
  wet.soil_percent = 60.0f;
  c.tick(20000, wet);
  CHECK(!c.status(20000).failure_lockout);
  // The long safety cooldown is still in force.
  CHECK(c.status(20000).reason == &reasons::kIdleCooldown);

  c.clearFailureLockout(20000);
  c.tick(20000, wet);
  CHECK(c.status(20000).reason == &reasons::kIdleSoilAdequate);
}

TEST(irrigation_completes_when_soil_reaches_stop_level) {
  IrrigationController c;
  c.begin(0, manualCfg(), true);
  c.requestManual(6000, dryInputs());
  c.tick(10000, dryInputs());
  CHECK(c.status(10000).state == IrrigationState::Soaking);

  IrrigationInputs wet = dryInputs();
  wet.soil_percent = 60.0f;
  c.tick(11000, wet);
  IrrigationStatus s = c.status(11000);
  CHECK(!s.pump_on);
  CHECK(s.reason == &reasons::kCompleteMoisture);
  CHECK(s.last.reason == &reasons::kCompleteMoisture);
  CHECK(!s.failure_lockout);
  CHECK(s.cumulative_pump_ms == 4000);
}

TEST(irrigation_link_loss_stops_only_a_manual_session) {
  IrrigationController manual;
  manual.begin(0, manualCfg(), true);
  manual.requestManual(6000, dryInputs());
  IrrigationInputs lost = dryInputs();
  lost.link_age_ms = 31000;
  manual.tick(7000, lost);
  CHECK(!manual.pumpOn());
  CHECK(manual.status(7000).reason == &reasons::kStoppedLinkLost);

  IrrigationController automatic;
  automatic.begin(0, autoCfg(), true);
  automatic.tick(6000, dryInputs());
  automatic.tick(6001, dryInputs());
  CHECK(automatic.pumpOn());
  CHECK(automatic.status(6001).session == SessionKind::Auto);

  IrrigationInputs noLink = dryInputs();
  noLink.link_age_ms = 999999;
  automatic.tick(7000, noLink);
  CHECK(automatic.pumpOn());
  CHECK(automatic.status(7000).state == IrrigationState::Pumping);
}

TEST(irrigation_auto_needs_dry_soil_and_water) {
  IrrigationController c;
  c.begin(0, autoCfg(), true);

  IrrigationInputs wet = dryInputs();
  wet.soil_percent = 40.0f;
  c.tick(6000, wet);
  CHECK(!c.pumpOn());
  CHECK(c.status(6000).reason == &reasons::kIdleSoilAdequate);

  IrrigationInputs low = dryInputs();
  low.reservoir_available = false;
  c.tick(7000, low);
  CHECK(!c.pumpOn());
  CHECK(c.status(7000).reason == &reasons::kIdleWaterLow);

  IrrigationInputs bad = dryInputs();
  bad.soil_calibrated = false;
  c.tick(8000, bad);
  CHECK(!c.pumpOn());
  CHECK(c.status(8000).reason == &reasons::kIdleSoilUncalibrated);
}

TEST(irrigation_auto_confirms_dryness_before_starting) {
  IrrigationConfig cfg = autoCfg();
  cfg.dry_confirm_ms = 1000;
  IrrigationController c;
  c.begin(0, cfg, true);
  c.tick(6000, dryInputs());
  CHECK(!c.pumpOn());
  CHECK(c.status(6000).reason == &reasons::kIdleSoilDryWaiting);
  c.tick(6500, dryInputs());
  CHECK(!c.pumpOn());
  c.tick(7000, dryInputs());
  CHECK(c.pumpOn());
  CHECK(c.status(7000).session == SessionKind::Auto);
}

TEST(irrigation_restart_clears_the_session_and_pump) {
  IrrigationController c;
  c.begin(0, manualCfg(), true);
  c.requestManual(6000, dryInputs());
  CHECK(c.pumpOn());

  c.begin(7000, manualCfg(), true);
  CHECK(!c.pumpOn());
  IrrigationStatus s = c.status(7000);
  CHECK(s.state == IrrigationState::Idle);
  CHECK(s.session == SessionKind::None);
  CHECK(!s.last.present);
  CHECK(s.reason == &reasons::kIdleBoot);
  CHECK(c.requestManual(8000, dryInputs()).reason ==
        &reasons::kBlockedBootGuard);
}

TEST(irrigation_config_change_can_disable_the_pump_safely) {
  IrrigationController c;
  c.begin(0, manualCfg(), true);
  c.requestManual(6000, dryInputs());
  CHECK(c.pumpOn());

  IrrigationConfig cfg = manualCfg();
  cfg.pump_enabled = false;
  c.setConfig(6500, cfg, true);
  CHECK(!c.pumpOn());
  CHECK(c.status(6500).reason == &reasons::kStoppedPumpDisabled);
}

TEST(irrigation_reports_pulse_and_soak_countdowns) {
  IrrigationController c;
  c.begin(0, manualCfg(), true);
  c.requestManual(6000, dryInputs());
  CHECK(c.status(7000).pulse_remaining_ms == 3000);
  c.tick(10000, dryInputs());
  IrrigationStatus s = c.status(10000);
  CHECK(s.state == IrrigationState::Soaking);
  CHECK(s.soak_remaining_ms == 1000);
  CHECK(!s.pump_on);
}

// A request handler stamps the contact time with a later millis() than the
// value the loop sampled at the top of the same pass.  The unsigned difference
// then reads as ~49 days, which is longer than any timeout, and every manual
// session died on its first tick as "laptop communication lost".
TEST(age_ms_treats_a_stamp_ahead_of_now_as_zero) {
  CHECK(ageMs(1000, 1000) == 0);
  CHECK(ageMs(1500, 1000) == 500);
  CHECK(ageMs(1000, 1006) == 0);
  // A genuine wrap of millis() is still measured correctly.
  CHECK(ageMs(10, 0xFFFFFFF0u) == 26);
}

TEST(irrigation_survives_a_contact_stamp_from_the_same_tick) {
  IrrigationController c;
  c.begin(0, manualCfg(), true);
  CHECK(c.requestManual(6000, dryInputs()).result == CommandResult::Accepted);
  CHECK(c.pumpOn());

  IrrigationInputs in = dryInputs();
  in.link_age_ms = ageMs(5994, 6000);  // the handler ran 6 ms after `now`
  CHECK(in.link_age_ms == 0);

  c.tick(5994, in);
  CHECK(c.pumpOn());
  const IrrigationStatus s = c.status(5994);
  CHECK(s.state == IrrigationState::Pumping);
  CHECK(!s.last.present);
}
