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
    "INDICATE_WASTE",
}

WASTE_CATEGORIES = {"organic", "plastic", "paper"}


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
    bins: dict[str, float] | None = None
    sensor_fault: str | None = Field(default=None, max_length=40)
    pump_enabled: bool | None = None
    auto_enabled: bool | None = None


class SpeakRequest(BaseModel):
    """Text to read aloud with the local neural voice."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=1200)
    language: Literal["en", "ml", "hi"] = "en"
    length_scale: float = Field(default=1.0, ge=0.5, le=2.0)
