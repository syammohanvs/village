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
| Glass | TrashNet `glass` (MIT) + Wikimedia glasses/sunglasses | ~509 |
| Metal | TrashNet `metal` (MIT) + Wikimedia keys/key rings | ~476 |
| Textile | clothing-dataset-small (CC0) + fabric photos (Wikimedia) | 841 |
| Leather | clothing-dataset-small `outwear` (CC0) + Wikimedia wallets | ~194 |
| Footwear | clothing-dataset-small `shoes` (CC0) | 198 |
| Thermocol | Wikimedia foam/packaging photos | 171 |
| Ewaste | Wikimedia e-waste + key fobs, phones, watches | ~183 |
| Background | room and table photos with no item | 110 |

The Paper count includes TrashNet's **403 `cardboard` photos**, which the first
pipeline never copied. The Plastic count includes real-world photos of bottle
caps, ball pens, bottles, cups and containers; Thermocol gained 129 foam
photos. Glass, Metal, Leather and Ewaste also gained a small set of ordinary
objects (sunglasses, keys, key rings, wallets, key fobs, phones and watches),
because those are still materials a visitor may hand to the camera. Those
families were simply absent before, which is why a brown paper cover was read
as e-waste, a bottle cap as e-waste and a ball pen as glass.

Fifteen per cent of each class is held back for validation. **The installed
classifier is ResNet50, running on the laptop's backend** — see *Where the model
runs* below. It scores **91.5% exact class (872/953)** on the common mixed set
(studio photos plus real-world object photos). Because the seven recycler
classes share one action, **95.5% of items get the right action**.

| Model | Exact (953) | Bin | Recycler | Item action | Probe (236) |
| --- | --- | --- | --- | --- | --- |
| V3 (MobileNetV1) | 85.6% | **91.8%** | 87.5% | 89.4% | 62.3% |
| V6 (MobileNetV1) | 85.1% | 87.4% | 93.1% | 90.6% | 64.8% |
| V8 (MobileNetV1) | 86.7% | 86.0% | 95.8% | 91.4% | 64.0% |
| V12 (MobileNetV1) | 90.9% | 90.6% | 96.7% | 94.0% | 62.7% |
| **ResNet50 (installed)** | **91.5%** | **91.8%** | **98.5%** | **95.5%** | **71.6%** |

ResNet50 is the best build on every measure except the handkerchief (below). The
MobileNetV1 files are kept in `models/waste/` and `models/waste-v*/`, so any of
them can be restored by copying four files; they are no longer loaded by the
running app.

| Class | Exact match | Held-out photos |
| --- | --- | --- |
| Organic | 100.0% | 27 |
| Plastic | 83.5% | 170 |
| Paper | 86.2% | 217 |
| Glass | 74.7% | 91 |
| Metal | 80.5% | 82 |
| Textile | 94.4% | 126 |
| Leather | 83.3% | 36 |
| Footwear | 93.3% | 30 |
| Thermocol | 91.4% | 70 |
| Ewaste | 94.2% | 86 |
| Background | 77.8% | 18 |

### The objects that were misread

A slice of the extra photos is kept out of training as a **probe**. These are
the results on photos the model has never seen:

| Object | Correct | Misread as |
| --- | --- | --- |
| Ball-pointed pen | **100.0%** (14/14) | — |
| Ball pen | **92.3%** (12/13) | Thermocol 1 |
| Bottle cap | **81.8%** (9/11) | Ewaste 1, Background 1 |
| Cardboard box | **64.3%** (9/14) | Ewaste 3, Background 1, Plastic 1 |
| Corrugated board | **42.9%** (6/14) | Ewaste 3, Thermocol 2, Plastic 2, Metal 1 |
| Paper bag | **71.4%** (10/14) | Thermocol 4 |
| Plastic bottle | **64.3%** (9/14) | Paper 3, Ewaste 2 |
| Plastic cup | **64.3%** (9/14) | Thermocol 2, Ewaste 2, Paper 1 |
| Foam food container | **83.3%** (10/12) | Plastic 1, Background 1 |
| Foam cup | **83.3%** (5/6) | Plastic 1 |
| Electronic key fob | **66.7%** (6/9) | Plastic 2, Leather 1 |
| Key fob (key-fob category) | **100.0%** (6/6) | — |
| Advertising key fob | **83.3%** (5/6) | Plastic 1 |
| Car key (ordinary key) | **4/10** | Ewaste 5, Thermocol 1 |

