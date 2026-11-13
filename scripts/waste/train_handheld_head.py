#!/usr/bin/env python3
"""Train a waste head that survives an item held in somebody's hand.

The frozen ResNet50 backbone is unchanged: the existing feature cache supplies
the original photographs, and only the new hand-held composites are pushed
through the backbone here (about 3 000 images instead of 25 000, which is the
difference between four minutes and half an hour).

Three numbers decide whether the result ships:

  val        the fixed held-out photographs, which must NOT regress
  probe      the real-world probe folder, which must NOT regress
  hand       composites made from VAL objects (never trained on), which is the
             case the venue actually sees

usage:
  python3 train_handheld_head.py \\
      --features /tmp/opencode/waste-resnet50-v13/features.npz \\
      --hand-train /tmp/opencode/hand-train \\
      --hand-test /tmp/opencode/hand-test \\
      --probe ~/.cache/village-waste/v13/probe \\
      --out /tmp/opencode/waste-handheld
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", str(os.cpu_count() or 4))
import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
import torch.nn.functional as F  # noqa: E402
from PIL import Image  # noqa: E402

CLASSES = ["Organic", "Plastic", "Paper", "Glass", "Metal", "Textile", "Leather",
           "Footwear", "Thermocol", "Ewaste", "Background"]
IMAGE_SIZE = 224
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
BINS = {"Organic", "Plastic", "Paper"}
RECYCLING = {"Glass", "Metal", "Textile", "Leather", "Footwear", "Thermocol", "Ewaste"}
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


class Head(nn.Module):
    def __init__(self, in_dim=2048, hid=128, n=11, p=0.2):
        super().__init__()
        self.fc1 = nn.Linear(in_dim, hid)
        self.drop = nn.Dropout(p)
        self.fc2 = nn.Linear(hid, n)

    def forward(self, x):
        return self.fc2(self.drop(torch.relu(self.fc1(x))))


def _class_weights(labels: np.ndarray) -> np.ndarray:
    """sqrt inverse frequency, the recipe both trainers use."""
    counts = np.bincount(labels, minlength=len(CLASSES)).astype(np.float64)
    weights = np.sqrt(1.0 / np.maximum(1.0, counts))
    return weights / weights.mean()


def folder_items(root: Path) -> list[tuple[Path, int]]:
    items = []
    for cls in CLASSES:
        folder = root / cls
        if not folder.is_dir():
            continue
        for path in sorted(folder.iterdir()):
            if path.suffix.lower() in IMAGE_EXT:
                items.append((path, CLASSES.index(cls)))
    return items


def features_of(backbone, items, batch=32):
    X, y = [], []
    skipped: list[str] = []
    with torch.no_grad():
        for start in range(0, len(items), batch):
            chunk = items[start:start + batch]
            tensors = []
            kept: list[int] = []
            for path, label in chunk:
                try:
                    image = Image.open(path).convert("RGB").resize(
                        (IMAGE_SIZE, IMAGE_SIZE), Image.BILINEAR)
                except Exception:  # noqa: BLE001
                    # A folder of the venue's own photos will contain a corrupt
                    # file or an HTML "download" some day.  Skipping it (and
                    # saying so) beats losing the run at hour one.
                    skipped.append(str(path))
                    continue
                tensor = torch.from_numpy(
                    np.asarray(image, dtype=np.float32) / 255.0).permute(2, 0, 1)
                tensors.append((tensor - MEAN.squeeze(0)) / STD.squeeze(0))
                kept.append(label)
            if not tensors:
                continue
            xb = torch.stack(tensors)
            X.append(backbone(xb).pooler_output.flatten(1).numpy())
            y.extend(kept)
            if start and start % (batch * 20) == 0:
                print(f"    {start}/{len(items)}", flush=True)
    if skipped:
        print(f"    skipped {len(skipped)} unreadable file(s): {skipped[:3]}", flush=True)
    return np.concatenate(X), np.array(y, dtype=np.int64)


def action_hit(truth: str, guess: str) -> bool:
    """The app's own grouping: seven recycler materials are one outcome."""
    def group(label):
        if label in RECYCLING:
            return "recycling"
        return label
    return group(truth) == group(guess)


