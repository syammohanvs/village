#!/usr/bin/env python3
"""Score the ResNet50 waste checkpoint on the same photos as the TFJS evaluator.

usage:
  python3 eval_resnet50.py --ckpt /tmp/opencode/waste-resnet50/resnet50_head.pt \\
      --data ~/.cache/village-waste/v2 --probe ~/.cache/village-waste/v2/probe \\
      --extra /tmp/opencode/hankies-probe /tmp/opencode/carkeys
"""
import argparse, json, os, sys
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from transformers import ResNetModel

CLASSES = ["Organic","Plastic","Paper","Glass","Metal","Textile","Leather",
           "Footwear","Thermocol","Ewaste","Background"]
IMG_SIZE = 224
IMAGENET_MEAN = torch.tensor([0.485,0.456,0.406]).view(1,3,1,1)
IMAGENET_STD  = torch.tensor([0.229,0.224,0.225]).view(1,3,1,1)
BINS={'Organic','Plastic','Paper'}
RECY={'Glass','Metal','Textile','Leather','Footwear','Thermocol','Ewaste'}


class Head(nn.Module):
    def __init__(self, in_dim=2048, hid=128, n=11, p=0.2):
        super().__init__()
        self.fc1=nn.Linear(in_dim,hid); self.drop=nn.Dropout(p); self.fc2=nn.Linear(hid,n)
    def forward(self,x):
        return self.fc2(self.drop(torch.relu(self.fc1(x))))


def features(backbone, paths):
    X=[]
    for i,p in enumerate(paths):
        img=Image.open(p).convert("RGB").resize((IMG_SIZE,IMG_SIZE),Image.BILINEAR)
        x=torch.from_numpy(np.asarray(img,dtype=np.float32)/255.0).permute(2,0,1).unsqueeze(0)
        x=(x-IMAGENET_MEAN)/IMAGENET_STD
        with torch.no_grad():
            f=backbone(x).pooler_output.flatten(1)
        X.append(f.numpy()[0])
        if (i+1)%50==0: print(f"  {i+1}/{len(paths)}", flush=True)
    return np.stack(X)


def score(head, backbone, paths, labels):
    if not paths: return None
    X=features(backbone, paths)
    with torch.no_grad():
        logits=head(torch.tensor(X,dtype=torch.float32))
        prob=F.softmax(logits,dim=1).numpy()
    pred=[CLASSES[i] for i in prob.argmax(1)]
    exact=sum(1 for a,b in zip(pred,labels) if a==b)/len(labels)
    # action-level
    bt=bo=rt=ro=0
    for t,p in zip(labels,pred):
        if t in BINS: bt+=1; bo += int(p==t)
        elif t in RECY: rt+=1; ro += int(p in RECY)
    return {"n":len(labels),"exact":exact,"bin":bo/bt if bt else 0,"recyc":ro/rt if rt else 0,
            "item":(bo+ro)/(bt+rt) if (bt+rt) else 0,"pred":pred}


def collect(root, split):
    paths,labels=[],[]
    d=os.path.join(root,split)
    if not os.path.isdir(d): return paths,labels
    for cls in CLASSES:
        cdir=os.path.join(d,cls)
        if not os.path.isdir(cdir): continue
        for f in os.listdir(cdir):
            if f.lower().endswith((".jpg",".jpeg",".png",".webp",".bmp")):
                paths.append(os.path.join(cdir,f)); labels.append(cls)
    return paths,labels


def collect_flat(folder):
    # A folder with one class per subfolder, OR a flat folder of photos whose
    # class is encoded in the filename prefix (handkerchief photos are named
    # handkerchiefs-NN.jpg and are Textile).
    paths,labels=[],[]
    if not os.path.isdir(folder): return paths,labels
    subs=[d for d in os.listdir(folder) if os.path.isdir(os.path.join(folder,d))]
    if subs:
        for cls in CLASSES:
            d=os.path.join(folder,cls)
            if not os.path.isdir(d): continue
            for f in os.listdir(d):
                if f.lower().endswith((".jpg",".jpeg",".png",".webp",".bmp")):
                    paths.append(os.path.join(d,f)); labels.append(cls)
        return paths,labels
    # flat: infer from filename for the known probe sets
    for f in os.listdir(folder):
        if not f.lower().endswith((".jpg",".jpeg",".png",".webp",".bmp")): continue
        low=f.lower()
        cls=None
        # handkerchief/cloth -> Textile
        if any(k in low for k in ("handkerchief","napkin","cloth","fabric","towel")): cls="Textile"
        # car keys -> Ewaste-ish; treat as Ewaste for the recycler action
        elif "automobile-key" in low or "key-" in low: cls="Ewaste"
        if cls: paths.append(os.path.join(folder,f)); labels.append(cls)
    return paths,labels


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--data", default="")
    ap.add_argument("--probe", default="")
    ap.add_argument("--extra", nargs="*", default=[])
    args=ap.parse_args()

    ckpt=torch.load(args.ckpt, map_location="cpu")
    backbone=ResNetModel.from_pretrained("microsoft/resnet-50")
    backbone.eval()
    for p in backbone.parameters(): p.requires_grad=False
    head=Head(); head.load_state_dict(ckpt["head"]); head.eval()

    print("=== ResNet50 ===")
    if args.data:
        tr,tl=collect(args.data,"train"); va,la=collect(args.data,"val")
        # train not needed for scoring; report val only
        r=score(head,backbone,va,la)
        print(f"val (fixed)   n={r['n']:4d} exact {r['exact']*100:6.1f}%  bin {r['bin']*100:6.1f}%  recyc {r['recyc']*100:6.1f}%  ITEM {r['item']*100:6.1f}%")
    if args.probe:
        p,l=collect_flat(args.probe)
        if not p: p,l=collect(args.probe,"")  # no
        if p:
            r=score(head,backbone,p,l)
            print(f"probe         n={r['n']:4d} exact {r['exact']*100:6.1f}%  bin {r['bin']*100:6.1f}%  recyc {r['recyc']*100:6.1f}%  ITEM {r['item']*100:6.1f}%")
    for folder in args.extra:
        p,l=collect_flat(folder)
        if not p:
            print(folder,"-> no scorable photos"); continue
        r=score(head,backbone,p,l)
        print(f"{os.path.basename(folder):12s} n={r['n']:4d} exact {r['exact']*100:6.1f}%  bin {r['bin']*100:6.1f}%  recyc {r['recyc']*100:6.1f}%  ITEM {r['item']*100:6.1f}%")
        from collections import Counter
        print("   top-1:", dict(Counter(r['pred'])))
    return 0

if __name__ == "__main__":
    sys.exit(main())
PY