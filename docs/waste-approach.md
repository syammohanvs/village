# The waste classifier — how it works, and how to change it

A handoff brief for a coding agent. It describes the exhibit's waste page as it
is today (2026-11-19), the rules that are load-bearing, the numbers that were
measured, and the things that were tried and rejected so they are not tried
again.

Everything below is either a path in this repository, a measured number, or an
explicit decision. Where something is an assumption it says so.

---

## 0. The one-minute version

One item is **placed** on a fixed base in front of a webcam. The visitor presses
**Check the item**. The page crops the frame to the item, sends that one crop to
**two models at the same time**:

- a **hosted vision model** that *names the object* ("clear plastic bottle"), and
- a **local ResNet50** that *classifies the material* (11 classes, offline, ~70 ms).

A pure function, `wasteDecision.ts`, turns those two answers into one of: a bin,
a collection route, "ask the Gram Sahayak", or "nothing to sort". The bin lamps
are only driven by that decision. Sara speaks the label, the category and the
path in the visitor's language. The crop is filed as future training data for
the local model **only when the name decided** the answer.

The hosted model's answer is what the visitor sees, because the local model is
much better at *materials* and the hosted one at *objects*. The local model is
the fallback for a dead internet — it runs on every press precisely so it keeps
seeing the booth's own items.

---

## 1. The contract the app makes

Three physical bins: **Organic / food**, **Plastic**, **Paper & cardboard**.
Everything else is a referral, never a bin:

- glass, metal, textile, leather, footwear, thermocol, e-waste → "keep it
  separate, ask the collection agent" (no lamp);
- batteries, syringes, diapers, medicine, chemicals → **special care**: refuse
  before anything else, no lamp, ask a person;
- a pencil / crayon / eraser → "use it as long as possible", no bin;
- anything not read → "not sure, ask the Gram Sahayak".

A wrong bin puts a real object in the wrong physical bin; that is the mistake
that actually matters here. A wrong "ask somebody" costs a conversation. **Every
bar in this document is set on that asymmetry.**

The page also never claims more than it can see: no bin fullness, no
"recyclable" promise, no percentage shown to the visitor.

---

## 2. The pipeline, in order

`web/frontend/src/pages/SortWaste.tsx` → `runCheck()`

1. **Analysis frame.** The video is drawn into a 160×120 canvas
   (`ANALYSIS_WIDTH` × `ANALYSIS_HEIGHT`) and read with `getImageData`.
2. **Find the item.** `backdropBox()` (`lib/backdrop.ts`) measures the median
   colour of a 3-px border band, then finds every pixel further than **48** (per
   channel) from it. The box is that bounding box, grown by **PAD = 0.20** (10 %
   each side) and squared. It **refuses** — returns `null`, caller uses the
   centre square — when the item covers **< 2 %** of the frame, **> 85 %**, or
   when the frame has no plain backdrop at all (a wooden table differs
   everywhere). Refusing is deliberate: a scene crop is what makes the model
   classify the room.
3. **Crop.** The found box is scaled from the analysis frame to the video's own
   resolution and drawn into a **224×224** canvas (`CROP_SIZE`), then encoded as
   `image/jpeg` at **q = 0.92**. Quality matters: q 0.85 cost 4–5 points of
   item-action on every measured set; q 1.00 is no better than 0.92.
4. **Both models, in parallel, once.** One `wasteIdentify(crop)` and one
   `wasteClassify(crop)` per press. Nothing is re-sent.
5. **Wait for the name, but not forever.** `VISION_WAIT_MS = 6000`. A late name
   still fills the card but is never spoken or acted on (see `checkSeq`).
6. **Decide.** `decide()` in `web/frontend/src/lib/wasteDecision.ts` — pure,
   DOM-free, no clock, no state. Same inputs, same answer.
7. **Record + lamp.** `postRecognition({category, ...})` with the bin (or
   `other`); the backend sends `INDICATE_WASTE` only for a bin category.
8. **Speak once.** The label, the category, then the path, in the language the
   press began in.
9. **Teach** (fire-and-forget, never awaited, failure silent) — only when the
   *name* decided and there is a class to file.

`checkSeq` is the request identity: a result belonging to an older press is
dropped rather than overwriting a newer answer.

---