The car key that started this work was read as Leather by the older model. On
the **8 photos of car keys** used for that check, the previous install produced
**4 Metal, 3 Ewaste, 1 Paper** (seven recycler materials); the installed V6
produces **3 Metal, 5 Ewaste — all eight are recycler materials and none is
Leather**. With the grouped recycler confidence below, all eight are accepted
even when the top class is only 42–64%: Metal + Ewaste together clear the
threshold.

### Where the model runs

Until 2026-11-13 the waste classifier was a **MobileNetV1** model that ran in the
browser (2.5 MB, no backend needed). It is now a **ResNet50** that runs on the
laptop's backend, because the browser cannot load PyTorch and because ResNet50 is
measurably better on the same photographs.

| | MobileNetV1 (browser) | ResNet50 (backend) |
| --- | --- | --- |
| Exact class | 86.7% | **91.5%** |
| Item action | 91.4% | **95.5%** |
| Bin kept | 86.0% | **91.8%** |
| Recycler referred | 95.8% | **98.5%** |
| Real-world probe | 64.0% | **71.6%** |
| Business card | 14/25 | **25/25** |
| Pin | 3/8 | **4/8** |
| Handkerchief | **4/8** | 1/8 |
| Per frame | ~30 ms | ~50-85 ms |
| Needs the backend | no | yes |

The camera still crops and paints out the table **in the browser**; only the
classification step is a round trip. `POST /api/v1/waste/classify` takes the
224x224 crop as a JPEG data URL and returns the 11-class distribution, which the
page groups into bin / recycler / background exactly as before. No internet is
needed and nothing leaves the laptop.

The model file is `models/waste-resnet50/model.pt` (~95 MB, git-ignored).
`scripts/waste/train_resnet50.py` trains the head on a frozen backbone and
`scripts/waste/export_resnet50.py` writes the single file the backend loads.

### Specific objects, and why they need photos rather than a bigger model

A handkerchief was reported as never resolving. It is **Textile**, and the
Textile class was built from a clothing dataset: shirts, trousers and jackets
hanging or being worn, not a flat square of cloth lying on a table. On 28 real
handkerchief photos the installed V6 put Textile first **0–7 times out of 28**
depending on the sample, and mostly said Paper, Thermocol or Background.

A business card was reported as Thermocol. It is **Paper**, but the Paper class
was built from TrashNet's flat sheets and paper bags — not printed cards with
text and logos.

Adding 20 photos of each (four copies each) improved the general metrics every
time, but the two specific objects **oscillate**: V8 gets handkerchiefs 4/8 and
business cards 14/25; V9 gets business cards 25/25 but handkerchiefs 1/8; V12
gets business cards 5/5 and handkerchiefs 3/8. No single MobileNetV1 build is
best on both. This is the ceiling of the current approach — adding photos of one
object dilutes another.

**The lesson: the failure is the dataset, and the network is too small to learn
both from 20 photos each.** No amount of MobileNetV3, ResNet50 or a cloud
vision model is a substitute for having the object in the training data — but a
larger network would generalise further from 20 photos than a frozen
MobileNetV1 does. The ResNet50 experiment (89.7% exact, 74.6% probe) shows
that. Venue photos remain the highest-value input, and a bigger backbone is
the path to recognising all of them at once.

### Ordinary objects

A phone, watch, key fob, mechanical key, wallet or pair of sunglasses is still
a **material**: Ewaste, Metal, Leather or Glass, and the app refers all of them
to the recycling agent. The public samples are small (1–9 probe photos each),
so V6 is not yet reliable on phones (1/4), wallets (1/5), smartwatches (2/4)
or wristwatches (2/4); sunglasses are 4/5. A key fob is much better
(6/6 in the fob category). Venue photos are the fix.

The remaining misses on the waste photos are mostly the paper/foam and
foam/plastic boundaries and brown cardboard against e-waste, which are
genuinely close on a 224×224 photo.

To rebuild it:

