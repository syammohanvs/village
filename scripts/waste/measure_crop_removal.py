#!/usr/bin/env python3
"""Measure what a background remover is worth before the classifier sees a frame.

The Sort Waste camera compares each frame with an empty-scene snapshot, crops to
what changed, and then paints out the part of the crop that is still the empty
scene (see `web/frontend/src/lib/focus.ts::objectMask`).  This script exists so
that decision can be re-checked instead of trusted, and so the alternative that
was rejected — a general subject-cutout model — does not have to be rediscovered.

It builds the test set the honest way.  A studio photo of an item on a plain
plate is not what the camera sees; an item on a cluttered table is.  So real
object photos are cut out and pasted onto real room photos, and the same 200-odd
items are then classified in five different renderings.

    # 1. build the scenes (object photos -> on top of room photos)
    python3 scripts/waste/measure_crop_removal.py scenes \
      --items ~/.cache/village-waste/v2/probe \
      --rooms ~/.cache/village-waste/v2/train/Background \
      --out /tmp/crop-removal --n 240

    # 2. the crop and the subtraction, as class trees the scorer understands
    python3 scripts/waste/measure_crop_removal.py variants \
      --scenes /tmp/crop-removal/scenes \
      --rooms /tmp/crop-removal/rooms \
      --out /tmp/crop-removal --sub-thresh 38

    # 3. (optional) the rejected alternative, which needs onnxruntime + u2net
    python3 scripts/waste/measure_crop_removal.py cutout \
      --model /path/u2net.onnx --out /tmp/crop-removal/cutout \
      /tmp/crop-removal/scenes

    # 4. score each tree with the installed model
    node scripts/waste/evaluate_waste_model.mjs --model models/waste \
      --data /tmp/crop-removal/tree/subtract --modules ~/.cache/village-waste

Results of the last run are in docs/verification.md.  Headline: item-level
action accuracy is 8.6% whole frame, 32.9% crop only, 52.7% cutout inside the
crop, 60.5% crop with the stored scene painted out.
"""
import argparse
import os
import random
import shutil
import sys

import numpy as np
from PIL import Image, ImageFilter

IMAGE_RE = (".jpg", ".jpeg", ".png", ".webp")
DIFF_W = 160          # the app's analysis frame
DIFF_H = 120
MASK_W = 320          # resolution the subtraction mask is computed at


# --------------------------------------------------------------------------- #
# scene building
# --------------------------------------------------------------------------- #

def _onnx_session(model: str):
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    so.intra_op_num_threads = max(1, (os.cpu_count() or 4) - 1)
    return ort.InferenceSession(model, so, providers=["CPUExecutionProvider"])


