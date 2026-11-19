"""ResNet50 waste classifier, running on the laptop's own CPU.

The browser MobileNetV1 model was replaced by this because ResNet50 is
measurably better on the same photographs (91.5% exact class against 86.7%,
95.5% item action against 91.4%, 71.6% on the real-world probe against 64.0%),
and it fixes the business-card and pin misreads.  It runs here because the
browser cannot load PyTorch; there is no cloud call and no internet needed.

The model file is `models/waste-resnet50/model.pt` (about 95 MB, git-ignored
like the other model files).  Loading it takes a second; classification is
about 140 ms per frame on eight cores.
"""

from __future__ import annotations

import base64
import io
import json
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

CLASSES = [
    "Organic", "Plastic", "Paper", "Glass", "Metal", "Textile", "Leather",
    "Footwear", "Thermocol", "Ewaste", "Background",
]
IMAGE_SIZE = 224
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)


class WasteModelError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


_lock = threading.Lock()
# The crop this process kept for the last classification.  One camera, one page,
# one at a time -- and the page needs the name so a correction can point at the
# exact picture the model judged.
_last_capture: str | None = None
_model: Any = None
_classes: list[str] = CLASSES
_transforms: Any = None


def _build():
    """Load the checkpoint once and keep it in memory."""
    global _model, _classes, _transforms
    import torch
    from torch import nn

    classes = CLASSES
    model_path = Path(__file__).resolve().parents[3] / "models" / "waste-resnet50" / "model.pt"
    if not model_path.is_file():
        raise WasteModelError(
            503, "MODEL_MISSING",
            f"the ResNet50 waste model is missing at {model_path}. "
            "Run scripts/waste/export_resnet50.py.",
        )
    blob = torch.load(model_path, map_location="cpu")
    classes = list(blob.get("classes", CLASSES))

    class Head(nn.Module):
        def __init__(self, in_dim=2048, hid=128, n=11, p=0.2):
            super().__init__()
            self.fc1 = nn.Linear(in_dim, hid)
            self.drop = nn.Dropout(p)
            self.fc2 = nn.Linear(hid, n)

        def forward(self, x):
            return self.fc2(self.drop(torch.relu(self.fc1(x))))

    class Full(nn.Module):
        def __init__(self, bb, hd):
            super().__init__()
            self.bb = bb
            self.hd = hd

        def forward(self, x):
            return self.hd(self.bb(x).pooler_output.flatten(1))

    # The saved file holds the full state dict of `Full`, so rebuild the
    # architecture with the pretrained backbone's structure only (no download:
    # the weights come from the checkpoint).
    from transformers import ResNetConfig, ResNetModel

    backbone = ResNetModel(ResNetConfig())
    head = Head()
    full = Full(backbone, head)
    full.load_state_dict(blob["state_dict"])
    full.eval()

    _model = full
    _classes = classes


def _ensure_loaded():
    global _model
    if _model is not None:
        return
    with _lock:
        if _model is None:
            _build()


def _to_tensor(image):
    """Resize to 224, scale to [0,1], normalise with the ImageNet statistics.

    Done with PIL and numpy rather than torchvision so the backend does not need
    a second heavyweight wheel for three lines of arithmetic.
    """
    import numpy as np
    import torch
    from PIL import Image

    resized = image.resize((IMAGE_SIZE, IMAGE_SIZE), Image.BILINEAR)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    array = (array - np.array(MEAN, dtype=np.float32)) / np.array(STD, dtype=np.float32)
    array = np.transpose(array, (2, 0, 1))
    return torch.from_numpy(array).unsqueeze(0)


def available() -> bool:
    path = Path(__file__).resolve().parents[3] / "models" / "waste-resnet50" / "model.pt"
    return path.is_file()


def status() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[3] / "models" / "waste-resnet50" / "model.pt"
    return {
        "installed": path.is_file(),
        "model": "resnet50",
        "path": str(path),
        "classes": CLASSES,
    }


# --- saved crops -----------------------------------------------------------
# The camera sends exactly the 224x224 picture the model judged.  Keeping it is
# the difference between "it called my key fob paper" and being able to look at
# what it was actually shown, so it is on by default while the app is being
# developed.  Bounded by `keep` so a long session cannot fill the disk.
_capture_lock = threading.Lock()
# The crop this process kept for the last classification.  One camera, one page,
# one at a time -- and the page needs the name so a correction can point at the
# exact picture the model judged.
_last_capture: str | None = None


def _capture(raw: bytes, predictions: list[dict[str, Any]]) -> Path | None:
    """Keep the crop and one line about what was said about it.

    Best effort: a full disk, a read-only folder or a bad name must never fail a
    classification -- the answer matters more than the record.
    """
    from .config import Settings  # local import: keeps the module importable alone

    settings = _settings()
    if settings is not None and not getattr(settings, "waste_save_crops", False):
        # Off by default: saving every judged crop is an operator decision for
        # training, not something a visitor's press should do silently.
        return None
    folder = settings.waste_capture_dir if settings else None
    if folder is None:
        return None
    try:
        folder.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
        top = predictions[0] if predictions else {"className": "unknown", "probability": 0.0}
        safe = "".join(c for c in str(top["className"]).lower() if c.isalnum()) or "unknown"
        name = f"{stamp}-{safe}-{top['probability']:.2f}"
        with _capture_lock:
            # Never overwrite: two frames in one second are two frames.
            path = folder / f"{name}.jpg"
            suffix = 1
            while path.exists():
                path = folder / f"{name}-{suffix}.jpg"
                suffix += 1
            path.write_bytes(raw)
            global _last_capture
            _last_capture = path.name
            line = {
                "file": path.name,
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "predictions": [
                    {"className": row["className"], "probability": round(row["probability"], 4)}
                    for row in predictions
                ],
            }
            with (folder / "index.jsonl").open("a", encoding="utf-8") as log:
                log.write(json.dumps(line) + "\n")
            _prune(folder, settings.waste_capture_keep)
        return path
    except Exception:  # noqa: BLE001 - a record must never break the answer
        return None


