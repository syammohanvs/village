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
| `Plastic` | TrashNet `plastic` (MIT) + Wikimedia caps, pens, bottles, cups | 888 |
| `Paper` | TrashNet `paper` + `cardboard` (MIT) + Wikimedia paper bags/board | 1 279 |
| `Glass` | TrashNet `glass` (MIT) | 501 |
| `Metal` | TrashNet `metal` (MIT) | 410 |
| `Textile` | clothing-dataset-small (CC0) + fabric photos | 841 |
| `Leather` | clothing-dataset-small `outwear` (CC0) | 184 |
| `Footwear` | clothing-dataset-small `shoes` (CC0) | 198 |
| `Thermocol` | Wikimedia Commons foam/packaging photos | 171 |
| `Ewaste` | Wikimedia Commons electronic-waste photos | 123 |
| `Background` | room and table photos with no item | 110 |

The trainer holds back 15% of each class for validation. The current install
scores **88.8% exact class (717/807)** on a mixed set that now includes
real-world object photos. Because the seven recycler classes share one action,
**91.8% of items get the right action**: 371/414 bin items kept their own bin
and 355/377 recycler items were referred.

On the **same 807 photos** the previous studio-only model scores 76.5%, so the
drop from its old 93.4% is the harder validation set, not a worse model. A
separate probe of real-world objects never used for training goes from
**17.4% (28/161)** to **77.6% (125/161)**; every ball pen, bottle cap and
cardboard box that the old model misread is now mostly correct.

| Class | Exact match | Held out |
| --- | --- | --- |
| Organic | 100.0% | 27 |
| Plastic | 87.6% | 170 |
| Paper | 89.9% | 217 |
| Glass | 86.7% | 75 |
| Metal | 93.5% | 62 |
| Textile | 93.7% | 126 |
| Leather | 82.1% | 28 |
| Footwear | 93.3% | 30 |
| Thermocol | 73.7% | 38 |
| Ewaste | 72.2% | 18 |
| Background | 81.2% | 16 |

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
Plastic, Paper (including its `cardboard` folder), Glass and Metal; the others
are folders you supply. Separate several sources for one class with a comma.

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
default 2), `--alpha` (MobileNet width, default 1.0), `--pooling gap|gapmax`,
`--class-weight balanced|sqrt|none`, `--label-smoothing`, `--probe <dir>`,
`--seed`, `--force`, and `--no-verify` (skip the reload check). The trainer
refuses to replace an installed model without `--force`.

## Fixing a specific confusion

A confusion is a data gap, not a reason to lower the threshold.  The loop is:

1. **Prove it.**  Put a dozen photos of the item in `probe/<Class>/` and run
   the trainer with `--probe`.  The report prints one line per object
   (`bottle-caps 0/11, misread as Ewaste 5, Metal 3`), so the failure is a
   number rather than a story.
2. **Find the missing class contents.**  `fetch_extra_images.mjs` downloads
   real photos of the object families that the bootstrap datasets do not
   cover — bottle caps, ball pens, paper bags, cardboard, foam packaging — from
   Wikimedia Commons, with the licence recorded in `sources.json`.
3. **Rebuild the tree.**  `build_waste_dataset.mjs` keeps the bootstrap
   `train/` + `val/`, adds TrashNet's unused `cardboard` folder to Paper and
   the extra photos (repeated so they are not drowned by studio photos), and
   copies the held-out probe slice.
4. **Retrain and compare.**  The two numbers that matter are the ordinary
   validation score and the per-object probe score.  A model that wins on the
   probe is the one for the exhibition, even if the studio validation drops a
   point.

```bash
node scripts/waste/fetch_extra_images.mjs \
  --out ~/.cache/village-waste/extra --per-source 60 --probe 0.2
node scripts/waste/build_waste_dataset.mjs \
  --base ~/.cache/village-waste \
  --trashnet ~/.cache/village-waste/dataset-resized \
  --extra ~/.cache/village-waste/extra \
  --out ~/.cache/village-waste/v2 --extra-repeat 2 --force
node scripts/waste/train_waste_model.mjs \
  --data ~/.cache/village-waste/v2 \
  --probe ~/.cache/village-waste/v2/probe \
  --modules ~/.cache/village-waste \
  --pooling gapmax --class-weight sqrt --label-smoothing 0.05 \
  --out models/waste --force
```

Two training choices are deliberate.  **`--class-weight sqrt`** damps the
inverse-frequency weighting: full balancing up-weighted the small Ewaste class
by more than 3x against Paper, which is why an unfamiliar brown object fell
into Ewaste.  **Label smoothing** keeps a rare class from becoming the
confident default answer for anything unusual.

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

- **Clear glass versus clear plastic is still the hard pair.** On the mixed
  held-out set Glass is 86.7% and Plastic 87.6%; most misses are glass read as
  metal (6 of 75) and plastic read as paper (13 of 170). A coloured plastic
  bottle or a bag is easier for the demo; venue photos are the real fix.
- **Paper, foam and thin plastic overlap.** Foam cups are read as plastic in
  half the probe photos, and paper bags as thermocol in three of fourteen.
  Thermocol is now 73.7% on held-out photos (it had 42 public photos before;
  the current tree has 171), but it is still the weakest class.
- **Brown cardboard is mostly fixed, not perfect.** Cardboard boxes are 85.7%
  and corrugated board 64.3% on the probe; the remaining corrugated misses are
  read as e-waste, because brown board and a brown circuit board share a colour
  and a texture at 224×224.
- The model classifies the item in front of the camera. It cannot tell who put
  it there, and a recognition is not proof of a deposit or a handover.
- A 224×224 image of a crumpled wrapper is genuinely ambiguous. The page
  requires the same class for several consecutive frames and a confidence
  threshold; it does not guess when the answer is weak.
