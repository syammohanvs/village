"""Does resolution decide it?  The same probe photos at 224 and at 448.

The classifier is fed a 224-px crop; a vision model is not bound to that.  Forty
years of "the crop is the fault" in this project says the honest test is the same
photos, two sizes, one model, and the same question.

  python3 res_probe.py                     # llama-3.2-11b-vision, 224 vs 448
  python3 res_probe.py --model @cf/meta/llama-4-scout-17b-16e-instruct
"""
from __future__ import annotations

import io
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, "/tmp/opencode")
import probe_ab as ab  # noqa: E402
import vision  # noqa: E402  (scripts/waste is on the path when run from there)
from PIL import Image  # noqa: E402

ROWS = Path("/tmp/opencode/probe_ab.json")
CLASSES = ["Organic", "Plastic", "Paper", "Glass", "Metal", "Textile", "Leather",
           "Footwear", "Thermocol", "Ewaste", "Background"]
PROMPT = (
    "Choose ONE word for the material this object is made of, from this list: "
    + ", ".join(CLASSES) + ". Answer with the single word only."
)


def jpeg(path: Path, size: int) -> bytes:
    image = Image.open(path).convert("RGB").resize((size, size), Image.BILINEAR)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=92)
    return buffer.getvalue()


def run(size: int, model: str, rows: list[dict], workers: int = 4) -> dict:
    started = time.time()

    def one(row: dict) -> str:
        text = vision.ask_object(jpeg(Path(row["file"]), size), PROMPT,
                                 which="cloudflare", model=model)
        for cls in CLASSES:
            if re.search(rf"\b{cls}\b", text, re.I):
                return cls
        return "?"

    with ThreadPoolExecutor(max_workers=workers) as pool:
        picked = list(pool.map(one, rows))
    exact = sum(1 for r, p in zip(rows, picked) if p == r["truth"])
    action = sum(1 for r, p in zip(rows, picked) if ab.action(p) == ab.action(r["truth"]))
    return {
        "size": size,
        "exact": exact,
        "action": action,
        "n": len(rows),
        "seconds": time.time() - started,
        "picked": picked,
    }


def main() -> int:
    model = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else \
        "@cf/meta/llama-3.2-11b-vision-instruct"
    rows = json.loads(ROWS.read_text())
    print(f"{len(rows)} photos · {model}")
    for size in (224, 448):
        result = run(size, model, rows)
        print(f"  {size:>3} px   exact {result['exact']}/{result['n']} = "
              f"{100 * result['exact'] / result['n']:.1f}%   "
              f"item {result['action']}/{result['n']} = "
              f"{100 * result['action'] / result['n']:.1f}%   "
              f"{result['seconds']:.0f}s")
        Path(f"/tmp/opencode/res_{size}.json").write_text(json.dumps(result["picked"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