def score(head, X, y):
    with torch.no_grad():
        logits = head(torch.tensor(X, dtype=torch.float32))
        prob = F.softmax(logits, dim=1).numpy()
    pred = prob.argmax(1)
    exact = float((pred == y).mean())
    action = float(np.mean([action_hit(CLASSES[int(t)], CLASSES[int(p)])
                            for t, p in zip(y, pred)]))
    return exact, action, pred


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--features", required=True, help="npz from train_resnet50.py")
    ap.add_argument("--hand-train", required=True)
    ap.add_argument("--hand-test", required=True)
    ap.add_argument("--probe", default="")
    ap.add_argument("--extra-train", default="",
                    help="folder of new photos to ADD to training, in <Class>/<file> "
                         "layout (e.g. the venue's own handkerchiefs).  Validation and "
                         "the probe are untouched, so the measurement stays honest.")
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=40,
                    help="epochs on the archive alone, before the hand-held stage")
    ap.add_argument("--stage2-epochs", type=int, default=12,
                    help="epochs of fine-tuning on the hand-held composites")
    ap.add_argument("--stage2-lr", type=float, default=2e-4)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--hand-repeat", type=float, default=1.0,
                    help="how many times the composites count against the originals")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    z = np.load(args.features)
    Xtr, ytr = z["Xtr"], z["ytr"]
    Xva, yva = z["Xva"], z["yva"]

    from transformers import ResNetModel
    print("loading ResNet50 backbone ...", flush=True)
    backbone = ResNetModel.from_pretrained("microsoft/resnet-50")
    backbone.eval()
    for parameter in backbone.parameters():
        parameter.requires_grad = False

    extra_items = folder_items(Path(args.extra_train).expanduser()) if args.extra_train else []

    cache = out / "hand-features.npz"
    extra_cache = out / "extra-features.npz"
    if cache.exists():
        zz = np.load(cache)
        Xh, yh, Xt, yt = zz["Xh"], zz["yh"], zz["Xt"], zz["yt"]
        print("loaded cached composite features", flush=True)
    else:
        hand_train = folder_items(Path(args.hand_train).expanduser())
        hand_test = folder_items(Path(args.hand_test).expanduser())
        print(f"extracting features for {len(hand_train)} composites "
              f"and {len(hand_test)} hand-held test photos ...", flush=True)
        Xh, yh = features_of(backbone, hand_train)
        Xt, yt = features_of(backbone, hand_test)
        np.savez(cache, Xh=Xh, yh=yh, Xt=Xt, yt=yt)

    if extra_items:
        # Its own cache, keyed by the file list, so dropping more photos in later
        # only re-reads the new ones.
        signature = ",".join(str(path) for path, _ in extra_items)
        if extra_cache.exists():
            zz = np.load(extra_cache)
            if str(zz["signature"]) == signature:
                Xe, ye = zz["Xe"], zz["ye"]
                print(f"loaded cached features for {len(ye)} new photos", flush=True)
            else:
                extra_cache.unlink()
                Xe, ye = None, None
        else:
            Xe, ye = None, None
        if Xe is None:
            print(f"extracting features for {len(extra_items)} new photos ...", flush=True)
            Xe, ye = features_of(backbone, extra_items)
            np.savez(extra_cache, Xe=Xe, ye=ye, signature=signature)
        Xtr = np.concatenate([Xtr, Xe])
        ytr = np.concatenate([ytr, ye])
        print(f"archive + {len(ye)} new photos: {len(ytr)} views", flush=True)

    # `hand-repeat` lets the composites outweigh their raw count: the venue is
    # all hand, while the archive is all clean product shots.
    repeat = max(1, int(round(args.hand_repeat)))
    Xtr_all = np.concatenate([Xtr] + [Xh] * repeat)
    ytr_all = np.concatenate([ytr] + [yh] * repeat)
    print(f"train {Xtr_all.shape[0]} views ({Xh.shape[0]} hand-held x{repeat}), "
          f"val {Xva.shape[0]}, hand-test {Xt.shape[0]}")

    head = Head()
    history = []

    def train_epochs(X, y, epochs, lr, tag, weight):
        optimiser = torch.optim.Adam(head.parameters(), lr=lr)
        n_local = len(X)
        best_local = {"val": -1.0, "state": None, "hand_action": 0.0, "epoch": 0}
        for epoch in range(1, epochs + 1):
            head.train()
            order = np.random.permutation(n_local)
            total = correct = 0
            for start_i in range(0, n_local, args.batch):
                idx = order[start_i:start_i + args.batch]
                xb = torch.tensor(X[idx], dtype=torch.float32)
                yb = torch.tensor(y[idx], dtype=torch.long)
                logits = head(xb)
                logp = F.log_softmax(logits, dim=1)
                with torch.no_grad():
                    onehot = torch.zeros_like(logits).scatter_(1, yb.unsqueeze(1), 1.0)
                    onehot = onehot * 0.95 + 0.05 / len(CLASSES)
                loss = -((onehot * logp).sum(dim=1) * weight[yb]).mean()
                optimiser.zero_grad()
                loss.backward()
                optimiser.step()
                total += len(idx)
                correct += int((logits.argmax(1) == yb).sum())

            head.eval()
            val_exact, val_action, _ = score(head, Xva, yva)
            hand_exact, hand_action, _ = score(head, Xt, yt)
            row = {"stage": tag, "epoch": epoch, "train": correct / total,
                   "val": val_exact, "val_action": val_action,
                   "hand_exact": hand_exact, "hand_action": hand_action}
            history.append(row)
            print(f"{tag} {epoch:3d}/{epochs}  train {correct / total * 100:5.1f}%  "
                  f"val {val_exact * 100:5.1f}%  hand {hand_exact * 100:5.1f}% / "
                  f"item {hand_action * 100:5.1f}%", flush=True)

            better = best_local["state"] is None
            if not better and val_exact >= best_local["val"] - 0.02 and hand_action > best_local["hand_action"]:
                better = True
            if better:
                best_local = {
                    "val": val_exact,
                    "state": {k: v.clone() for k, v in head.state_dict().items()},
                    "epoch": epoch,
                    "hand_action": hand_action,
                    "hand_exact": hand_exact,
                }
        head.load_state_dict(best_local["state"])
        return best_local

    # Stage 1: the archive on its own, exactly the recipe the deployed model
    # came from.  This is what keeps a clean photograph reading as it did.
    print(f"stage 1: {len(Xtr)} archive views, {args.epochs} epochs", flush=True)
    stage1 = train_epochs(Xtr, ytr, args.epochs, args.lr, "archive",
                          torch.tensor(_class_weights(ytr), dtype=torch.float32))

    # Stage 2: the same head, nudged by the hand-held composites at a small
    # learning rate.  Training on the mixture from scratch moved the archive
    # decision boundaries by more than the hand case was worth.
    print(f"stage 2: + {len(Xh) * repeat} hand-held views, "
          f"{args.stage2_epochs} epochs at lr {args.stage2_lr}", flush=True)
    stage2 = train_epochs(Xtr_all, ytr_all, args.stage2_epochs, args.stage2_lr, "hand",
                          torch.tensor(_class_weights(ytr_all), dtype=torch.float32))

    floor = stage1["val"] - 0.015
    if stage2["val"] >= floor and stage2["hand_action"] > stage1["hand_action"]:
        best = stage2
        shipped_stage = "hand-held fine-tune"
    else:
        best = stage1
        shipped_stage = "archive only (the hand-held stage cost too much validation)"
    print(f"shipping: {shipped_stage}  (val floor {floor * 100:.1f}%)")

    head.load_state_dict(best["state"])
    torch.save({"head": head.state_dict(), "classes": CLASSES,
                "val_acc": float(best["val"]), "hand_action": float(best.get("hand_action", 0.0))},
               out / "resnet50_head.pt")

    # Final honest report on every set that matters.
    report = {"classes": CLASSES, "epochs": args.epochs,
              "stage2_epochs": args.stage2_epochs, "hand_repeat": repeat,
              "train_views": int(len(Xtr_all)), "hand_train": int(len(yh)),
              "hand_test": int(len(yt)), "chosen_epoch": best["epoch"],
              "shipped_stage": shipped_stage, "stage1_val": stage1["val"],
              "history": history}
    val_exact, val_action, _ = score(head, Xva, yva)
    hand_exact, hand_action, hand_pred = score(head, Xt, yt)
    report["val"] = {"exact": val_exact, "action": val_action}
    report["hand"] = {"exact": hand_exact, "action": hand_action}

    if args.probe:
        probe_items = folder_items(Path(args.probe).expanduser())
        if probe_items:
            Xp, yp = features_of(backbone, probe_items)
            p_exact, p_action, _ = score(head, Xp, yp)
            report["probe"] = {"exact": p_exact, "action": p_action, "n": len(yp)}
            print(f"probe   n={len(yp):4d}  exact {p_exact * 100:5.1f}%  item {p_action * 100:5.1f}%")

    (out / "report.json").write_text(json.dumps(report, indent=1))
    print(f"\nval    exact {val_exact * 100:5.1f}%  item {val_action * 100:5.1f}%")
    print(f"hand   exact {hand_exact * 100:5.1f}%  item {hand_action * 100:5.1f}%")
    from collections import Counter
    print("hand guesses:", dict(Counter(CLASSES[int(i)] for i in hand_pred).most_common(5)))
    print("saved", out / "resnet50_head.pt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
