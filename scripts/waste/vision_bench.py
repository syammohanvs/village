#!/usr/bin/env python3
"""Score vision models on naming the OBJECT, on the exhibit's own items.

The classifier's classes are materials; a vision model answers with objects.  So
the question this answers is narrow and honest: *does it name the thing*, and
how long does it take?  The class it would imply is printed beside it, but the
bin stays the local classifier's decision (measured 2026-11-19: a vision model
scored 43.9 % exact on the venue probe against the local model's 74.7 %).

  ./scripts/waste/vision_bench.py                       # provider from .env
  ./scripts/waste/vision_bench.py --provider cloudflare
  ./scripts/waste/vision_bench.py --provider cloudflare \
      --model @cf/llama-3.2-11b-vision-instruct
  ./scripts/waste/vision_bench.py --frame path/to/x.jpg=pipe,metal

A "hit" means one of the expected words appears in the answer, so `pipe` counts
`metal pipe`, and `remote` counts `remote control`.  Latency is wall-clock per
photo including the network.
"""
from __future__ import annotations

import argparse
import re
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

import vision
from io import BytesIO

ROOT = Path(__file__).resolve().parent.parent.parent
CAPTURES = ROOT / "data" / "waste-captures"

PROMPT = (
    "Name the single object in this photo in two or three words. "
    "Do not describe the background, the table or the hand. "
    "If there is no object, answer exactly: nothing"
)

# The exhibit's own items, as the operator named them (2026-11-19).  Expected
# words are what a person would accept as "it named the thing"; `strict` is False
# where the operator has judged the *item itself* ambiguous, so a miss there is
# not the model's fault and is reported apart from the score.
FRAMES: list[tuple[Path, tuple[str, ...], str, bool]] = [
    (CAPTURES / "20261118T145745-plastic-0.64.jpg", ("pipe", "tube", "rod"), "Metal", True),
    (CAPTURES / "20261118T145808-plastic-0.84.jpg", ("glue", "bottle", "adhesive"), "Plastic", True),
    # "the cardboard in the pic is small and even humans can call it brown
    # bread, so don't hold it against the model" — the operator, 2026-11-19.
    (CAPTURES / "20261118T150020-plastic-0.58.jpg",
     ("cardboard", "card", "paper", "carton", "bread"), "Paper", False),
    (CAPTURES / "20261118T150118-plastic-0.42.jpg", ("remote", "control"), "Ewaste", True),
    (CAPTURES / "20261118T150330-plastic-0.90.jpg", ("pencil",), "none", True),
    # A sliver of a pen on a white sheet: the frame, not the model.
    (CAPTURES / "20261118T150303-paper-0.35.jpg", ("pen",), "Plastic", False),
]


def jpeg(path: Path, size: int = 224) -> bytes:
    image = Image.open(path).convert("RGB").resize((size, size), Image.BILINEAR)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=92)
    return buffer.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", default="", help="opencode | cloudflare (default: .env)")
    ap.add_argument("--model", default="", help="override the model id")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--frame", action="append", default=[],
                    help="extra photo as PATH=word,word, repeatable")
    args = ap.parse_args()

    conf = vision.settings()
    which = args.provider or vision.provider(conf)
    model = args.model or vision.model_name(conf, which)
    if not which:
        raise SystemExit(
            "no vision provider configured: set VILLAGE_VISION_PROVIDER plus "
            "VILLAGE_VISION_API_KEY, or VILLAGE_CF_ACCOUNT_ID + VILLAGE_CF_API_TOKEN"
        )

    frames = [frame for frame in FRAMES if frame[0].is_file()]
    for item in args.frame:
        path, _, words = item.partition("=")
        frames.append((Path(path), tuple(w.strip() for w in words.split(",") if w.strip()), "?"))
    if not frames:
        raise SystemExit("no frames to score")

    print(f"provider: {which} · model: {model}")
    print(f"{len(frames)} photos, {args.workers} workers\n")

    def one(frame: tuple[Path, tuple[str, ...], str, bool]) -> tuple[str, float]:
        path = frame[0]
        started = time.time()
        answer = vision.ask_object(jpeg(path), PROMPT, which=which, model=model)
        return answer, time.time() - started

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        answers = list(pool.map(one, frames))

    hits = scored = 0
    ambiguous: list[str] = []
    took: list[float] = []
    print(f"{'photo':34} {'answer':30} {'s':>6}  hit")
    for (path, words, truth, strict), (answer, seconds) in zip(frames, answers):
        took.append(seconds)
        hit = bool(answer) and any(re.search(rf"\b{re.escape(w)}", answer, re.I) for w in words)
        scored += int(strict)
        hits += int(hit and strict)
        if not strict:
            ambiguous.append(f"{path.name[-24:]} -> {answer or '(no answer)'}"
                             f" ({'as expected' if hit else 'not named'}, item ambiguous)")
        print(f"{path.name[-34:]:34} {answer[:30] or '(no answer)':30} {seconds:6.1f}  "
              f"{'yes' if hit else 'NO'}  (truth {truth}{'' if strict else ', ambiguous item'})")

    named = sum(1 for answer, _ in answers if answer.strip())
    print(f"\nobject named {named}/{len(frames)}, expected word {hits}/{scored} on the "
          f"{scored} unambiguous items")
    for line in ambiguous:
        print(f"  not scored: {line}")
    if took:
        print(f"latency median {statistics.median(took):.1f}s, slowest {max(took):.1f}s")
    print("\nThe bin is still the local classifier's decision — this only measures naming.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
