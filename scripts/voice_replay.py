#!/usr/bin/env python3
"""Re-run the kept recordings through the parser they were answered by.

The app keeps the last few voice recordings under `data/voice-clips/` (bounded
and pruned — see `docs/operation.md`), each with a sidecar saying what it
produced.  This script reads the sidecars and answers the only question worth
asking after a voice fix: **did the sentence the exhibit got wrong now work?**

    ./scripts/voice_replay.py                # every kept clip
    ./scripts/voice_replay.py --fails-only   # only the ones it got wrong
    ./scripts/voice_replay.py --audio        # re-transcribe the WAVs too

`--audio` asks the local whisper server again, which is how a model change is
measured; without it the script uses the stored transcript, which is exactly
what the parser saw.  Nothing is written and nothing is sent to the village.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "web" / "backend"))

from app.config import Settings  # noqa: E402
from app.intents import IntentMatcher  # noqa: E402


def transcribe(path: Path, language: str, url: str) -> str:
    """Ask whisper again, the way the app does (same fields, same language)."""
    import httpx

    from app.voice import request_fields

    response = httpx.post(
        url + "/inference",
        files={"file": (path.name, path.read_bytes(), "audio/wav")},
        data=request_fields(language),
        timeout=120.0,
    )
    response.raise_for_status()
    return str(response.json().get("text", "")).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", default=str(ROOT / "data" / "voice-clips"))
    parser.add_argument("--fails-only", action="store_true",
                        help="only the clips whose answer was not a matched command")
    parser.add_argument("--audio", action="store_true",
                        help="re-transcribe the recordings instead of using the stored transcript")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    settings = Settings.load()
    matcher = IntentMatcher(settings.intents_path)
    folder = Path(args.dir)
    sidecars = sorted(folder.glob("*.json"), reverse=True)
    if args.limit:
        sidecars = sidecars[: args.limit]
    if not sidecars:
        print(f"no recordings in {folder}")
        print("the app keeps the last VILLAGE_VOICE_CLIPS (default 100) — speak to it first,")
        print("or set VILLAGE_VOICE_CLIPS to a number above 0 if it is switched off")
        return 1

    changed = 0
    failed = 0
    for sidecar in sidecars:
        try:
            line = json.loads(sidecar.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        was = line.get("intent") or "?"
        was_ok = was not in {"UNKNOWN", "AMBIGUOUS", "NEGATED", "NO_SPEECH"}
        if args.fails_only and was_ok:
            continue
        language = line.get("language") or "en"
        text = line.get("transcript") or ""
        if args.audio:
            wav = sidecar.with_suffix(".wav")
            try:
                text = transcribe(wav, language, settings.whisper_url)
            except Exception as exc:  # noqa: BLE001 - a report, not a gate
                print(f"{sidecar.stem}: whisper failed ({exc})")
                continue
        result = matcher.match(text, language)
        now = result["intent"]
        command = result.get("command") or "-"
        if now != was:
            changed += 1
        if not was_ok and now in {"UNKNOWN", "AMBIGUOUS", "NEGATED", "NO_SPEECH"}:
            failed += 1
        mark = "->" if now != was else "  "
        print(f"{sidecar.stem[:15]} {language}  {was:18} {mark} {now:18} {command:20} {text[:60]}")

    print()
    print(f"{len(sidecars)} clip(s) · {changed} answered differently now · {failed} still unread")
    print(f"(policy: keep {settings.voice_clips} clips, at most "
          f"{settings.voice_clip_bytes // (1024 * 1024)} MB — {folder})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
