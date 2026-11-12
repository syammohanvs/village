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
| Plastic | TrashNet `plastic` (MIT) | 482 |
| Paper | TrashNet `paper` (MIT) | 594 |
| Glass | TrashNet `glass` (MIT) | 501 |
| Metal | TrashNet `metal` (MIT) | 410 |
| Textile | clothing-dataset-small (CC0) + fabric photos (Wikimedia) | 841 |
| Leather | clothing-dataset-small `outwear` (CC0) | 184 |
| Footwear | clothing-dataset-small `shoes` (CC0) | 198 |
| Thermocol | foam/packaging photos from Wikimedia Commons | 42 |
| Ewaste | electronic-waste photos from Wikimedia Commons | 123 |
| Background | room and table photos with no item | 110 |

Fifteen per cent of each class is held back for validation. The installed model
scores **93.4% exact class (513/549)**, and because the seven recycler classes
share one action, **97.3% of items get the right action**:

| Class | Exact match | Held-out photos |
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

The important action-level numbers: **180/188 bin items** got their own bin and
**338/345 recycler items** were referred to the agent. Five clear glass photos
were read as plastic, and four bin photos were read as a recycler material.

To rebuild it:

```bash
npm install --prefix ~/.cache/village-waste @tensorflow/tfjs-node@4.22.0
node scripts/waste/train_waste_model.mjs \
  --data ~/.cache/village-waste \
  --modules ~/.cache/village-waste \
  --out models/waste --force
```

The trainer refuses to overwrite an installed model without `--force`, and
before it exits it reloads the exported files and classifies eight photos
again to prove the export is complete.

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

- The public training photos are studio-like: waste on white backgrounds,
  rooms and tables for Background. A camera at the venue can look different,
  which is why section 1's retraining step exists.
- **Clear glass versus clear plastic is the hard pair.** Five of 72 held-out
  plastic photos were read as recycler material, and five of 75 glass photos
  were read as plastic. Use a coloured plastic bottle or a bag for the demo,
  and retrain with the venue's own items for the best result.
- Thermocol has only 42 public photos and two of its six held-out photos were
  ignored (they were not really foam). Add real thermocol plates/cups/packing
  from the venue before relying on it.
- The camera identifies waste, not people. It cannot attribute an item to a
  villager. Profiles are optional **fictional demo records** and require an
  explicit selection.
- Recognition does not prove that the item was deposited or handed over.
- Bin fill is estimated from ultrasonic distance, not measured weight or
  volume.
- The app stores classification events, not images or video.