def _cutout_rgba(img: Image.Image, sess) -> Image.Image:
    """The subject of one photo on a transparent plate (u2net, 320x320)."""
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    small = img.convert("RGB").resize((320, 320), Image.BILINEAR)
    a = (np.asarray(small, dtype=np.float32) / 255.0 - mean) / std
    x = np.transpose(a, (2, 0, 1))[None, ...].astype(np.float32)
    out = sess.run(None, {sess.get_inputs()[0].name: x})[0]
    m = np.squeeze(out).astype(np.float32)
    lo, hi = float(m.min()), float(m.max())
    m = (m - lo) / (hi - lo) if hi > lo else np.zeros_like(m)
    mask = Image.fromarray((m * 255).astype(np.uint8), "L").resize(img.size, Image.BILINEAR)
    rgb = np.asarray(img.convert("RGB"), dtype=np.float32)
    alpha = np.asarray(mask, dtype=np.float32)[..., None] / 255.0
    rgba = np.concatenate([rgb, alpha * 255.0], axis=2).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def cmd_scenes(args) -> int:
    if not args.cutout_model:
        print("--cutout-model is needed to isolate the objects", file=sys.stderr)
        return 2
    rnd = random.Random(args.seed)
    rooms = [os.path.join(args.rooms, f) for f in sorted(os.listdir(args.rooms))
             if f.lower().endswith(IMAGE_RE)]
    items = []
    for cls in sorted(os.listdir(args.items)):
        folder = os.path.join(args.items, cls)
        if not os.path.isdir(folder):
            continue
        for f in sorted(os.listdir(folder)):
            if f.lower().endswith(IMAGE_RE):
                items.append((cls, os.path.join(folder, f)))
    if not rooms or not items:
        print("need room photos and object photos", file=sys.stderr)
        return 2

    sess = _onnx_session(args.cutout_model)
    for name in ("scenes", "rooms", "crops", "oracle"):
        os.makedirs(os.path.join(args.out, name), exist_ok=True)
    truth = os.path.join(args.out, "scenes", "truth")
    os.makedirs(truth, exist_ok=True)

    rnd.shuffle(items)
    made = 0
    for cls, path in items:
        if made >= args.n:
            break
        try:
            obj = _cutout_rgba(Image.open(path), sess)
        except Exception:
            continue
        if np.asarray(obj.split()[-1]).mean() < 12:
            continue          # the cutout kept nothing, so there is no object
        room = Image.open(rnd.choice(rooms)).convert("RGB").resize((640, 480), Image.LANCZOS)
        share = rnd.uniform(0.33, 0.55)
        side = int(min(room.size) * share)
        w, h = obj.size
        obj = obj.resize((side, max(1, int(side * h / w))), Image.LANCZOS)
        obj = obj.rotate(rnd.uniform(-18, 18), expand=True, resample=Image.BICUBIC)
        x = rnd.randint(0, max(0, room.size[0] - obj.size[0]))
        y = rnd.randint(0, max(0, room.size[1] - obj.size[1]))
        empty = room.copy()                       # the table before the item
        room.paste(obj, (x, y), obj)
        stem = f"{cls.lower()}-{made:04d}"
        room.save(os.path.join(args.out, "scenes", stem + ".jpg"), quality=92)
        empty.save(os.path.join(args.out, "rooms", stem + ".jpg"), quality=92)
        open(os.path.join(truth, stem + ".txt"), "w").write(cls + "\n")
        # What the focus step hands on today: a square around the changed box.
        bw, bh = obj.size
        cx, cy = x + bw / 2.0, y + bh / 2.0
        side2 = int(max(bw, bh) * 1.15)
        left = max(0, min(room.size[0] - side2, int(cx - side2 / 2)))
        top = max(0, min(room.size[1] - side2, int(cy - side2 / 2)))
        room.crop((left, top, left + side2, top + side2)).save(
            os.path.join(args.out, "crops", stem + ".jpg"), quality=92)
        # The ceiling: the item alone, as if everything else were removed perfectly.
        plate = Image.new("RGB", obj.size, "white")
        plate.paste(obj, (0, 0), obj)
        plate.save(os.path.join(args.out, "oracle", stem + ".jpg"), quality=92)
        made += 1
        if made % 20 == 0:
            print(f"  {made} scenes", flush=True)
    print(f"made {made} scenes -> {args.out}")
    return 0


# --------------------------------------------------------------------------- #
# the subtraction, mirroring focus.ts
# --------------------------------------------------------------------------- #

def _changed_box(scene: Image.Image, room: Image.Image):
    a = np.asarray(scene.convert("L").resize((DIFF_W, DIFF_H), Image.BILINEAR), dtype=np.int16)
    b = np.asarray(room.convert("L").resize((DIFF_W, DIFF_H), Image.BILINEAR), dtype=np.int16)
    hot = np.abs(a - b) > 26
    if hot.mean() < 0.004:
        return None
    ys, xs = np.nonzero(hot)
    sx = scene.size[0] / DIFF_W
    sy = scene.size[1] / DIFF_H
    return (int(xs.min() * sx), int(ys.min() * sy),
            int((xs.max() + 1) * sx), int((ys.max() + 1) * sy))


def _square(box, size, pad=1.2):
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    side = max(max(x1 - x0, y1 - y0) * pad, 24)
    left = int(min(max(0, cx - side / 2), max(0, size[0] - side)))
    top = int(min(max(0, cy - side / 2), max(0, size[1] - side)))
    side = int(min(side, size[0] - left, size[1] - top))
    return (left, top, left + side, top + side)


def subtract(scene: Image.Image, room: Image.Image, thresh: int):
    """The item on a white plate, or None when no usable mask exists."""
    box = _changed_box(scene, room)
    if box is None:
        return None
    rect = _square(box, scene.size)
    s = scene.crop(rect).convert("RGB").resize((MASK_W, MASK_W), Image.BILINEAR)
    r = room.crop(rect).convert("RGB").resize((MASK_W, MASK_W), Image.BILINEAR)
    d = np.abs(np.asarray(s, dtype=np.int16) - np.asarray(r, dtype=np.int16)).max(axis=2)
    m = (d > thresh).astype(np.uint8) * 255
    # Same opening the page gets from scaling the 160x120 mask up to 224: close
    # one-pixel speckle and soften the edge.
    mask = Image.fromarray(m, "L").filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(3))
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))
    alpha = np.asarray(mask, dtype=np.float32)[..., None] / 255.0
    if alpha.mean() < 0.02:
        return None           # an almost empty plate is refused, not used
    rgb = np.asarray(s, dtype=np.float32)
    plate = np.full_like(rgb, 255.0)
    return Image.fromarray((rgb * alpha + plate * (1.0 - alpha)).astype(np.uint8), "RGB")


