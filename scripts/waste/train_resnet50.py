#!/usr/bin/env python3
"""Train an 11-class waste classifier on a ResNet50 backbone (torch, CPU).

Mirrors the TFJS pipeline's evaluation so the result is comparable: same
classes, same held-out sets, same class weighting (sqrt inverse frequency) and
label smoothing.  The backbone is frozen and features are extracted once, which
is the only way 20k augmented views finish on a CPU in an afternoon.

Output: a torch checkpoint + an ONNX export under --out, plus a feature cache
so re-evaluation and a second training run are cheap.

usage:
  python3 train_resnet50.py --data ~/.cache/village-waste/v8 \\
      --modules ~/.cache/village-waste --out /tmp/opencode/waste-resnet50 \\
      --epochs 60 --augment 2 --batch 32
"""
import argparse, json, os, sys, time
import numpy as np
from PIL import Image

os.environ.setdefault("OMP_NUM_THREADS", str(os.cpu_count() or 4))
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from transformers import ResNetModel

CLASSES = ["Organic","Plastic","Paper","Glass","Metal","Textile","Leather",
           "Footwear","Thermocol","Ewaste","Background"]
IMG_SIZE = 224
IMAGENET_MEAN = torch.tensor([0.485,0.456,0.406]).view(1,3,1,1)
IMAGENET_STD  = torch.tensor([0.229,0.224,0.225]).view(1,3,1,1)


def list_images(root):
    out = []
    for dirpath,_,files in os.walk(root):
        for f in files:
            if f.lower().endswith((".jpg",".jpeg",".png",".webp",".bmp")):
                out.append(os.path.join(dirpath,f))
    return out


def class_of(path, root):
    # <root>/<split>/<Class>/<file>
    rel = os.path.relpath(path, root)
    parts = rel.split(os.sep)
    return parts[1] if len(parts) >= 3 else None


def augment(img: Image.Image, rng: np.random.Generator) -> Image.Image:
    """A small, honest augmentation: crop, flip, mild colour jitter."""
    w,h = img.size
    scale = rng.uniform(0.78, 1.0)
    nw,nh = int(w*scale), int(h*scale)
    x0 = rng.integers(0, max(1, w-nw+1))
    y0 = rng.integers(0, max(1, h-nh+1))
    img = img.crop((x0,y0,x0+nw,y0+nh)).resize((IMG_SIZE,IMG_SIZE), Image.BILINEAR)
    if rng.random() < 0.5:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    # mild brightness/contrast
    arr = np.asarray(img,dtype=np.float32)
    arr = arr * rng.uniform(0.88,1.12) + rng.uniform(-6,6)
    arr = np.clip(arr,0,255).astype(np.uint8)
    return Image.fromarray(arr,"RGB")


