#!/usr/bin/env python3
"""Train on what the pipeline actually shows the model, not on raw photos.

Two failures at the venue had the same shape:

  * a plain white plate — what the paint-out leaves when it keeps almost nothing
    — is read as **Paper 0.69**;
  * an empty hand held up (no item at all) is read as a material, because the
    hand *is* a big change from the room and so it becomes the crop.

Neither is a mystery once you look at the picture: the model has only ever been
trained on photographs of objects, and at the venue it is shown
"hand + item on a white plate" and, when nothing is being shown,
"hand on a white plate". Those are different pictures, and nobody taught it
about them.

So this builds a training set out of the pipeline's own output:

    with an item        -> the item's class
    without an item     -> Background  (an empty hand is not waste)

It needs scene pairs (`make_handheld_set.py compose --pairs N`), because the
crop and the mask are computed against the same room with the item taken away --
the same comparison the page makes against its learned room.

    python3 make_handheld_set.py compose --cutouts /tmp/opencode/cut-val \\
        --backgrounds ~/.cache/village-waste/v13/train/Background \\
        --out /tmp/opencode/pairs --pairs 20 --layout dataset --seed 9
    python3 make_pipeline_set.py --pairs /tmp/opencode/pairs \\
        --out /tmp/opencode/pipeline-set

Then add the tree to a retrain:

    train_handheld_head.py ... --extra-train /tmp/opencode/pipeline-set
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

# The crop and the mask are the page's, so they are taken from the one script
# that already mirrors them rather than written a second time.
from measure_hand_crop import CLASSES, build


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", default="/tmp/opencode/pairs")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0, help="pairs per class")
    args = ap.parse_args()

    root = Path(args.pairs)
    out = Path(args.out).expanduser()
    meta = json.loads((root / "pairs.json").read_text())

    by_class: dict[str, list[str]] = {}
    for name, info in meta.items():
        by_class.setdefault(info["class"], []).append(name)

    written = {"item": 0, "empty": 0}
    for cls in CLASSES:
        names = sorted(by_class.get(cls, []))
        if args.limit:
            names = names[: args.limit]
        if not names:
            continue
        item_dir = out / cls
        item_dir.mkdir(parents=True, exist_ok=True)
        empty_dir = out / "Background"
        empty_dir.mkdir(parents=True, exist_ok=True)
        for name in names:
            with_path = root / "with" / cls / name
            bare_path = root / "rooms" / name
            hand_path = root / "without" / name
            if not with_path.is_file() or not bare_path.is_file():
                continue
            # The room on its own is what the page learns; both frames below are
            # compared against it, exactly as the page does.
            room = Image.open(bare_path).convert("RGB")

            # With the item: the crop the page hands the model.
            crop = build(Image.open(with_path).convert("RGB"), room, "current")
            if crop is not None:
                crop.save(item_dir / f"pipe-{name}", quality=92)
                written["item"] += 1

            # Without it: a hand held up with nothing in it. This is the picture
            # that was being called a material at the venue.
            if hand_path.is_file():
                empty = build(Image.open(hand_path).convert("RGB"), room, "current")
            else:
                empty = None
            if empty is None:
                # Nothing changed, so the page classifies nothing -- but a blank
                # plate is what a partly matching mask leaves, so it is still
                # worth teaching as Background.
                empty = Image.new("RGB", (224, 224), (252, 252, 250))
            empty.save(empty_dir / f"pipe-{name}", quality=92)
            written["empty"] += 1
        print(f"  {cls:11s} {len(names)}", flush=True)

    print(f"wrote {written['item']} item crops and {written['empty']} empty ones to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
