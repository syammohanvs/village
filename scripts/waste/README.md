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
| `Glass` | TrashNet `glass` (MIT) + Wikimedia glasses/sunglasses | ~509 |
| `Metal` | TrashNet `metal` (MIT) + Wikimedia keys/key rings | ~476 |
| `Textile` | clothing-dataset-small (CC0) + fabric photos | 841 |
| `Leather` | clothing-dataset-small `outwear` (CC0) + Wikimedia wallets | ~194 |
| `Footwear` | clothing-dataset-small `shoes` (CC0) | 198 |
| `Thermocol` | Wikimedia Commons foam/packaging photos | 171 |
| `Ewaste` | Wikimedia e-waste + key fobs, phones, watches | ~183 |
| `Background` | room and table photos with no item | 110 |

The trainer holds back 15% of each class for validation. The current install
scores **85.1% exact class (811/953)** on a mixed set that now includes
real-world object photos. Because the seven recycler classes share one action,
**90.6% of items get the right action**: 362/414 bin items kept their own bin
and 485/521 recycler items were referred.

The previous install (V3) scores **85.6% (816/953)** on the same photos, with
**91.8%** bin accuracy and **87.5%** recycler accuracy. V6 trades about four
points of bin accuracy for about 5.6 points of recycler accuracy and the
car-key result; the V3 backup is `models/waste-v3-20261113/`. The real-world
probe is **64.8% (153/236)** for V6 against **62.3%** for V3.

| Class | Exact match | Held out |
| --- | --- | --- |
| Organic | 100.0% | 27 |
| Plastic | 82.4% | 170 |
| Paper | 89.9% | 217 |
| Glass | 85.7% | 91 |
| Metal | 70.7% | 82 |
| Textile | 96.0% | 126 |
| Leather | 75.0% | 36 |
| Footwear | 86.7% | 30 |
| Thermocol | 85.7% | 70 |
| Ewaste | 77.9% | 86 |
| Background | 66.7% | 18 |

The **car key** report is checked separately: the previous model read the 8
car-key photos as 4 Metal, 3 Ewaste and 1 Paper; the install reads them as
3 Metal and 5 Ewaste — all eight are recycler materials, none is Leather. The
grouped recycler confidence accepts all eight even when the top class is only
42–64%. A phone, watch, key fob or wallet is still a material (Ewaste, Metal,
Leather, Glass); the public probe has only a handful of each, so phones,
wallets and watches still need venue photos before they can be claimed.

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

`build_waste_dataset.mjs` has two more: `--extra-repeat` repeats every extra
photo (default 1), and `--focus-labels Metal,Ewaste --focus-repeat 4`
oversamples only the classes whose real-world photos are still scarce.

## Fixing a specific confusion

A confusion is a data gap, not a reason to lower the threshold.  The loop is:

1. **Prove it.**  Put a dozen photos of the item in `probe/<Class>/` and run
   the trainer with `--probe`.  The report prints one line per object
   (`bottle-caps 0/11, misread as Ewaste 5, Metal 3`), so the failure is a
   number rather than a story.
2. **Find the missing class contents.**  `fetch_extra_images.mjs` downloads
   real photos of the object families that the bootstrap datasets do not
   cover — bottle caps, ball pens, paper bags, cardboard, foam packaging, key
   fobs, phones, watches, wallets and sunglasses — from Wikimedia Commons,
   with the licence recorded in `sources.json`.  The title filter drops the
   category's noise (a photo of spring flowers is not a key).
3. **Rebuild the tree.**  `build_waste_dataset.mjs` keeps the bootstrap
   `train/` + `val/`, adds TrashNet's unused `cardboard` folder to Paper and
   the extra photos (repeated so they are not drowned by studio photos), and
   copies the held-out probe slice.
4. **Retrain and compare.**  The two numbers that matter are the ordinary
   validation score and the per-object probe score.  A model that wins on the
   probe is the one for the exhibition, even if the studio validation drops a
   point.

An ordinary object is still a **material**, not "nothing": a key fob, phone or
watch is **Ewaste**; a mechanical key or key ring is **Metal**; sunglasses are
**Glass**; a wallet is **Leather**.  They all go to the recycling agent, so the
material changes the label, not the bin action.  Only the empty table and the
room are `Background`.

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

## At the venue: correct the miss, keep the photo

Every crop the Sort Waste page sends is kept, with the full 11-class
distribution, in `data/waste-captures/` (an `index.jsonl` line plus the JPEG).

**When the model is wrong, press _Wrong? It was…_ under the result.** That one
press posts `POST /api/v1/waste/correction` with the crop's own file name (the
one the classify response returned) and the class you say it really is.  The
backend copies that frame into `data/waste-samples/<Class>/venue-<stamp>.jpg`
and appends a line to `data/waste-corrections.jsonl`.

Those copies are exactly what the trainer reads:

```bash
python3 scripts/waste/train_handheld_head.py --extra-train data/waste-samples
python3 scripts/waste/export_resnet50.py
# then re-measure before trusting it
python3 scripts/waste/hand_eval.py
```

`separate` ("keep it separate") is **not** a training class — it is glass,
metal, textile, leather, footwear, thermocol or e-waste, and guessing which
would put a wrong label in the tree.  Those frames go to
`data/waste-samples/Separate/` for a human to file.

## What did the camera see? (`venue_report.py`)

```bash
python3 scripts/waste/venue_report.py              # the whole log
python3 scripts/waste/venue_report.py --days 1     # today
python3 scripts/waste/venue_report.py --undecided 15
```

It reports reads per day, what the page would have said (bin / referral /
nothing / undecided) using the app's own 0.70 and 0.50 bars, the top-class
distribution, and the correction confusion list (*model said → really is*).
`--undecided N` lists the most recent crops that reached no decision, which are
the ones worth looking at first.  On the 23,961 reads recorded at home and in
the office it answers: 19.4% bin, 32.3% referral, 15.3% background and **33.0%
undecided** — the baseline to compare a venue session against.
