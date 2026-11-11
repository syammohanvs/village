# Waste recognition model

The classifier runs **entirely in the browser** with TensorFlow.js. No image
leaves the laptop and no cloud service is used.

## 1. Train a Teachable Machine image project

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
4. Train, then test with items **not** in the training set. A model that only
   works on its own training photos is not ready.
5. Export → **TensorFlow.js** → download the zip.

## 1b. Or train it locally, without Teachable Machine

`scripts/waste/train_waste_model.mjs` trains the same architecture Teachable
Machine uses (a frozen truncated MobileNet v1 plus a small dense head) on this
laptop and writes the exact three files the dashboard loads. It never talks to
Google.

```bash
# once: the training dependencies live outside the web build
npm install --prefix ~/.cache/village-waste @tensorflow/tfjs-node@4.22.0

# train and install into models/waste/
node scripts/waste/train_waste_model.mjs \
  --data ~/.cache/village-waste \
  --modules ~/.cache/village-waste \
  --out models/waste
```

`--data` is a folder of one sub-folder per class (`Organic`, `Plastic`,
`Paper`, `Background`), or an already-split `train/` + `val/` tree. The script
prints held-out accuracy, refuses an export whose input shape is not 224×224,
reloads what it saved, and only then installs it.

The model currently installed on this laptop was trained this way on 850
photos: TrashNet (MIT, paper/cardboard/plastic), the Voxel51 food-waste
dataset (MIT, organic), and freely licensed table/room photos from Wikimedia
Commons for `Background`. Held-out accuracy was **96.4 %**. That is a starting
point for the exhibition, not a promise: photos from the venue's own table
under its own lighting will do better. Put ~80–150 photos per class in
`~/.cache/village-waste/train/<class>/` and run the command again to replace
the model in a few minutes.

## 2. Install the exported files

Copy these three files into `models/waste/`:

```
models/waste/model.json
models/waste/metadata.json
models/waste/weights.bin
```

They are git-ignored. Check them:

```bash
curl -s http://127.0.0.1:8010/api/v1/waste/model-status
```

`installed: true` means the backend found all three. The Waste page will load
`/models/waste/model.json` and `metadata.json` through the local backend.
If the files are missing the page says **Recognition model not installed**. It
never substitutes random predictions.

## 3. How a prediction becomes an event

- The camera preview runs at a modest rate. Each frame produces class scores.
- A class must exceed the confidence threshold (default 0.75) and be stable for
  several consecutive frames (default 5).
- `Background`/unknown is ignored.
- After an accepted event, the app requires a short background/absence period
  and a cooldown before it can count another item. Repeated frames of the same
  bottle do not become multiple items.
- One accepted event sends `INDICATE_WASTE` through the backend. The correct
  category LED lights for a bounded time. Unknown categories activate nothing.
- If the target bin is **full**, the app still indicates the correct category
  and shows a warning. It never redirects the item to a different bin.
- The recognition is logged separately from a **confirmed deposit**. Pressing
  “Confirm deposited” creates a deliberate confirmation record. A photo of an
  item is not proof that it went into the bin.

## 4. Class mapping

| Model class | Bin | LED |
| --- | --- | --- |
| Organic | Organic | organic |
| Plastic | Plastic | plastic |
| Paper | Paper | paper |
| Background / unknown | none | none |

The mapping is fixed in this build. The threshold, stable-frame count and
cooldown are adjustable in Setup → Voice & Camera.

## 5. Honest limits

- The camera identifies waste, not people. It cannot attribute an item to a
  villager. Profiles are optional **fictional demo records** and require an
  explicit selection.
- Recognition does not prove that the item was deposited.
- Bin fill is estimated from ultrasonic distance, not measured weight or
  volume.
- A model trained on one table under one lamp may fail under another. Test at
  the exhibition location.
- The app stores classification events, not images or video.
