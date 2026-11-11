# Waste recognition model

The classifier runs **entirely in the browser** with TensorFlow.js. No image
leaves the laptop and no cloud service is used.

The installed model was trained on this laptop from public photos with the
same architecture a Teachable Machine image project produces (a frozen
truncated MobileNet v1 plus a small classifier head). It loads exactly as a
Teachable Machine export does, so the dashboard cannot tell the two apart.

## 1. Train it automatically on this laptop (what this project uses)

The complete pipeline is in [`scripts/waste/`](../scripts/waste/README.md).
It needs no browser, no Google account and no upload, and it writes the three
files the dashboard expects.

The training photos live outside the repository, in `~/.cache/village-waste`:

| Class | Source | Photos |
| --- | --- | --- |
| Plastic | TrashNet `plastic` (MIT) | 320 |
| Paper | TrashNet `paper` (MIT) | 320 |
| Organic | Voxel51 food-waste dataset (MIT) | 180 |
| Background | freely licensed room/table photos from Wikimedia Commons | 110 |

The photos are not committed; they stay in `~/.cache/village-waste`. The
trained weights are a derived work of those datasets, which is one more reason
`models/` is git-ignored.

Fifteen per cent of each class is held back for validation. The current install
scores **97.1%** on those 140 held-out photos. (The dataset assembler can also
map TrashNet's `cardboard` folder into Paper; the installed model used the
`paper` folder on its own.) The trainer prints the accuracy
per class and a confusion matrix, and writes `training-report.json` next to the
model so the claim can be checked later.

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
2. Put them in `Organic/`, `Plastic/`, `Paper/` and `Background/` folders.
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
2. Create four classes, named exactly:
   - `Organic`
   - `Plastic`
   - `Paper`
   - `Background`
3. Collect at least 80–150 images per class. Use the same camera, lighting and
   table as the exhibition.
   - Move the item around; show different angles and distances.
   - Include hands, the empty table, the bin and the room in `Background`.
   - Use several examples of each material (a bottle, a bag, a wrapper; paper,
     card, newspaper; leaves, fruit peel, a small plant).
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
- `Background`/unknown is ignored.
- After an accepted event the **camera stops itself**, so repeated frames of
  the same bottle cannot become multiple items and the next item gets a fresh
  session when the operator presses Start Camera again.
- The background/cooldown rules still protect a session that stays open — for
  example when the backend refuses a recognition and the camera is left
  running so the item can be shown again.
- One accepted event sends `INDICATE_WASTE` through the backend. The correct
  category LED lights for a bounded time. Unknown categories activate nothing.
- If the target bin is **full**, the app still indicates the correct category
  and shows a warning. It never redirects the item to a different bin.
- The recognition is logged separately from a **confirmed deposit**. Pressing
  “Confirm deposited” creates a deliberate confirmation record. A photo of an
  item is not proof that it went into the bin.

The threshold and stable-frame count are adjustable in
Setup → Voice & Camera; the cooldown applies to a session that stays open.

## 5. Class mapping

| Model class | Bin | LED |
| --- | --- | --- |
| Organic | Organic | organic |
| Plastic | Plastic | plastic |
| Paper | Paper | paper |
| Background / unknown | none | none |

The mapping is fixed in this build.

## 6. Honest limits

- The public training photos are studio-like: waste on white backgrounds,
  rooms and tables for Background. A camera at the venue can look different,
  which is why section 1's retraining step exists.
- The camera identifies waste, not people. It cannot attribute an item to a
  villager. Profiles are optional **fictional demo records** and require an
  explicit selection.
- Recognition does not prove that the item was deposited.
- Bin fill is estimated from ultrasonic distance, not measured weight or
  volume.
- A crumpled wrapper is genuinely ambiguous between paper and plastic. The
  stable-frames rule and the threshold stop a single weak frame from acting.
- The app stores classification events, not images or video.
