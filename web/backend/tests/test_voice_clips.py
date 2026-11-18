"""The last few voice recordings: kept, bounded, and pruned by themselves.

Asked for on 2026-11-18 after an evening of misheard commands: the app had
nothing to play back, only the transcript it had produced.  Two things have to
be true of such a folder and are tested here — that the newest 100 (or whatever
`VILLAGE_VOICE_CLIPS` says) survive, and that it can never grow without bound,
by count **and** by bytes.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import replace

import pytest

from app import voice_clips
from conftest import client_for, make_settings
from test_voice import silence_wav


def clip(folder, name: str, size: int = 64, *, age: float = 0.0):
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_bytes(b"\0" * size)
    (folder / f"{name[:-4]}.json").write_text("{}")
    if age:
        stamp = time.time() - age
        os.utime(path, (stamp, stamp))
    return path


def test_it_keeps_the_newest_and_lets_the_oldest_go(tmp_path):
    folder = tmp_path / "voice-clips"
    for index in range(12):
        clip(folder, f"2026010{index:02d}T000000Z-en.wav", age=100 - index)

    removed = voice_clips.prune(folder, keep=10, max_bytes=0)

    assert removed == 2
    left = sorted(path.name for path in folder.glob("*.wav"))
    assert len(left) == 10
    # The two oldest went, and their sidecars with them.
    assert "202601000T000000Z-en.wav" not in left
    assert "202601001T000000Z-en.wav" not in left
    assert not (folder / "202601000T000000Z-en.json").exists()
    assert (folder / "202601011T000000Z-en.json").exists()


def test_the_total_size_is_capped_too_not_only_the_count(tmp_path):
    folder = tmp_path / "voice-clips"
    for index in range(6):
        clip(folder, f"2026010{index:02d}T000000Z-en.wav", size=1000, age=100 - index)

    # Room for four clips of 1000 bytes; the count would allow six.
    removed = voice_clips.prune(folder, keep=100, max_bytes=4000)

    assert removed == 2
    assert sum(path.stat().st_size for path in folder.glob("*.wav")) <= 4000


def test_one_oversized_recording_is_still_kept(tmp_path):
    """A cap smaller than one clip must not empty the folder.

    The newest recording is the one under suspicion; deleting it to honour a
    byte count would lose exactly the sentence that was just misheard.
    """
    folder = tmp_path / "voice-clips"
    clip(folder, "202601000T000000Z-en.wav", size=5000, age=10)
    clip(folder, "202601001T000000Z-en.wav", size=5000, age=1)

    voice_clips.prune(folder, keep=100, max_bytes=100)

    left = sorted(path.name for path in folder.glob("*.wav"))
    assert left == ["202601001T000000Z-en.wav"]


def test_saving_writes_a_clip_and_never_overwrites_one(tmp_path):
    settings = make_settings(tmp_path)
    first = voice_clips.save(b"RIFF-one", language="ml", settings=settings)
    second = voice_clips.save(b"RIFF-two", language="ml", settings=settings)

    assert first is not None and second is not None
    assert first != second
    assert first.read_bytes() == b"RIFF-one"
    assert second.read_bytes() == b"RIFF-two"
    assert "-ml" in first.name


def test_the_sidecar_says_what_the_clip_produced(tmp_path):
    settings = make_settings(tmp_path)
    path = voice_clips.save(b"RIFF", language="en", settings=settings)
    voice_clips.annotate(
        path,
        language="en",
        engine="whisper",
        text="Dumb on!",
        result={"intent": "IRRIGATION_START", "reason": "matched", "kind": "command",
                "command": "IRRIGATION_REQUEST", "matched_phrase": None},
        duration_s=1.4,
    )

    line = json.loads(path.with_suffix(".json").read_text())
    assert line["transcript"] == "Dumb on!"
    assert line["engine"] == "whisper"
    assert line["intent"] == "IRRIGATION_START"
    assert line["command"] == "IRRIGATION_REQUEST"
    assert line["duration_s"] == 1.4


def test_switching_it_off_keeps_nothing(tmp_path):
    settings = replace(make_settings(tmp_path), voice_clips=0)

    assert voice_clips.enabled(settings) is False
    assert voice_clips.save(b"RIFF", language="en", settings=settings) is None
    assert list((tmp_path / "voice-clips").glob("*")) == []

    no_folder = replace(make_settings(tmp_path), voice_clip_dir=None)
    assert voice_clips.enabled(no_folder) is False
    assert voice_clips.save(b"RIFF", language="en", settings=no_folder) is None


def test_a_broken_folder_never_breaks_the_answer(tmp_path):
    """The folder is a record; the request must not fail because of it."""
    wall = tmp_path / "voice-clips"
    wall.write_text("not a directory")
    settings = replace(make_settings(tmp_path), voice_clip_dir=wall)

    assert voice_clips.save(b"RIFF", language="en", settings=settings) is None
    # A sidecar for a clip that does not exist is a no-op, not a crash.
    voice_clips.annotate(None, language="en", engine="whisper", text="", result=None)


def test_status_reports_the_count_and_the_policy(tmp_path):
    settings = make_settings(tmp_path)
    folder = tmp_path / "voice-clips"
    clip(folder, "202601000T000000Z-en.wav", size=100)

    state = voice_clips.status(settings)
    assert state["enabled"] is True
    assert state["kept"] == 1
    assert state["bytes"] == 100
    assert state["keep"] == 100
    assert state["max_bytes"] == 64 * 1024 * 1024

    off = voice_clips.status(replace(settings, voice_clips=0))
    assert off == {"enabled": False, "keep": 0, "kept": 0, "bytes": 0}


# ---------------------------------------------------------------------------
# The route: a recording is kept even when the answer is "not understood",
# which is the whole point of keeping it.
# ---------------------------------------------------------------------------
class StubVoice:
    def __init__(self, text: str = "Dumb on!") -> None:
        self.text = text

    async def transcribe(self, data: bytes, language: str):
        return {"text": self.text, "duration_s": 0.5}

    async def readiness(self):
        return {"enabled": True, "server_reachable": True}


@pytest.mark.asyncio
async def test_a_transcription_keeps_its_recording_and_its_outcome(tmp_path):
    settings = make_settings(tmp_path)

    async with client_for(settings, voice=StubVoice("Bounce on!")) as (client, _gw, _app):
        response = await client.post(
            "/api/v1/voice/transcribe?mode=demo",
            files={"audio": ("a.wav", silence_wav(), "audio/wav")},
            data={"language": "en"},
        )

    assert response.status_code == 200, response.text
    # The sentence was not understood — and it is on disk, with what it
    # produced beside it, which is how the next fix gets measured.
    assert response.json()["intent"] == "AMBIGUOUS"
    clips = sorted((tmp_path / "voice-clips").glob("*.wav"))
    assert len(clips) == 1
    sidecar = json.loads(clips[0].with_suffix(".json").read_text())
    assert sidecar["transcript"] == "Bounce on!"
    assert sidecar["language"] == "en"
    assert sidecar["engine"] == "whisper"
    assert sidecar["intent"] == "AMBIGUOUS"
    assert sidecar["duration_s"] == 0.5
    assert clips[0].stat().st_size == len(silence_wav())


@pytest.mark.asyncio
async def test_the_route_keeps_nothing_when_the_folder_is_off(tmp_path):
    settings = replace(make_settings(tmp_path), voice_clips=0)

    async with client_for(settings, voice=StubVoice()) as (client, _gw, _app):
        response = await client.post(
            "/api/v1/voice/transcribe?mode=demo",
            files={"audio": ("a.wav", silence_wav(), "audio/wav")},
            data={"language": "en"},
        )

    assert response.status_code == 200, response.text
    assert list((tmp_path / "voice-clips").glob("*")) == []


@pytest.mark.asyncio
async def test_readiness_says_whether_clips_are_kept(tmp_path):
    settings = make_settings(tmp_path)

    async with client_for(settings, voice=StubVoice()) as (client, _gw, _app):
        response = await client.get("/api/v1/voice/readiness?mode=demo")

    body = response.json()
    assert body["clips"]["enabled"] is True
    assert body["clips"]["keep"] == 100
