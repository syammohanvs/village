# Waste model training

This folder rebuilds the waste classifier the **Sort Waste** page loads. It
produces the same three files a Teachable Machine image export produces:

```
models/waste/model.json
models/waste/weights.bin
models/waste/metadata.json
```

No Google account and no upload are involved. The trainer uses the same
architecture Teachable Machine uses for its image projects — a frozen
truncated MobileNet v1 with a small dense head — through
`@tensorflow/tfjs-node` on this laptop.

Everything in `models/` is git-ignored. The dataset lives outside the repo in
`~/.cache/village-waste` (also not committed).

## Classes and sources

Every recycler material has its own class so the model can learn its shape and
texture. The dashboard maps all seven recycler classes to one outcome,
**Recycling agent**; only Organic, Plastic and Paper light a bin LED.

| Class | Source | Photos |
| --- | --- | --- |
| `Organic` | Voxel51 food-waste dataset (MIT) | 180 |
| `Plastic` | TrashNet `plastic` (MIT) | 482 |
| `Paper` | TrashNet `paper` (MIT) | 594 |
| `Glass` | TrashNet `glass` (MIT) | 501 |
| `Metal` | TrashNet `metal` (MIT) | 410 |
| `Textile` | clothing-dataset-small (CC0) + fabric photos | 841 |
| `Leather` | clothing-dataset-small `outwear` (CC0) | 184 |
| `Footwear` | clothing-dataset-small `shoes` (CC0) | 198 |
| `Thermocol` | Wikimedia Commons foam/packaging photos | 42 |
| `Ewaste` | Wikimedia Commons electronic-waste photos | 123 |
| `Background` | room and table photos with no item | 110 |

The trainer holds back 15% of each class for validation. The current install
scores **93.4% exact class (513/549)**. Because the seven recycler classes
share one action, **97.3% of items get the right action**: 180/188 bin items
kept their own bin and 338/345 recycler items were referred.

| Class | Exact match | Held out |
| --- | --- | --- |
| Organic | 100.0% | 27 |
| Plastic | 93.1% | 72 |
| Paper | 96.6% | 89 |
| Glass | 82.7% | 75 |
| Metal | 98.4% | 62 |
| Textile | 93.7% | 126 |
| Leather | 92.9% | 28 |
| Footwear | 100.0% | 30 |
| Thermocol | 66.7% | 6 |
| Ewaste | 88.9% | 18 |
| Background | 100.0% | 16 |

The images are not redistributed here; they stay in `~/.cache/village-waste`.
The trained weights inherit those datasets' terms, which is one more reason
`models/` is git-ignored. Wikimedia photos are used under their own free
licences.

## First-time setup

```bash
# The TensorFlow.js Node runtime is only needed for training, never by the app.
npm install --prefix ~/.cache/village-waste @tensorflow/tfjs-node@4.22.0
```

## Rebuild the dataset

`prepare_waste_dataset.mjs` copies one folder per class. TrashNet supplies
Plastic, Paper, Glass and Metal; the others are folders you supply. Separate
several sources for one class with a comma.

```bash
node scripts/waste/prepare_waste_dataset.mjs \
  --trashnet ~/.cache/village-waste/dataset-resized \
  --organic ~/.cache/village-waste/raw/organic \
  --background ~/.cache/village-waste/raw/background \
  --textile ~/photos/textile,~/photos/fabric \
  --leather ~/photos/leather \
  --footwear ~/photos/footwear \
  --thermocol ~/photos/thermocol \
  --ewaste ~/photos/ewaste \
  --out ~/.cache/village-waste/raw-classes --force
```

The result is one folder per class. The trainer can split that itself, so the
existing `train/` + `val/` tree is optional.

## Train and install

```bash
node scripts/waste/train_waste_model.mjs \
  --data ~/.cache/village-waste \
  --modules ~/.cache/village-waste \
  --out models/waste --force
```

`--data` may point at either:

- a folder with `train/<Class>/` and `val/<Class>/` (what is in the cache now), or
- a folder with just `<Class>/` folders; the trainer holds back `--split` of
  each class itself.

Useful options: `--epochs`, `--augment` (extra augmented copies per photo,
default 2), `--alpha` (MobileNet width, default 1.0), `--pooling gap`,
`--seed`, `--force`, and `--no-verify` (skip the reload check). The trainer
refuses to replace an installed model without `--force`.

Before it exits it:

- prints per-class accuracy and a confusion matrix on the held-out photos,
- writes `training-report.json` beside the model (counts, accuracy, seed),
- reloads the exported model and classifies eight photos again to prove the
  files are complete.

The page picks the files up on the next camera start; the backend's status
endpoint reads the folder per request, so no restart is needed.

## Retraining with photos from the exhibition

The public dataset is a **bootstrap**. Teachable Machine's own advice applies:
the model should be trained on the table, lamp and camera it will see.

1. Open **Sort Waste**, start the camera, and take 40–80 photos for each class
   in the real setting. Include hands, the empty table and the room in
   `Background`.
2. Put the photos in the class folders on this laptop.
3. Run the trainer with `--data <that folder>` and `--split 0.2`.
4. Test with items that were **not** photographed. A model that only works on
   its own training photos is not ready.

The two numbers that matter are in the trainer's output and in
`training-report.json`. If a class is under 80%, the trainer says so rather
than pretending the model is finished.

## Honest limits

- **Clear glass versus clear plastic is the hard pair.** Five of 72 held-out
  plastic photos were read as recycler material and five of 75 glass photos
  were read as plastic. A coloured plastic bottle or a bag is easier for the
  demo; venue photos are the real fix.
- **Thermocol is the weakest class** (42 public photos; two of six held-out
  photos were ignored because they were not really foam). Add real thermocol
  plates, cups and packing before relying on it.
- The model classifies the item in front of the camera. It cannot tell who put
  it there, and a recognition is not proof of a deposit or a handover.
- A 224×224 image of a crumpled wrapper is genuinely ambiguous. The page
  requires the same class for several consecutive frames and a confidence
  threshold; it does not guess when the answer is weak.
