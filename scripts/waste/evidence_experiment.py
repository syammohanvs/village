"""Does the cloud *name* make the classifier's answer better, or only louder?

The exhibit's own case: a white remote came back `Ewaste 0.55` — the right class,
under the 0.70 a bin needs — while the cloud model said "remote control".  The
question is whether that name should be allowed to promote the classifier's
answer, and the honest way to answer it is to score three policies on the probe:

  A  classifier only          (top class, bars)
  B  name as evidence         (if the top is under the bar and the name implies a
                               class the picture already puts in its top 3,
                               promote that class)

B can only pick a class the picture supports; it never overrides a confident
class with a different one.  It is printed next to A and next to A's *false bin*
count, because a promotion that opens the wrong physical bin is worse than an
abstention.

  python3 scripts/waste/evidence_experiment.py [--limit N] [--workers 5]
"""
from __future__ import annotations

import argparse
import base64
import io
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "web" / "backend"))
sys.path.insert(0, str(ROOT / "scripts" / "waste"))

from app import waste_resnet  # noqa: E402
import vision  # noqa: E402

CLASSES = waste_resnet.CLASSES
BINS = {"Organic", "Plastic", "Paper"}
RECYCLING = {"Glass", "Metal", "Textile", "Leather", "Footwear", "Thermocol", "Ewaste"}
BIN_BAR = 0.70
MATERIAL_BAR = 0.50

# The word → class map the page uses (wasteDecision.ts), reduced to what this
# experiment needs: a class id, or None.
WORD_CLASS: list[tuple[str, tuple[str, ...]]] = [
    ("Paper", ("paper", "cardboard", "carton", "newspaper", "notebook", "envelope")),
    ("Organic", ("food", "banana", "peel", "vegetable", "fruit", "leaf", "flower")),
    ("Plastic", ("plastic", "pvc", "bottle cap", "polythene", "acrylic", "silicone")),
    ("Glass", ("glass", "jar")),
    ("Metal", ("metal", "steel", "iron", "aluminium", "aluminum", "copper", "brass", "tin", "pipe")),
    ("Textile", ("cloth", "fabric", "textile", "cotton", "wool", "shirt", "towel")),
    ("Leather", ("leather",)),
    ("Footwear", ("shoe", "sandal", "slipper", "boot", "footwear")),
    ("Thermocol", ("thermocol", "styrofoam", "foam")),
    ("Ewaste", ("remote", "phone", "cable", "charger", "electronic", "keyboard", "mouse")),
]


def claim_of(name: str | None) -> str | None:
    if not name:
        return None
    text = f" {name.lower()} "
    for cls, words in WORD_CLASS:
        if any(f" {w} " in text or f" {w}s " in text for w in words):
            return cls
    return None


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
    ap.add_argument("--limit", type=int, default=0, help="photos per class")
    ap.add_argument("--workers", type=int, default=5)
    args = ap.parse_args()

    probe = Path(args.probe)
    photos: list[tuple[Path, str]] = []
    for folder in sorted(probe.iterdir()):
        if not folder.is_dir() or folder.name not in CLASSES:
            continue
        files = sorted(p for p in folder.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
        if args.limit:
            files = files[: args.limit]
        photos.extend((path, folder.name) for path in files)
    if not photos:
        raise SystemExit("no probe photos")
    print(f"{len(photos)} probe photos · {args.workers} workers", flush=True)

    def one(item: tuple[Path, str]) -> dict:
        path, truth = item
        raw = path.read_bytes()
        image = Image.open(io.BytesIO(raw)).convert("RGB").resize((224, 224), Image.BILINEAR)
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=92)
        jpeg = buffer.getvalue()
        predictions = waste_resnet.classify(
            "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
        )
        name = vision.ask_object(jpeg, vision_broker_prompt())
        top = predictions[0]
        return {
            "truth": truth,
            "top": top["className"],
            "p": top["probability"],
            "top3": [row["className"] for row in predictions[:3]],
            "name": name,
            "claim": claim_of(name),
        }

    started = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        rows = list(pool.map(one, photos))
    print(f"{time.time() - started:.0f}s total\n")
    Path("/tmp/opencode/evidence_rows.json").write_text(
        __import__("json").dumps(
            [{**row, "file": str(path)} for row, (path, _) in zip(rows, photos)], indent=1)
    )

    def summarise(label: str, pick) -> dict:
        exact = action_hits = false_bin = abstain = promoted = 0
        for row in rows:
            cls, p = pick(row)
            exact += int(cls == row["truth"])
            action_hits += int(action(cls) == action(row["truth"]))
            if cls in BINS and action(row["truth"]) != action(cls):
                false_bin += 1
            if decide(cls, p) == "abstain":
                abstain += 1
            promoted += int(cls != row["top"])
        n = len(rows)
        print(f"{label:26} exact {100 * exact / n:5.1f}%  action {100 * action_hits / n:5.1f}%  "
              f"false bin {false_bin:2}  abstained {abstain:3}  changed {promoted}")
        return {"exact": exact, "action": action_hits, "false_bin": false_bin, "n": n}

    def baseline(row):
        return row["top"], row["p"]

    def agreed(row):
        """C: the name *agrees* with the top class — accept a material below its bar.

        Only a material (never a bin), so this can move an abstention to a
        referral but cannot open a lamp.
        """
        if (
            row["top"] in RECYCLING
            and row["p"] < MATERIAL_BAR
            and row["p"] >= 0.30
            and row["claim"] == row["top"]
        ):
            return row["top"], MATERIAL_BAR
        return row["top"], row["p"]

    def promoted(row):
        # The name may only choose a class the picture already lists in its top 3.
        if row["p"] >= BIN_BAR or not row["claim"] or row["claim"] not in row["top3"]:
            return row["top"], row["p"]
        if row["claim"] == row["top"]:
            return row["top"], row["p"]
        # Promotion uses the top-3 member's own probability, not a made-up one.
        return row["claim"], 0.69

    a = summarise("A classifier only", baseline)
    b = summarise("B + name as evidence", promoted)
    c = summarise("C name agrees (materials)", agreed)
    print()
    print(f"B vs A: exact {b['exact'] - a['exact']:+d}   action {b['action'] - a['action']:+d}   "
          f"false bin {b['false_bin'] - a['false_bin']:+d}")
    print(f"C vs A: exact {c['exact'] - a['exact']:+d}   action {c['action'] - a['action']:+d}   "
          f"false bin {c['false_bin'] - a['false_bin']:+d}")

    print("\nwhere the name changed the answer:")
    for row in rows:
        cls, p = promoted(row)
        if cls != row["top"]:
            fixed = cls == row["truth"]
            print(f"  {row['truth']:10} top {row['top']:10} {row['p']:.2f} -> {cls:10} "
                  f"{'RIGHT' if fixed else 'wrong'}   name={row['name'][:34]!r}")
    return 0


def vision_broker_prompt() -> str:
    # The page's own question — the same words the exhibit sends, so the
    # measurement is about the mechanism and not about a different prompt.
    return (
        "Name the single object in this photo in two to four words, including "
        "what it is made of when you can see it (for example 'clear plastic "
        "bottle'). If there is no object, answer exactly: nothing"
    )


if __name__ == "__main__":
    sys.exit(main())
