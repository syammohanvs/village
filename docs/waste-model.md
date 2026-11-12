# Waste recognition model

The classifier runs **entirely in the browser** with TensorFlow.js. No image
leaves the laptop and no cloud service is used.

The installed model was trained on this laptop with the same architecture a
Teachable Machine image project produces (a frozen truncated MobileNet v1 plus
a small classifier head). It loads exactly as a Teachable Machine export does,
so the dashboard cannot tell the two apart.

## 1. Train it automatically on this laptop (what this project uses)

The complete pipeline is in [`scripts/waste/`](../scripts/waste/README.md).
It needs no browser, no Google account and no upload, and it writes the three
files the dashboard expects.

Every recycler material has its own model class, because shape and texture
matter, but the dashboard maps all of them to one outcome: **hand it to our
recycling agent**. The training photos live outside the repository, in
`~/.cache/village-waste`:

| Class | Source | Photos |
| --- | --- | --- |
| Organic | Voxel51 food-waste dataset (MIT) | 180 |
| Plastic | TrashNet `plastic` (MIT) + Wikimedia caps, pens, bottles, cups | 888 |
| Paper | TrashNet `paper` + `cardboard` (MIT) + Wikimedia paper bags/board | 1 279 |
| Glass | TrashNet `glass` (MIT) | 501 |
| Metal | TrashNet `metal` (MIT) | 410 |
| Textile | clothing-dataset-small (CC0) + fabric photos (Wikimedia) | 841 |
| Leather | clothing-dataset-small `outwear` (CC0) | 184 |
| Footwear | clothing-dataset-small `shoes` (CC0) | 198 |
| Thermocol | Wikimedia foam/packaging photos | 171 |
| Ewaste | electronic-waste photos from Wikimedia Commons | 123 |
| Background | room and table photos with no item | 110 |

The Paper count includes TrashNet's **403 `cardboard` photos**, which the first
pipeline never copied. The Plastic count includes real-world photos of bottle
caps, ball pens, bottles, cups and containers; Thermocol gained 129 foam
photos. Those object families were simply absent before, which is why a brown
paper cover was read as e-waste, a bottle cap as e-waste and a ball pen as
glass.

Fifteen per cent of each class is held back for validation. The installed model
scores **88.8% exact class (717/807)** on that mixed set (studio photos plus
real-world object photos). Because the seven recycler classes share one action,
**91.8% of items get the right action**: **371/414 bin items** kept their own
bin and **355/377 recycler items** were referred.

The previous model is not comparable on its own older figures, because those
were measured on studio photos only. Scored on the **same 807 photos**, the old
model gets **76.5% (617/807)** and the new one **88.8%**. On the separate
**probe** of real-world objects it is even clearer: the old model **17.4%**
(28/161), the new model **77.6%** (125/161).

| Class | Exact match | Held-out photos |
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

### The objects that were misread

A slice of the extra photos is kept out of training as a **probe**. These are
the results on photos the model has never seen:

| Object | Correct | Misread as |
| --- | --- | --- |
| Ball-pointed pen | **100.0%** (14/14) | — |
| Ball pen | **92.3%** (12/13) | Thermocol 1 |
| Bottle cap | **90.9%** (10/11) | Ewaste 1 |
| Cardboard box | **85.7%** (12/14) | Background 1, Thermocol 1 |
| Corrugated board | **64.3%** (9/14) | Ewaste 3, Metal 1, Plastic 1 |
| Paper bag | **71.4%** (10/14) | Thermocol 3, Plastic 1 |
| Plastic bottle | **71.4%** (10/14) | Thermocol 2, Paper 1, Background 1 |
| Plastic cup | **64.3%** (9/14) | Paper 2, Thermocol 2, Ewaste 1 |
| Foam food container | **66.7%** (8/12) | Plastic 2, Paper 1, Ewaste 1 |
| Foam cup | **50.0%** (3/6) | Plastic 3 |

