from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any

import httpx

from .config import Settings


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
                    data={
                        "temperature": "0",
                        "response_format": "json",
                        "language": language,
                    },
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
