#!/usr/bin/env python3
"""Turn a trained ResNet50 head into the single file the backend loads.

`train_resnet50.py` saves only the 128-unit head (about 1 MB) because the
backbone is frozen and can be rebuilt from the pretrained weights.  The backend
cannot rebuild it without downloading from Hugging Face, and it should not need
the internet at the exhibition, so this script writes one self-contained
checkpoint: the full ResNet50 state dict plus the class list.

usage:
  python3 export_resnet50.py \
    --head /tmp/opencode/waste-resnet50-v13/resnet50_head.pt \
    --out models/waste-resnet50/model.pt
"""
import argparse
import os
import sys

import torch


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--head", required=True, help="the .pt written by train_resnet50.py")
    ap.add_argument("--out", default="models/waste-resnet50/model.pt")
    args = ap.parse_args()

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from eval_resnet50 import CLASSES, Head

    from transformers import ResNetModel

    blob = torch.load(args.head, map_location="cpu")
    classes = list(blob.get("classes", CLASSES))

    backbone = ResNetModel.from_pretrained("microsoft/resnet-50")
    head = Head()
    head.load_state_dict(blob["head"])

    class Full(torch.nn.Module):
        def __init__(self, bb, hd):
            super().__init__()
            self.bb = bb
            self.hd = hd

        def forward(self, x):
            return self.hd(self.bb(x).pooler_output.flatten(1))

    full = Full(backbone, head).eval()
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    torch.save({"state_dict": full.state_dict(), "classes": classes}, args.out)
    size = os.path.getsize(args.out) / 1e6
    print(f"wrote {args.out} ({size:.1f} MB, {len(classes)} classes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