def _prune(folder: Path, keep: int) -> None:
    """Keep the newest `keep` crops; the index keeps its own history."""
    if keep <= 0:
        return
    files = sorted(folder.glob("*.jpg"), key=lambda p: p.stat().st_mtime)
    for old in files[: max(0, len(files) - keep)]:
        try:
            old.unlink()
        except OSError:
            pass


_settings_ref: Any = None


def configure(settings: Any) -> None:
    """Hand the resnet module the settings it needs for captures."""
    global _settings_ref
    _settings_ref = settings


def _settings() -> Any:
    return _settings_ref


def last_capture() -> str | None:
    """The file name of the crop kept for the most recent classification."""
    return _last_capture


# A correction names what the item really was, in the operator's words.  A
# referral is deliberately NOT a training class: "keep it separate" is glass,
# metal, textile, leather, footwear, thermocol or e-waste, and guessing which
# one would put a wrong label in the tree.  Those frames are kept aside for a
# human to file.
CORRECTION_TARGETS = {
    "organic": "Organic",
    "plastic": "Plastic",
    "paper": "Paper",
    "separate": "Separate",
}


def label_capture(file_name: str, actual: str) -> dict[str, Any]:
    """File a judged crop under the class the operator says it really is.

    This is the venue's whole learning loop: every mistake costs one press, and
    the picture is copied into the folder the trainer reads, so the next model
    has seen the venue's own light, background and hands.
    """
    from .config import Settings as _Settings  # noqa: F401  (kept importable alone)

    target = CORRECTION_TARGETS.get((actual or "").strip().lower())
    if target is None:
        raise WasteModelError(
            422,
            "BAD_CORRECTION",
            "actual must be organic, plastic, paper or separate",
        )
    name = (file_name or "").strip()
    # A file name, nothing else: no separators, no "..", no absolute path.
    if not name or Path(name).name != name:
        raise WasteModelError(422, "BAD_FILE", "the capture name must be a plain file name")

    settings = _settings()
    captures_dir = settings.waste_capture_dir if settings else None
    if captures_dir is None:
        raise WasteModelError(409, "CAPTURES_OFF", "crop capture is disabled on this deployment")
    source = Path(captures_dir) / name
    if not source.is_file():
        raise WasteModelError(404, "NO_CAPTURE", f"{name} is not a saved crop")

    samples_dir = Path(settings.waste_samples_dir) / target
    samples_dir.mkdir(parents=True, exist_ok=True)
    destination = samples_dir / f"venue-{source.stem}.jpg"
    suffix = 1
    while destination.exists():
        destination = samples_dir / f"venue-{source.stem}-{suffix}.jpg"
        suffix += 1
    shutil.copyfile(source, destination)

    line = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "file": name,
        "actual": target,
        "saved_as": str(destination),
    }
    try:
        with open(Path(settings.waste_samples_dir).parent / "waste-corrections.jsonl",
                  "a", encoding="utf-8") as handle:
            handle.write(json.dumps(line) + "\n")
    except OSError:
        # The copy is what matters; a missing log must not undo the press.
        pass
    return {"file": name, "actual": target, "saved_as": str(destination)}


def captures() -> dict[str, Any]:
    """What has been saved, for the status route."""
    settings = _settings()
    folder = settings.waste_capture_dir if settings else None
    if folder is None:
        return {"enabled": False, "folder": None, "count": 0, "newest": None}
    count = len(list(folder.glob("*.jpg"))) if folder.is_dir() else 0
    newest = None
    if count:
        newest = max(folder.glob("*.jpg"), key=lambda p: p.stat().st_mtime).name
    return {"enabled": True, "folder": str(folder), "count": count, "newest": newest}


def predict(image: Any) -> list[dict[str, Any]]:
    """Every class with its probability, highest first.

    Separate from `classify` so the wiring around it (decoding, saving the crop)
    can be tested without loading the model.
    """
    import torch

    _ensure_loaded()
    tensor = _to_tensor(image)
    with torch.no_grad():
        logits = _model(tensor)
        probs = torch.softmax(logits, dim=1)[0].tolist()
    return [
        {"className": label, "probability": float(prob)}
        for label, prob in sorted(zip(_classes, probs), key=lambda pair: pair[1], reverse=True)
    ]


def classify(image_b64: str) -> list[dict[str, Any]]:
    """Return every class with its probability, highest first.

    The frontend groups the seven recycler materials itself, so this returns
    the raw 11-class distribution rather than a decision.  The crop is kept as
    it is classified, so a misread can be looked at afterwards.
    """
    from PIL import Image

    try:
        raw = base64.b64decode(image_b64.split(",")[-1], validate=False)
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:  # noqa: BLE001 - the caller sends whatever a canvas gave it
        raise WasteModelError(422, "BAD_IMAGE", f"the image could not be read: {exc}") from exc

    predictions = predict(image)
    _capture(raw, predictions)
    return predictions