## 3. Model A — the hosted namer (`web/backend/app/vision.py`)

`POST /api/v1/waste/identify {image}` →
`{object, provider, model, ms, cached?, reason?}`. **Always 200.** `object` is
`null` when nothing is configured, the model failed, or it answered "nothing".

- **It never decides a bin.** Measured head-to-head on 41 probe photos, a
  hosted vision model scored **43.9 % exact** against the local model's
  **70.7 %** — it names *objects* well and *materials* badly (it calls the
  plastic casing of a remote "plastic").
- **Prompt** asks for the object **and its material**, two to four words
  ("clear plastic bottle"), and "nothing" when there is no object. The material
  word is the whole point: `wasteDecision` reads it.
- **Provider chain**, tried stickily (once one account is spent, the session
  starts at the next): `VILLAGE_CF_API_TOKEN` (_2 … _5) with their account ids
  (Cloudflare Workers AI, ~0.9 s), then `VILLAGE_VISION_API_KEY` on
  `VILLAGE_VISION_BASE_URL`/`_MODEL` (OpenCode Go / DeepSeek, 5–7 s). The free
  Workers AI allowance is per account per day. `VILLAGE_VISION_PROVIDER`
  chooses which family goes first.
- **Cache:** the same image string is answered once (256 entries). A retry or a
  correction must not pay twice.
- **Timeout:** `VILLAGE_VISION_TIMEOUT_SECS` (default 8).
- Keys live in `.env` / `.env.secrets` and are never printed, logged or
  committed into a doc.

---

## 4. Model B — the local ResNet50 (`web/backend/app/waste_resnet.py`)

`POST /api/v1/waste/classify {image}` →
`{model: "resnet50", predictions: [{className, probability}…], file?}` — the raw
**11-class** distribution, highest first. The page does the grouping.

- Classes: `Organic, Plastic, Paper, Glass, Metal, Textile, Leather, Footwear,
  Thermocol, Ewaste, Background`.
- File: `models/waste-resnet50/model.pt` (~95 MB, committed; the full ResNet50
  state dict + the class list, so no download is needed at the venue). Normally
  it is the **v18** checkpoint (15 Nov).
- CPU only, ~70–140 ms per crop on 8 cores. Loaded when the page opens, not on
  the first press.
- It is **not displayed to the visitor**; it is the offline fallback and the
  thing the booth's own crops teach.
- `GET /api/v1/waste/model-status` / `…/resnet-status` answer whether the model
  is installed and whether a namer is configured.
- `VILLAGE_WASTE_SAVE_CROPS` (default **false**) additionally keeps every
  classified crop in `VILLAGE_WASTE_CAPTURE_DIR` as a rolling log
  (`VILLAGE_WASTE_CAPTURE_KEEP`, 20 000). Off by default: the crops a press
  teaches with are enough, and the log was 322 MB.

---

## 5. The decision (`web/frontend/src/lib/wasteDecision.ts`)

The order **is** the safety argument. Nothing below may be reordered without
re-measuring.

```
1. nothing to see (no name, no usable reading)      -> nothing / ask
2. a special-care cue in the name                    -> refuse, ask a person
3. an OBJECT the name states, with its own route     -> that route (never a bin)
4. the first MATERIAL word in the name               -> that material's route/bin
5. no name, but the classifier is sure               -> bin at 0.70 / material at 0.50
6. anything else                                     -> "not sure, ask"
```

**Bars** (`wasteDecision.ts`):

| constant | value | what it gates |
| --- | --- | --- |
| `BIN_CONFIDENCE` | **0.70** | one model alone may light a lamp |
| `MATERIAL_BAR` | **0.50** | a material may be named at all |
| `CORROBORATED_BIN_FLOOR` | 0.50 | *unused today* — see below |
| `CORROBORATION_FLOOR` | 0.30 | *unused today* — see below |

The collaborative floors exist because the number was measured, not chosen: on
the 241-photo probe a "name + classifier agree" route gained **12 correct bins
for one wrong one**, and that one is a photo of oranges *in cardboard boxes*
labelled Thermocol — a person would say paper too. **Both constants are now
dead**: the name-first path returns `classConfidence` without applying a floor,
so the two numbers are exported and read by nothing but their tests. Either wire
them into the named branch or delete them — do not document them as active.