def _class_tree(source: str, truth_dir: str, dest: str) -> int:
    """Copy `<source>/<stem>.(jpg|png)` into `<dest>/val/<class>/`."""
    count = 0
    for f in sorted(os.listdir(source)):
        if not f.lower().endswith(IMAGE_RE):
            continue
        label = os.path.join(truth_dir, os.path.splitext(f)[0] + ".txt")
        if not os.path.exists(label):
            continue
        cls = open(label).read().strip()
        target = os.path.join(dest, "val", cls)
        os.makedirs(target, exist_ok=True)
        shutil.copy(os.path.join(source, f), os.path.join(target, f))
        count += 1
    return count


def cmd_variants(args) -> int:
    out = os.path.join(args.out, "tree")
    subtracted = os.path.join(args.out, "subtracted")
    os.makedirs(subtracted, exist_ok=True)
    skipped = 0
    for f in sorted(os.listdir(args.scenes)):
        if not f.lower().endswith(IMAGE_RE):
            continue
        stem = os.path.splitext(f)[0]
        room = os.path.join(args.rooms, stem + ".jpg")
        if not os.path.exists(room):
            continue
        got = subtract(Image.open(os.path.join(args.scenes, f)), Image.open(room), args.sub_thresh)
        if got is None:
            skipped += 1
            continue
        got.save(os.path.join(subtracted, stem + ".png"))
    truth = os.path.join(args.scenes, "truth")
    made = {
        "whole": _class_tree(args.scenes, truth, os.path.join(out, "whole")),
        "crop": _class_tree(os.path.join(args.out, "crops"), truth, os.path.join(out, "crop")),
        "oracle": _class_tree(os.path.join(args.out, "oracle"), truth, os.path.join(out, "oracle")),
        "subtract": _class_tree(subtracted, truth, os.path.join(out, "subtract")),
    }
    for name, n in made.items():
        print(f"  tree/{name:12s} {n} photos")
    print(f"subtraction kept a usable mask for {made['subtract']}, refused {skipped}")
    print("\nNow score each tree, e.g.\n"
          f"  node scripts/waste/evaluate_waste_model.mjs --model models/waste \\\n"
          f"    --data {out}/subtract --modules ~/.cache/village-waste")
    return 0


# --------------------------------------------------------------------------- #
# the rejected alternative, kept so it is not re-derived from scratch
# --------------------------------------------------------------------------- #

def cmd_cutout(args) -> int:
    sess = _onnx_session(args.model)
    os.makedirs(args.out, exist_ok=True)
    files = []
    for item in args.inputs:
        if os.path.isdir(item):
            files += [os.path.join(item, f) for f in sorted(os.listdir(item))
                      if f.lower().endswith(IMAGE_RE)]
        else:
            files.append(item)
    for i, path in enumerate(files, 1):
        img = Image.open(path)
        obj = _cutout_rgba(img, sess)
        plate = Image.new("RGB", img.size, "white")
        plate.paste(obj, (0, 0), obj)
        plate.save(os.path.join(args.out, os.path.splitext(os.path.basename(path))[0] + ".png"))
        if i % 25 == 0:
            print(f"  {i}/{len(files)}", flush=True)
    print(f"cut out {len(files)} photos -> {args.out}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    scenes = sub.add_parser("scenes", help="paste object photos onto room photos")
    scenes.add_argument("--items", required=True, help="one subfolder per material")
    scenes.add_argument("--rooms", required=True, help="room photos with no item")
    scenes.add_argument("--out", required=True)
    scenes.add_argument("--n", type=int, default=240)
    scenes.add_argument("--seed", type=int, default=7)
    scenes.add_argument("--cutout-model", default="/tmp/opencode/bgmodels/u2net.onnx",
                        help="u2net ONNX file used to isolate each object")
    scenes.set_defaults(func=cmd_scenes)

    variants = sub.add_parser("variants", help="crop + subtraction, as class trees")
    variants.add_argument("--scenes", required=True)
    variants.add_argument("--rooms", required=True)
    variants.add_argument("--out", required=True)
    # The page's own DEFAULTS.threshold in focus.ts, so the measurement
    # describes the shipped behaviour rather than a nearby setting.
    variants.add_argument("--sub-thresh", type=int, default=38)
    variants.set_defaults(func=cmd_variants)

    cut = sub.add_parser("cutout", help="the rejected AI remover, for comparison")
    cut.add_argument("--model", required=True)
    cut.add_argument("--out", required=True)
    cut.add_argument("inputs", nargs="+")
    cut.set_defaults(func=cmd_cutout)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
