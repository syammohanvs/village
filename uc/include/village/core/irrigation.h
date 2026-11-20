#pragma once

#include <cmath>
#include <cstdint>

#include "village/core/config.h"
#include "village/core/reasons.h"
#include "village/core/time.h"
#include "village/core/types.h"

namespace village {

struct IrrigationInputs {
  bool soil_valid = false;
  bool soil_calibrated = false;
  float soil_percent = NAN;
  bool reservoir_valid = false;
  bool reservoir_calibrated = false;
  bool reservoir_available = false;
  // Age of the last authenticated request from the laptop.  Only a MANUAL
  // session is stopped by this; local automatic watering continues.
  uint32_t link_age_ms = UINT32_MAX;
};

struct IrrigationLastSession {
  bool present = false;
  SessionKind kind = SessionKind::None;
  const Reason* reason = &reasons::kIdleBoot;
  uint32_t at_ms = 0;
  uint8_t pulses = 0;
  uint32_t pumped_ms = 0;
};

struct IrrigationStatus {
  bool auto_enabled = true;
  bool pump_enabled = false;   // configuration
  PumpMode mode = PumpMode::Auto;
  bool failure_lockout = false;
  bool pump_on = false;
  IrrigationState state = IrrigationState::Idle;
  SessionKind session = SessionKind::None;
  uint8_t pulses_done = 0;
  uint8_t pulse_limit = 0;
  uint32_t cumulative_pump_ms = 0;
  uint32_t max_cumulative_pump_ms = 0;
  uint32_t cooldown_remaining_ms = 0;
  uint32_t session_elapsed_ms = 0;
  uint32_t pulse_remaining_ms = 0;
  uint32_t soak_remaining_ms = 0;
  const Reason* reason = &reasons::kIdleBoot;
  IrrigationLastSession last;
};

struct IrrigationDecision {
  CommandResult result = CommandResult::Rejected;
  const Reason* reason = &reasons::kIdleBoot;
};

// The complete irrigation safety state machine.  It is deliberately free of
// Arduino calls: the firmware feeds it filtered sensor values and applies
// pumpOn() to the GPIO.  Every start is checked here, including starts from
// the browser and from voice commands.
class IrrigationController {
 public:
  static constexpr uint32_t kBootGuardMs = 5000;
  static constexpr uint32_t kFailureLockoutMs = 1800000;  // 30 minutes
  static constexpr uint32_t kUserStopCooldownMs = 1000;
  static constexpr uint32_t kLinkLostCooldownMs = 5000;

  void begin(uint32_t now, const IrrigationConfig& cfg) {
    cfg_ = cfg;
    mode_ = PumpMode::Auto;
    manual_on_ = false;
    state_ = IrrigationState::Idle;
    session_ = SessionKind::None;
    pump_on_ = false;
    pulses_done_ = 0;
    cumulative_ms_ = 0;
    session_start_ms_ = 0;
    pulse_start_ms_ = 0;
    active_pulse_ms_ = 0;
    soak_start_ms_ = 0;
    active_soak_ms_ = 0;
    cooldown_until_ms_ = now;
    boot_guard_until_ms_ = now + kBootGuardMs;
    dry_timer_active_ = false;
    dry_since_ms_ = 0;
    failure_lockout_ = false;
    last_ = IrrigationLastSession{};
    reason_ = &reasons::kIdleBoot;
  }

  void setConfig(uint32_t now, const IrrigationConfig& cfg) {
    cfg_ = cfg;
    if (active() && !effectivePump()) {
      stopInternal(now, reasons::kStoppedPumpDisabled, 0);
    }
  }

  // The manual switch is the operator's, so it answers directly; everything
  // else answers from the session state machine.
  bool pumpOn() const {
    if (mode_ != PumpMode::Auto) return manual_on_;
    return pump_on_ && state_ == IrrigationState::Pumping;
  }