```bash
npm install --prefix ~/.cache/village-waste @tensorflow/tfjs-node@4.22.0
node scripts/waste/fetch_extra_images.mjs \
  --out ~/.cache/village-waste/extra --per-source 40 --probe 0.2
node scripts/waste/build_waste_dataset.mjs \
  --base ~/.cache/village-waste \
  --trashnet ~/.cache/village-waste/dataset-resized \
  --extra ~/.cache/village-waste/extra \
  --out ~/.cache/village-waste/v2 --extra-repeat 2 \
  --focus-labels Ewaste --focus-repeat 6 --force
node scripts/waste/train_waste_model.mjs \
  --data ~/.cache/village-waste/v2 \
  --probe ~/.cache/village-waste/v2/probe \
  --modules ~/.cache/village-waste \
  --out models/waste --force
```

The installed V6 repeated the **key-fob photos 6×**; the phone/watch extras were
left out of its Ewaste tree, because they pulled paper into e-waste. The trainer
refuses to overwrite an installed model without `--force`, and
before it exits it reloads the exported files and classifies eight photos
again to prove the export is complete. `evaluate_waste_model.mjs` scores any
exported model on the same photos, which is what makes an old-versus-new
comparison honest. `predict_waste_image.mjs` shows the top classes for one
photo, which is how an operator's "my car key came out as leather" report is
checked.

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
  --out ~/.cache/village-waste/v2 --extra-repeat 2 \
  --focus-labels Ewaste --focus-repeat 6 --force
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
- **The seven recycler materials are one outcome, so their probabilities are
  added.** If a frame says Ewaste 45% and Metal 35%, the recycling action is
  80% even though no single material reached 75%; the page accepts it and
  names the stronger material. This is why a car key fob split between Ewaste
  and Metal is no longer stuck on “not sure”. A bin action never borrows
  another bin's probability: Plastic has to beat the recycler total on its
  own.
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

### Focusing on the object, not the room

The page compares each camera frame with one or more **empty-scene snapshots**.
A pixel that matches any stored snapshot is background; everything else is the
object.

The comparison has **three** outcomes, and they must not be confused:

| What the frame is | What the page does |
| --- | --- |
| Matches the stored scene | “Not a waste item”. The model is not asked to name the room. |
| Something changed | Crops to it, paints out the empty scene, classifies. |
| **Matches nothing** | **Says so, and still classifies the whole frame.** |

The third row is the one that used to break the exhibit. “The table is empty”
and “the stored background no longer describes this view” both arrived as *no
region*, so the page reported “Not a waste item” for the second one too — and a
real item in front of the camera was never looked at again. A nudged camera, a
lamp switched on, or **pressing Set background with an item already on the
table** all produce it. Now the page says *“The stored background no longer
matches this view. Show the empty table and press Set background again.”* and
keeps classifying, so the visitor still gets an answer while the operator fixes
the snapshot.

1. Start the camera. If the table is empty, press **Set background** once — that
   gives the best accuracy (the table is painted out of the crop).
2. If the table is not empty (or the item is being held in the hand), leave
   **Focus on the object** ticked and show the item in the centre of the frame.
   The page crops the centre and classifies that; the hint below the camera
   says how to do better.
3. Show one item. Only the part that appeared is classified.

Inside the crop, every pixel that still matches the stored empty scene is then
**replaced with a plain white plate**. A pixel that matches the empty table
cannot be the item, so there is nothing to guess at: the table, the floor and
the background between the item and the edge of the crop are removed exactly,
and the classifier is handed the object on its own.

This is the step people expect from a “remove the background” website. It is
done **by subtraction rather than by a model**, and that is deliberate — see
*Why not an AI background remover* below.

The backgrounds are **kept on this device** across a camera stop and a page
reload; the last set remains until **Clear backgrounds** is pressed. Up to
**three** can be stored, because a hall changes: a door is open in one and
closed in another, or the lamps are on in one and off in another. A fourth
press of **Add background** replaces the oldest, so the newest views are
always the three in force. **Focus on the object** can be unticked to classify
the whole frame, which is the old behaviour.

After a confirmed item the **camera stays on**. Remove the item; the empty
scene lets the stabilizer re-arm, and the next item is classified without
pressing Start Camera again. The result card says *remove the item*, then
*Camera armed*, so the operator can see which state it is in.

**Practical workflow.** A background is what makes the system accurate, but it
is not required. With no background stored the page classifies a centre crop of
the frame, which is enough for an item held in the hand or shown close to the
camera. The result card still names the class and the confidence, so the
operator can see what the model thinks even when it is unsure. For an item that
keeps misreading, the fix is the same as for the car key and the handkerchief:
photographs of that object in the exhibition setting, added to the training set
and retrained. The training scripts and the measurement harness are in
`scripts/waste/`.

