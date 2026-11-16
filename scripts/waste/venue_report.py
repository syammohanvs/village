#!/usr/bin/env python3
"""What did the camera actually see, and what did the model make of it?

The Sort Waste page sends every crop it judges to the backend, and the backend
keeps each one beside a line in ``data/waste-captures/index.jsonl``.  That makes
a venue session measurable **without labelling anything by hand**: the log holds
the picture, the moment and the full 11-class distribution.

    python3 scripts/waste/venue_report.py                # the whole log
    python3 scripts/waste/venue_report.py --days 1       # today only
    python3 scripts/waste/venue_report.py --undecided 15 # look at the misses

The bars are the ones the app uses, so the "undecided" count here is the same
number of items that would have shown *"Not sure what this is"*:

  * a **bin** answer (Organic / Plastic / Paper) needs **0.70**
  * a **referral** (glass, metal, textile, leather, footwear, thermocol,
    e-waste) needs **0.50**

Corrections pressed on the page land in ``data/waste-corrections.jsonl`` and are
reported as a confusion list: *what the model said → what it really was*.  Those
are the frames already copied into ``data/waste-samples/<Class>/``, i.e. the ones
the next training run will learn from.

This is a measurement of the **venue's own frames**, which is exactly what the
trained model could not be checked against from home or the office.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

BIN_CONFIDENCE = 0.70
REFERRAL_CONFIDENCE = 0.50
BINS = {"Organic", "Plastic", "Paper"}


def _root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_index(path: Path) -> list[dict]:
    rows = []
    if not path.is_file():
        return rows
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def decision(top: dict) -> str:
    """The same three outcomes the page can reach, from the raw distribution."""
    name = str(top.get("className", ""))
    probability = float(top.get("probability", 0.0))
    if name.lower() == "background":
        return "nothing"
    if name in BINS:
        return "bin" if probability >= BIN_CONFIDENCE else "undecided"
    return "referral" if probability >= REFERRAL_CONFIDENCE else "undecided"


def summarise(rows: list[dict], corrections: list[dict]) -> str:
    lines: list[str] = []
    if not rows:
        return "No captures yet. Show the camera an item and the log starts here.\n"

    days = collections.Counter(str(row.get("at", ""))[:10] for row in rows)
    outcomes = collections.Counter()
    labels = collections.Counter()
    for row in rows:
        predictions = row.get("predictions") or []
        if not predictions:
            continue
        top = max(predictions, key=lambda p: float(p.get("probability", 0.0)))
        outcomes[decision(top)] += 1
        labels[str(top.get("className", "?"))] += 1

    total = sum(outcomes.values()) or 1
    lines.append(f"Reads: {total}   ({len(days)} day(s))")
    for day, count in sorted(days.items())[-7:]:
        lines.append(f"  {day}  {count}")

    lines.append("")
    lines.append("What the page would have said:")
    for name, note in (
        ("bin", f"a bin lit (≥{BIN_CONFIDENCE:.2f})"),
        ("referral", f"hand it to the agent (≥{REFERRAL_CONFIDENCE:.2f})"),
        ("nothing", "nothing to sort (background)"),
        ("undecided", "“not sure — hold one item…”"),
    ):
        share = 100.0 * outcomes[name] / total
        lines.append(f"  {note:44s} {outcomes[name]:6d}  {share:5.1f}%")

    lines.append("")
    lines.append("Top classes:")
    for name, count in labels.most_common(11):
        share = 100.0 * count / total
        lines.append(f"  {name:12s} {count:6d}  {share:5.1f}%")

    if corrections:
        lines.append("")
        lines.append(f"Corrections filed ({len(corrections)}), model said → really is:")
        confusion = collections.Counter()
        for row in corrections:
            said = Path(str(row.get("file", ""))).stem.split("-")[-2:-1]
            confusion[(said[0].title() if said else "?", str(row.get("actual", "?")))] += 1
        for (said, actual), count in confusion.most_common():
            lines.append(f"  {said:10s} → {actual:10s} {count}")
    else:
        lines.append("")
        lines.append(
            "No corrections yet. Every “Wrong? It was…” press copies that frame into\n"
            "data/waste-samples/<Class>/ — those are the photos worth having."
        )
    return "\n".join(lines) + "\n"


def recent_undecided(rows: list[dict], limit: int) -> list[str]:
    out: list[str] = []
    for row in reversed(rows):
        predictions = row.get("predictions") or []
        if not predictions:
            continue
        top = max(predictions, key=lambda p: float(p.get("probability", 0.0)))
        if decision(top) == "undecided":
            out.append(f"  {row.get('at', '?')}  {row.get('file', '?')}  "
                       f"{top.get('className')} {float(top.get('probability', 0)):.2f}")
        if len(out) >= limit:
            break
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", default=None,
                        help="capture folder (default: <repo>/data/waste-captures)")
    parser.add_argument("--days", type=float, default=None,
                        help="only the last N days")
    parser.add_argument("--undecided", type=int, default=0,
                        help="also list the N most recent undecided crops")
    args = parser.parse_args(argv)

    root = _root()
    folder = Path(args.dir) if args.dir else root / "data" / "waste-captures"
    rows = load_index(folder / "index.jsonl")
    corrections = load_index(folder.parent / "waste-corrections.jsonl")

    if args.days is not None:
        from datetime import datetime, timedelta, timezone

        cutoff = datetime.now(timezone.utc) - timedelta(days=args.days)

        def recent(rows: list[dict]) -> list[dict]:
            kept = []
            for row in rows:
                try:
                    stamp = datetime.strptime(str(row.get("at", "")), "%Y-%m-%dT%H:%M:%SZ")
                except ValueError:
                    continue
                if stamp.replace(tzinfo=timezone.utc) >= cutoff:
                    kept.append(row)
            return kept

        rows = recent(rows)
        corrections = recent(corrections)

    print(summarise(rows, corrections), end="")
    if args.undecided:
        listing = recent_undecided(rows, args.undecided)
        if listing:
            print("\nMost recent undecided crops (look at these first):")
            print("\n".join(listing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