With **no** name the bar is still 0.70, and the classifier's own probability is
what has to clear it.

**Object before material** is what makes a plastic remote e-waste, a metal watch
e-waste, and a pencil "none of the bins". The object list is deliberately small
— a word belongs in it only if it has a route **of its own**; `keychain` and
`bottle` are not there, because either can be three materials and a
disagreement should refuse rather than guess.

**Name-first is the operator's instruction (2026-11-19)**, with its cost stated:
on synthetic probes the name is the *worse* classifier (archive 53.1/66.8 vs
local 72.2/83.0), but on the operator's real items the name was right every
time while the local model misread the base. If that turns out wrong at the
venue, the fallback is one constant in `decide()` and the probe rows above say
what to go back to.

**Two things always refuse**: a special-care cue before anything else, and a
route the deployment does not have (`ROUTES.glass/metal` in `wasteGuide.ts` are
false unless an authorised collector exists — the referral sentence is then the
answer).

---

## 6. What the visitor sees and hears

The result card is one big answer, not two model scores:

1. **"I see: clear plastic lid"** (the name), then the material in smaller type.
2. **The suggested action** — e.g. *"Empty and rinse it, then put it in the
   plastic bin."*
3. The three bin lamps (`BinLeds`), lit only for an accepted bin.
4. **Model details** — collapsed. Provider, model, the local model's own top
   classes and score, the crop that was analysed, whether the crop was found or
   fell back to the centre. Nothing technical on the face of the card.
5. A **cloud disclosure** in plain words (en/hi/ml): the picture goes to a hosted
   model to be named, and the crop is kept on the laptop to teach the offline
   model.

Sara speaks `"<label>. <category>. <action>"` once — never the controller's
English reason on its own, and never a percentage. Colour words on the path
(prepare / keep out) come from `wasteGuide.ts`, so the card, the speech and the
help page cannot disagree.

---

## 7. Teaching: what becomes training data

`POST /api/v1/waste/teach {image, label, said, model}` →
`{saved, file?, label?, reason?}`.

- Fires **only** when `decision.source === 'vision'` **and** `decision.classId`
  exists. The label is the class the *name* implied, capitalised.
- Writes `data/waste-knowledge/<Class>/booth-<UTC stamp>-<class>.jpg` and one
  line in `data/waste-knowledge/index.jsonl`:
  `{at, file, label, said, model}` — `said` is the namer's own words, `model`
  which provider answered.
- Bounded: `VILLAGE_WASTE_KNOWLEDGE_KEEP` (6000, oldest first, never the crop
  just written). `VILLAGE_WASTE_LEARN` (default **true**) switches it off.
- Separate from `data/waste-samples/<Class>/`, which holds **human-verified**
  corrections (`POST /waste/correction`). A trainer can weight or exclude the
  machine-named tree without guessing which is which.
- **Nothing is filed for an item the name puts in "none of our bins"** (pencil,
  crayon, eraser): there is no class to teach and the classifier's own guess
  must not be written back. That was a real bug — four pencil/eraser crops had
  been filed as Plastic (2026-11-19), now fixed and pinned by two tests.
- Git-ignored, like `data/waste-captures/`.

---

## 8. Where the model actually stands (measured)

All numbers on the **served v18** checkpoint unless stated.

| set | what it is | exact | item action |
| --- | --- | --- | --- |
| archive probe | 241 real photos of objects (desks, hands, rooms) | **74.7 %** | **82.6 %** |
| venue probe | 227 manufactured composites: one object on a coloured sheet | 48.9 % | 59.9 % |
| booth crops | the first 18 real presses, labelled by the name | 14/18 | — |

Under the page's own bars, the 18 real booth crops produce:

- **7** correct bin, **1** collector referral, **10** "ask a person",
  **0 wrong bins**.

So offline it answers roughly half the items and stays silent on the rest. That
is the property to protect: **silence, not a wrong bin.** Its misses are
consistent — Paper and Metal read as Plastic at 0.38–0.56, i.e. under the bar,
which is why they abstain.

