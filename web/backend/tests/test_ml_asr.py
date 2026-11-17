"""The Malayalam speech model and the route that prefers it.

The model itself is ~950 MB and is not in git, so these tests never load it:
they pin the **rules** — when it counts as available, that the Malayalam route
uses it, and that a failure falls back to whisper-server instead of failing the
request (a missing model must never stop the exhibit from listening).
"""

from __future__ import annotations

import json
from dataclasses import replace

import pytest

from app import ml_asr
from app.config import Settings
from app.voice import VoiceError
from conftest import client_for, make_settings
from test_voice import silence_wav


def model_dir(tmp_path, *, weights: bool = True, config: bool = True):
    directory = tmp_path / "ml-asr"
    directory.mkdir(parents=True, exist_ok=True)
    if config:
        (directory / "config.json").write_text("{}")
    if weights:
        (directory / "model.safetensors").write_bytes(b"\0" * 16)
    return directory


def test_the_default_is_a_model_directory_beside_the_others(tmp_path):
    settings = make_settings(tmp_path)
    assert settings.ml_asr_dir.name == "ml-asr"
    assert settings.ml_asr_dir.parent.name == "whisper"


def test_a_usable_model_needs_its_config_and_weights(tmp_path):
    try:
        ml_asr.configure(model_dir(tmp_path))
        assert ml_asr.available() is True

        # Config but no weights: nothing to run.
        ml_asr.configure(model_dir(tmp_path / "a", weights=False))
        assert ml_asr.available() is False
        # Weights with no config: the processor cannot be built.
        ml_asr.configure(model_dir(tmp_path / "b", config=False))
        assert ml_asr.available() is False
        # No directory at all is the ordinary fresh-clone case.
        ml_asr.configure(tmp_path / "nowhere")
        assert ml_asr.available() is False
    finally:
        ml_asr.reset_for_tests()
        ml_asr.configure(None)


class NeverCalledVoice:
    """A whisper client that fails the test if the route asks it anything."""

    async def transcribe(self, data: bytes, language: str):
        raise AssertionError("whisper must not be used for Malayalam here")

    async def readiness(self):
        return {"enabled": True, "server_reachable": True}


@pytest.mark.asyncio
async def test_malayalam_is_read_by_its_own_model_first(tmp_path, monkeypatch):
    settings = replace(make_settings(tmp_path), ml_asr_dir=model_dir(tmp_path))
    monkeypatch.setattr(ml_asr, "available", lambda: True)
    monkeypatch.setattr(ml_asr, "transcribe", lambda data: "വിളക്കുകൾ ഓട്ടോ ചെയ്യുക")

    async with client_for(settings, voice=NeverCalledVoice()) as (client, _gateway, _app):
        response = await client.post(
            "/api/v1/voice/transcribe?mode=demo",
            files={"audio": ("a.wav", silence_wav(), "audio/wav")},
            data={"language": "ml"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["transcript"] == "വിളക്കുകൾ ഓട്ടോ ചെയ്യുക"
    assert body["intent"] == "LIGHTS_AUTO"


class StubVoice:
    """Stands in for whisper-server when the Malayalam model is unavailable."""

    def __init__(self) -> None:
        self.calls = 0

    async def transcribe(self, data: bytes, language: str):
        self.calls += 1
        return {"text": "turn on the lights", "language": language}

    async def readiness(self):
        return {"enabled": True, "server_reachable": True}


@pytest.mark.asyncio
async def test_a_broken_malayalam_model_falls_back_to_whisper(tmp_path, monkeypatch):
    stub = StubVoice()
    settings = replace(make_settings(tmp_path), ml_asr_dir=model_dir(tmp_path))

    def explode(data: bytes) -> str:
        raise ml_asr.MalayalamAsrError("the model is not loadable")

    monkeypatch.setattr(ml_asr, "available", lambda: True)
    monkeypatch.setattr(ml_asr, "transcribe", explode)

    async with client_for(settings, voice=stub) as (client, _gateway, _app):
        response = await client.post(
            "/api/v1/voice/transcribe?mode=demo",
            files={"audio": ("a.wav", silence_wav(), "audio/wav")},
            data={"language": "ml"},
        )
    assert response.status_code == 200, response.text
    # The request was answered, by the engine that still works.
    assert stub.calls == 1
    assert response.json()["intent"] == "LIGHTS_ON"


@pytest.mark.asyncio
async def test_english_never_goes_near_the_malayalam_model(tmp_path, monkeypatch):
    stub = StubVoice()
    settings = replace(make_settings(tmp_path), ml_asr_dir=model_dir(tmp_path))
    monkeypatch.setattr(ml_asr, "available", lambda: True)
    monkeypatch.setattr(
        ml_asr,
        "transcribe",
        lambda data: (_ for _ in ()).throw(AssertionError("not for English")),
    )

    async with client_for(settings, voice=stub) as (client, _gateway, _app):
        response = await client.post(
            "/api/v1/voice/transcribe?mode=demo",
            files={"audio": ("a.wav", silence_wav(), "audio/wav")},
            data={"language": "en"},
        )
    assert response.status_code == 200, response.text
    assert stub.calls == 1
