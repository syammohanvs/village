#!/usr/bin/env python3
"""Measure where the crop should land when an item is held up in a hand.

The venue case is a person holding the item toward the camera.  The frame then
contains three things: the room, the hand, and the item -- and only the item is
the answer.  This script decides, by measurement, how much of the other two to
keep.

It needs scenes where the *same* room and hand exist with and without the item,
which `make_handheld_set.py compose --pairs N` writes:

    python3 make_handheld_set.py compose --cutouts /tmp/opencode/cut-val \\
        --backgrounds ~/.cache/village-waste/v13/train/Background \\
        --out /tmp/opencode/pairs --pairs 6 --layout dataset --seed 5

    python3 measure_hand_crop.py --pairs /tmp/opencode/pairs

Each variant is the page's own pipeline up to the 224 crop, then the installed
model is asked.  The variants:

    current     square around the edge-weighted centre, 1.25x the long side
    tighter     0.9x the long side (the item, less of the arm)
    nohand      current, with skin painted out of the crop
    tight_nohand  both

Run from the repository root with the backend up; it scores through the same
HTTP route the camera uses.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

CLASSES = ["Organic", "Plastic", "Paper", "Glass", "Metal", "Textile", "Leather",
           "Footwear", "Thermocol", "Ewaste", "Background"]
RECYCLING = {"Glass", "Metal", "Textile", "Leather", "Footwear", "Thermocol", "Ewaste"}
ANALYSIS = (160, 120)
CROP = 224
THRESHOLD = 38
DEFAULTS = {"padding": 0.22, "minFraction": 0.003, "maxFraction": 0.98}


def action(label: str) -> str:
    return "recycling" if label in RECYCLING else label


def load(image: Image.Image, size=ANALYSIS) -> Image.Image:
    return image.convert("RGB").resize(size, Image.BILINEAR)


def diff(frame: np.ndarray, room: np.ndarray):
    """focus.ts's `scan`: changed box, edge-weighted centre, edge touch."""
    h, w, _ = frame.shape
    delta = np.abs(frame.astype(np.int16) - room.astype(np.int16)).max(axis=2)
    mask = delta > THRESHOLD
    if not mask.any():
        return None
    ys, xs = np.nonzero(mask)
    if len(xs) / (w * h) < DEFAULTS["minFraction"]:
        return None
    minx, maxx = xs.min(), xs.max()
    miny, maxy = ys.min(), ys.max()
    long_side = max(maxx - minx + 1, maxy - miny + 1)
    if (long_side * long_side) / (w * h) > DEFAULTS["maxFraction"]:
        return None
    edge = np.minimum(np.minimum(xs + 1, ys + 1), np.minimum(w - xs, h - ys))
    weight = edge.astype(np.float64) ** 3
    total = weight.sum()
    if total <= 0:
        return None
    cx = float((xs * weight).sum() / total)
    cy = float((ys * weight).sum() / total)
    return {"long": int(long_side), "centre": (cx, cy), "w": w, "h": h}


def square(centre, side, w, h):
    side = max(8, min(int(round(side)), w, h))
    x = int(round(centre[0] - side / 2))
    y = int(round(centre[1] - side / 2))
    x = max(0, min(x, w - side))
    y = max(0, min(y, h - side))
    return x, y, side


def is_skin(rgb: np.ndarray) -> np.ndarray:
    """The YCbCr window used for the rejection experiment, here as a mask."""
    r, g, b = rgb[:, :, 0].astype(np.float32), rgb[:, :, 1].astype(np.float32), rgb[:, :, 2].astype(np.float32)
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    return (y >= 40) & (cb >= 77) & (cb <= 127) & (cr >= 133) & (cr <= 173)