  void setMode(PumpMode mode) {
    mode_ = mode;
    if (mode != PumpMode::Auto) {
      // Leaving the rules ends any session they had running.
      pump_on_ = false;
      state_ = IrrigationState::Idle;
      session_ = SessionKind::None;
      dry_timer_active_ = false;
      manual_on_ = false;
    }
  }
  PumpMode mode() const { return mode_; }

  bool active() const {
    return state_ == IrrigationState::Pumping || state_ == IrrigationState::Soaking;
  }

  IrrigationDecision requestManual(uint32_t now, const IrrigationInputs& in) {
    if (mode_ != PumpMode::Auto) return reject(reasons::kPumpManualActive);
    if (active()) return reject(reasons::kBlockedAlreadyActive);
    if (!effectivePump()) return reject(reasons::kBlockedPumpDisabled);
    if (bootGuardActive(now)) return reject(reasons::kBlockedBootGuard);
    if (failure_lockout_) return reject(reasons::kBlockedLockout);
    if (cooldownActive(now)) return reject(reasons::kBlockedCooldown);
    if (!in.soil_valid || !std::isfinite(in.soil_percent)) {
      return reject(reasons::kBlockedSensorInvalid);
    }
    if (!in.soil_calibrated) return reject(reasons::kBlockedSoilUncalibrated);
    if (in.soil_percent > static_cast<float>(cfg_.dry_start_pct)) {
      return reject(reasons::kBlockedSoilWet);
    }
    if (!in.reservoir_valid) return reject(reasons::kBlockedWaterUnknown);
    if (!in.reservoir_available) return reject(reasons::kBlockedWaterLow);

    startSession(now, SessionKind::Manual);
    return {CommandResult::Accepted, reason_};
  }

  // An explicit stop is idempotent: pressing Stop when idle is a success, not
  // an error.  It interrupts a pulse immediately and records the session.
  IrrigationDecision stopUser(uint32_t now) {
    if (mode_ != PumpMode::Auto) {
      // "Stop the pump" must stop it even when the manual switch is holding it
      // on.  Leaving the switch on while answering "stopped" is the one answer
      // this must never give (2026-11-17).
      mode_ = PumpMode::Off;
      manual_on_ = false;
      reason_ = &reasons::kPumpManualOff;
      return {CommandResult::Accepted, reason_};
    }
    if (!active()) {
      pump_on_ = false;
      reason_ = &reasons::kIdleAlreadyStopped;
      return {CommandResult::Accepted, reason_};
    }
    stopInternal(now, reasons::kStoppedUser, kUserStopCooldownMs);
    return {CommandResult::Accepted, reason_};
  }

