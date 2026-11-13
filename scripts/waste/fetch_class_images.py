#!/usr/bin/env python3
"""Fetch real photographs of one object family from Wikimedia Commons.

The venue keeps finding objects the model has never seen — a ceramic cup with a
handle is not a glass bottle and is not a foam cup, so a classifier trained on
bottles and foam has nothing to match it against. This pulls freely licensed
photographs for one search phrase into the samples tree, under the class you
name, so the normal retrain picks them up.

    python3 fetch_class_images.py --query "ceramic cup" --class Glass --count 60

Two rules keep it honest: only Commons' own file pages are used (so the licence
is free by construction), and the model's answer is *not* consulted — the label
comes from the search phrase, which is the only thing known about the picture.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://commons.wikimedia.org/w/api.php"
UA = "SmartGreenVillage/0.1 (training-data fetch; contact: support@t7wealth.com)"


def api(params: dict) -> dict:
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", required=True)
    ap.add_argument("--class", dest="label", required=True)
    ap.add_argument("--count", type=int, default=60)
    ap.add_argument("--out", default="data/waste-samples")
    ap.add_argument("--min-bytes", type=int, default=12_000)
    args = ap.parse_args()

    target = Path(args.out).expanduser() / args.label
    target.mkdir(parents=True, exist_ok=True)

    collected = 0
    offset = 0
    while collected < args.count:
        found = api({
            "action": "query", "generator": "search",
            "gsrsearch": f"filetype:bitmap {args.query}", "gsrnamespace": 6,
            "gsrlimit": 40, "gsroffset": offset,
            "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": 640,
        })
        pages = list((found.get("query", {}) or {}).get("pages", {}).values())
        if not pages:
            break
        offset += 40
        for page in pages:
            if collected >= args.count:
                break
            info = (page.get("imageinfo") or [{}])[0]
            url = info.get("thumburl") or info.get("url")
            if not url:
                continue
            title = page.get("title", "").lower()
            if any(bad in title for bad in (".svg", ".tif", "logo", "diagram", "map")):
                continue
            try:
                request = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(request, timeout=30) as response:
                    blob = response.read()
            except Exception:  # noqa: BLE001 - a dead link is skipped, not fatal
                continue
            if len(blob) < args.min_bytes:
                continue
            name = f"commons-{args.query.replace(' ', '-')}-{collected:03d}.jpg"
            (target / name).write_bytes(blob)
            collected += 1
            time.sleep(0.05)
        print(f"  {collected}/{args.count}", flush=True)
    print(f"wrote {collected} photos for '{args.query}' to {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
