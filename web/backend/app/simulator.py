from __future__ import annotations

import copy
import secrets
import threading
import time
from typing import Any

PROTOCOL_VERSION = 1
BIN_IDS = ("organic", "plastic", "paper")

CATEGORY_REASONS = {
    "organic": ("WASTE_INDICATED_ORGANIC", "Organic waste recognised. Organic-bin indicator activated."),
    "plastic": ("WASTE_INDICATED_PLASTIC", "Plastic recognised. Plastic-bin indicator activated."),
    "paper": ("WASTE_INDICATED_PAPER", "Paper recognised. Paper-bin indicator activated."),
}

REASONS: dict[str, tuple[str, str]] = {
    "IDLE_BOOT": ("IDLE_BOOT", "Controller started. The pump is off until a new decision."),
    "IDLE_AUTO_OFF": ("IDLE_AUTO_OFF", "Automatic irrigation is switched off. Manual requests are still checked."),
    "IDLE_SOIL_ADEQUATE": ("IDLE_SOIL_ADEQUATE", "Soil moisture is adequate. No watering is needed."),
    "IDLE_SOIL_DRY_WAITING": ("IDLE_SOIL_DRY_WAITING", "Soil is dry and water is available. Confirming the reading before watering."),
    "IDLE_WATER_LOW": ("IDLE_WATER_LOW", "Irrigation blocked: reservoir water is low."),
    "IDLE_WATER_UNKNOWN": ("IDLE_WATER_UNKNOWN", "Irrigation blocked: reservoir water state is unknown."),
    "IDLE_SOIL_UNCALIBRATED": ("IDLE_SOIL_UNCALIBRATED", "Irrigation blocked: soil moisture is not calibrated."),
    "IDLE_SENSOR_INVALID": ("IDLE_SENSOR_INVALID", "Irrigation blocked: a required sensor reading is invalid."),
    "IDLE_COOLDOWN": ("IDLE_COOLDOWN", "Waiting before the next watering session."),
    "IDLE_PUMP_NOT_COMMISSIONED": ("IDLE_PUMP_NOT_COMMISSIONED", "Soil is dry and water is available, but the pump is not commissioned."),
    "IDLE_ALREADY_STOPPED": ("IDLE_ALREADY_STOPPED", "Irrigation is already stopped. The pump is off."),
    "IDLE_FAILURE_LOCKOUT": ("IDLE_FAILURE_LOCKOUT", "Irrigation is locked out after repeated watering with no moisture rise. Check the probe, the water and the soil."),
    "IRRIGATION_STARTED": ("IRRIGATION_STARTED", "Soil is dry and water is available. Watering for a short pulse."),
    "IRRIGATION_PULSE": ("IRRIGATION_PULSE", "Soil is dry and water is available. Watering for a short pulse."),
    "IRRIGATION_SOAKING": ("IRRIGATION_SOAKING", "Waiting for water to soak into the soil."),
    "IRRIGATION_COMPLETE_MOISTURE": ("IRRIGATION_COMPLETE_MOISTURE", "Soil moisture reached the stop level. Watering finished."),
    "IRRIGATION_STOPPED_MAX_PULSES": ("IRRIGATION_STOPPED_MAX_PULSES", "No moisture rise after the allowed pulses. Watering is locked out."),
    "IRRIGATION_STOPPED_MAX_RUNTIME": ("IRRIGATION_STOPPED_MAX_RUNTIME", "The maximum pump-on time for this session was reached."),
    "IRRIGATION_STOPPED_LOW_WATER": ("IRRIGATION_STOPPED_LOW_WATER", "Irrigation stopped: reservoir water is low."),
    "IRRIGATION_STOPPED_SENSOR_INVALID": ("IRRIGATION_STOPPED_SENSOR_INVALID", "Irrigation stopped: a required sensor reading became invalid."),
    "IRRIGATION_STOPPED_LINK_LOST": ("IRRIGATION_STOPPED_LINK_LOST", "Irrigation stopped: laptop communication was lost during a manual session."),
    "IRRIGATION_STOPPED_USER": ("IRRIGATION_STOPPED_USER", "Irrigation stopped by the operator."),
    "IRRIGATION_STOPPED_PUMP_DISABLED": ("IRRIGATION_STOPPED_PUMP_DISABLED", "Irrigation stopped: the pump was disabled in the configuration."),
    "IRRIGATION_BLOCKED_SOIL_WET": ("IRRIGATION_BLOCKED_SOIL_WET", "Irrigation blocked: the soil is already wet enough."),
    "IRRIGATION_BLOCKED_SOIL_UNCALIBRATED": ("IRRIGATION_BLOCKED_SOIL_UNCALIBRATED", "Irrigation blocked: soil moisture calibration is missing or invalid."),
    "IRRIGATION_BLOCKED_SENSOR_INVALID": ("IRRIGATION_BLOCKED_SENSOR_INVALID", "Irrigation blocked: a required sensor reading is stale or invalid."),
    "IRRIGATION_BLOCKED_WATER_LOW": ("IRRIGATION_BLOCKED_WATER_LOW", "Irrigation blocked: reservoir water is low."),
    "IRRIGATION_BLOCKED_WATER_UNKNOWN": ("IRRIGATION_BLOCKED_WATER_UNKNOWN", "Irrigation blocked: the reservoir state is uncalibrated or unavailable."),
    "IRRIGATION_BLOCKED_PUMP_NOT_COMMISSIONED": ("IRRIGATION_BLOCKED_PUMP_NOT_COMMISSIONED", "Irrigation blocked: the pump has not been commissioned."),
    "IRRIGATION_BLOCKED_ALREADY_ACTIVE": ("IRRIGATION_BLOCKED_ALREADY_ACTIVE", "Irrigation blocked: a watering session is already running."),
    "IRRIGATION_BLOCKED_COOLDOWN": ("IRRIGATION_BLOCKED_COOLDOWN", "Irrigation blocked: the post-session lockout is still active."),
    "IRRIGATION_BLOCKED_LOCKOUT": ("IRRIGATION_BLOCKED_LOCKOUT", "Irrigation blocked: repeated watering produced no moisture rise, so the controller is locked out."),
    "IRRIGATION_BLOCKED_BOOT_GUARD": ("IRRIGATION_BLOCKED_BOOT_GUARD", "Irrigation blocked: the controller is still in its post-boot guard."),
    "LIGHTS_AUTO_DARK": ("LIGHTS_AUTO_DARK", "It is dark. Streetlights switched on."),
    "LIGHTS_AUTO_BRIGHT": ("LIGHTS_AUTO_BRIGHT", "It is bright. Streetlights are off."),
    "LIGHTS_AUTO_UNKNOWN": ("LIGHTS_AUTO_UNKNOWN", "The light sensor is not ready, so the streetlights stay off."),
    "LIGHTS_MANUAL_ON": ("LIGHTS_MANUAL_ON", "Streetlights switched on manually."),
    "LIGHTS_MANUAL_OFF": ("LIGHTS_MANUAL_OFF", "Streetlights switched off manually."),
    "LIGHTS_NOT_INSTALLED": ("LIGHTS_NOT_INSTALLED", "Streetlights are not installed in this build."),
    "WASTE_UNKNOWN_CATEGORY": ("WASTE_UNKNOWN_CATEGORY", "Unknown waste category. No category indicator was activated."),
    "DUPLICATE_COMMAND": ("DUPLICATE_COMMAND", "This command was already processed. No second action was taken."),
    "COMMAND_INVALID": ("COMMAND_INVALID", "The command type or parameters were not recognised."),
    "CONFIG_SAVED": ("CONFIG_SAVED", "Configuration saved and applied."),
}