Before this retraining the same probe scored **17.4%**, with every ball pen read
as glass, every bottle cap as e-waste, and every cardboard box as e-waste. The
remaining misses are mostly the paper/foam and foam/plastic boundaries, which
are genuinely close on a 224×224 photo.

To rebuild it:

```bash
npm install --prefix ~/.cache/village-waste @tensorflow/tfjs-node@4.22.0
node scripts/waste/build_waste_dataset.mjs \
  --base ~/.cache/village-waste \
  --trashnet ~/.cache/village-waste/dataset-resized \
  --extra ~/.cache/village-waste/extra \
  --out ~/.cache/village-waste/v2 --extra-repeat 2 --force
node scripts/waste/train_waste_model.mjs \
  --data ~/.cache/village-waste/v2 \
  --probe ~/.cache/village-waste/v2/probe \
  --modules ~/.cache/village-waste \
  --out models/waste --force
```

The trainer refuses to overwrite an installed model without `--force`, and
before it exits it reloads the exported files and classifies eight photos
again to prove the export is complete. `evaluate_waste_model.mjs` scores any
exported model on the same photos, which is what makes an old-versus-new
comparison honest.

### Retrain it where the exhibition happens

The public photos are a **bootstrap, not a finished model**. The same camera,
lamp and table matter more than extra public images.

1. Open **Sort Waste**, start the camera, and take 40–80 photos for each class
   in the real setting. Add hands, the empty table and the room to
   `Background`.
2. Put them in `Organic/`, `Plastic/`, `Paper/`, `Glass/`, `Metal/`,
   `Textile/`, `Leather/`, `Footwear/`, `Thermocol/`, `Ewaste/` and
   `Background/` folders.
3. Run `train_waste_model.mjs --data <that folder> --out models/waste --force`.
4. Test with items that were **not** photographed. A model that only works on
   its own training photos is not ready.

The backend reads the model folder per request, so a new model is picked up on
the next camera start; no restart is needed. Reload the page if it was already
open.

### When one category is confused with another

A wrong answer is a **data gap**, not a threshold to lower. The pipeline has
three tools for closing one:

- **`--probe <folder>`** keeps a slice of photos out of training and reports
  the result **per object** (`bottle-caps 0/11, misread as Ewaste 5, Metal 3`).
  The ordinary validation score can look healthy while the exact item in front
  of the camera is still wrong, so the probe is the number to watch.
- **`fetch_extra_images.mjs`** downloads real-world photos of the object
  families the bootstrap datasets do not cover — bottle caps, ball pens, paper
  bags, cardboard, foam packaging, cans, jars — from Wikimedia Commons, with
  each file's licence recorded in `sources.json`.
- **`build_waste_dataset.mjs`** assembles the training tree: the bootstrap
  photos, TrashNet's previously unused `cardboard` folder (filed under Paper),
  the extra photos and the held-out probe slice.

TrashNet's `cardboard` folder matters on its own: brown corrugated cardboard
had no photos in Paper at all, which is why a brown paper cover was read as
electronic waste. Two training changes matter too: `--class-weight sqrt`
damps the rare-class weighting (full balancing up-weighted Ewaste by more than
3x against Paper), and label smoothing stops a small class becoming the
confident answer for anything unfamiliar.

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
  --out models/waste --force
