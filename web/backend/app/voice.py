from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any

import httpx

from .config import Settings


# A short sample of the words the village listens for, in the language itself.
#
# **Hindi only.**  whisper.cpp takes an initial prompt into the decoder, and for
# Hindi it settles the *script*: with no prompt the same clip came back as
# "Light Bandkaru." (Latin) while this prompt gave "… करो" in Devanagari
# (measured 2026-11-17).
#
# **Malayalam must have NO prompt.**  The note here used to say Malayalam was
# "unaffected" by its prompt; measured on 2026-11-18 that is false, and the
# prompt actively hurts: the same three clips gave
#   "விலக்குகள் காட்டிக்குக்கா" / "தாங்கில வெள்ளம்ணு" / "தாங்கில் வெள்ளமுண்டு"
# without it (all three parsed correctly) and
#   "வியலகுகள் கட்டிக்குங்கள்" (with a Persian yeh), "மண்ணில் எத்தான்…" and a
#   bare "യ്മയ്ക്കുക." with it.  Whisper names Malayalam with the *Devanagari*
# token, so a Malayalam prompt pulls the decoder toward the wrong tokens.
# **English has one, and it was measured on the exhibit's own clips**
# (2026-11-19).  Whisper heard "lights status" as "Lead status", "stop
# irrigation" as "Stop Illusion!" and "pump status" as "BOM status!", and no
# model fixed that — small and large-v3-turbo failed the same words (large took
# 18-24 s and was worse).  Priming the decoder with the vocabulary the village
# listens for fixed four of the five, on the same base model, with no extra
# latency:
#   "Stop Illusion!"  -> "Stop irrigation."
#   "BOM status!"     -> "Pump status."
#   "Like status."    -> "Light status."
#   "automatic bomb." -> "Automatic, pump."
# The risk a prompt carries — inventing a command from noise — was checked on
# the noise clips: "[Music]" and "[BLANK_AUDIO]" stayed noise, and a cough that
# read "Oh!" became "Off.", a single word the parser answers with "which
# device?" and never actuates.  The page also refuses a silent recording before
# the model is asked (peakLevel).
LANGUAGE_PROMPTS = {
    "hi": "लाइट बंद करो, लाइट चालू करो, पंप चालू करो, पानी, स्ट्रीट लाइट.",
    "en": (
        "Lights, streetlights, pump, irrigation, status, on, off, automatic, "
        "soil, water, village."
    ),
}


def request_fields(language: str) -> dict[str, str]:
    """The form fields whisper.cpp is given for one transcription.

    One definition, so a test can assert the prompt without a server.
    """
    fields = {
        "temperature": "0",
        "response_format": "json",
        "language": language,
    }
    prompt = LANGUAGE_PROMPTS.get(language)
    if prompt:
        fields["prompt"] = prompt
    return fields


