#!/usr/bin/env python3
"""Score the deployed waste classifier on a folder of labelled photos.

Talks to the running backend (`POST /api/v1/waste/classify`), so it measures
exactly the model the camera uses rather than a copy of it.

  python3 hand_eval.py --dir /tmp/opencode/hand-smoke
  python3 hand_eval.py --dir ~/.cache/village-waste/v13/val --limit 40

Prints exact-class and item-action accuracy, and a per-class table.  The action
grouping matches the frontend: the seven recycler materials are one outcome, so
a car key read as Metal instead of Ewaste is counted right.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

CLASSES = ["Organic", "Plastic", "Paper", "Glass", "Metal", "Textile", "Leather",
           "Footwear", "Thermocol", "Ewaste", "Background"]
RECYCLING = {"Glass", "Metal", "Textile", "Leather", "Footwear", "Thermocol", "Ewaste"}
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


def action(label: str) -> str:
    """The outcome the app acts on, not the model's label."""
    if label in RECYCLING:
        return "recycling"
    return label


def classify(url: str, image_path: Path, quality: int = 92) -> list[dict]:
    """Exactly what the camera does: resize to 224 and post a JPEG data URL.

    `quality` matters more than it looks: the browser sends the frame as
    `canvas.toDataURL('image/jpeg', q)`, and q is a real accuracy knob, so it is
    a parameter here rather than a constant.
    """
    image = Image.open(image_path).convert("RGB").resize((224, 224), Image.BILINEAR)
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=quality)
    payload = json.dumps({
        "image": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    }).encode()
    request = urllib.request.Request(url, data=payload,
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())["predictions"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--url", default="http://127.0.0.1:8010/api/v1/waste/classify")
    ap.add_argument("--limit", type=int, default=0, help="photos per class (0 = all)")
    ap.add_argument("--quality", type=int, default=92,
                    help="JPEG quality the browser sends (SortWaste uses 0.92)")
    ap.add_argument("--json-out", default="")
    args = ap.parse_args()

    root = Path(args.dir).expanduser()
    per_class: dict[str, list[int]] = {}
    n = exact = act = 0
    rows = []

    for cls in CLASSES:
        folder = root / cls
        if not folder.is_dir():
            continue
        files = sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXT)
        if args.limit:
            files = files[: args.limit]
        if not files:
            continue
        hit_exact = hit_act = 0
        for path in files:
            predictions = classify(args.url, path, args.quality)
            top = max(predictions, key=lambda row: row["probability"])
            label = top["className"]
            confidence = float(top["probability"])
            n += 1
            exact_hit = label == cls
            action_hit = action(label) == action(cls)
            hit_exact += int(exact_hit)
            hit_act += int(action_hit)
            exact += int(exact_hit)
            act += int(action_hit)
            rows.append({"file": str(path), "truth": cls, "guess": label,
                         "confidence": round(confidence, 4),
                         "action_ok": action_hit})
        per_class[cls] = [hit_exact, hit_act, len(files)]
        print(f"  {cls:11s} exact {hit_exact:3d}/{len(files):<3d}   "
              f"action {hit_act:3d}/{len(files):<3d}", flush=True)

    print()
    print(f"TOTAL exact {exact}/{n} = {100.0 * exact / max(1, n):.1f}%   "
          f"action {act}/{n} = {100.0 * act / max(1, n):.1f}%")
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(
            {"n": n, "exact": exact / max(1, n), "action": act / max(1, n),
             "per_class": per_class, "rows": rows}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