  // Called frequently (the firmware uses ~100 ms).  Safe to call at any time.
  void tick(uint32_t now, const IrrigationInputs& in) {
    if (mode_ != PumpMode::Auto) {
      tickManual(in);
      return;
    }
    manual_on_ = false;
    if (active()) {
      if (!effectivePump()) {
        stopInternal(now, reasons::kStoppedPumpDisabled, 0);
        return;
      }
      if (!in.soil_valid || !std::isfinite(in.soil_percent) || !in.soil_calibrated) {
        stopInternal(now, reasons::kStoppedSensorInvalid, cfg_.cooldown_ms);
        return;
      }
      if (!in.reservoir_valid) {
        stopInternal(now, reasons::kStoppedSensorInvalid, cfg_.cooldown_ms);
        return;
      }
      if (!in.reservoir_available) {
        stopInternal(now, reasons::kStoppedLowWater, cfg_.cooldown_ms);
        return;
      }
      if (session_ == SessionKind::Manual && in.link_age_ms > cfg_.link_timeout_ms) {
        stopInternal(now, reasons::kStoppedLinkLost, kLinkLostCooldownMs);
        return;
      }

      if (state_ == IrrigationState::Pumping) {
        const uint32_t elapsed = ageMs(now, pulse_start_ms_);
        // A config change can lower the cumulative limit mid-session.  Act on
        // it immediately instead of waiting for the pulse to end.
        if (cumulative_ms_ + elapsed >= cfg_.max_cumulative_ms) {
          failure_lockout_ = true;
          stopInternal(now, reasons::kStoppedMaxRuntime, effectiveCooldown());
          return;
        }
        if (elapsed >= active_pulse_ms_) {
          cumulative_ms_ += elapsed;
          pump_on_ = false;
          if (cumulative_ms_ >= cfg_.max_cumulative_ms) {
            failure_lockout_ = true;
            // The pulse has already ended, so stopInternal() must not add the
            // pulse time a second time.
            state_ = IrrigationState::Soaking;
            finish(now, reasons::kStoppedMaxRuntime, effectiveCooldown());
            return;
          }
          state_ = IrrigationState::Soaking;
          soak_start_ms_ = now;
          active_soak_ms_ = cfg_.soak_ms;
          reason_ = &reasons::kSoaking;
          return;
        }
        pump_on_ = true;
        return;
      }

      if (state_ == IrrigationState::Soaking) {
        pump_on_ = false;
        if (ageMs(now, soak_start_ms_) >= active_soak_ms_) {
          if (in.soil_percent >= static_cast<float>(cfg_.stop_pct)) {
            finish(now, reasons::kCompleteMoisture, cfg_.cooldown_ms);
            return;
          }
          if (pulses_done_ >= cfg_.max_pulses) {
            failure_lockout_ = true;
            finish(now, reasons::kStoppedMaxPulses, effectiveCooldown());
            return;
          }
          if (cumulative_ms_ >= cfg_.max_cumulative_ms) {
            failure_lockout_ = true;
            finish(now, reasons::kStoppedMaxRuntime, effectiveCooldown());
            return;
          }
          startPulse(now, false);
          return;
        }
        return;
      }
    }

    updateIdle(now, in);
  }

  // Manual: the switch decides, and the tank is the only thing still watched.
  // A pump must never run dry, so a low or unreadable tank stops it whatever
  // the switch says.
  void tickManual(const IrrigationInputs& in) {
    // Reported as pumping while the switch holds it on, so the page's
    // Watering chip and the pump agree (the state machine's pulses are not
    // used here -- that is what manual means).
    pump_on_ = false;
    state_ = IrrigationState::Idle;
    session_ = SessionKind::None;
    if (mode_ == PumpMode::Off) {
      manual_on_ = false;
      reason_ = &reasons::kPumpManualOff;
      return;
    }
    // Only a tank that is KNOWN to be empty stops the manual switch.  A probe
    // that cannot say (uncalibrated, stale, no sample) must not refuse a
    // switch the operator is standing in front of — the first version did, and
    // the button looked dead on a board whose probe had never been calibrated
    // (reported 2026-11-17).
    const bool tank_known_dry =
        in.reservoir_valid && in.reservoir_calibrated && !in.reservoir_available;
    if (tank_known_dry) {
      manual_on_ = false;
      reason_ = &reasons::kPumpManualWaterLow;
      return;
    }
    manual_on_ = true;
    state_ = IrrigationState::Pumping;
    reason_ = (in.reservoir_valid && in.reservoir_calibrated)
                  ? &reasons::kPumpManualOn
                  : &reasons::kPumpManualWaterUnknown;
  }

  void clearFailureLockout(uint32_t now) {
    failure_lockout_ = false;
    cooldown_until_ms_ = now;
  }