def build(frame_full: Image.Image, room_full: Image.Image, variant: str) -> Image.Image | None:
    """The page's pipeline up to the 224 crop, for one variant."""
    frame = np.asarray(load(frame_full))
    room = np.asarray(load(room_full))
    found = diff(frame, room)
    if not found:
        return None

    scale = 1.25 if variant in ("current", "nohand") else 0.9
    cap = 0.75 if variant in ("current", "nohand") else 0.6
    side = min(found["w"] * cap, max(8, found["long"] * scale))
    x, y, size = square(found["centre"], side, found["w"], found["h"])

    # Work at the video's own resolution so nothing is thrown away by the
    # analysis frame: scale the box up to the full picture.
    fx = frame_full.width / found["w"]
    fy = frame_full.height / found["h"]
    box = (int(x * fx), int(y * fy), int((x + size) * fx), int((y + size) * fy))
    crop = frame_full.crop(box)

    # Paint out what is still the room, exactly like objectMask.
    room_crop = room_full.crop(box)
    crop_small = np.asarray(crop.resize((size, size), Image.BILINEAR)).astype(np.int16)
    room_small = np.asarray(room_crop.resize((size, size), Image.BILINEAR)).astype(np.int16)
    keep = np.abs(crop_small - room_small).max(axis=2) > THRESHOLD
    if "nohand" in variant:
        keep &= ~is_skin(crop_small)
    if keep.mean() < 0.02:
        keep = np.ones_like(keep, dtype=bool)
    plate = np.full_like(crop_small, 255, dtype=np.uint8)
    plate[keep] = crop_small[keep].astype(np.uint8)
    return Image.fromarray(plate, "RGB").resize((CROP, CROP), Image.BILINEAR)


def classify(api: str, image: Image.Image) -> list[dict]:
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=92)
    body = json.dumps({"image": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}).encode()
    request = urllib.request.Request(api, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())["predictions"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", default="/tmp/opencode/pairs")
    ap.add_argument("--api", default="http://127.0.0.1:8010/api/v1/waste/classify")
    ap.add_argument("--limit", type=int, default=0, help="pairs per class")
    args = ap.parse_args()

    root = Path(args.pairs)
    meta = json.loads((root / "pairs.json").read_text())
    variants = ["current", "tighter", "nohand", "tight_nohand"]
    scores = {v: {"n": 0, "action": 0, "exact": 0} for v in variants}
    per_class: dict[str, dict[str, int]] = {}

    by_class: dict[str, list[str]] = {}
    for name, info in meta.items():
        by_class.setdefault(info["class"], []).append(name)

    for cls, names in sorted(by_class.items()):
        picked = names[: args.limit] if args.limit else names
        for name in picked:
            with_path = root / "with" / cls / name
            without_path = root / "without" / name
            if not with_path.is_file() or not without_path.is_file():
                continue
            frame_full = Image.open(with_path).convert("RGB")
            room_full = Image.open(without_path).convert("RGB")
            for variant in variants:
                crop = build(frame_full, room_full, variant)
                if crop is None:
                    continue
                preds = classify(args.api, crop)
                top = max(preds, key=lambda row: row["probability"])
                scores[variant]["n"] += 1
                scores[variant]["exact"] += int(top["className"] == cls)
                scores[variant]["action"] += int(action(top["className"]) == action(cls))
                per_class.setdefault(cls, {}).setdefault(variant, [0, 0])
                per_class[cls][variant][0] += int(action(top["className"]) == action(cls))
                per_class[cls][variant][1] += 1
        print(f"  {cls:11s} {len(picked)} pairs", flush=True)

    print()
    print(f"{'variant':14s} {'n':>4s}  {'exact':>7s}  {'item action':>11s}")
    for variant in variants:
        s = scores[variant]
        if not s["n"]:
            continue
        print(f"{variant:14s} {s['n']:4d}  {100 * s['exact'] / s['n']:6.1f}%  "
              f"{100 * s['action'] / s['n']:10.1f}%")
    print()
    for cls, rows in sorted(per_class.items()):
        line = "  ".join(f"{v}={100 * rows[v][0] / max(1, rows[v][1]):.0f}%" for v in variants if v in rows)
        print(f"  {cls:11s} {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