def reason(code: str) -> tuple[str, str]:
    return REASONS.get(code, ("COMMAND_INVALID", "The command was not recognised."))


def default_config() -> dict[str, Any]:
    bins = []
    for bin_id in BIN_IDS:
        bins.append(
            {
                "id": bin_id,
                "installed": True,
                "empty_cm": 60,
                "full_cm": 12,
                "near_full_pct": 75,
                "full_pct": 90,
                "median_samples": 5,
                "confirm_readings": 3,
                "timeout_us": 30000,
                "blind_zone_cm": 3,
                "max_range_cm": 400,
                "max_age_ms": 3000,
            }
        )
    return {
        "revision": 1,
        "soil": {
            "dry_raw": 2800,
            "wet_raw": 1100,
            "min_span_raw": 400,
            "samples": 9,
            "max_age_ms": 5000,
            "calibrated": True,
        },
        "reservoir": {
            "wet_threshold_mv": 1200,
            "dry_threshold_mv": 2400,
            "confirm_readings": 3,
            "max_age_ms": 5000,
            "calibrated": True,
        },
        "light": {
            "installed": True,
            "sensor_fitted": True,
            "output_type": "analog",
            "analog_bright_high": False,
            "digital_dark_when_high": True,
            "dark_threshold": 1600,
            "bright_threshold": 2400,
            "stable_ms": 2000,
            "max_age_ms": 5000,
        },
        "bins": bins,
        "irrigation": {
            "auto_enabled": True,
            "pump_enabled": True,
            "dry_start_pct": 35,
            "stop_pct": 55,
            "dry_confirm_ms": 6000,
            "pulse_ms": 4000,
            "max_pulse_ms": 4000,
            "soak_ms": 8000,
            "max_cumulative_ms": 12000,
            "max_pulses": 3,
            "cooldown_ms": 20000,
            "link_timeout_ms": 30000,
        },
        "waste": {"indicate_ms": 8000},
    }


