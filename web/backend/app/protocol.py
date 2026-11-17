from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Mode = Literal["live", "demo"]

ALLOWED_COMMANDS = {
    "LIGHTS_ON",
    "LIGHTS_OFF",
    "LIGHTS_AUTO",
    "IRRIGATION_REQUEST",
    "IRRIGATION_STOP",
    # The pump's own switch, like the lights': the rules, held on, held off.
    "PUMP_ON",
    "PUMP_OFF",
    "PUMP_AUTO",
    "INDICATE_WASTE",
    # Bench control from Setup → Test outputs: TEST_MODE is the page's master
    # switch and TEST_OUTPUT drives one pin.  The firmware refuses an output
    # while the master switch is off, so this route only keeps the wire honest.
    "TEST_MODE",
    "TEST_OUTPUT",
}

WASTE_CATEGORIES = {"organic", "plastic", "paper"}

TEST_OUTPUTS = {"pump", "led_organic", "led_plastic", "led_paper", "streetlights"}


class CommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Mode = "live"
    type: str = Field(min_length=1, max_length=40)
    parameters: dict[str, Any] = Field(default_factory=dict)
    request_id: str = Field(min_length=8, max_length=80)
    source: Literal["browser", "voice", "system"] = "browser"


class CommandError(BaseModel):
    code: str
    message: str


class CommandResponse(BaseModel):
    confirmed: bool
    mode: Mode
    physical: bool
    ack: dict[str, Any] | None = None
    error: CommandError | None = None
    duplicate_request: bool = False
    state: dict[str, Any] | None = None


class ConfigPutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Mode = "live"
    config_revision: int = Field(ge=1)
    config: dict[str, Any]


class SoilCalibrationRequest(BaseModel):
    mode: Mode = "live"
    dry_raw: int = Field(ge=0, le=4095)
    wet_raw: int = Field(ge=0, le=4095)


class ReservoirCalibrationRequest(BaseModel):
    mode: Mode = "live"
    dry_threshold_mv: int = Field(ge=50, le=3200)
    wet_threshold_mv: int = Field(ge=50, le=3200)


class RecognitionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Mode = "live"
    category: str = Field(min_length=3, max_length=20)
    confidence: float = Field(ge=0.0, le=1.0)
    model: str = Field(default="teachable-machine", max_length=80)
    request_id: str = Field(min_length=8, max_length=80)
    profile_id: int | None = None
    # What the model actually named, and its best few guesses.  A recycler is
    # posted as "other", so without this a session cannot be reviewed afterwards:
    # "identified wrongly" would have no record of what was said.
    material: str | None = Field(default=None, max_length=40)
    top: list[dict[str, Any]] | None = None


class DisposalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Mode = "live"
    recognition_id: int = Field(ge=1)
    profile_id: int | None = None
    note: str = Field(default="", max_length=200)


class ProfileCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=60)
    house_no: str = Field(min_length=1, max_length=20)
    avatar: str = Field(default="", max_length=8)


class AppSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: Literal["en", "ml", "hi"] | None = None
    tts_enabled: bool | None = None
    # Which English voice Sara uses: her own local neural voice (American), or
    # this computer's English (India) voice.  Stored with the other settings so
    # it survives a browser reset, a new laptop and any ESP32 reflash
    # (2026-11-17).
    english_voice: Literal["sara", "device-india"] | None = None
    waste_model_path: str | None = Field(default=None, max_length=200)
    camera_device_id: str | None = Field(default=None, max_length=200)
    waste_confidence: float | None = Field(default=None, ge=0.3, le=0.99)
    waste_stability_frames: int | None = Field(default=None, ge=2, le=20)
    waste_cooldown_ms: int | None = Field(default=None, ge=1000, le=60000)
    demo_mode: bool | None = None


class ScenarioRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    soil_pct: float | None = Field(default=None, ge=0, le=100)
    reservoir: Literal["available", "low"] | None = None
    light: Literal["bright", "dark"] | None = None
    # The ambient-light reading the demo should report, on the firmware's own
    # metric scale (brightness = 4095 - raw).  2100/2500 are the thresholds the
    # exhibit's room was calibrated to, so a slider on this scale really does
    # exercise Auto mode rather than pretending to.
    light_metric: int | None = Field(default=None, ge=0, le=4095)
    # A lab switch for the pump, the same idea as the streetlights' manual On.
    # Simulation only: the firmware has no manual pump mode, and its gates
    # (commissioning, tank, soil) are exactly what this bypasses for a demo.
    pump_manual: Literal["auto", "on", "off"] | None = None
    # The streetlights' own switch, so a preset can say "night time + Auto".
    lights_mode: Literal["auto", "manual_on", "manual_off"] | None = None
    # The lab's two light sources, 0..1: the lamp on the solar panel and the
    # windmill's speed.  Both are simulated inputs, never measurements.
    solar_light: float | None = Field(default=None, ge=0, le=1)
    wind_speed: float | None = Field(default=None, ge=0, le=1)
    sensor_fault: str | None = Field(default=None, max_length=40)
    pump_enabled: bool | None = None
    auto_enabled: bool | None = None


class SpeakRequest(BaseModel):
    """Text to read aloud with the local neural voice."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=1200)
    language: Literal["en", "ml", "hi"] = "en"
    length_scale: float = Field(default=1.0, ge=0.5, le=2.0)
    # English only: "sara" (American, the same speaker as hi/ml) or "indian"
    # (the neural Indian voice).  Ignored for the other languages.
    voice: Literal["sara", "indian"] | None = None


class VoiceInterpretRequest(BaseModel):
    """A typed request, parsed by the same rules as a spoken transcript."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=300)
    language: Literal["en", "ml", "hi"] = "en"
    source: Literal["typed", "voice"] = "typed"


class LoginRequest(BaseModel):
    """The one account's credentials."""

    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=1, max_length=200)


class WasteCorrectionRequest(BaseModel):
    """What the operator says an item really was, for one judged crop.

    `file` is the name the classify response returned, so the correction points
    at the exact picture the model was shown -- never at "the most recent one".
    """

    model_config = ConfigDict(extra="forbid")

    file: str = Field(min_length=1, max_length=200)
    actual: str = Field(min_length=1, max_length=20)


class WasteClassifyRequest(BaseModel):
    """A 224x224 frame (data URL or bare base64) to classify with ResNet50."""

    model_config = ConfigDict(extra="forbid")

    image: str = Field(min_length=32, max_length=2_000_000)
