"""Score the *served* classifier per class, and score the handling pipeline.

Two numbers the project has been quoting as one:

  classification   what the model said (exact class, item action)
  handling         what the page would have done: a bin, a referral, or nothing

This prints both, plus the two failures that matter at the venue — a bin opened
for something that is not that bin's material (**false bin**), and an item
abstained on (**abstention**).

  ./scripts/waste/evaluate_pipeline.py [--probe DIR] [--limit N]
"""
from __future__ import annotations

import argparse
import io
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "web" / "backend"))

from app import waste_resnet  # noqa: E402

CLASSES = waste_resnet.CLASSES
BINS = {"Organic", "Plastic", "Paper"}
RECYCLING = {"Glass", "Metal", "Textile", "Leather", "Footwear", "Thermocol", "Ewaste"}
BIN_BAR = 0.70
MATERIAL_BAR = 0.50


def action(label: str) -> str:
    if label in BINS:
        return f"bin:{label.lower()}"
    if label in RECYCLING:
        return "collect"
    return "nothing"


def decide(label: str, p: float) -> str:
    if label == "Background":
        return "nothing"
    if label in BINS:
        return f"bin:{label.lower()}" if p >= BIN_BAR else "abstain"
    return "collect" if p >= MATERIAL_BAR else "abstain"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", default=str(Path.home() / ".cache" / "village-waste" / "v13" / "probe"))
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    probe = Path(args.probe)
    if not probe.is_dir():
        raise SystemExit(f"no probe folder at {probe}")

    rows: list[tuple[str, str, float]] = []
    for folder in sorted(probe.iterdir()):
        if not folder.is_dir() or folder.name not in CLASSES:
            continue
        files = sorted(p for p in folder.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
        if args.limit:
            files = files[: args.limit]
        for path in files:
            raw = path.read_bytes()
            top = waste_resnet.classify("data:image/jpeg;base64," +
                                        __import__("base64").b64encode(raw).decode())[0]
            rows.append((folder.name, top["className"], top["probability"]))

    n = len(rows)
    exact = sum(1 for truth, said, _ in rows if truth == said)
    same_action = sum(1 for truth, said, _ in rows if action(truth) == action(said))
    false_bin = [r for r in rows if r[1] in BINS and action(r[0]) != action(r[1])]
    abstain = [r for r in rows if decide(r[1], r[2]) == "abstain"]

    print(f"{n} probe photos")
    print(f"  exact class       {exact}/{n} = {100 * exact / n:.1f}%")
    print(f"  item action       {same_action}/{n} = {100 * same_action / n:.1f}%")
    print(f"  false bin         {len(false_bin)}")
    print(f"  abstained         {len(abstain)}")

    print("\nper class (truth -> how often it was said):")
    for truth in CLASSES:
        of = [said for t, said, _ in rows if t == truth]
        if not of:
            continue
        hits = sum(1 for said in of if said == truth)
        confused = Counter(said for said in of if said != truth)
        detail = ", ".join(f"{k} {v}" for k, v in confused.most_common(3))
        print(f"  {truth:10} {hits:3}/{len(of):<3} = {100 * hits / len(of):5.1f}%   {detail}")

    if false_bin:
        print("\nfalse bins (a bin opened for another material):")
        for truth, said, p in false_bin[:12]:
            print(f"  {truth:10} -> {said:10} {p:.2f}")

    if abstain:
        print("\nabstentions (the page would have said 'not sure'):")
        for truth, said, p in abstain[:12]:
            print(f"  {truth:10} -> {said:10} {p:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
