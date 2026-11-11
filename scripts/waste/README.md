# Waste model training

This folder rebuilds the four-class waste classifier the **Sort Waste** page
loads. It produces the same three files a Teachable Machine image export
produces:

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

## What the dataset is

| Class | Where it comes from | Count |
| --- | --- | --- |
| `Plastic` | TrashNet `plastic` (MIT) | 320 |
| `Paper` | TrashNet `paper` (MIT) | 320 |
| `Organic` | Voxel51 food-waste dataset (MIT) | 180 |
| `Background` | Wikimedia Commons room/table photos (free licences) | 110 |

The images are not redistributed here; they stay in `~/.cache/village-waste`.
The trained weights inherit those datasets' terms, which is one more reason
`models/` is git-ignored.

The trainer holds back 15% of each class for validation. The current install
scores **97.1%** on those 140 held-out photos (135/140), with Background and
Organic perfect and the few misses between paper and plastic.

The assembler maps TrashNet's `paper` and `cardboard` folders into `Paper`;
the installed model used `paper` on its own. `glass`, `metal` and `trash` are
deliberately **not** used: the exhibition has three bins, and teaching a fourth
category the app cannot indicate would only produce confident wrong answers.

## First-time setup

```bash
# The TensorFlow.js Node runtime is only needed for training, never by the app.
npm install --prefix ~/.cache/village-waste @tensorflow/tfjs-node@4.22.0
```

## Rebuild the dataset

```bash
node scripts/waste/prepare_waste_dataset.mjs \
  --trashnet ~/.cache/village-waste/dataset-resized \
  --organic  ~/.cache/village-waste/raw/organic \
  --background ~/.cache/village-waste/raw/background \
  --out ~/.cache/village-waste/raw-classes --limit 320 --force
```

The result is one folder per class. `--limit 320` caps each class so Plastic
and Paper do not dwarf Organic and Background; the trainer can split the
result itself, so the existing `train/` + `val/` tree is optional.

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
default 2), `--alpha` (MobileNet width, default 1.0), `--seed`, `--force`, and
`--no-verify` (skip the reload check). The trainer refuses to replace an
installed model without `--force`.

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
2. Put the photos in `Organic/`, `Plastic/`, `Paper/` and `Background/` folders
   on this laptop.
3. Run the trainer with `--data <that folder>` and `--split 0.2`.
4. Test with items that were **not** photographed. A model that only works on
   its own training photos is not ready.

The two accuracy numbers that matter are in the trainer's output and in
`training-report.json`. If a class is under 80%, the trainer says so rather
than pretending the model is finished.

## Honest limits

- Training photos are studio-like: white backgrounds for waste, rooms and
  tables for Background. A camera view at the venue can differ, which is why
  the retraining step above exists.
- The model classifies the item in front of the camera. It cannot tell who put
  it there, and a recognition is not proof of a deposit.
- A 224×224 image of a crumpled wrapper is genuinely ambiguous between paper
  and plastic. The page requires the same class for several consecutive frames
  and a confidence threshold; it does not guess when the answer is weak.
