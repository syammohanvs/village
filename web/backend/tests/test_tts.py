from __future__ import annotations

import hashlib
import wave
from pathlib import Path

import pytest

from app import tts as tts_module
from app.tts import MAX_TEXT_CHARS, PiperTts, TtsError, cache_key, clean_text

from conftest import client_for, make_settings


class FakeTts:
    def __init__(self, path: Path | None = None, error: TtsError | None = None):
        self.path = path
        self.error = error
        self.calls: list[tuple[str, str, float]] = []

    def readiness(self) -> dict[str, object]:
        return {
            "ready": self.path is not None,
            "engine": "piper",
            "languages": ["en", "hi", "ml"] if self.path else [],
            "message": "fake",
        }

    async def synthesize(self, text: str, language: str, length_scale: float = 1.0) -> Path:
        self.calls.append((text, language, length_scale))
        if self.error is not None:
            raise self.error
        assert self.path is not None
        return self.path


def write_silence(path: Path, seconds: float = 0.25) -> Path:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(22050)
        handle.writeframes(b"\x00\x00" * int(22050 * seconds))
    return path


def test_clean_text_collapses_whitespace_and_caps_length():
    assert clean_text("  hello\n\n world  ") == "hello world"
    assert clean_text("a\x00b\x07c") == "abc"
    assert len(clean_text("x" * (MAX_TEXT_CHARS + 50))) == MAX_TEXT_CHARS


def test_cache_key_changes_with_language_and_speed():
    base = cache_key("en", "voice", 1.0, "hello")
    assert base == cache_key("en", "voice", 1.0, "hello")
    assert base != cache_key("ml", "voice", 1.0, "hello")
    assert base != cache_key("en", "voice", 1.2, "hello")
    assert base != cache_key("en", "voice", 1.0, "hello there")
    assert base == hashlib.sha1(b"en|voice|1.000|hello").hexdigest()


def test_readiness_is_honest_when_piper_is_not_installed(tmp_path):
    settings = make_settings(tmp_path)
    from dataclasses import replace

    uninstalled = replace(
        settings,
        piper_bin=tmp_path / "missing-piper",
        piper_voices_dir=tmp_path / "missing-voices",
        piper_cache_dir=tmp_path / "cache",
    )
    ready = PiperTts(uninstalled).readiness()
    assert ready["ready"] is False
    assert "not installed" in str(ready["message"])


@pytest.mark.asyncio
async def test_speak_route_returns_wav(tmp_path):
    settings = make_settings(tmp_path)
    voice_file = write_silence(tmp_path / "reply.wav")
    fake = FakeTts(voice_file)

    async with client_for(settings, tts=fake) as (client, _gateway, _app):
        response = await client.post(
            "/api/v1/voice/speak",
            json={"text": "The soil is dry.", "language": "ml", "length_scale": 1.1},
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")
    assert response.content[:4] == b"RIFF"
    assert fake.calls == [("The soil is dry.", "ml", 1.1)]


@pytest.mark.asyncio
async def test_speak_route_validates_language_and_text(tmp_path):
    settings = make_settings(tmp_path)
    fake = FakeTts(write_silence(tmp_path / "reply.wav"))

    async with client_for(settings, tts=fake) as (client, _gateway, _app):
        bad_language = await client.post(
            "/api/v1/voice/speak", json={"text": "hello", "language": "fr"}
        )
        empty = await client.post("/api/v1/voice/speak", json={"text": "", "language": "en"})
        too_long = await client.post(
            "/api/v1/voice/speak", json={"text": "x" * 1300, "language": "en"}
        )

    assert bad_language.status_code == 422
    assert empty.status_code == 422
    assert too_long.status_code == 422
    assert fake.calls == []


@pytest.mark.asyncio
async def test_speak_route_reports_a_missing_engine_in_words(tmp_path):
    settings = make_settings(tmp_path)
    fake = FakeTts(error=TtsError(503, "TTS_UNAVAILABLE", "the Piper voice for 'ml' is not installed"))

    async with client_for(settings, tts=fake) as (client, _gateway, _app):
        response = await client.post(
            "/api/v1/voice/speak", json={"text": "hello", "language": "ml"}
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "TTS_UNAVAILABLE"
    assert "not installed" in response.json()["error"]["message"]


@pytest.mark.asyncio
async def test_readiness_includes_the_speech_engine(tmp_path):
    settings = make_settings(tmp_path)
    fake = FakeTts(write_silence(tmp_path / "reply.wav"))

    async with client_for(settings, tts=fake) as (client, _gateway, _app):
        response = await client.get("/api/v1/voice/readiness")

    body = response.json()
    assert body["tts"]["ready"] is True
    assert body["tts"]["engine"] == "piper"
    assert body["tts"]["languages"] == ["en", "hi", "ml"]