class VoiceError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def wav_info(data: bytes) -> dict[str, Any]:
    if len(data) < 44 or data[0:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise VoiceError(400, "AUDIO_FORMAT", "expected a WAV file (16 kHz mono 16-bit PCM)")
    offset = 12
    fmt: tuple[int, int, int, int] | None = None
    data_size = 0
    while offset + 8 <= len(data):
        chunk_id = data[offset : offset + 4]
        size = struct.unpack_from("<I", data, offset + 4)[0]
        body = offset + 8
        if chunk_id == b"fmt " and size >= 16 and body + 16 <= len(data):
            audio_format, channels, rate, _byte_rate, _block_align, bits = struct.unpack_from(
                "<HHIIHH", data, body
            )
            fmt = (audio_format, channels, rate, bits)
        elif chunk_id == b"data":
            data_size = min(size, max(0, len(data) - body))
        offset = body + size + (size & 1)
    if fmt is None:
        raise VoiceError(400, "AUDIO_FORMAT", "the WAV file has no fmt chunk")
    audio_format, channels, rate, bits = fmt
    if audio_format != 1 or channels != 1 or rate != 16000 or bits != 16:
        raise VoiceError(
            400,
            "AUDIO_FORMAT",
            f"expected 16 kHz mono 16-bit PCM WAV, got format={audio_format} channels={channels} rate={rate} bits={bits}",
        )
    seconds = data_size / float(rate * channels * (bits // 8)) if data_size else 0.0
    return {"duration_s": round(seconds, 2), "channels": channels, "rate": rate, "bits": bits}


def english_only_model(name: str) -> bool:
    """True for whisper.cpp's English-only builds (``ggml-*.en.bin``).

    Any other ``ggml-*.bin`` is multilingual: base, small, medium,
    large-v3 and large-v3-turbo all work, so the guard rejects only the
    English-only variants rather than insisting on one exact filename.
    """
    return name.endswith(".en.bin") or ".en." in name


class WhisperClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def readiness(self) -> dict[str, Any]:
        model = self.settings.whisper_model_path
        exists = model.is_file()
        size = model.stat().st_size if exists else 0
        server_ok = False
        detail = ""
        try:
            async with httpx.AsyncClient(timeout=2.5) as client:
                for path in ("/health", "/"):
                    try:
                        response = await client.get(self.settings.whisper_url + path)
                        if response.status_code < 500:
                            server_ok = True
                            detail = f"HTTP {response.status_code} from {path}"
                            break
                    except httpx.HTTPError as exc:
                        detail = str(exc)
        except httpx.HTTPError as exc:
            detail = str(exc)
        installed = bool(
            exists and size > 1_000_000 and not english_only_model(model.name)
        )
        english_only = english_only_model(model.name)
        if english_only:
            # A wrong model is a configuration mistake the operator can fix
            # without looking at the server, so it is reported first.
            message = (
                f"{model.name} is English-only. Use a multilingual ggml model "
                "(for example ggml-base.bin or ggml-large-v3-turbo.bin)."
            )
        elif not server_ok:
            message = "Whisper server is not reachable."
        elif not exists or size <= 1_000_000:
            message = "The multilingual Whisper model is missing."
        else:
            message = "Whisper is ready."
        return {
            "enabled": True,
            "server_reachable": server_ok,
            "base_url": self.settings.whisper_url,
            "model_path": str(model),
            "model_file_present": exists,
            "model_bytes": size,
            "model_name": model.name,
            "multilingual": not english_only,
            "languages": ["en", "ml", "hi"],
            "ready": bool(server_ok and installed),
            "detail": detail,
            "message": message,
        }

    async def transcribe(self, data: bytes, language: str) -> dict[str, Any]:
        if language not in {"en", "ml", "hi"}:
            raise VoiceError(422, "LANGUAGE_UNSUPPORTED", "language must be en, ml or hi")
        if len(data) > self.settings.voice_max_bytes:
            raise VoiceError(413, "AUDIO_TOO_LARGE", "the recording is too large")
        info = wav_info(data)
        if info["duration_s"] <= 0.15:
            raise VoiceError(422, "NO_SPEECH", "No speech was detected. Hold the button and speak clearly.")
        if info["duration_s"] > self.settings.voice_max_seconds:
            raise VoiceError(
                422, "AUDIO_TOO_LONG",
                f"the recording is {info['duration_s']:.1f}s; keep it under {self.settings.voice_max_seconds:.0f}s",
            )

        model = self.settings.whisper_model_path
        if not model.is_file() or model.stat().st_size < 1_000_000:
            raise VoiceError(
                503, "WHISPER_MODEL_MISSING",
                f"the multilingual Whisper model is missing at {model}. Run scripts/download_models.sh.",
            )
        if english_only_model(model.name):
            raise VoiceError(
                503,
                "WHISPER_MODEL_WRONG",
                f"{model.name} only understands English. Use a multilingual ggml "
                "model (for example ggml-base.bin or ggml-large-v3-turbo.bin).",
            )

        try:
            async with httpx.AsyncClient(timeout=self.settings.whisper_timeout_s) as client:
                response = await client.post(
                    self.settings.whisper_url + "/inference",
                    files={"file": ("audio.wav", data, "audio/wav")},
                    data=request_fields(language),
                )
        except httpx.HTTPError as exc:
            raise VoiceError(
                503, "WHISPER_UNREACHABLE",
                f"the local Whisper server did not answer: {exc}",
            ) from exc
        if response.status_code != 200:
            message = response.text.strip()[:400]
            raise VoiceError(
                502, "WHISPER_ERROR",
                f"Whisper refused the request (HTTP {response.status_code}): {message}",
            )
        try:
            payload = response.json()
            text = str(payload.get("text", "")).strip()
        except (ValueError, AttributeError):
            text = response.text.strip()
        if not text:
            raise VoiceError(422, "NO_SPEECH", "No speech was detected. Hold the button and speak clearly.")
        return {"text": text, "duration_s": info["duration_s"]}


def audio_assets(settings: Settings) -> dict[str, Any]:
    manifest = settings.audio_manifest_path
    files: list[str] = []
    if manifest.is_file():
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
            for language, entries in data.get("files", {}).items():
                for intent, filename in entries.items():
                    if (manifest.parent / filename).is_file():
                        files.append(f"/audio/{filename}")
        except (json.JSONDecodeError, OSError):
            files = []
    return {
        "manifest_present": manifest.is_file(),
        "available": files,
        "count": len(files),
        "note": "Optional recordings. Browser speech synthesis is used when a recording is absent.",
    }
