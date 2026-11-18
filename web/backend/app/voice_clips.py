"""The last few voice recordings, kept so a misheard sentence can be replayed.

Why (2026-11-18, asked for by the user): visitors gave commands, several were
answered "not understood", and the app had **nothing to play back** — only the
transcript it had produced, which is exactly the part under suspicion.  A
recording is the evidence: it can be listened to, and it can be run through the
parser again after a fix (`scripts/voice_replay.py` reads this folder).

**Bounded on purpose, and it prunes itself.**  The folder holds at most
`VILLAGE_VOICE_CLIPS` clips (default 100) **and** at most
`VILLAGE_VOICE_CLIP_BYTES` in total (default 64 MB), whichever is reached
first; the oldest goes first.  A 10-second clip is ~320 kB, so a hundred of
them is ~32 MB and the byte cap is headroom for a deployment that asks for more
clips.  A venue season therefore cannot fill the disk.

**The sidecar is the point.**  Each clip carries a `.json` with what it
produced — language, engine, transcript, intent, reason — because the mismatch
between the two is what gets studied.  The sidecar is deleted with its clip, so
the pair cannot drift.

Two refusals, both deliberate: turning it off is one setting
(`VILLAGE_VOICE_CLIP_DIR=`), and **a failure to save never fails a request** —
the answer matters more than the record.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

from .config import Settings

# One clip at a time: two utterances can arrive together, and the prune must
# not count a file another thread is still writing.
_lock = threading.Lock()


def enabled(settings: Settings) -> bool:
    return settings.voice_clip_dir is not None and settings.voice_clips > 0


def save(data: bytes, *, language: str, settings: Settings) -> Path | None:
    """Keep one recording, then apply the policy.  Never raises."""
    if not enabled(settings) or not data:
        return None
    folder = settings.voice_clip_dir
    assert folder is not None  # `enabled` said so
    try:
        folder.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        with _lock:
            path = folder / f"{stamp}-{language}.wav"
            suffix = 1
            # Never overwrite: two utterances in one second are two utterances,
            # and the second is not less interesting than the first.
            while path.exists():
                path = folder / f"{stamp}-{language}-{suffix}.wav"
                suffix += 1
            path.write_bytes(data)
            prune(folder, settings.voice_clips, settings.voice_clip_bytes)
        return path
    except Exception:  # noqa: BLE001 - a record must never break an answer
        return None


def annotate(
    clip: Path | None,
    *,
    language: str,
    engine: str,
    text: str,
    result: dict[str, Any] | None,
    duration_s: float | None = None,
) -> None:
    """Write what the clip produced beside it.  Never raises."""
    if clip is None:
        return
    line = {
        "file": clip.name,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "language": language,
        "engine": engine,
        "duration_s": duration_s,
        "transcript": text,
    }
    if result:
        line["intent"] = result.get("intent")
        line["reason"] = result.get("reason")
        line["kind"] = result.get("kind")
        line["command"] = result.get("command")
        line["matched_phrase"] = result.get("matched_phrase")
    try:
        clip.with_suffix(".json").write_text(
            json.dumps(line, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    except OSError:
        pass


def prune(folder: Path, keep: int, max_bytes: int) -> int:
    """Keep the newest `keep` clips, and never more than `max_bytes` of them.

    Returns how many went, which is what a test can see and a log line can say.
    A clip and its sidecar go together.  The newest clip is always kept, even if
    one recording on its own is larger than the cap — an empty folder would be
    the one outcome that loses the sentence that was just misheard.
    """
    if keep <= 0:
        return 0
    try:
        clips = sorted(
            folder.glob("*.wav"), key=lambda path: path.stat().st_mtime, reverse=True
        )
    except OSError:
        return 0
    total = 0
    kept = 0
    removed = 0
    for index, path in enumerate(clips):
        try:
            size = path.stat().st_size
        except OSError:
            continue
        too_many = index >= keep
        too_big = max_bytes > 0 and total + size > max_bytes and kept > 0
        if not (too_many or too_big):
            total += size
            kept += 1
            continue
        try:
            path.unlink()
        except OSError:
            continue
        try:
            path.with_suffix(".json").unlink()
        except OSError:
            pass
        removed += 1
    return removed


def status(settings: Settings) -> dict[str, Any]:
    """What is on disk now — one line an operator can read out over `curl`."""
    if not enabled(settings):
        return {"enabled": False, "keep": settings.voice_clips, "kept": 0, "bytes": 0}
    folder = settings.voice_clip_dir
    clips: list[Path] = []
    total = 0
    if folder is not None:
        try:
            clips = list(folder.glob("*.wav"))
            total = sum(path.stat().st_size for path in clips)
        except OSError:
            pass
    return {
        "enabled": True,
        "keep": settings.voice_clips,
        "max_bytes": settings.voice_clip_bytes,
        "kept": len(clips),
        "bytes": total,
    }
