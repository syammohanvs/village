"""Malayalam speech, read by a Whisper-small fine-tuned on Malayalam.

Why this exists (2026-11-18): the multilingual `ggml-base` model cannot write
Malayalam.  It *hears* the sentence — the sounds are right — but it spells them
in Tamil, Devanagari or even Arabic letters, and it mangles the question word,
so the parser has nothing to match.  Measured through the real
`/api/v1/voice/transcribe` route on six catalogue sentences: **2/6**.

`kavyamanohar/whisper-small-malayalam` (a Whisper-small fine-tune) writes the
sentence in **Malayalam script** and gets the words right, on the same six
clips, at **2.5–3.5 s** each on this CPU.  It runs here rather than in
`whisper-server` because the GGML conversion of the same checkpoint measured
5–26 s per clip on this machine, and a prompt sent to it produced a runaway
repetition.

The model is *not* in git (`models/whisper/ml-asr/`, ~1 GB):
`scripts/download_models.sh` fetches it.  When it is missing, absent or broken,
the caller falls back to `whisper-server` — a missing Malayalam model must never
stop the exhibit from listening.
"""

from __future__ import annotations

import io
import threading
import wave
from pathlib import Path
from typing import Any

# A short sample of the words the village listens for.  This is only a priming
# hint for the decoder; it measurably straightens the spelling ("വിലക്കുകൾ" →
# "വിളക്കുകൾ"), which is the difference between a command and a shrug.
PROMPT = (
    "വിളക്കുകൾ കത്തിക്കുക, വിളക്കുകൾ അണയ്ക്കുക, വിളക്കുകൾ ഓട്ടോ, "
    "പമ്പ് ഓഫ് ചെയ്യുക, നനയ്ക്കാൻ തുടങ്ങുക, മണ്ണിൽ ഈർപ്പം, ടാങ്കിൽ വെള്ളമുണ്ടോ."
)

MODEL_FILES = ("model.safetensors", "pytorch_model.bin")

_lock = threading.Lock()
_model: Any = None
_processor: Any = None
_dir: Path | None = None
_load_failed = False


class MalayalamAsrError(Exception):
    """The fine-tuned model could not answer; the caller uses Whisper instead."""


def configure(model_dir: Path | str | None) -> None:
    """Point the engine at a model directory (called once, from `create_app`)."""
    global _dir, _model, _processor, _load_failed
    target = Path(model_dir) if model_dir else None
    with _lock:
        if target != _dir:
            _dir = target
            _model = None
            _processor = None
            _load_failed = False


def available() -> bool:
    """True when a model directory with weights is there to load."""
    directory = _dir
    if directory is None or _load_failed:
        return False
    if not (directory / "config.json").is_file():
        return False
    return any((directory / name).is_file() for name in MODEL_FILES)


def model_dir() -> Path | None:
    return _dir


def _load() -> tuple[Any, Any]:
    global _model, _processor, _load_failed
    with _lock:
        if _model is not None and _processor is not None:
            return _model, _processor
        if _dir is None:
            raise MalayalamAsrError("no Malayalam model directory is configured")
        try:
            import torch
            from transformers import WhisperForConditionalGeneration, WhisperProcessor

            _processor = WhisperProcessor.from_pretrained(str(_dir))
            _model = WhisperForConditionalGeneration.from_pretrained(
                str(_dir), dtype=torch.float32
            )
            _model.eval()
        except Exception as exc:  # noqa: BLE001 - any failure means "use Whisper"
            _load_failed = True
            raise MalayalamAsrError(f"could not load the Malayalam model: {exc}") from exc
        return _model, _processor


def reset_for_tests() -> None:
    """Forget the loaded model (tests only; loading is otherwise permanent)."""
    global _model, _processor, _load_failed
    with _lock:
        _model = None
        _processor = None
        _load_failed = False


def _samples(data: bytes) -> Any:
    """16 kHz mono 16-bit PCM, as the browser records it."""
    import numpy as np

    from .voice import VoiceError, wav_info

    info = wav_info(data)
    # `bits` is the sample width in bits (the 16 in "16-bit PCM").
    if info["channels"] != 1 or info["bits"] != 16:
        raise MalayalamAsrError("expected mono 16-bit PCM")
    with wave.open(io.BytesIO(data)) as handle:
        raw = handle.readframes(handle.getnframes())
        rate = handle.getframerate()
    if rate != 16000:
        raise MalayalamAsrError(f"expected 16 kHz audio, got {rate}")
    return np.frombuffer(raw, dtype="<i2").astype("float32") / 32768.0


def transcribe(data: bytes) -> str:
    """One recording → Malayalam text.  Blocking; call it in a thread."""
    import torch

    model, processor = _load()
    audio = _samples(data)
    if audio.size == 0:
        return ""
    features = processor(audio, sampling_rate=16000, return_tensors="pt").input_features
    prompt_ids = processor.get_prompt_ids(PROMPT, return_tensors="pt")
    with _lock, torch.no_grad():
        ids = model.generate(
            features,
            language="ml",
            task="transcribe",
            prompt_ids=prompt_ids,
            max_new_tokens=96,
        )
    return processor.batch_decode(ids, skip_special_tokens=True)[0].strip()
