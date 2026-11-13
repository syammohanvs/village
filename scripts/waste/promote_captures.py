#!/usr/bin/env python3
"""Turn saved captures into training photos, under the class they really are.

`data/waste-captures/` already holds exactly what the model was shown (see
docs/waste-model.md), so a misread is one press away from becoming a training
photo.  This copies the ones you choose into the samples tree that
`train_handheld_head.py --extra-train` reads.

    # everything the model called "paper" that was really a key fob:
    python3 promote_captures.py --class Ewaste --from-wrongly Paper
    # or one file, when only that one is worth keeping:
    python3 promote_captures.py --class Background --file 20261113T195904-paper-0.67.jpg

`--dry-run` prints what would be copied.  Nothing is moved or deleted: the
captures stay where they are, because the index that records what the model said
is the evidence.

The common case this exists for: hold an empty hand up to the camera, let it
mislabel it, and promote those crops to **Background** — the pipeline's own
picture of "nothing is being shown", which is what it was never taught.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

CLASSES = ["Organic", "Plastic", "Paper", "Glass", "Metal", "Textile", "Leather",
           "Footwear", "Thermocol", "Ewaste", "Background"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="source", default="data/waste-captures")
    ap.add_argument("--to", dest="target", default="data/waste-samples")
    ap.add_argument("--class", dest="label", required=True, help="the class it really is")
    ap.add_argument("--wrongly", default="", help="only captures the model called this")
    ap.add_argument("--file", action="append", default=[], help="a single capture (repeatable)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.label not in CLASSES:
        raise SystemExit(f"class must be one of {', '.join(CLASSES)}")

    source = Path(args.source).expanduser()
    if not source.is_dir():
        raise SystemExit(f"no captures at {source} — show something to the camera first")

    if args.file:
        chosen = [source / name for name in args.file]
        missing = [p for p in chosen if not p.is_file()]
        if missing:
            raise SystemExit("not found: " + ", ".join(str(p) for p in missing))
    else:
        chosen = sorted(source.glob("*.jpg"))
        if args.wrongly:
            needle = f"-{args.wrongly.strip().lower()}-"
            chosen = [p for p in chosen if needle in p.name]

    if not chosen:
        raise SystemExit("nothing matched")

    target = Path(args.target).expanduser() / args.label
    print(f"{len(chosen)} capture(s) -> {target}")
    for path in chosen:
        print(f"  {path.name}")
    if args.dry_run:
        return 0

    target.mkdir(parents=True, exist_ok=True)
    for path in chosen:
        shutil.copy2(path, target / f"capture-{path.name}")
    print("copied. Retrain with:")
    print("  python3 scripts/waste/train_handheld_head.py --extra-train "
          f"{Path(args.target).expanduser()} \\")
    print("      --features /tmp/opencode/waste-resnet50-v13/features.npz \\")
    print("      --hand-train /tmp/opencode/hand-train --hand-test /tmp/opencode/hand-test \\")
    print("      --probe ~/.cache/village-waste/v13/probe --out /tmp/opencode/waste-next")
    return 0


if __name__ == "__main__":
    sys.exit(main())
