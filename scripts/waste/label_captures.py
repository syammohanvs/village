#!/usr/bin/env python3
"""Propose a class for each *take* the venue's camera saved, using a vision model.

Every frame the classifier is shown is kept (`data/waste-captures/`, bounded), so
after a session at the bins the log holds what the visitors actually showed.  A
"take" is one item: consecutive captures less than `--gap` seconds apart, with
the frame whose item fills most of the square chosen as its representative.

For each take it prints what the served classifier said, what the vision model
says the object is, and the class the vision model named.  **It prints, it does
not promote** — the operator strikes out what is wrong, then
`promote_captures.py` files the good ones and `train_handheld_head.py
--extra-train` learns from them.

The vision model is a *labeller*, not a classifier: measured 2026-11-19 it scored
43.9% exact on the 236-photo probe against the local model's 70.7%, and on a bare
red surface it invents objects ("Baseball", "Red high heel").  Its one job here
is naming the object, which it does well.

  ./scripts/waste/label_captures.py --since 2026-11-18T14:55
  ./scripts/waste/label_captures.py --since 2026-11-18T14:55 --gap 20 --workers 4
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import vision

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent.parent
CAPTURES = ROOT / "data" / "waste-captures"
CLASSES = ["Organic", "Plastic", "Paper", "Glass", "Metal", "Textile", "Leather",
           "Footwear", "Thermocol", "Ewaste", "Background"]
PROMPT = (
    "You are the waste-sorting assistant for a village exhibit in India. "
    "Name the single object in the photo, then choose ONE word from this list: "
    + ", ".join(CLASSES) + ". "
    "A remote control, a charger, a small electrical pump or a phone is Ewaste. "
    "Cardboard, newspaper or a paper bag is Paper. "
    "Answer in exactly this form: <object> = <word>"
)


def jpeg(path: Path, size: int = 224) -> bytes:
    image = Image.open(path).convert("RGB").resize((size, size), Image.BILINEAR)
    from io import BytesIO

    buf = BytesIO()
    image.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def takes(since: str, gap: float, limit: int) -> list[tuple[str, Path]]:
    """One representative frame per item, newest first."""
    rows = []
    for line in CAPTURES.joinpath("index.jsonl").read_text().splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if row["at"] < since:
            continue
        path = CAPTURES / row["file"]
        if not path.is_file():
            continue
        rows.append((datetime.strptime(row["at"][:19], "%Y-%m-%dT%H:%M:%S"), path))
    rows.sort()
    groups: list[list] = []
    for moment, path in rows:
        if groups and (moment - groups[-1][-1][0]).total_seconds() <= gap:
            groups[-1].append((moment, path))
        else:
            groups.append([(moment, path)])
    out = []
    for group in groups:
        if len(group) < 2:
            continue  # a single frame is usually the camera moving, not an item
        # the representative: the least red/pale margin is hard to know here, so
        # take the middle frame of the take, which is the one held still
        moment, path = group[len(group) // 2]
        out.append((moment.strftime("%m-%d %H:%M:%S"), path))
    return out[-limit:] if limit else out


def ask(path: Path, which: str | None = None, model: str | None = None) -> tuple[str, str, bool]:
    """(object phrase, class, answered) for one take, from the configured provider."""
    for attempt in range(3):
        text = vision.ask_object(jpeg(path), PROMPT, which=which, model=model)
        if text:
            break
        time.sleep(3)  # a labeller must not crash a session over one photo
    else:
        return "", "?", False
    phrase = text.split("=")[0].strip(" .*`")
    for cls in CLASSES:
        if re.search(rf"\b{cls}\b", text.split("=")[-1], re.I):
            return phrase[:38], cls, True
    return phrase[:38], "?", False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", required=True, help="captures at or after this ISO time")
    ap.add_argument("--gap", type=float, default=15.0, help="seconds between takes")
    ap.add_argument("--limit", type=int, default=40, help="most recent takes to label")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--sheet", default="/tmp/opencode/takes-labelled.png")
    ap.add_argument("--provider", default="", help="opencode | cloudflare (default: .env)")
    ap.add_argument("--model", default="", help="override the model id")
    args = ap.parse_args()

    conf = vision.settings()
    which = vision.provider(conf)
    model = args.model or vision.model_name(conf, which)
    if args.provider:
        which = args.provider
    if not which:
        raise SystemExit(
            "no vision provider configured: set VILLAGE_VISION_PROVIDER and a key "
            "in .env (VILLAGE_VISION_API_KEY, or VILLAGE_CF_ACCOUNT_ID + VILLAGE_CF_API_TOKEN)"
        )
    print(f"provider: {which} · model: {model}")

    found = takes(args.since, args.gap, args.limit)
    if not found:
        raise SystemExit("no takes found in that window")
    print(f"{len(found)} takes since {args.since}")
    rows = []
    started = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        labels = [pool.submit(ask, path, which, model) for _, path in found]
        for (stamp, path), label in zip(found, labels):
            phrase, cls, answered = label.result()
            rows.append({"at": stamp, "file": path.name, "vision": cls,
                         "object": phrase, "answered": answered})
            print(f"  {stamp}  {cls:10} {phrase}")

    answered = sum(1 for row in rows if row["answered"])
    print(f"\n{len(rows)} takes, {answered} answered, {time.time() - started:.0f}s")
    print("Nothing has been promoted.  Strike out what is wrong, then:")
    print("  ./scripts/waste/promote_captures.py --class <Class> --file <capture> …")

    cell, cols = 150, 8
    height = (len(rows) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, height * (cell + 30)), (24, 24, 24))
    draw = ImageDraw.Draw(sheet)
    for index, row in enumerate(rows):
        image = Image.open(CAPTURES / row["file"]).convert("RGB").resize((cell, cell))
        x = (index % cols) * cell
        y = (index // cols) * (cell + 30)
        sheet.paste(image, (x, y))
        draw.text((x + 3, y + cell + 1), f"{index + 1}. {row['vision']}", fill=(255, 255, 255))
        draw.text((x + 3, y + cell + 14), f"   {row['object'][:22]}", fill=(180, 180, 180))
    sheet.save(args.sheet)
    print(f"contact sheet: {args.sheet}")
    Path("/tmp/opencode/takes-labelled.json").write_text(json.dumps(rows, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
