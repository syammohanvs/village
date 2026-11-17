"""The simulation lab's own arithmetic and its promise.

Everything here drives `SimulatedDevice` directly: it is the engine behind the
sliders, the presets and the sample items, and the rule that matters is that
none of it can reach the board.  A separate test (`test_api.py`) covers the
routes; this one covers what the lab computes and explains (2026-11-17).
"""

from __future__ import annotations

from app.simulator import SimulatedDevice, default_config


def status(device: SimulatedDevice) -> dict:
    with device._lock:
        device.advance(0)
        return device.status()


# --------------------------------------------------------------------- solar ---
def test_solar_power_is_volts_times_milliamps_at_every_light_level() -> None:
    """The three numbers are one circuit, not three independent guesses."""
    for level in (0.0, 0.1, 0.35, 0.55, 0.8, 1.0):
        device = SimulatedDevice(demo=True)
        device.scenario({"solar_light": level})
        solar = status(device)["sensors"]["solar"]

        assert solar["junction_millivolts"] <= solar["millivolts"]
        assert round(solar["power_mw"], 9) == round(
            (solar["millivolts"] / 1000.0) * solar["current_ma"], 9
        )
        # Below the LED's forward voltage nothing conducts at all.
        if solar["millivolts"] <= 1800:
            assert solar["current_ma"] == 0
            assert solar["power_mw"] == 0


def test_more_light_on_the_panel_is_more_voltage_and_more_power() -> None:
    device = SimulatedDevice(demo=True)
    readings = []
    for level in (0.0, 0.25, 0.5, 0.75, 1.0):
        device.scenario({"solar_light": level})
        solar = status(device)["sensors"]["solar"]
        readings.append((solar["millivolts"], solar["power_mw"]))
    assert readings == sorted(readings), readings


# ---------------------------------------------------------------------- wind ---
def test_wind_reports_voltage_only_and_follows_its_slider() -> None:
    device = SimulatedDevice(demo=True)
    device.scenario({"wind_speed": 0.0})
    still = status(device)["sensors"]["wind"]
    assert still["millivolts"] == 0
    assert still["generating"] is False
    # No current or power: the board has no second input for them, and inventing
    # one here would be the exact claim the card refuses to make.
    assert "current_ma" not in still
    assert "power_mw" not in still

    device.scenario({"wind_speed": 1.0})
    fast = status(device)["sensors"]["wind"]
    assert fast["millivolts"] > still["millivolts"]
    assert fast["generating"] is True
    assert fast["speed"] == 1.0


# -------------------------------------------------------------------- watering ---
def test_dry_soil_with_water_available_starts_automatic_watering() -> None:
    device = SimulatedDevice(demo=True)
    device.scenario({"soil_pct": 20, "reservoir": "available", "pump_manual": "auto"})
    # Past the post-boot guard, then past the dry-confirmation window.
    device.advance(6000)
    device.advance(6100)
    irrigation = status(device)["irrigation"]
    assert irrigation["state"] == "pumping", irrigation["reason"]


def test_low_water_blocks_automatic_watering() -> None:
    device = SimulatedDevice(demo=True)
    device.scenario({"soil_pct": 20, "reservoir": "low", "pump_manual": "auto"})
    device.advance(6000)
    device.advance(20000)
    irrigation = status(device)["irrigation"]
    assert irrigation["state"] == "idle"
    assert "low" in irrigation["reason"].lower()


def test_a_manual_on_runs_the_pump_and_a_low_tank_stops_it_without_moving_the_switch() -> None:
    device = SimulatedDevice(demo=True)
    device.scenario({"soil_pct": 60, "reservoir": "available", "pump_manual": "on"})
    device.advance(1000)
    pump = status(device)["actuators"]["pump"]
    assert pump["commanded"] is True
    assert pump["mode"] == "on"

    # The switch stays where the operator put it; the tank is what stops it.
    device.scenario({"reservoir": "low"})
    device.advance(1000)
    pump = status(device)["actuators"]["pump"]
    assert pump["commanded"] is False
    assert pump["mode"] == "on", "the switch must not move by itself"

    device.scenario({"reservoir": "available"})
    device.advance(1000)
    assert status(device)["actuators"]["pump"]["commanded"] is True


def test_manual_off_holds_the_pump_stopped_even_on_dry_soil() -> None:
    device = SimulatedDevice(demo=True)
    device.scenario({"soil_pct": 20, "reservoir": "available", "pump_manual": "off"})
    device.advance(30000)
    irrigation = status(device)["irrigation"]
    assert irrigation["state"] == "idle"
    assert status(device)["actuators"]["pump"]["commanded"] is False


# --------------------------------------------------------------------- resets ---
def test_reset_restores_every_documented_default() -> None:
    device = SimulatedDevice(demo=True)
    device.scenario(
        {
            "soil_pct": 80,
            "reservoir": "low",
            "light_metric": 3000,
            "solar_light": 0.0,
            "wind_speed": 0.0,
            "pump_manual": "on",
            "lights_mode": "manual_off",
        }
    )
    device.reset()
    frame = status(device)
    assert frame["sensors"]["soil"]["percent"] == 28.0
    assert frame["sensors"]["reservoir"]["state"] == "available"
    assert frame["sensors"]["light"]["brightness"] == "dark"
    assert frame["sensors"]["solar"]["light"] == 0.55
    assert frame["sensors"]["wind"]["speed"] == 0.6
    assert frame["actuators"]["pump"]["mode"] == "auto"
    assert frame["actuators"]["streetlights"]["mode"] == "auto"
    assert frame["irrigation"]["state"] == "idle"


def test_the_default_config_is_untouched_by_the_lab() -> None:
    """The sliders are conditions, never settings: calibration must not move."""
    device = SimulatedDevice(demo=True)
    before = default_config()
    device.scenario({"solar_light": 0.1, "wind_speed": 0.2, "soil_pct": 10})
    device.reset()
    assert device.get_config()["config"] == before


# ---------------------------------------------------------------------- voice ---
def test_a_demo_answer_says_it_is_simulated() -> None:
    device = SimulatedDevice(demo=True)
    ack = device.command({"type": "LIGHTS_ON", "command_id": "demo-lights-1"})
    assert ack["result"] == "ACCEPTED"
    assert ack["reason"].startswith("Simulated: ")

    # The development simulator is not spoken to a visitor, so its own text is
    # left alone — only the demo answers are labelled.
    plain = SimulatedDevice(demo=False)
    plain_ack = plain.command({"type": "LIGHTS_ON", "command_id": "sim-lights-1"})
    assert not plain_ack["reason"].startswith("Simulated: ")