class SplitDataset(Dataset):
    """One split of the built dataset, optionally with extra augmented views.

    The split is explicit because a version that walked both `train/` and
    `val/` silently trained on the validation photos — which reported 99.9%
    validation accuracy and meant nothing.
    """

    def __init__(self, root, split, augment_n=0, seed=42):
        self.root = root
        self.augment_n = augment_n
        self.rng = np.random.default_rng(seed)
        base = []
        split_dir = os.path.join(root, split)
        if os.path.isdir(split_dir):
            for cls in CLASSES:
                d = os.path.join(split_dir, cls)
                if not os.path.isdir(d):
                    continue
                for f in sorted(os.listdir(d)):
                    if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp")):
                        base.append((os.path.join(d, f), CLASSES.index(cls)))
        if not base:
            raise SystemExit(f"no photos under {split_dir}")
        self.original = len(base)
        self.items = list(base)
        # Extra views are appended after the originals so `idx >= original`
        # identifies them; every copy stays inside this split, so augmentation
        # cannot leak a photo across the boundary either.
        for _ in range(augment_n):
            self.items += base

    def __len__(self):
        return len(self.items)

    def __getitem__(self, idx):
        path, yi = self.items[idx]
        img = Image.open(path).convert("RGB")
        if self.augment_n and idx >= self.original:
            img = augment(img, self.rng)
        else:
            img = img.resize((IMG_SIZE, IMG_SIZE), Image.BILINEAR)
        x = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0).permute(2, 0, 1)
        x = (x - IMAGENET_MEAN.squeeze(0)) / IMAGENET_STD.squeeze(0)
        return x, yi


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--modules", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--augment", type=int, default=2)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=42)
    args=ap.parse_args()

    torch.manual_seed(args.seed); np.random.seed(args.seed)
    os.makedirs(args.out, exist_ok=True)

    # ---- class weights (sqrt inverse frequency) ----
    counts = [0]*len(CLASSES)
    for cls in CLASSES:
        d=os.path.join(args.data,"train",cls)
        if os.path.isdir(d):
            counts[CLASSES.index(cls)] = sum(1 for f in os.listdir(d)
                                             if f.lower().endswith((".jpg",".jpeg",".png",".webp",".bmp")))
    w = np.array([1.0/max(1,c) for c in counts], dtype=np.float32)
    w = np.sqrt(w); w = w/w.mean()
    class_w = torch.tensor(w)

    # ---- feature extractor ----
    print("loading ResNet50 backbone ...")
    backbone = ResNetModel.from_pretrained("microsoft/resnet-50")
    backbone.eval()
    for p in backbone.parameters(): p.requires_grad = False

    # ---- feature cache (extract once) ----
    cache = os.path.join(args.out, "features.npz")
    if os.path.exists(cache):
        print("loading cached features ...")
        z = np.load(cache)
        Xtr, ytr = z["Xtr"], z["ytr"]
        Xva, yva = z["Xva"], z["yva"]
    else:
        print("extracting features (this is the slow part) ...")
        ds_tr = SplitDataset(args.data, "train", augment_n=args.augment, seed=args.seed)
        ds_va = SplitDataset(args.data, "val", augment_n=0, seed=args.seed + 1)
        # The two splits must be disjoint, or the validation number is theatre.
        train_paths = {p for p, _ in ds_tr.items}
        val_paths = {p for p, _ in ds_va.items}
        overlap = train_paths & val_paths
        if overlap:
            raise SystemExit(f"{len(overlap)} photos are in both train and val; refusing to train")

        def extract(ds):
            loader = DataLoader(ds, batch_size=args.batch, shuffle=False, num_workers=0)
            X = []
            y = []
            with torch.no_grad():
                for i, (xb, yb) in enumerate(loader):
                    f = backbone(xb).pooler_output.flatten(1)
                    X.append(f.numpy())
                    y.append(yb.numpy())
                    if (i + 1) % 20 == 0:
                        print(f"  {i + 1}/{len(loader)}", flush=True)
            return np.concatenate(X), np.concatenate(y)

        Xtr, ytr = extract(ds_tr)
        Xva, yva = extract(ds_va)
        np.savez(cache, Xtr=Xtr, ytr=ytr, Xva=Xva, yva=yva)
        print("cached features ->", cache)

    print("train", Xtr.shape, "val", Xva.shape)

    # ---- head ----
    class Head(nn.Module):
        def __init__(self, in_dim=2048, hid=128, n=11, p=0.2):
            super().__init__()
            self.fc1=nn.Linear(in_dim,hid); self.drop=nn.Dropout(p); self.fc2=nn.Linear(hid,n)
        def forward(self,x):
            return self.fc2(self.drop(torch.relu(self.fc1(x))))

    torch.manual_seed(args.seed)
    head = Head()
    opt = torch.optim.Adam(head.parameters(), lr=args.lr)
    bs = args.batch
    ntr = len(Xtr)
    best = 0.0; best_state=None
    for epoch in range(1, args.epochs+1):
        head.train()
        perm = np.random.permutation(ntr)
        loss_sum=0; correct=0; n=0
        for s in range(0,ntr,bs):
            idx=perm[s:s+bs]
            xb=torch.tensor(Xtr[idx],dtype=torch.float32)
            yb=torch.tensor(ytr[idx],dtype=torch.long)
            logits=head(xb)
            # label smoothing
            logp=F.log_softmax(logits,dim=1)
            # one-hot with smoothing
            with torch.no_grad():
                yoh = torch.zeros_like(logits).scatter_(1,yb.unsqueeze(1),1.0)
                yoh = yoh*(1-0.05)+0.05/len(CLASSES)
            loss=-(yoh*logp).sum(dim=1).mean()
            # class weight
            # apply per-sample weight
            sw = class_w[yb]
            loss = (-(yoh*logp).sum(dim=1)*sw).mean()/sw.mean()
            opt.zero_grad(); loss.backward(); opt.step()
            loss_sum+=loss.item()*len(idx); n+=len(idx)
            correct += (logits.argmax(1)==yb).sum().item()
        # val
        head.eval()
        with torch.no_grad():
            va_logits=head(torch.tensor(Xva,dtype=torch.float32))
            va_pred=va_logits.argmax(1).numpy()
            va_acc=(va_pred==yva).mean()
        print(f"epoch {epoch:3d}/{args.epochs}  loss {loss_sum/n:.4f}  acc {correct/n*100:5.1f}%  val {va_acc*100:5.1f}%", flush=True)
        if va_acc>best:
            best=va_acc; best_state={k:v.clone() for k,v in head.state_dict().items()}
    head.load_state_dict(best_state)

    # ---- save checkpoint ----
    ckpt = os.path.join(args.out, "resnet50_head.pt")
    torch.save({"head": head.state_dict(), "classes": CLASSES,
                "val_acc": float(best)}, ckpt)
    print("saved", ckpt, "best val", round(best*100,2))

    # ---- export ONNX (backbone + head fused) ----
    try:
        class Full(nn.Module):
            def __init__(self, bb, hd):
                super().__init__(); self.bb=bb; self.hd=hd
            def forward(self,x):
                f=self.bb(x).pooler_output.flatten(1)
                return self.hd(f)
        full = Full(backbone, head).eval()
        onnx_path = os.path.join(args.out, "resnet50_waste.onnx")
        dummy = torch.randn(1,3,IMG_SIZE,IMG_SIZE)
        torch.onnx.export(full, dummy, onnx_path, input_names=["input"],
                          output_names=["logits"], opset_version=13,
                          dynamic_axes={"input":{0:"n"},"logits":{0:"n"}})
        print("exported", onnx_path)
    except Exception as e:
        print("onnx export skipped:", e)

    # write a small report
    report = {"classes": CLASSES, "val_acc": float(best),
              "train": int(len(Xtr)), "val": int(len(Xva)),
              "augment": args.augment, "epochs": args.epochs}
    with open(os.path.join(args.out,"report.json"),"w") as f: json.dump(report,f,indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