  IrrigationStatus status(uint32_t now) const {
    IrrigationStatus s;
    s.auto_enabled = cfg_.auto_enabled;
    s.pump_enabled = cfg_.pump_enabled;
    s.mode = mode_;
    s.failure_lockout = failure_lockout_;
    s.pump_on = pumpOn();
    s.state = state_;
    s.session = session_;
    s.pulses_done = pulses_done_;
    s.pulse_limit = cfg_.max_pulses;
    s.cumulative_pump_ms = cumulative_ms_;
    s.max_cumulative_pump_ms = cfg_.max_cumulative_ms;
    s.cooldown_remaining_ms = cooldownRemaining(now);
    s.session_elapsed_ms =
        active() ? ageMs(now, session_start_ms_) : 0;
    if (state_ == IrrigationState::Pumping) {
      const uint32_t used = ageMs(now, pulse_start_ms_);
      s.pulse_remaining_ms = used >= active_pulse_ms_ ? 0 : active_pulse_ms_ - used;
    }
    if (state_ == IrrigationState::Soaking) {
      const uint32_t used = ageMs(now, soak_start_ms_);
      s.soak_remaining_ms = used >= active_soak_ms_ ? 0 : active_soak_ms_ - used;
    }
    s.reason = reason_;
    s.last = last_;
    return s;
  }

 private:
  static IrrigationDecision reject(const Reason& r) {
    return {CommandResult::Rejected, &r};
  }

  bool effectivePump() const { return cfg_.pump_enabled; }

  bool bootGuardActive(uint32_t now) const {
    return static_cast<int32_t>(boot_guard_until_ms_ - now) > 0;
  }

  bool cooldownActive(uint32_t now) const {
    return static_cast<int32_t>(cooldown_until_ms_ - now) > 0;
  }

  uint32_t cooldownRemaining(uint32_t now) const {
    const int32_t d = static_cast<int32_t>(cooldown_until_ms_ - now);
    return d > 0 ? static_cast<uint32_t>(d) : 0;
  }

  uint32_t effectiveCooldown() const {
    // The exhibition runs with no cooldown, so the configured value is the
    // whole story -- including after a safety stop.  A failure stop still
    // latches `failure_lockout_`, and only a genuinely wet reading clears that
    // (see updateIdle), so a probe that never gets wet cannot water forever.
    // Before 2026-11-20 this returned at least 30 minutes, which put the
    // exhibit into a half-hour wait after four dry pulses.
    return cfg_.cooldown_ms;
  }

  void startSession(uint32_t now, SessionKind kind) {
    session_ = kind;
    pulses_done_ = 0;
    cumulative_ms_ = 0;
    session_start_ms_ = now;
    dry_timer_active_ = false;
    state_ = IrrigationState::Idle;
    startPulse(now, true);
  }

  void startPulse(uint32_t now, bool first) {
    if (pulses_done_ >= cfg_.max_pulses) {
      failure_lockout_ = true;
      finish(now, reasons::kStoppedMaxPulses, effectiveCooldown());
      return;
    }
    const uint32_t remaining = cfg_.max_cumulative_ms > cumulative_ms_
                                   ? cfg_.max_cumulative_ms - cumulative_ms_
                                   : 0;
    if (remaining < 500) {
      failure_lockout_ = true;
      finish(now, reasons::kStoppedMaxRuntime, effectiveCooldown());
      return;
    }
    uint32_t pulse = cfg_.pulse_ms;
    if (cfg_.max_pulse_ms < pulse) pulse = cfg_.max_pulse_ms;
    if (remaining < pulse) pulse = remaining;
    active_pulse_ms_ = pulse;
    pulse_start_ms_ = now;
    state_ = IrrigationState::Pumping;
    pump_on_ = true;
    ++pulses_done_;
    reason_ = first ? &reasons::kStarted : &reasons::kPulse;
  }

  void finish(uint32_t now, const Reason& why, uint32_t cooldown_ms) {
    stopInternal(now, why, cooldown_ms);
  }