This is why a car key on a home table no longer becomes “Leather” from the
wooden table or a sleeve in the frame: the table and the room are the
background, and the key is what survives the subtraction.

**What the removal is worth, measured.** 222 scenes were built by pasting a
real object photo onto a real room photo the way the camera sees it, then
classified with the installed model. Item-level action accuracy (the right bin,
or “recycling agent” for any recycler material):

| What the model is given | Right action |
| --- | --- |
| The whole frame | 8.6% |
| A square crop of the changed box (the previous behaviour) | 32.9% |
| A crop with the empty scene painted out | **about 60%** |

The earlier install and the current one agree on the ranking, so this is a
property of the step and not of one model. The measurement lives in
`docs/verification.md`.

**Why not an AI background remover.** A general subject-cutout model was tried
first, because that is what the cutout websites use. It was rejected on
measurement, not on taste:

- **It removes the wrong thing.** Run on the whole frame it keeps the largest
  salient object, which on a table is the **furniture**: in the test scenes it
  deleted the item and kept the desk, the picnic table and a bookcase. Item
  accuracy on the whole frame was 37.4% against 8.6% for no processing at all —
  better than nothing, far worse than the crop.
- **Run inside the crop it does help — but less than subtraction.** Crop then
  cutout scores 52.7% against about 60% for painting out the stored scene.
- **It damages shiny objects.** On the eight car-key photos, which already sit
  on a white background, the small `u2netp` model made the black plastic shell
  **semi-transparent** and the larger `u2net` left holes in it. Those are the
  photos that started this work.
- **It costs a lot for that.** A 4.4–168 MB model and 0.26–0.51 s per photo on
  a desktop CPU, against a few milliseconds for the subtraction, which needs
  no model at all because the empty scene is already stored.

So the order is: compare with the stored empty scene, crop to what changed, then
subtract the parts of the crop that are still that empty scene. The comparison
is the only step that needs to know *where* the item is, and it already does.

**When it is not sure, it says what it thinks.** The page used to say *“Not sure
yet”* for as long as the guess stayed below the acceptance threshold, which tells
the operator nothing — the report that prompted this was a handkerchief that
never resolved. The card now reads *“Best guess Paper at 55% — not sure enough
to choose a bin. Move it a little and hold it still.”* It still refuses to pick a
bin, but the guess and the number are the information needed to decide whether to
move the item, change the light, or hand it to the operator.

**Zara greets the visitor.** On arrival the page says one line in the language the
app is set to — *“Know the bin? Go ahead. Not sure? Show the item to the camera
and I’ll help.”* — and shows the same words for a device with no voice. It is
said again if the language is switched while the card is open, and stops when
the card is dismissed or the page is left.

**Hands and people.** A background snapshot does not know that an arm is not
waste: a hand entering the frame changes pixels too, so it survives the
subtraction. The crop is therefore weighted towards the **middle** of the
picture (an arm comes in from an edge; the item is usually at the far end of
it), and when the changed area touches a frame edge the page shows a warning:
*“A hand or person is in the picture. Place the item on the table and step
back.”* It still classifies, but the operator knows why a sleeve may be read as
cloth. The reliable workflow at the exhibition is to **put the item on the
table** rather than hold it in front of the camera. There is no
person-detection model in this build; if held-item recognition is needed, a
person-segmentation pass (which removes the *person*, not the background) is
the next step — a cutout model is the wrong tool for it.

**Where the subtraction can still lose something.** An item whose middle looks
exactly like the table — a clear glass bottle, or white foam on a white
tablecloth — has its interior painted out and reaches the model as an outline.
The page refuses a mask that would keep less than 2% of the crop and falls back
to the plain crop, and a moved camera makes everything differ, which also falls
back to the plain crop, so the step cannot make the picture emptier than the
crop already was.

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

An ordinary object is still sorted by its material, because that is what the
camera sees: a phone, key fob or watch is **Electronic waste**; a mechanical
key or key ring is **Metal**; sunglasses are **Glass**; a wallet is **Leather**
(natural or synthetic). All of them are referred to the recycling agent, so the
material changes the label but not the bin action. Only the empty table and the
room are **Background**, which the page shows as **“Not a waste item”** and
ignores.

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
- Bin fill is estimated from a laser distance measurement, not measured weight
  or volume.
- The app stores classification events, not images or video.
