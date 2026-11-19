#!/usr/bin/env python3
"""Build a *venue* set for the waste classifier: one item on a plain sheet.

The exhibit does not photograph objects in a room.  It puts **one item on a red,
green or white sheet** and reads a webcam picture of it.  Every number this
project has quoted — 74.7 % exact, the 241-photo probe, "oranges in cardboard
boxes" — comes from archive photographs: objects on desks, in hands, in rooms.
That is a different problem, and the model's low confidence on the exhibit's own
items is the symptom (a business card at 0.5–0.6, a white remote at 0.37–0.46).

There are no venue photographs to train or measure on yet, so this script
manufactures the condition the way `make_handheld_set.py` manufactures a hand:
it cuts each object out of its own photograph and composites it onto a sheet,
under a lamp, with a shadow.  The label always comes from the object.

Two uses, deliberately separate — the same split the hand-held set uses:

  train   cut-outs from the archive's TRAIN split  → training composites
  probe   cut-outs from the archive's PROBE split  → measurement only

usage:
  python3 make_venue_set.py compose --cutouts ~/.cache/waste-train/cut-train \\
      --out ~/.cache/waste-train/venue-train --copies 2 --negatives 40
  python3 make_venue_set.py compose --cutouts ~/.cache/waste-train/cut-probe \\
      --out ~/.cache/waste-train/venue-probe --copies 1 --layout flat
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

CLASSES = ["Organic", "Plastic", "Paper", "Glass", "Metal", "Textile", "Leather",
           "Footwear", "Thermocol", "Ewaste", "Background"]
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
CANVAS = 512

# The three demonstration sheets.  Chosen as physical cloth/laminate rather than
# pure primaries: a saturated #ff0000 would be a colour no camera produces.
SHEETS = {
    "red": (176, 54, 48),
    "green": (47, 118, 68),
    "white": (238, 237, 231),
}


def sheet(rng, colour):
    """A sheet under a lamp: uneven brightness, noise, a vignette."""
    from PIL import Image, ImageDraw, ImageFilter

    base = Image.new("RGB", (CANVAS, CANVAS), colour)
    # The lamp: a soft ellipse of extra light, off-centre, plus an overall
    # gradient, because a webcam frame is never evenly lit.
    glow = Image.new("L", (CANVAS, CANVAS), 0)
    d = ImageDraw.Draw(glow)
    cx = int(CANVAS * rng.uniform(0.3, 0.7))
    cy = int(CANVAS * rng.uniform(0.2, 0.45))
    rx = int(CANVAS * rng.uniform(0.45, 0.8))
    ry = int(CANVAS * rng.uniform(0.35, 0.7))
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(CANVAS * 0.12))
    amount = rng.uniform(0.04, 0.16)
    lit = Image.new("RGB", (CANVAS, CANVAS), tuple(min(255, int(c * (1 + amount))) for c in colour))
    base = Image.composite(lit, base, glow.point(lambda v: int(v * 0.9)))

    # Vignette: the corners of a sheet in a room are a little darker.
    dark = Image.new("L", (CANVAS, CANVAS), 0)
    dd = ImageDraw.Draw(dark)
    dd.ellipse([-CANVAS * 0.15, -CANVAS * 0.15, CANVAS * 1.15, CANVAS * 1.15],
               fill=255)
    dark = dark.filter(ImageFilter.GaussianBlur(CANVAS * 0.18))
    shadowed = Image.new("RGB", (CANVAS, CANVAS), tuple(int(c * 0.86) for c in colour))
    base = Image.composite(base, shadowed, dark)
    return base


def compose(cutout, sheet_image, rng, share_scale=1.0):
    """Place the object on the sheet with a soft shadow, as a webcam sees it."""
    from PIL import Image, ImageFilter

    scene = sheet_image.copy()
    if cutout is None:
        return scene

    obj = cutout.copy()
    # A card is small on the sheet; a bottle fills it.  Both occur at the venue.
    share = rng.uniform(0.32, 0.42) if rng.random() < 0.22 else rng.uniform(0.45, 0.74)
    share *= share_scale
    long_side = int(CANVAS * share)
    ratio = long_side / max(obj.size)
    obj = obj.resize((max(8, int(obj.width * ratio)), max(8, int(obj.height * ratio))),
                     Image.BILINEAR)
    if rng.random() < 0.7:
        obj = obj.rotate(rng.uniform(-18, 18), expand=True, resample=Image.BICUBIC)

    # The page crops the item out, so it is not always centred in the raw frame.
    jitter = int(CANVAS * 0.06)
    ox = CANVAS // 2 - obj.width // 2 + rng.randint(-jitter, jitter)
    oy = CANVAS // 2 - obj.height // 2 + rng.randint(-jitter, jitter)

    # Contact shadow: the object's own silhouette, blurred, offset, faint.
    shadow = Image.new("RGBA", obj.size, (0, 0, 0, 0))
    shadow.putalpha(obj.split()[-1].point(lambda v: int(v * rng.uniform(0.18, 0.32))))
    shadow = shadow.filter(ImageFilter.GaussianBlur(rng.uniform(5, 12)))
    scene.paste(shadow, (ox + rng.randint(3, 12), oy + rng.randint(4, 14)), shadow)
    scene.paste(obj, (ox, oy), obj)

    if rng.random() < 0.35:
        scene = scene.filter(ImageFilter.GaussianBlur(rng.uniform(0.2, 0.6)))
    return scene


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cutouts", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--copies", type=int, default=2)
    ap.add_argument("--negatives", type=int, default=0)
    ap.add_argument("--layout", choices=["dataset", "flat"], default="dataset")
    ap.add_argument("--quality", type=int, default=92)
    ap.add_argument("--digits", type=int, default=3,
                    help="crop the final image to this many digits (a webcam JPEG)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--share-scale", type=float, default=1.0,
                    help="shrink the item in the frame, which is what a larger "
                         "capture square does (0.86 ≈ the 12%%→30%% pad change)")
    args = ap.parse_args()

    from PIL import Image

    cut_root = Path(args.cutouts).expanduser()
    manifest = json.loads((cut_root / "manifest.json").read_text())
    by_class: dict[str, list[Path]] = {}
    for name, meta in manifest.items():
        by_class.setdefault(meta["class"], []).append(cut_root / name)

    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    written = 0

    for cls in CLASSES:
        items = by_class.get(cls, [])
        if not items:
            continue
        folder = out / cls if args.layout == "dataset" else out
        folder.mkdir(parents=True, exist_ok=True)
        for copy in range(args.copies):
            for src in items:
                cutout = Image.open(src).convert("RGBA")
                colour = SHEETS[rng.choice(sorted(SHEETS))]
                scene = compose(cutout, sheet(rng, colour), rng, args.share_scale)
                tag = src.stem.lower().replace('/', '-')
                name = f"venue-{cls.lower()}-{tag}-{copy:02d}.jpg"
                scene.save(folder / name, quality=args.quality)
                written += 1
        print(f"  {cls:11s} {len(items) * args.copies:4d} scenes", flush=True)

    # An empty sheet must be Background, not Paper: a white sheet is the single
    # most paper-looking thing at the venue and it is what the camera sees when
    # nobody is holding anything.
    if args.negatives:
        folder = out / "Background" if args.layout == "dataset" else out
        folder.mkdir(parents=True, exist_ok=True)
        for i in range(args.negatives):
            colour = SHEETS[rng.choice(sorted(SHEETS))]
            sheet(rng, colour).save(folder / f"venue-empty-{i:03d}.jpg", quality=args.quality)
            written += 1
        print(f"  Background  {args.negatives:4d} empty sheets", flush=True)

    print(f"wrote {written} venue scenes to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
