from __future__ import annotations

import struct
from dataclasses import replace

import pytest

from app.voice import VoiceError, WhisperClient, english_only_model, wav_info
from conftest import make_settings


def silence_wav(seconds: float = 0.5, rate: int = 16000) -> bytes:
    data = b"\x00\x00" * int(rate * seconds)
    return (
        b"RIFF"
        + struct.pack("<I", 36 + len(data))
        + b"WAVE"
        + b"fmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
        + b"data"
        + struct.pack("<I", len(data))
        + data
    )


def model_file(tmp_path, name: str, size: int = 2_000_000):
    path = tmp_path / name
    path.write_bytes(b"\0" * size)
    return path


def test_english_only_names_are_recognised():
    assert english_only_model("ggml-base.en.bin")
    assert english_only_model("ggml-small.en.bin")
    assert not english_only_model("ggml-base.bin")
    assert not english_only_model("ggml-large-v3-turbo.bin")
    assert not english_only_model("ggml-medium.bin")


@pytest.mark.asyncio
async def test_english_only_model_is_refused(tmp_path):
    settings = replace(
        make_settings(tmp_path),
        whisper_model_path=model_file(tmp_path, "ggml-base.en.bin"),
    )
    with pytest.raises(VoiceError) as caught:
        await WhisperClient(settings).transcribe(silence_wav(), "ml")
    assert caught.value.status == 503
    assert caught.value.code == "WHISPER_MODEL_WRONG"
    assert "English" in caught.value.message


@pytest.mark.asyncio
async def test_a_multilingual_model_is_accepted(tmp_path):
    # The name guard must not insist on ggml-base.bin.  With an unreachable
    # server the call fails later, which proves it got past the model check.
    settings = replace(
        make_settings(tmp_path),
        whisper_model_path=model_file(tmp_path, "ggml-large-v3-turbo.bin"),
        whisper_url="http://127.0.0.1:9",
    )
    with pytest.raises(VoiceError) as caught:
        await WhisperClient(settings).transcribe(silence_wav(), "ml")
    assert caught.value.status == 503
    assert caught.value.code == "WHISPER_UNREACHABLE"


@pytest.mark.asyncio
async def test_readiness_flags_an_english_only_model(tmp_path):
    settings = replace(
        make_settings(tmp_path),
        whisper_model_path=model_file(tmp_path, "ggml-base.en.bin"),
        whisper_url="http://127.0.0.1:9",
    )
    status = await WhisperClient(settings).readiness()
    assert status["multilingual"] is False
    assert status["ready"] is False
    assert "English-only" in status["message"]


def test_wav_info_reads_the_duration():
    assert wav_info(silence_wav(0.5))["duration_s"] == 0.5


def test_the_decoder_is_primed_with_the_language_it_should_expect():
    """whisper.cpp takes an initial prompt into the decoder, and it settles the
    script: the same Hindi clip came back as "Light Bandkaru." with no prompt
    and in Devanagari with one (measured 2026-11-17).

    **Malayalam is the opposite case (measured 2026-11-18).**  Whisper names
    Malayalam with the Devanagari token, so a Malayalam prompt pulls the
    decoder toward the wrong tokens: the same clips came back as
    "வியலகுகள் கட்டிக்குங்கள்" (with a Persian yeh) and one bare "യ്മയ്ക്കുക."
    with the prompt, and as three parseable sentences without it.  No prompt.
    """
    from app.voice import request_fields

    assert "prompt" not in request_fields("en")
    assert "prompt" not in request_fields("ml")

    fields = request_fields("hi")
    assert fields["language"] == "hi"
    assert fields["prompt"].strip()
    # The prompt has to be written in that language's own script, or it primes
    # the wrong decoder.
    assert any("\u0900" <= char <= "\u097f" for char in fields["prompt"])