  void stopInternal(uint32_t now, const Reason& why, uint32_t cooldown_ms) {
    if (state_ == IrrigationState::Pumping) {
      cumulative_ms_ += ageMs(now, pulse_start_ms_);
    }
    pump_on_ = false;
    last_.present = true;
    last_.kind = session_;
    last_.reason = &why;
    last_.at_ms = now;
    last_.pulses = pulses_done_;
    last_.pumped_ms = cumulative_ms_;
    state_ = IrrigationState::Idle;
    session_ = SessionKind::None;
    cooldown_until_ms_ = now + cooldown_ms;
    dry_timer_active_ = false;
    reason_ = &why;
  }

  void updateIdle(uint32_t now, const IrrigationInputs& in) {
    pump_on_ = false;

    if (failure_lockout_) {
      // A genuinely wet probe proves that watering worked; clear the lockout
      // so the village is not stuck forever after a dry probe was fixed.
      if (in.soil_valid && in.soil_calibrated && std::isfinite(in.soil_percent) &&
          in.soil_percent >= static_cast<float>(cfg_.stop_pct)) {
        failure_lockout_ = false;
      } else {
        reason_ = &reasons::kIdleFailureLockout;
        dry_timer_active_ = false;
        return;
      }
    }

    if (!effectivePump()) {
      reason_ = &reasons::kIdlePumpDisabled;
      dry_timer_active_ = false;
      return;
    }
    if (bootGuardActive(now)) {
      reason_ = &reasons::kIdleBoot;
      dry_timer_active_ = false;
      return;
    }
    if (cooldownActive(now)) {
      reason_ = &reasons::kIdleCooldown;
      dry_timer_active_ = false;
      return;
    }
    if (!in.soil_valid || !std::isfinite(in.soil_percent)) {
      reason_ = &reasons::kIdleSensorInvalid;
      dry_timer_active_ = false;
      return;
    }
    if (!in.soil_calibrated) {
      reason_ = &reasons::kIdleSoilUncalibrated;
      dry_timer_active_ = false;
      return;
    }
    if (!in.reservoir_valid) {
      reason_ = &reasons::kIdleWaterUnknown;
      dry_timer_active_ = false;
      return;
    }
    if (!in.reservoir_available) {
      reason_ = &reasons::kIdleWaterLow;
      dry_timer_active_ = false;
      return;
    }
    if (in.soil_percent > static_cast<float>(cfg_.dry_start_pct)) {
      reason_ = &reasons::kIdleSoilAdequate;
      dry_timer_active_ = false;
      return;
    }
    if (!cfg_.auto_enabled) {
      reason_ = &reasons::kIdleAutoOff;
      dry_timer_active_ = false;
      return;
    }
    if (!dry_timer_active_) {
      dry_timer_active_ = true;
      dry_since_ms_ = now;
      reason_ = &reasons::kIdleSoilDryWaiting;
      return;
    }
    if (elapsed(now, dry_since_ms_, cfg_.dry_confirm_ms)) {
      startSession(now, SessionKind::Auto);
      return;
    }
    reason_ = &reasons::kIdleSoilDryWaiting;
  }

  IrrigationConfig cfg_{};
  PumpMode mode_ = PumpMode::Auto;
  bool manual_on_ = false;
  bool pump_on_ = false;
  bool failure_lockout_ = false;
  IrrigationState state_ = IrrigationState::Idle;
  SessionKind session_ = SessionKind::None;
  uint8_t pulses_done_ = 0;
  uint32_t cumulative_ms_ = 0;
  uint32_t session_start_ms_ = 0;
  uint32_t pulse_start_ms_ = 0;
  uint32_t active_pulse_ms_ = 0;
  uint32_t soak_start_ms_ = 0;
  uint32_t active_soak_ms_ = 0;
  uint32_t cooldown_until_ms_ = 0;
  uint32_t boot_guard_until_ms_ = 0;
  bool dry_timer_active_ = false;
  uint32_t dry_since_ms_ = 0;
  const Reason* reason_ = &reasons::kIdleBoot;
  IrrigationLastSession last_{};
};

}  // namespace village