class SimulatorError(Exception):
    def __init__(self, status: int, payload: dict[str, Any]):
        super().__init__(payload.get("error", {}).get("message", "simulator error"))
        self.status = status
        self.payload = payload


class SimulatedDevice:
    """A simulated ESP32 that speaks the same protocol as the firmware.

    It is used for development, for Demo mode, and for tests.  It never opens a
    GPIO and never claims physical verification.  The safety rules mirror the
    firmware's intent, though the firmware remains authoritative on hardware.
    """

    def __init__(self, *, demo: bool = False, accelerated: bool = False):
        self.demo = demo
        self.accelerated = accelerated
        self._lock = threading.RLock()
        self.boot_id = ("demo-" if demo else "sim-") + secrets.token_hex(4)
        self.device_id = "village-simulator" if not demo else "village-demo"
        self._real_last = time.monotonic()
        self.now_ms = 0
        self.sample_seq = 0
        self.config = default_config()
        self.soil_pct = 28.0
        self.reservoir = "available"
        self.light = "dark"
        self.bins = {"organic": 35.0, "plastic": 58.0, "paper": 82.0}
        self.sensor_fault: str | None = None
        self.pump_enabled = True
        self.auto_enabled = True
        self.state = "idle"
        self.session = "none"
        self.pulses = 0
        self.cumulative_ms = 0
        self.pulse_started = 0
        self.pulse_len = 0
        self.soak_started = 0
        self.cooldown_until = 0
        self.boot_guard_until = 5000
        self.dry_since: int | None = None
        self.failure_lockout = False
        self.last_session: dict[str, Any] | None = None
        self.light_mode = "auto"
        self.waste_category: str | None = None
        self.waste_until = 0
        self.commands: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []
        self._add_event(*reason("IDLE_BOOT"))
        self._apply_config_flags()

    # ------------------------------------------------------------------
    def _apply_config_flags(self) -> None:
        irr = self.config["irrigation"]
        self.pump_enabled = bool(irr.get("pump_enabled", True))
        self.auto_enabled = bool(irr.get("auto_enabled", True))

    def _add_event(self, code: str, text: str) -> None:
        if self.events and self.events[-1]["code"] == code:
            return
        self.events.append({"at_uptime_ms": self.now_ms, "code": code, "text": text})
        self.events = self.events[-12:]

    def advance(self, delta_ms: int | None = None) -> None:
        with self._lock:
            if delta_ms is None:
                real = time.monotonic()
                delta = max(0, int((real - self._real_last) * 1000))
                self._real_last = real
            else:
                delta = max(0, int(delta_ms))
            if delta <= 0:
                return
            self.now_ms += delta
            self.sample_seq += 1
            self._step(delta)

    def _step(self, dt: int) -> None:
        if self.state == "pumping":
            self.soil_pct = min(72.0, self.soil_pct + dt * 0.0045)
            if self.now_ms - self.pulse_started >= self.pulse_len:
                self.cumulative_ms += self.now_ms - self.pulse_started
                self.state = "soaking"
                self.soak_started = self.now_ms
                self._add_event(*reason("IRRIGATION_SOAKING"))
                if self.cumulative_ms >= self.config["irrigation"]["max_cumulative_ms"]:
                    self.failure_lockout = True
                    self._stop("IRRIGATION_STOPPED_MAX_RUNTIME", 1_800_000)
        elif self.state == "soaking":
            if self.now_ms - self.soak_started >= self.config["irrigation"]["soak_ms"]:
                irr = self.config["irrigation"]
                if self.soil_pct >= irr["stop_pct"]:
                    self._stop("IRRIGATION_COMPLETE_MOISTURE", irr["cooldown_ms"])
                elif self.pulses >= irr["max_pulses"]:
                    self.failure_lockout = True
                    self._stop("IRRIGATION_STOPPED_MAX_PULSES", 1_800_000)
                elif self.cumulative_ms >= irr["max_cumulative_ms"]:
                    self.failure_lockout = True
                    self._stop("IRRIGATION_STOPPED_MAX_RUNTIME", 1_800_000)
                else:
                    self._start_pulse(manual=False)
        else:
            # Slow drying while idle.  The demo should not drift too fast.
            self.soil_pct = max(0.0, self.soil_pct - dt * 0.000015)
            if self.failure_lockout and self.soil_pct >= self.config["irrigation"]["stop_pct"]:
                self.failure_lockout = False
            if (
                self.auto_enabled
                and self.pump_enabled
                and not self.failure_lockout
                and self.reservoir == "available"
                and self.sensor_fault not in {"soil", "reservoir"}
                and self.soil_pct <= self.config["irrigation"]["dry_start_pct"]
                and self.now_ms >= self.boot_guard_until
                and self.now_ms >= self.cooldown_until
            ):
                if self.dry_since is None:
                    self.dry_since = self.now_ms
                    self._add_event(*reason("IDLE_SOIL_DRY_WAITING"))
                elif self.now_ms - self.dry_since >= self.config["irrigation"]["dry_confirm_ms"]:
                    self._start_session("auto")
            else:
                self.dry_since = None

    # ------------------------------------------------------------------
    def _start_session(self, kind: str) -> None:
        self.session = kind
        self.pulses = 0
        self.cumulative_ms = 0
        self.failure_lockout = False
        self.dry_since = None
        self._start_pulse(manual=(kind == "manual"))

    def _start_pulse(self, *, manual: bool) -> None:
        irr = self.config["irrigation"]
        if self.pulses >= irr["max_pulses"] or self.cumulative_ms >= irr["max_cumulative_ms"]:
            self.failure_lockout = True
            self._stop("IRRIGATION_STOPPED_MAX_PULSES", 1_800_000)
            return
        remaining = irr["max_cumulative_ms"] - self.cumulative_ms
        self.pulse_len = min(irr["pulse_ms"], irr["max_pulse_ms"], remaining)
        if self.pulse_len < 500:
            self.failure_lockout = True
            self._stop("IRRIGATION_STOPPED_MAX_RUNTIME", 1_800_000)
            return
        self.pulse_started = self.now_ms
        self.state = "pumping"
        self.pulses += 1
        self._add_event(*(reason("IRRIGATION_STARTED") if self.pulses == 1 else reason("IRRIGATION_PULSE")))

    def _stop(self, code: str, cooldown_ms: int) -> None:
        if self.state == "pumping":
            self.cumulative_ms += self.now_ms - self.pulse_started
        self.state = "idle"
        self.last_session = {
            "kind": self.session,
            "reason_code": reason(code)[0],
            "reason": reason(code)[1],
            "at_uptime_ms": self.now_ms,
            "pulses": self.pulses,
            "pumped_ms": self.cumulative_ms,
        }
        self.session = "none"
        self.cooldown_until = self.now_ms + cooldown_ms
        self.dry_since = None
        self._add_event(*reason(code))

    # ------------------------------------------------------------------
    def _soil(self) -> dict[str, Any]:
        irr = self.config["irrigation"]
        if self.sensor_fault == "soil":
            return {
                "valid": False,
                "calibrated": True,
                "raw": 0,
                "percent": None,
                "state": "unavailable",
                "age_ms": 9999,
                "fault": "simulated sensor fault",
            }
        state = "dry" if self.soil_pct <= irr["dry_start_pct"] else (
            "wet" if self.soil_pct >= irr["stop_pct"] else "adequate"
        )
        return {
            "valid": True,
            "calibrated": True,
            "raw": int(2800 - self.soil_pct * 17),
            "percent": round(self.soil_pct, 1),
            "state": state,
            "age_ms": 120,
            "fault": None,
        }

    def _reservoir(self) -> dict[str, Any]:
        if self.sensor_fault == "reservoir":
            return {
                "valid": False,
                "calibrated": True,
                "state": "unavailable",
                "millivolts": 0,
                "conductive": False,
                "age_ms": 9999,
                "fault": "simulated sensor fault",
            }
        available = self.reservoir == "available"
        return {
            "valid": True,
            "calibrated": True,
            "state": "available" if available else "low",
            "millivolts": 620 if available else 2810,
            "conductive": available,
            "age_ms": 800,
            "fault": None,
        }

    def _light(self) -> dict[str, Any]:
        if self.sensor_fault == "light":
            return {
                "valid": False,
                "raw": 0,
                "brightness": "unknown",
                "output_type": "analog",
                "age_ms": 9999,
                "fault": "simulated sensor fault",
            }
        return {
            "valid": True,
            "raw": 3200 if self.light == "dark" else 900,
            "brightness": self.light,
            "output_type": "analog",
            "age_ms": 200,
            "fault": None,
        }

    def _bins(self) -> list[dict[str, Any]]:
        result = []
        for item in self.config["bins"]:
            bin_id = item["id"]
            if self.sensor_fault == f"bin_{bin_id}":
                result.append(
                    {
                        "id": bin_id,
                        "installed": True,
                        "valid": False,
                        "distance_cm": None,
                        "fill_pct_estimate": None,
                        "state": "unavailable",
                        "age_ms": 9999,
                        "fault": "simulated echo timeout",
                        "near_blind_zone": False,
                    }
                )
                continue
            fill = max(0.0, min(100.0, self.bins.get(bin_id, 0.0)))
            distance = item["empty_cm"] - (fill / 100.0) * (item["empty_cm"] - item["full_cm"])
            state = "full" if fill >= item["full_pct"] else (
                "nearly_full" if fill >= item["near_full_pct"] else "available"
            )
            result.append(
                {
                    "id": bin_id,
                    "installed": True,
                    "valid": True,
                    "distance_cm": round(distance, 1),
                    "fill_pct_estimate": round(fill, 1),
                    "state": state,
                    "age_ms": 300,
                    "fault": None,
                    "near_blind_zone": False,
                }
            )
        return result

    def _irrigation_reason(self) -> tuple[str, str]:
        if self.state == "pumping":
            return reason("IRRIGATION_PULSE")
        if self.state == "soaking":
            return reason("IRRIGATION_SOAKING")
        if self.failure_lockout:
            return reason("IDLE_FAILURE_LOCKOUT")
        if not self.pump_enabled:
            return reason("IDLE_PUMP_NOT_COMMISSIONED")
        if self.now_ms < self.boot_guard_until:
            return reason("IDLE_BOOT")
        if self.now_ms < self.cooldown_until:
            return reason("IDLE_COOLDOWN")
        if self.sensor_fault == "soil":
            return reason("IDLE_SENSOR_INVALID")
        if self.sensor_fault == "reservoir":
            return reason("IDLE_WATER_UNKNOWN")
        if self.reservoir != "available":
            return reason("IDLE_WATER_LOW")
        if self.soil_pct > self.config["irrigation"]["dry_start_pct"]:
            return reason("IDLE_SOIL_ADEQUATE")
        if not self.auto_enabled:
            return reason("IDLE_AUTO_OFF")
        return reason("IDLE_SOIL_DRY_WAITING")

    def _irrigation(self) -> dict[str, Any]:
        code, text = self._irrigation_reason()
        return {
            "auto_enabled": self.auto_enabled,
            "pump_enabled": self.pump_enabled,
            "commissioned": True,
            "failure_lockout": self.failure_lockout,
            "state": self.state,
            "session": self.session,
            "pulses_done": self.pulses,
            "pulse_limit": self.config["irrigation"]["max_pulses"],
            "cumulative_pump_ms": self.cumulative_ms,
            "max_cumulative_pump_ms": self.config["irrigation"]["max_cumulative_ms"],
            "cooldown_remaining_ms": max(0, self.cooldown_until - self.now_ms),
            "session_elapsed_ms": max(0, self.now_ms - self.pulse_started) if self.state != "idle" else 0,
            "pulse_remaining_ms": max(0, self.pulse_len - (self.now_ms - self.pulse_started)) if self.state == "pumping" else 0,
            "soak_remaining_ms": max(0, self.config["irrigation"]["soak_ms"] - (self.now_ms - self.soak_started)) if self.state == "soaking" else 0,
            "reason_code": code,
            "reason": text,
            "last_session": self.last_session,
        }

    def _lights(self) -> dict[str, Any]:
        if not self.config["light"]["installed"]:
            on, code = False, "LIGHTS_NOT_INSTALLED"
        elif self.light_mode == "manual_on":
            on, code = True, "LIGHTS_MANUAL_ON"
        elif self.light_mode == "manual_off":
            on, code = False, "LIGHTS_MANUAL_OFF"
        elif self.sensor_fault == "light":
            on, code = False, "LIGHTS_AUTO_UNKNOWN"
        elif self.light == "dark":
            on, code = True, "LIGHTS_AUTO_DARK"
        else:
            on, code = False, "LIGHTS_AUTO_BRIGHT"
        return {
            "mode": self.light_mode,
            "commanded": on,
            "led_count": 5,
            "installed": self.config["light"]["installed"],
            "feedback": "none",
            "reason_code": reason(code)[0],
            "reason": reason(code)[1],
            "brightness": self._light()["brightness"],
        }

    def _waste(self) -> dict[str, Any]:
        active = self.waste_category is not None and self.now_ms < self.waste_until
        return {
            "category": self.waste_category if active else None,
            "active": active,
            "remaining_ms": max(0, self.waste_until - self.now_ms) if active else 0,
        }

    def status(self) -> dict[str, Any]:
        with self._lock:
            self.advance()
            irrigation = self._irrigation()
            lights = self._lights()
            waste = self._waste()
            return {
                "protocol_version": PROTOCOL_VERSION,
                "device_id": self.device_id,
                "boot_id": self.boot_id,
                "firmware": "0.1.0-sim",
                "uptime_ms": self.now_ms,
                "sample_seq": self.sample_seq,
                "config_revision": self.config["revision"],
                "sensors": {
                    "soil": self._soil(),
                    "reservoir": self._reservoir(),
                    "light": self._light(),
                    "bins": self._bins(),
                },
                "actuators": {
                    "pump": {
                        "commanded": self.state == "pumping",
                        "commissioned": True,
                        "enabled": self.pump_enabled,
                        "feedback": "none",
                    },
                    "streetlights": {
                        "mode": lights["mode"],
                        "commanded": lights["commanded"],
                        "led_count": 5,
                        "installed": lights["installed"],
                        "feedback": "none",
                    },
                    "waste_indicator": waste,
                },
                "irrigation": irrigation,
                "faults": self._faults(),
                "recent_events": list(self.events),
            }

    def _faults(self) -> list[str]:
        faults = []
        if self.sensor_fault == "soil":
            faults.append("soil: simulated sensor fault")
        if self.sensor_fault == "reservoir":
            faults.append("reservoir: simulated sensor fault")
        if self.sensor_fault == "light":
            faults.append("light: simulated sensor fault")
        for bin_id in BIN_IDS:
            if self.sensor_fault == f"bin_{bin_id}":
                faults.append(f"bin {bin_id}: simulated echo timeout")
        return faults

    # ------------------------------------------------------------------
    def health(self) -> dict[str, Any]:
        return {
            "protocol_version": PROTOCOL_VERSION,
            "device_id": self.device_id,
            "boot_id": self.boot_id,
            "firmware": "0.1.0-sim",
            "uptime_ms": self.now_ms,
            "board": {
                "profile": "simulator",
                "module": "none",
                "description": "Local protocol simulator (no physical outputs)",
                "chip_model": "simulated",
                "revision": 0,
                "flash_size": 0,
                "mac": "00:00:00:00:00:00",
                "pin_map_version": "simulator",
            },
            "wifi": {"mode": "sim", "ssid": "loopback", "ip": "127.0.0.1", "rssi": 0, "connected": True},
            "pump_commissioned": True,
            "free_heap": 0,
            "pin_map": {},
        }

    def get_config(self) -> dict[str, Any]:
        with self._lock:
            return {
                "protocol_version": PROTOCOL_VERSION,
                "device_id": self.device_id,
                "config_revision": self.config["revision"],
                "config": copy.deepcopy(self.config),
            }

    def put_config(self, expected_revision: int, config: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            if expected_revision != self.config["revision"]:
                raise SimulatorError(
                    409,
                    {
                        "error": {
                            "code": "CONFIG_REVISION_CONFLICT",
                            "message": "the configuration changed since it was read; reload it before saving",
                            "current_revision": self.config["revision"],
                        }
                    },
                )
            merged = copy.deepcopy(self.config)
            for section, values in config.items():
                if section == "revision":
                    continue
                if isinstance(values, dict) and isinstance(merged.get(section), dict):
                    merged[section].update(values)
                elif section == "bins" and isinstance(values, list) and len(values) == 3:
                    for i, item in enumerate(values):
                        merged["bins"][i].update(item)
                else:
                    merged[section] = values
            self._validate(merged)
            merged["revision"] = self.config["revision"] + 1
            self.config = merged
            self._apply_config_flags()
            if not self.pump_enabled and self.state != "idle":
                self._stop("IRRIGATION_STOPPED_PUMP_DISABLED", 0)
            self._add_event(*reason("CONFIG_SAVED"))
            return self.get_config()

    def _validate(self, config: dict[str, Any]) -> None:
        def fail(field: str, message: str) -> None:
            raise SimulatorError(
                400,
                {"error": {"code": "CONFIG_INVALID", "message": message, "field": field}},
            )

        soil = config["soil"]
        if not (0 <= soil["dry_raw"] <= 4095 and 0 <= soil["wet_raw"] <= 4095):
            fail("soil.dry_raw/wet_raw", "Raw calibration endpoints must be 0..4095.")
        if abs(int(soil["dry_raw"]) - int(soil["wet_raw"])) < int(soil.get("min_span_raw", 400)):
            fail("soil.dry_raw/wet_raw", "Dry and wet endpoints are too close or identical.")
        irr = config["irrigation"]
        if not (5 <= irr["dry_start_pct"] <= 80):
            fail("irrigation.dry_start_pct", "Dry-start threshold must be 5..80 %.")
        if irr["stop_pct"] <= irr["dry_start_pct"] or irr["stop_pct"] > 95:
            fail("irrigation.stop_pct", "Stop threshold must be above dry-start and at most 95 %.")
        if irr["pulse_ms"] > irr["max_pulse_ms"]:
            fail("irrigation.max_pulse_ms", "Maximum pulse must be at least the pulse length.")
        if irr["max_cumulative_ms"] < irr["pulse_ms"]:
            fail("irrigation.max_cumulative_ms", "Maximum cumulative pump time must cover one pulse.")
        res = config["reservoir"]
        if res["dry_threshold_mv"] - res["wet_threshold_mv"] < 100:
            fail("reservoir.wet/dry", "The dry threshold must be at least 100 mV above the wet threshold.")
        for i, item in enumerate(config["bins"]):
            if item["full_cm"] + 2 > item["empty_cm"]:
                fail(f"bins[{i}].full_cm", "Full distance must be below the empty distance.")

    # ------------------------------------------------------------------
    def command(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self.advance()
            command_id = str(payload.get("command_id", ""))
            command_type = str(payload.get("type", ""))
            if not command_id:
                raise SimulatorError(400, {"error": {"code": "COMMAND_ID_REQUIRED", "message": "command_id is required"}})
            if command_id in self.commands:
                prior = copy.deepcopy(self.commands[command_id])
                prior["result"] = "DUPLICATE"
                self._add_event(*reason("DUPLICATE_COMMAND"))
                return prior

            result = "REJECTED"
            code, text = reason("COMMAND_INVALID")

            if command_type in {"LIGHTS_ON", "LIGHTS_OFF", "LIGHTS_AUTO"}:
                if command_type == "LIGHTS_ON":
                    self.light_mode = "manual_on"
                elif command_type == "LIGHTS_OFF":
                    self.light_mode = "manual_off"
                else:
                    self.light_mode = "auto"
                lights = self._lights()
                result = "ACCEPTED" if lights["installed"] else "REJECTED"
                code, text = lights["reason_code"], lights["reason"]
            elif command_type == "IRRIGATION_REQUEST":
                result, code, text = self._request_irrigation("manual")
            elif command_type == "IRRIGATION_STOP":
                if self.state == "idle":
                    code, text = reason("IDLE_ALREADY_STOPPED")
                else:
                    self._stop("IRRIGATION_STOPPED_USER", 1000)
                    code, text = reason("IRRIGATION_STOPPED_USER")
                result = "ACCEPTED"
            elif command_type == "INDICATE_WASTE":
                category = str(payload.get("parameters", {}).get("category", ""))
                if category not in CATEGORY_REASONS:
                    code, text = reason("WASTE_UNKNOWN_CATEGORY")
                else:
                    duration = int(payload.get("parameters", {}).get("duration_ms", 0) or 8000)
                    duration = max(1000, min(duration, int(self.config["waste"]["indicate_ms"])))
                    self.waste_category = category
                    self.waste_until = self.now_ms + duration
                    code, text = CATEGORY_REASONS[category]
                    result = "ACCEPTED"
            else:
                code, text = reason("COMMAND_INVALID")

            self._add_event(code, text)
            ack = {
                "protocol_version": PROTOCOL_VERSION,
                "command_id": command_id,
                "type": command_type,
                "result": result,
                "reason_code": code,
                "reason": text,
                "at_uptime_ms": self.now_ms,
                "irrigation": {
                    "state": self.state,
                    "pump_on": self.state == "pumping",
                    "pulses_done": self.pulses,
                    "pulse_limit": self.config["irrigation"]["max_pulses"],
                },
            }
            self.commands[command_id] = copy.deepcopy(ack)
            if len(self.commands) > 100:
                self.commands.pop(next(iter(self.commands)))
            return ack

    def _request_irrigation(self, kind: str) -> tuple[str, str, str]:
        irr = self.config["irrigation"]
        if self.state != "idle":
            return "REJECTED", *reason("IRRIGATION_BLOCKED_ALREADY_ACTIVE")
        if not self.pump_enabled:
            return "REJECTED", *reason("IRRIGATION_BLOCKED_PUMP_NOT_COMMISSIONED")
        if self.now_ms < self.boot_guard_until:
            return "REJECTED", *reason("IRRIGATION_BLOCKED_BOOT_GUARD")
        if self.failure_lockout:
            return "REJECTED", *reason("IRRIGATION_BLOCKED_LOCKOUT")
        if self.now_ms < self.cooldown_until:
            return "REJECTED", *reason("IRRIGATION_BLOCKED_COOLDOWN")
        if self.sensor_fault == "soil":
            return "REJECTED", *reason("IRRIGATION_BLOCKED_SENSOR_INVALID")
        if self.sensor_fault == "reservoir":
            return "REJECTED", *reason("IRRIGATION_BLOCKED_WATER_UNKNOWN")
        if self.reservoir != "available":
            return "REJECTED", *reason("IRRIGATION_BLOCKED_WATER_LOW")
        if self.soil_pct > irr["dry_start_pct"]:
            return "REJECTED", *reason("IRRIGATION_BLOCKED_SOIL_WET")
        self._start_session(kind)
        return "ACCEPTED", *reason("IRRIGATION_STARTED")

    # ------------------------------------------------------------------
    def scenario(self, values: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self.advance()
            if values.get("soil_pct") is not None:
                self.soil_pct = float(values["soil_pct"])
            if values.get("reservoir") is not None:
                self.reservoir = values["reservoir"]
                if self.reservoir == "low" and self.state != "idle":
                    self._stop("IRRIGATION_STOPPED_LOW_WATER", 30000)
            if values.get("light") is not None:
                self.light = values["light"]
            if values.get("bins") is not None:
                for bin_id, fill in values["bins"].items():
                    if bin_id in self.bins:
                        self.bins[bin_id] = float(fill)
            if "sensor_fault" in values:
                self.sensor_fault = values["sensor_fault"] or None
            if values.get("pump_enabled") is not None:
                self.pump_enabled = bool(values["pump_enabled"])
                self.config["irrigation"]["pump_enabled"] = self.pump_enabled
                if not self.pump_enabled and self.state != "idle":
                    self._stop("IRRIGATION_STOPPED_PUMP_DISABLED", 0)
            if values.get("auto_enabled") is not None:
                self.auto_enabled = bool(values["auto_enabled"])
                self.config["irrigation"]["auto_enabled"] = self.auto_enabled
            self._add_event("DEMO_SCENARIO", "Demo scenario changed (simulated data, no physical outputs).")
            return self.status()

    def reset(self) -> dict[str, Any]:
        with self._lock:
            self.soil_pct = 28.0
            self.reservoir = "available"
            self.light = "dark"
            self.bins = {"organic": 35.0, "plastic": 58.0, "paper": 82.0}
            self.sensor_fault = None
            self.pump_enabled = True
            self.auto_enabled = True
            self.state = "idle"
            self.session = "none"
            self.pulses = 0
            self.cumulative_ms = 0
            self.cooldown_until = 0
            self.boot_guard_until = self.now_ms + 5000
            self.dry_since = None
            self.failure_lockout = False
            self.last_session = None
            self.light_mode = "auto"
            self.waste_category = None
            self.waste_until = 0
            self.commands.clear()
            self.events.clear()
            self._add_event(*reason("IDLE_BOOT"))
            return self.status()
