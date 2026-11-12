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

Fifteen per cent of each class is held back for validation. The installed model
scores **85.1% exact class (811/953)** on the common mixed set (studio photos
plus real-world object photos). Because the seven recycler classes share one
action, **90.6% of items get the right action**: **362/414 bin items** kept
their own bin and **485/521 recycler items** were referred.

The trade is deliberate. The previous install (V3) scores **85.6% (816/953)**
on the same photos, with **91.8%** bin accuracy and **87.5%** recycler
accuracy. The installed V6 gives up about **4 points of bin accuracy** for
about **5.6 points of recycler accuracy** and the car-key result below. If bin
sorting matters more than arbitrary objects, the V3 backup is kept at
`models/waste-v3-20261113/`. The real-world probe is **64.8% (153/236)** for
V6 against **62.3%** for V3.

| Class | Exact match | Held-out photos |
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
object. The page crops a square around the changed box and hands only that crop
to the classifier. An unchanged scene is reported as **“Not a waste item”**
without asking the model to name a material from the room.

1. Start the camera with the table (or the room) empty.
2. Press **Set background**. The page stores that snapshot on this device.
3. Show one item. Only the part that appeared is classified.

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
*camera armed*, so the operator can see which state it is in.

This is why a car key on a home table no longer becomes “Leather” from the
wooden table or a sleeve in the frame: the table and the room are the
background, and the key is the crop.

**Hands and people.** A background snapshot does not know that an arm is not
waste: a hand entering the frame changes pixels too. The crop is therefore
weighted towards the **middle** of the picture (an arm comes in from an edge;
the item is usually at the far end of it), and when the changed area touches a
frame edge the page shows a warning: *“A hand or person is in the picture.
Place the item on the table and step back.”* It still classifies, but the
operator knows why a sleeve may be read as cloth. The reliable workflow at the
exhibition is to **put the item on the table** rather than hold it in front of
the camera. There is no person-detection model in this build; if held-item
recognition is needed, a person-segmentation pass is the next step.

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
- Bin fill is estimated from ultrasonic distance, not measured weight or
  volume.
- The app stores classification events, not images or video.