**Retraining on the first 18 crops was tried twice and rejected both times**
(archive 69.3/75.9 and 69.7/76.3; venue +5 points). The venue condition gains
and the 241-photo probe loses 5–6; by the rule that the general probe decides,
neither ships. The 18/18 those runs report on the booth crops is **training
data** — circular, never to be quoted as accuracy. The cause is the shape of the
sample (18 photos, four classes, 13 of them plastic), not the recipe.

---

## 9. Retraining (the only way the weights change)

`learn()` only *files* a crop. The model changes when a person runs:

```bash
cd /home/ubuntu/aivillage
PY=/home/ubuntu/.venvs/aivillage/bin/python
C=~/.cache/waste-train

# 1. a new version dir, seeded with the cached composite features so only the
#    new photos are pushed through the backbone (35 epochs in ~4 min, not 30)
mkdir -p $C/v23 && cp $C/v18/hand-features.npz $C/v23/

$PY scripts/waste/train_handheld_head.py \
  --features    $C/v14/features.npz \
  --hand-train  $C/hand-train \
  --hand-test   $C/hand-test \
  --extra-train data/waste-knowledge \
  --probe       ~/.cache/village-waste/v13/probe \
  --out         $C/v23 \
  --epochs 20 --stage2-epochs 15

# 2. only if the probe line did not regress
$PY scripts/waste/export_resnet50.py --head $C/v23/resnet50_head.pt \
  --out models/waste-resnet50/model.pt

# 3. restart the backend (the model is loaded at startup) and verify
./scripts/stop.sh && ./scripts/launch.sh
curl -s localhost:8010/api/v1/waste/model-status | python3 -m json.tool
```

The script prints `val`, `hand` and `probe`; the probe is the gate. Whatever you
do, **do not ship on training accuracy.**

To judge a candidate on the sets that matter for the booth, the eval used here is
`/tmp/opencode/eval_booth.py` (venue probe + the booth crops under the page's
bars) — worth committing as `scripts/waste/eval_booth.py` if this becomes a
routine.

**Statistics before trusting anything:** a two-photo run moved the probe down
1.7 exact / 2.9 item. A handful of items is not worth a release. 15–20 confirmed
crops **per class** is the threshold the project has been holding itself to.

---

## 10. Offline behaviour

- With no internet: `wasteIdentify` returns `object: null` (fast), so the page
  says the name was unavailable and the **local model decides on its own bars**
  (0.70 bin / 0.50 material).
- That is exactly what the booth crops are for. Today it answers about half of
  them and abstains on the rest — usable, not a substitute for the name.
- If the *backend* is down the page cannot work at all; there is no browser-side
  model any more (the MobileNet was removed deliberately).

---

## 11. Invariants — do not change these without measuring

1. **The name decides, the classifier falls back.** Inverting it was measured on
   100 venue frames: the name states a material on 71 and is right 39.4 % of the
   time, the local model is right on 50.7 % of the same frames.
2. **A bin needs 0.70 from one model, 0.50 from two that agree.** Lowering it
   globally was measured and refused.
3. **A special-care cue refuses before anything else** — batteries, syringes,
   diapers, medicine, chemicals, bulbs, masks.
4. **An item in none of our bins has no class** — do not "promote" a pencil
   frame to Paper or Plastic; that teaches the mistake the rule prevents.
5. **The crop is the frame's whole story.** A scene crop (a face, a wall, a
   hand) makes the answer about the room; the backdrop finder refuses rather
   than guessing. Before adding photos, check what the classifier was *shown*.
6. **Routing never reads translated text.** `guideFor()` decides from the
   English class label and returns message **keys**; components translate. A
   Hindi page cannot send an item to a different bin.
7. **Nothing a visitor sees is a score.** No percentages, no provider names, no
   thresholds outside *Model details*.
8. **The bin lamp is driven by the decision only** — never by a raw class, and
   never for `other`/`medical`.
9. **Rejected and not to be re-proposed without new evidence:** CLIP/SigLIP
   zero-shot; a local VLM (SmolVLM took 24 s per photo and answered `Box.`,
   `Cord.`, `Rock.`); a hosted model as the live classifier (43.9 % exact vs
   70.7 %); letting the name promote a different top-3 class (+4 false bins);
   the u2net background remover inside the crop; a skin-colour "hand present"
   gate; training on synthetic base composites (v20 lost item action).