```

Keep the probe photos out of `train/` and `val/`; a model measured on its own
training photos is not measured at all.


## 2. Alternative: train on the Teachable Machine website

This is the manual route if the automated one is not wanted.

1. Open <https://teachablemachine.withgoogle.com/train/image> once, while the
   laptop still has internet.
2. Create one class for each folder in the table above (at minimum `Organic`,
   `Plastic`, `Paper`, and `Background`; add the recycler classes you will
   show).
3. Collect at least 80–150 images per class. Use the same camera, lighting and
   table as the exhibition.
4. Train, then test with items **not** in the training set.
5. Export → **TensorFlow.js** → download the zip.

## 3. Install the exported files

Either pipeline must end with these three files in `models/waste/`:

```
models/waste/model.json
models/waste/metadata.json
models/waste/weights.bin
```

They are git-ignored, so a fresh clone must retrain or copy them; a
frontend-only deployment has no model and says so. Check them:

```bash
curl -s http://127.0.0.1:8010/api/v1/waste/model-status
```

`installed: true` means the backend found all three and can read the labels.
The Waste page loads `/models/waste/model.json` and `metadata.json` through the
local backend. If the files are missing the page says **Recognition model not
installed**. It never substitutes random predictions.

## 4. How a prediction becomes an event

- The camera preview runs at a modest rate. Each frame produces a score for
  every class; the page ranks them and shows the best three.
- A class must exceed the confidence threshold (default 0.75) and be stable for
  several consecutive frames (default 5).
- An accepted Organic, Plastic or Paper item sends `INDICATE_WASTE`, lights the
  matching bin LED and stops the camera.
- An accepted **Glass, Metal, Textile, Leather, Footwear, Thermocol or
  Ewaste** item is posted as category `other`: the app shows **Recycling
  agent**, says the item does not go in the three bins, and sends **no
  `INDICATE_WASTE` command**, so no bin LED can light. Pressing **Confirm
  handed over** records a separate handover with zero points.
- `Background`/unknown is ignored.
- After an accepted event the **camera stops itself**, so repeated frames of
  the same bottle cannot become multiple items and the next item gets a fresh
  session when the operator presses Start Camera again.
- A **Hazardous / medical** button next to Start Camera is for syringes,
  cotton, napkins, diapers, urine bags and catheters. It records the item as
  hazardous waste, lights no bin LED and asks you to hand it to the operator
  and contact the operator. It works without a model, so it is the reliable
  path for medical waste; the camera is stopped after it too.
- If the target bin is **full**, the app still indicates the correct category
  and shows a warning. It never redirects the item to a different bin.
- A recognition is not proof that an item reached a bin or an agent.

The threshold and stable-frame count are adjustable in
Setup → Voice & Camera; the cooldown applies to a session that stays open.

## 5. Class mapping

| Model class | Action | LED |
| --- | --- | --- |
| Organic | Organic bin | organic |
| Plastic | Plastic bin | plastic |
| Paper | Paper bin | paper |
| Glass, Metal, Textile, Leather, Footwear, Thermocol, Ewaste | Recycling agent | none |
| Background / unknown | none | none |

The mapping is fixed in this build. The UI names the material it saw (for
example “Glass” or “Electronic waste”) and then gives the same referral
instructions. Medical waste is not a model class: the operator uses the
**Hazardous / medical** button for it.

## 6. Honest limits

- The bootstrap photos are studio-like: waste on white backgrounds, rooms and
  tables for Background. The retraining adds real-world photos of the object
  families that were missing (cardboard, caps, pens, foam, cups, cans, jars),
  but the venue's own camera, lamp and table are still the best next step.
- **Clear glass versus clear plastic is still the hard pair.** On the mixed
  validation set Glass is 86.7% and Plastic 87.6%; most misses are glass read as
  metal (6 of 75) and plastic read as paper (13 of 170). Use a coloured plastic
  bottle or a bag for the demo, and retrain with the venue's own items for the
  best result.
- **Paper, foam and thin plastic overlap.** Foam cups are read as plastic in
  half the probe photos, and paper bags as thermocol in three of fourteen. On a
  224×224 frame a white foam cup and a white paper cup are genuinely close.
  Thermocol is now 73.7% on held-out photos (was 66.7% with 42 photos) but it
  is still the weakest class.
- **Brown cardboard is mostly fixed, not perfect.** Cardboard boxes are 85.7%
  and corrugated board 64.3% on the probe; the remaining corrugated misses are
  read as e-waste, because a brown board and a brown circuit board share a
  colour and a texture at this resolution.
- The camera identifies waste, not people. It cannot attribute an item to a
  villager. Profiles are optional **fictional demo records** and require an
  explicit selection.
- Recognition does not prove that the item was deposited or handed over.
- Bin fill is estimated from ultrasonic distance, not measured weight or
  volume.
- The app stores classification events, not images or video.
