from __future__ import annotations

import asyncio
import hashlib
import re
from pathlib import Path

from .config import Settings

# One female voice per language, all Piper "medium" models at 22,050 Hz so the
# three sound like the same speaker family rather than three different engines.
VOICE_FOR_LANGUAGE = {
    "en": "en_US-lessac-medium",
    "hi": "hi_IN-priyamvada-medium",
    "ml": "ml_IN-meera-medium",
}

MAX_TEXT_CHARS = 1200


class TtsError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def clean_text(text: str) -> str:
    """Collapse whitespace and drop control characters.

    The text comes from our own guide, but it is passed to a subprocess on
    stdin, so it is normalised here rather than trusted.
    """
    collapsed = re.sub(r"\s+", " ", text or "").strip()
    printable = "".join(ch for ch in collapsed if ch.isprintable())
    return printable[:MAX_TEXT_CHARS]


def cache_key(language: str, voice: str, length_scale: float, text: str) -> str:
    payload = f"{language}|{voice}|{length_scale:.3f}|{text}".encode("utf-8")
    return hashlib.sha1(payload).hexdigest()


class PiperTts:
    """Local neural speech, used for every spoken reply.

    Piper is a VITS model: it sounds like a person rather than the formant
    synthesis of espeak, and it runs far faster than real time on this CPU
    (measured ~0.04 real-time factor).  One voice per language keeps the
    dashboard consistent across English, Hindi and Malayalam.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.cache_dir = settings.piper_cache_dir

    # ------------------------------------------------------------------
    def _model_path(self, language: str) -> Path | None:
        voice = VOICE_FOR_LANGUAGE.get(language)
        if voice is None:
            return None
        path = self.settings.piper_voices_dir / f"{voice}.onnx"
        return path if path.is_file() else None

    @property
    def enabled(self) -> bool:
        return self.settings.piper_bin.is_file()

    def languages(self) -> list[str]:
        if not self.enabled:
            return []
        return sorted([code for code in VOICE_FOR_LANGUAGE if self._model_path(code)])

    def readiness(self) -> dict[str, object]:
        languages = self.languages()
        if not self.enabled:
            message = (
                "Piper is not installed. Run scripts/install_piper.sh to add the engine and "
                "voices, then spoken replies use it."
            )
        elif not languages:
            message = "Piper is installed but no voice model was found in models/piper/voices."
        else:
            message = "Piper is ready for " + ", ".join(languages) + "."
        return {
            "ready": bool(languages),
            "engine": "piper",
            "languages": languages,
            "message": message,
        }

    # ------------------------------------------------------------------
    async def synthesize(self, text: str, language: str, length_scale: float = 1.0) -> Path:
        voice = VOICE_FOR_LANGUAGE.get(language)
        if voice is None:
            raise TtsError(400, "UNSUPPORTED_LANGUAGE", f"no voice for language '{language}'")
        model = self._model_path(language)
        if model is None:
            raise TtsError(
                503,
                "TTS_UNAVAILABLE",
                f"the Piper voice for '{language}' is not installed",
            )
        if not self.enabled:
            raise TtsError(503, "TTS_UNAVAILABLE", "the Piper engine is not installed")

        spoken = clean_text(text)
        if not spoken:
            raise TtsError(400, "EMPTY_TEXT", "text must contain at least one printable character")

        self.cache_dir.mkdir(parents=True, exist_ok=True)
        scale = max(0.5, min(2.0, round(length_scale, 3)))
        key = cache_key(language, voice, scale, spoken)
        target = self.cache_dir / f"{key}.wav"
        if target.is_file() and target.stat().st_size > 44:
            return target

        temporary = self.cache_dir / f"{key}.wav.tmp"
        command = [
            str(self.settings.piper_bin),
            "-m",
            str(model),
            "-f",
            str(temporary),
            "--length_scale",
            f"{scale:.3f}",
        ]
        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.settings.piper_voices_dir),
            )
        except OSError as exc:
            raise TtsError(503, "TTS_UNAVAILABLE", f"Piper could not start: {exc}") from exc

        try:
            _, stderr = await asyncio.wait_for(
                process.communicate(spoken.encode("utf-8")),
                timeout=30,
            )
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.wait()
            temporary.unlink(missing_ok=True)
            raise TtsError(504, "TTS_TIMEOUT", "speech synthesis took too long") from exc

        if process.returncode != 0:
            detail = (stderr or b"").decode("utf-8", "replace").strip().splitlines()
            temporary.unlink(missing_ok=True)
            raise TtsError(
                502,
                "TTS_FAILED",
                "Piper could not synthesise that text"
                + (f": {detail[-1]}" if detail else ""),
            )
        if not temporary.is_file() or temporary.stat().st_size <= 44:
            temporary.unlink(missing_ok=True)
            raise TtsError(502, "TTS_EMPTY", "Piper produced no audio")

        # Rename into place so a concurrent request never reads half a file.
        temporary.replace(target)
        return target