10. **The name-first decoder prompt and the cloud disclosure are load-bearing** —
    if the prompt learns soil/water vocabulary it invents commands out of music
    (that is a voice rule, but the same discipline applies here: no prompt or
    heuristic that can turn noise into a bin).

---

## 12. Known warts (safe to fix, worth fixing)

- `postRecognition` sends `confidence: 0`, `model: 'resnet50'`, `top: []` — a
  comment claims "there is no local model any more", which is no longer true.
  The recognition record therefore loses the local model's own answer, so
  `scripts/waste/venue_report.py` cannot say what the classifier thought. Pass
  the real top-3 and probability.
- `CORROBORATED_BIN_FLOOR` / `CORROBORATION_FLOOR` are exported and read by
  nothing but their own tests (dead since name-first). Either use them in the
  named branch or delete them.
- `web/frontend/src/lib/wasteStabilizer.ts` is the three-frame stabiliser the
  page no longer uses; `Prediction` is still the shared type.
- The corrections UI lives behind `?operator=1`; the documented shape is
  `POST /waste/correction {file, actual}`. There is no visible button on the
  visitor card, on purpose.
- `data/waste-rejected/` holds the five crops moved out on 2026-11-19 with a
  reason per row — it is outside the training tree on purpose (any subdirectory
  of `waste-knowledge/` is read as a class).
- A *gallery* matcher (cosine similarity of backbone features against stored
  views of the exhibit's own items) is the un-built plan B: it would be
  near-perfect on a fixed set of items and would leave general accuracy alone.
  No code exists for it.

---

## 13. File map

| path | what it is |
| --- | --- |
| `web/frontend/src/pages/SortWaste.tsx` | the page: camera, one press, both calls, decision, speech, teach |
| `web/frontend/src/lib/backdrop.ts` | find the item on the base (6 unit tests) |
| `web/frontend/src/lib/wasteDecision.ts` | **the decision**, pure (20 tests) |
| `web/frontend/src/lib/wasteGuide.ts` | bins, preparation sentences, keep-out rules, bars |
| `web/frontend/src/lib/focus.ts` | centre-crop fallback + guide square |
| `web/frontend/src/components/BinLeds.tsx` | the three lamps |
| `web/frontend/src/lib/messages.ts` | every visitor sentence in en/hi/ml |
| `web/backend/app/vision.py` | hosted namer + provider chain + prompt |
| `web/backend/app/waste_resnet.py` | local model, `learn()`, knowledge tree, prune |
| `web/backend/app/main.py` | `/waste/classify`, `/identify`, `/teach`, `/correction`, `/recognition`, `/model-status` |
| `models/waste-resnet50/model.pt` | the served checkpoint (v18) |
| `data/waste-knowledge/` | machine-named crops + `index.jsonl` (git-ignored) |
| `data/waste-samples/` | human-verified corrections (committed) |
| `scripts/waste/train_handheld_head.py` | the retrain (head only; backbone frozen) |
| `scripts/waste/export_resnet50.py` | head → the single file the backend loads |
| `scripts/waste/make_venue_set.py` | manufacture the booth condition for measuring |
| `scripts/waste/evaluate_pipeline.py` | score a served model on the probes |
| `scripts/waste/label_captures.py` | propose labels for a session's takes (a script, not a runtime path) |
| `docs/waste-page-review.md` | the review that produced the current page |

---

## 14. If the task is "make the offline model right for our exhibit items"

The protocol that works, and the one the measurements support:

1. **Collect per item, not per class.** One item on the base, **8–10 presses**
   per item, moving it each time (rotate, shift, closer/farther). One press is
   one crop; a single view does not survive a visitor placing it differently.
2. **Watch the card on every press.** The label is whatever the cloud says — a
   wrong name teaches a wrong label. Skip the item or correct it.
3. **Targets:** 3 bins × 4–5 items ≈ 12–15 items, ~100–150 crops; at least
   **15–20 per bin class**.
4. **Measure on held-out views of those same items** (hold back 2 presses per
   item), *and* on the 241-photo probe, and report both. The booth number is the
   one that says "correct for the exhibit"; the probe says what it cost.
5. **Ship only if both are acceptable.** If the head is too coarse at those
   counts, build the gallery (plan B) instead of pushing the head harder.
