#!/usr/bin/env python3
"""Build a "held in a human hand" set for the waste classifier.

The venue is a dynamic room and the item is shown to the camera in somebody's
hand, so the classifier has to ignore three things that are not the object: the
hand itself, whatever is behind it, and the fact that the object is off-centre,
rotated and partly covered by fingers.

There are no venue photographs to train on, so this script manufactures the
setup from photographs we do have: it cuts each training object out of its own
background, then composites it into a scene with a drawn arm and hand in a
random skin tone, over a real room photograph.  The label always comes from the
object, never from the scene, so the augmentation cannot mislabel a photo -
only the object's appearance is trusted.

Two uses, deliberately separate:

  cutouts   cache cut-outs for a split (train OR val; never both into one dir)
  compose   write composites into a dataset tree for training, or into a flat
            folder used only for measuring

Background negatives are produced too (a hand and a room with no object), which
is the case a venue sees most often and the one an object-only training set
never teaches.

usage:
  python3 make_handheld_set.py cutouts --data ~/.cache/village-waste/v13 \\
      --split train --per-class 60 --out /tmp/opencode/cut-train
  python3 make_handheld_set.py compose --cutouts /tmp/opencode/cut-train \\
      --backgrounds ~/.cache/village-waste/v13/train/Background \\
      --out ~/.cache/village-waste/v14/train --copies 3 --seed 11
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
from pathlib import Path

CLASSES = ["Organic", "Plastic", "Paper", "Glass", "Metal", "Textile", "Leather",
           "Footwear", "Thermocol", "Ewaste", "Background"]
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
CANVAS = 512

# A spread of real skin tones rather than one colour, because the people who
# will hold an item up at the venue are not all the same person.  Values are
# sampled from photographs of hands, dark to light, in no particular order.
SKIN_TONES = [
    (243, 205, 181), (232, 190, 160), (222, 173, 140), (205, 152, 116),
    (189, 131, 96), (171, 112, 78), (150, 95, 63), (128, 78, 50),
    (105, 62, 39), (86, 50, 31), (68, 40, 25), (52, 31, 20),
    (176, 120, 89), (140, 92, 66), (96, 60, 43),
]
# Clothing seen at a sleeve edge, so the model cannot key on bare skin alone.
SLEEVE_COLOURS = [
    (208, 208, 212), (34, 40, 52), (150, 40, 45), (40, 84, 120), (232, 226, 210),
    (96, 104, 72), (188, 160, 120), (60, 60, 60), (240, 240, 240), (120, 60, 130),
]


# --------------------------------------------------------------------------
# cut-outs
# --------------------------------------------------------------------------
def cutouts(args) -> None:
    from rembg import new_session, remove
    from PIL import Image

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    session = new_session(args.model)

    root = Path(args.data).expanduser() / args.split
    if not root.is_dir():
        raise SystemExit(f"no split at {root}")

    manifest = {}
    total = 0
    for cls in CLASSES:
        folder = root / cls
        if not folder.is_dir():
            continue
        files = sorted(f for f in folder.iterdir() if f.suffix.lower() in IMAGE_EXT)
        if not files:
            continue
        # Evenly spaced rather than the first N, so one alphabetical run of
        # near-identical photos cannot stand in for the whole class.
        step = max(1, len(files) // args.per_class)
        chosen = files[::step][: args.per_class]
        kept = 0
        for src in chosen:
            try:
                image = Image.open(src).convert("RGB")
            except Exception:  # noqa: BLE001 - a corrupt photo is skipped, not fatal
                continue
            cut = remove(image, session=session)
            alpha = cut.split()[-1]
            box = alpha.getbbox()
            if box is None:
                continue
            # A mask that keeps almost nothing deleted the object; a mask that
            # keeps almost everything kept the room.  Neither teaches anything.
            coverage = sum(1 for v in alpha.resize((64, 64)).getdata() if v > 127) / (64 * 64)
            if not (0.03 <= coverage <= 0.9):
                continue
            crop = cut.crop(box)
            if min(crop.size) < 24:
                continue
            name = f"{cls}__{src.stem}.png"
            crop.save(out / name)
            manifest[name] = {"class": cls, "source": str(src), "coverage": round(coverage, 3)}
            kept += 1
            total += 1
        print(f"  {cls:11s} {kept}/{len(chosen)} cut out", flush=True)

    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {total} cut-outs to {out}")


# --------------------------------------------------------------------------
# a drawn hand
# --------------------------------------------------------------------------
def _tint(colour, factor, rng):
    jitter = rng.uniform(-0.04, 0.04)
    return tuple(max(0, min(255, int(c * (factor + jitter)))) for c in colour)


def draw_hand(rng, side, grip_point, width, height, scale):
    """Draw an arm coming from `side`, with the object resting in the palm.

    Two passes are returned: the part of the hand BEHIND the object (palm, arm)
    and the part in FRONT of it (fingers, thumb).  A real grip looks like that,
    and if the whole hand were drawn in front the object would be hidden.
    """
    from PIL import Image, ImageDraw, ImageFilter

    skin = rng.choice(SKIN_TONES)
    behind = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    front = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    db, df = ImageDraw.Draw(behind), ImageDraw.Draw(front)

    length = int(min(width, height) * rng.uniform(0.55, 0.8))
    thickness = int(min(width, height) * rng.uniform(0.16, 0.24) * scale)
    cx, cy = grip_point
    # Where the arm enters the frame, and the angle it comes in at.
    margin = length
    if side == "left":
        arm_end = (-margin // 2, cy + rng.randint(-40, 40))
    elif side == "right":
        arm_end = (width + margin // 2, cy + rng.randint(-40, 40))
    elif side == "bottom":
        arm_end = (cx + rng.randint(-60, 60), height + margin // 2)
    else:
        arm_end = (cx + rng.randint(-60, 60), -margin // 2)

    # Arm: a thick line with round caps, tapered by drawing twice.
    db.line([arm_end, (cx, cy)], fill=_tint(skin, 1.0, rng) + (255,), width=thickness,
            joint="curve")
    # Palm.
    palm_rx = int(thickness * rng.uniform(0.95, 1.25))
    palm_ry = int(thickness * rng.uniform(0.8, 1.1))
    db.ellipse([cx - palm_rx, cy - palm_ry, cx + palm_rx, cy + palm_ry],
               fill=_tint(skin, 0.97, rng) + (255,))

    # A sleeve band near the frame edge, when the arm is long enough to show one.
    if rng.random() < 0.55:
        sleeve = rng.choice(SLEEVE_COLOURS)
        t = rng.uniform(0.55, 0.85)
        sx = int(arm_end[0] + (cx - arm_end[0]) * t)
        sy = int(arm_end[1] + (cy - arm_end[1]) * t)
        db.ellipse([sx - thickness, sy - thickness, sx + thickness, sy + thickness],
                   fill=sleeve + (255,))

    # Fingers across the object: short bars from the palm side, curling over it.
    finger_count = rng.randint(3, 4)
    finger_len = int(palm_rx * rng.uniform(1.5, 2.3))
    finger_w = max(6, int(palm_ry * rng.uniform(0.32, 0.46)))
    base_angle = {"left": 0.0, "right": math.pi, "bottom": -math.pi / 2,
                  "top": math.pi / 2}[side]
    spread = rng.uniform(0.5, 1.0)
    for i in range(finger_count):
        frac = (i - (finger_count - 1) / 2) / max(1, finger_count - 1)
        angle = base_angle + frac * spread + rng.uniform(-0.06, 0.06)
        x0 = cx + math.cos(angle) * palm_rx * 0.6
        y0 = cy + math.sin(angle) * palm_ry * 0.6
        x1 = x0 + math.cos(angle) * finger_len
        y1 = y0 + math.sin(angle) * finger_len
        df.line([(x0, y0), (x1, y1)], fill=_tint(skin, 1.02, rng) + (255,),
                width=finger_w, joint="curve")
        df.ellipse([x1 - finger_w / 2, y1 - finger_w / 2,
                    x1 + finger_w / 2, y1 + finger_w / 2],
                   fill=_tint(skin, 1.03, rng) + (255,))
    # Thumb, at one side of the grip.
    thumb_angle = base_angle + rng.choice([-1, 1]) * rng.uniform(0.9, 1.4)
    tx = cx + math.cos(thumb_angle) * palm_rx * 0.8
    ty = cy + math.sin(thumb_angle) * palm_ry * 0.8
    df.line([(cx, cy), (tx, ty)], fill=_tint(skin, 0.95, rng) + (255,),
            width=int(finger_w * 1.25), joint="curve")

    behind = behind.filter(ImageFilter.GaussianBlur(1.1))
    front = front.filter(ImageFilter.GaussianBlur(0.9))
    return behind, front


def _room(rng, backgrounds, width, height):
    """A real room photograph when one is available, otherwise a plain wall."""
    from PIL import Image
    if backgrounds and rng.random() < 0.78:
        src = rng.choice(backgrounds)
        try:
            room = Image.open(src).convert("RGB")
            # Cover the canvas, then take a random square out of it.
            scale = max(width / room.width, height / room.height) * rng.uniform(1.0, 1.35)
            room = room.resize((max(width, int(room.width * scale)),
                                max(height, int(room.height * scale))), Image.BILINEAR)
            x = rng.randint(0, max(0, room.width - width))
            y = rng.randint(0, max(0, room.height - height))
            return room.crop((x, y, x + width, y + height))
        except Exception:  # noqa: BLE001 - fall through to a plain wall
            pass
    from PIL import ImageDraw
    base = [rng.randint(110, 235) for _ in range(3)]
    room = Image.new("RGB", (width, height), tuple(base))
    draw = ImageDraw.Draw(room)
    for _ in range(rng.randint(0, 14)):
        shade = tuple(max(0, min(255, c + rng.randint(-28, 28))) for c in base)
        x0, y0 = rng.randint(-80, width), rng.randint(-80, height)
        draw.rectangle([x0, y0, x0 + rng.randint(40, 260), y0 + rng.randint(40, 260)],
                       fill=shade)
    return room


def compose_pair(cutout, backgrounds, rng):
    """A scene, and the SAME scene with the object taken away.

    Both come out of one RNG stream, so the room, the hand, the light and the
    blur are identical: the only difference between the two pictures is the
    item.  That is what makes it possible to measure a crop or a mask honestly
    -- the "room" is the pair, not an assumption.
    """
    from PIL import Image, ImageFilter

    room = _room(rng, backgrounds, CANVAS, CANVAS).convert("RGBA")
    side = rng.choice(["left", "right", "bottom"])
    cx = int(CANVAS * rng.uniform(0.38, 0.62))
    cy = int(CANVAS * rng.uniform(0.42, 0.6))
    behind, front = draw_hand(rng, side, (cx, cy), CANVAS, CANVAS,
                              rng.uniform(0.9, 1.25))

    obj = None
    box = None
    if cutout is not None:
        obj = cutout.copy()
        long_side = int(CANVAS * rng.uniform(0.45, 0.8))
        ratio = long_side / max(obj.size)
        obj = obj.resize((max(8, int(obj.width * ratio)), max(8, int(obj.height * ratio))),
                         Image.BILINEAR)
        if rng.random() < 0.5:
            obj = obj.rotate(rng.uniform(-20, 20), expand=True, resample=Image.BICUBIC)
        ox = cx - obj.width // 2 + rng.randint(-int(CANVAS * 0.08), int(CANVAS * 0.08))
        oy = cy - obj.height // 2 + rng.randint(-int(CANVAS * 0.08), int(CANVAS * 0.08))
        ox = max(-obj.width // 5, min(ox, CANVAS - obj.width * 4 // 5))
        oy = max(-obj.height // 5, min(oy, CANVAS - obj.height * 4 // 5))
        box = (ox, oy, ox + obj.width, oy + obj.height)

    blur = rng.uniform(0.3, 0.9) if rng.random() < 0.5 else None

    def finish(layers):
        scene = room.copy()
        for layer in layers:
            scene.alpha_composite(layer)
        if blur:
            scene = scene.filter(ImageFilter.GaussianBlur(blur))
        return scene.convert("RGB")

    without = finish([behind, front])
    if obj is None:
        return without, without, None, room.convert("RGB")

    shadow = Image.new("RGBA", obj.size, (0, 0, 0, 0))
    shadow.putalpha(obj.split()[-1].point(lambda v: int(v * 0.35)))
    # The object sits between the palm and the fingers, as a held item does.
    behind_with_shadow = behind.copy()
    behind_with_shadow.alpha_composite(shadow, (box[0] + 6, box[1] + 8))
    behind_with_shadow.alpha_composite(obj, (box[0], box[1]))
    with_object = finish([behind_with_shadow, front])
    return with_object, without, box, room.convert("RGB")


def compose_scene(cutout, backgrounds, rng, with_object=True):
    """One 512x512 scene: a room, an object (maybe), and a hand holding it."""
    scene, without, _, _ = compose_pair(cutout if with_object else None, backgrounds, rng)
    return scene if with_object else without


# --------------------------------------------------------------------------
# compose
# --------------------------------------------------------------------------
def compose(args) -> None:
    from PIL import Image

    cut_root = Path(args.cutouts).expanduser()
    manifest = json.loads((cut_root / "manifest.json").read_text())
    by_class: dict[str, list[Path]] = {}
    for name, meta in manifest.items():
        by_class.setdefault(meta["class"], []).append(cut_root / name)

    backgrounds = []
    if args.backgrounds:
        bdir = Path(args.backgrounds).expanduser()
        if bdir.is_dir():
            backgrounds = [p for p in sorted(bdir.iterdir()) if p.suffix.lower() in IMAGE_EXT]
    print(f"{len(manifest)} cut-outs, {len(backgrounds)} room photographs")

    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    written = 0
    pair_meta: dict[str, dict] = {}

    for cls in CLASSES:
        if args.pairs:
            continue
        items = by_class.get(cls, [])
        if not items:
            continue
        folder = out / cls if args.layout == "dataset" else out
        folder.mkdir(parents=True, exist_ok=True)
        for i in range(args.copies):
            for src in items:
                cutout = Image.open(src).convert("RGBA")
                scene = compose_scene(cutout, backgrounds, rng, with_object=True)
                # The whole cut-out stem, not its tail: two source photos can
                # end in the same number (`base__12` and `extra__12`) and the
                # later composite would overwrite the earlier one.
                tag = src.stem.lower().replace('/', '-')
                name = f"hand-{cls.lower()}-{tag}-{i:02d}.jpg"
                scene.save(folder / name, quality=args.quality)
                written += 1
        print(f"  {cls:11s} {len(items) * args.copies} composites", flush=True)

    if args.pairs:
        # Same room and same hand, twice: with the item and without it.  A crop
        # or a mask can then be measured against the truth instead of against
        # an assumption, and the "room" is exact rather than approximate.
        room_dir = out / "without"   # the same scene, hand only, no item
        room_dir.mkdir(parents=True, exist_ok=True)
        bare_dir = out / "rooms"     # the room on its own: what the page learns
        bare_dir.mkdir(parents=True, exist_ok=True)
        for cls in CLASSES:
            items = by_class.get(cls, [])
            if not items:
                continue
            folder = out / "with" / cls
            folder.mkdir(parents=True, exist_ok=True)
            for src in items[: args.pairs]:
                cutout = Image.open(src).convert("RGBA")
                with_object, without, box, room_only = compose_pair(cutout, backgrounds, rng)
                name = f"pair-{cls.lower()}-{src.stem.lower()}.jpg"
                with_object.save(folder / name, quality=args.quality)
                without.save(room_dir / name, quality=args.quality)
                room_only.save(bare_dir / name, quality=args.quality)
                pair_meta[name] = {"class": cls, "box": box}
            print(f"  {cls:11s} {len(items[: args.pairs])} pairs", flush=True)
        (out / "pairs.json").write_text(json.dumps(pair_meta, indent=1))

    # Negatives: a hand and a room, no object.  Without these the model learns
    # "hand in frame means something is being shown", which is exactly wrong.
    if args.negatives and args.layout == "dataset":
        folder = out / "Background"
        folder.mkdir(parents=True, exist_ok=True)
        for i in range(args.negatives):
            scene = compose_scene(None, backgrounds, rng, with_object=False)
            scene.save(folder / f"hand-empty-{i:04d}.jpg", quality=args.quality)
            written += 1
        print(f"  Background  {args.negatives} hand-only negatives")

    print(f"wrote {written} images to {out}")


# --------------------------------------------------------------------------
def plates(args) -> None:
    """Empty white plates, labelled Background.

    The page paints the room out of the crop and replaces it with a plain white
    plate, so the classifier is regularly handed a mostly-white picture with an
    item on it -- and sometimes a nearly empty one, when the paint-out keeps
    almost nothing. Measured: a plain white 224x224 square is read as **Paper
    0.69**, and a white plate with a small dark object on it is still Paper
    0.67. That is why a key fob came back as paper.

    These are negatives: nothing on the plate at all. Teaching the model that an
    empty plate is Background is what stops the plate from voting for a class.
    """
    from PIL import Image, ImageDraw, ImageFilter

    hand_out = Path(args.out).expanduser() / "Background"
    if args.hands:
        # An empty hand, as the page shows it to the model: the crop is the
        # hand, the room around it is painted out, so it arrives on a plain
        # plate. Measured at the venue: that picture was being called a
        # material. It is not waste, so it is Background.
        hand_out.mkdir(parents=True, exist_ok=True)
        rng_hand = random.Random(args.seed + 1)
        for i in range(args.hands):
            plate = Image.new("RGB", (CANVAS, CANVAS), (rng_hand.choice([
                (255, 255, 255), (250, 250, 248), (243, 243, 240),
            ])))
            behind, front = draw_hand(rng_hand, rng_hand.choice(["left", "right", "bottom"]),
                                      (CANVAS // 2, CANVAS // 2), CANVAS, CANVAS,
                                      rng_hand.uniform(0.8, 1.3))
            plate = plate.convert("RGBA")
            plate.alpha_composite(behind)
            plate.alpha_composite(front)
            plate.convert("RGB").resize((224, 224), Image.BILINEAR).save(
                hand_out / f"empty-hand-{i:04d}.jpg", quality=92)
        print(f"wrote {args.hands} empty hands to {hand_out}")

    out = Path(args.out).expanduser() / "Background"
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    for i in range(args.count):
        base = rng.choice([
            (255, 255, 255), (250, 250, 248), (243, 243, 240),
            (236, 236, 232), (228, 228, 224),
        ])
        plate = Image.new("RGB", (CANVAS, CANVAS), base)
        draw = ImageDraw.Draw(plate)
        # A faint shadow or crease: a real plate is never a perfect field.
        for _ in range(rng.randint(0, 3)):
            shade = tuple(max(0, min(255, c - rng.randint(2, 14))) for c in base)
            x0, y0 = rng.randint(-60, CANVAS), rng.randint(-60, CANVAS)
            draw.ellipse([x0, y0, x0 + rng.randint(80, 320), y0 + rng.randint(80, 320)],
                         fill=shade)
        if rng.random() < 0.5:
            plate = plate.filter(ImageFilter.GaussianBlur(rng.uniform(0.4, 1.6)))
        plate.resize((224, 224), Image.BILINEAR).save(
            out / f"empty-plate-{i:04d}.jpg", quality=92)
    print(f"wrote {args.count} empty plates to {out}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("cutouts", help="cache cut-outs for one split")
    c.add_argument("--data", required=True)
    c.add_argument("--split", default="train")
    c.add_argument("--per-class", type=int, default=60)
    c.add_argument("--model", default="u2netp")
    c.add_argument("--out", required=True)
    c.set_defaults(func=cutouts)

    p = sub.add_parser("compose", help="build composites from cached cut-outs")
    p.add_argument("--cutouts", required=True)
    p.add_argument("--backgrounds", default="")
    p.add_argument("--out", required=True)
    p.add_argument("--copies", type=int, default=3)
    p.add_argument("--negatives", type=int, default=0)
    p.add_argument("--pairs", type=int, default=0,
                   help="also write the same scene with and without the item, for "
                        "measuring a crop or a mask (see measure_hand_crop.py)")
    p.add_argument("--layout", choices=["dataset", "flat"], default="dataset")
    p.add_argument("--quality", type=int, default=92)
    p.add_argument("--seed", type=int, default=11)
    p.set_defaults(func=compose)

    pl = sub.add_parser("plates", help="empty white plates, labelled Background")
    pl.add_argument("--out", required=True)
    pl.add_argument("--count", type=int, default=300)
    pl.add_argument("--hands", type=int, default=0,
                    help="also write empty hands on a plain plate (the pipeline's "
                         "own picture of 'nothing is being shown')")
    pl.add_argument("--seed", type=int, default=21)
    pl.set_defaults(func=plates)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
