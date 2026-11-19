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
a collection route, "ask the Gram Sahayak", or "nothing to sort". **When a name
arrives its material word is what routes an ordinary item** — "clear plastic
bottle" opens the plastic bin, whatever the classifier thought — and the rules
are what make that safe (special care and object routes are checked first). When
no name arrives, the classifier's own thresholds decide instead. The bin lamps
are driven only through this decision. Sara speaks the label, the category and
the path in the visitor's language. The crop is filed as a *candidate training
photo* for the local model, and only when the name decided the answer.

Naming is a **three-layer chain**: Cloudflare Workers AI
(`@cf/meta/llama-3.2-11b-vision-instruct`) on account 1, the same model on
account 2 when account 1 is out of daily quota, then DeepSeek
(`deepseek-v4.1-flash` on OpenCode Go) as the last resort. If no name comes back
at all — no internet — the local **ResNet50** classifies on its own, which is
why it runs on every press.

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
   classify the room. **A refusal is not a refusal to classify** — the centre
   square is used, and Model details says so ("Using the middle of the picture").
3. **Crop.** The found box is scaled from the analysis frame to the video's own
   resolution and drawn into a **224×224** canvas (`CROP_SIZE`), then encoded as
   `image/jpeg` at **q = 0.92**. Quality matters: q 0.85 cost 4–5 points of
   item-action on every measured set; q 1.00 is no better than 0.92.
4. **Both models, in parallel, once.** One `wasteIdentify(crop)` and one
   `wasteClassify(crop)` per press. Nothing is re-sent.
5. **Wait for the name, but not forever.** `VISION_WAIT_MS = 6000`. A name that
   answers after that is **operator detail only**: it appears under Model details
   with the sentence that the answer above was already given. The visitor's
   answer, the lamp and Sara's sentence are final before it arrives, and one of
   them is never rewritten without the others.
6. **Decide.** `decide()` in `web/frontend/src/lib/wasteDecision.ts` — pure,
   DOM-free, no clock, no state. Same inputs, same answer.
7. **Record + lamp.** `postRecognition({category, ...})` with the bin, `other`
   for a referral, or `medical` for a special-care refusal. The backend sends
   `INDICATE_WASTE` only for a bin category; it records the hosted name, the
   classifier's own top classes, the route and which reader decided.
8. **Speak once.** The label, the category, then the path, in the language the
   press began in.
9. **Teach** (fire-and-forget, never awaited, failure silent) — only when the
   *name* decided and there is a class to file. See §7: this saves a photograph,
   it does not change the model.

**The bin LEDs are bounded by the firmware, not by the page.** One category LED
at a time, lit for `INDICATE_WASTE`'s `duration_ms` (8 s, capped by the board's
`indicate_ms`), then switched off by the board's own timer. A non-bin answer
sends no command, so no lamp is lit for it — but a lamp lit by the *previous*
item can stay on for the rest of its 8 seconds, because the firmware has no
"clear" command (`WasteIndicator::indicate` refuses `Unknown`). That is the one
window in which the physical lamp can disagree with the new answer; adding a
clear command is a firmware change and needs a board test.

`checkSeq` is the request identity: a result belonging to an older press is
dropped rather than overwriting a newer answer.

---

## 3. Model A — the hosted namer (`web/backend/app/vision.py`)

`POST /api/v1/waste/identify {image}` →
`{object, provider, model, ms, cached?, reason?}`. **Always 200.** `object` is
`null` when nothing is configured, the model failed, or it answered "nothing".

- **It names the item; the rules decide the route.** Its material word is an
  input to `wasteDecision`, so *it can put an item in a bin* — "clear plastic
  bottle" opens the plastic bin even at a low classifier probability. What the
  model does not do is pick the bin itself: the special-care and object rules
  are checked first, and a name with no usable material word falls through to
  the classifier's thresholds.
- **Why the rules and not the model alone.** Measured head-to-head on 41 probe
  photos, a hosted vision model scored **43.9 % exact** against the local
  model's **70.7 %**: it names *objects* well and *materials* badly (it calls the
  plastic casing of a remote "plastic"). That is why the decision is a small
  rule set over its words rather than "use whatever it says".
- **Prompt** asks for the object **and its material**, two to four words
  ("clear plastic bottle"), and "nothing" when there is no object. The material
  word is the whole point: `wasteDecision` reads it.
- **The chain is three layers, tried stickily** (once one account is spent, the
  session starts at the next):
  1. Cloudflare Workers AI, `@cf/meta/llama-3.2-11b-vision-instruct`, account 1
     (`VILLAGE_CF_API_TOKEN`), ~0.9–1.4 s;
  2. the **same model** on account 2 (`VILLAGE_CF_API_TOKEN_2`, its own
     `VILLAGE_CF_ACCOUNT_ID_2`) — the free allowance is per account per day;
  3. **DeepSeek** `deepseek-v4.1-flash` on OpenCode Go
     (`VILLAGE_VISION_API_KEY` + `VILLAGE_VISION_BASE_URL`), 5–12 s, the last
     resort when both Cloudflare accounts are out.
  `VILLAGE_VISION_PROVIDER` chooses which family goes first, and
  `GET /api/v1/waste/resnet-status` reports the chain in `vision.attempts`, which
  is what Model details shows.
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
- It does **not decide when a name arrives** — its reading is recorded and shown
  in Model details, and its thresholds decide only when no name came back. It is
  the third layer of the redundancy: the offline answer when both hosted models
  cannot be reached.
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
1. a special-care cue in the name                   -> refuse, ask a person
2. an OBJECT the name states, with its own route     -> that route (never a bin)
3. the first MATERIAL word in the name               -> that material's route;
                                                        a bin material opens a bin
4. no name and no classifier reading                 -> "ask a person"
5. no name: background / unknown class               -> nothing to sort
6. no name: classifier bin at 0.70                    -> accepted, lamp allowed
   no name: classifier material at 0.50               -> collection route, no lamp
7. anything else                                     -> "not sure, ask"
```

**Two regimes, and the thresholds belong to only one of them.**

| regime | who decides | bar |
| --- | --- | --- |
| a hosted name came back | the rules, reading the name | **none** — the name chose the route |
| no name (offline, timeout, failure) | the local classifier | `BIN_CONFIDENCE` **0.70** for a bin, `MATERIAL_BAR` **0.50** for a material |

`BIN_CONFIDENCE` (0.70) and `MATERIAL_BAR` (0.50) are the only bars, and they
exist because a wrong bin is the expensive mistake: a referral costs a
conversation, a wrong bin puts an object in the wrong physical place.

**There is no "two models must agree" rule and no corroboration floor** — those
constants were deleted in 2026-11-19 because the name-first path never applied
them, and the numbers they carried came from a rule the product no longer has.

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
4. **Model details** — collapsed. The naming model, the whole naming chain, the
   classifier on this laptop, the local model's top classes and score, the crop
   that was analysed, whether the crop was found or fell back to the centre, and
   a hosted name that arrived after the answer.
5. A **cloud disclosure** in plain words (en/hi/ml): naming uses a service on the
   internet; the local classifier is the offline fallback; the crop is kept on
   the laptop to teach it later.

Sara speaks `"<label>. <category>. <action>"` once — never the controller's
English reason on its own, and never a percentage. Colour words on the path
(prepare / keep out) come from `wasteGuide.ts`, so the card, the speech and the
help page cannot disagree.

---

## 7. Teaching: what becomes training data (a collection step, not learning)

`POST /api/v1/waste/teach {image, label, said, model}` →
`{saved, file?, label?, reason?}`.

**Saving a picture changes nothing about the model.** It adds a photograph to a
folder; the weights change only when a person runs the retrain script (§9) and
deploys the result. The card says "kept here to teach the offline model", not
"learning now", and the code/comments must keep that distinction.

- Fires **only** when `decision.source === 'vision'` **and** `decision.classId`
  exists. The label is the class the *name* implied, capitalised.
- Writes `data/waste-knowledge/<Class>/booth-<UTC stamp>-<class>.jpg` and one
  line in `data/waste-knowledge/index.jsonl`:
  `{at, file, label, said, model}` — `said` is the namer's own words, `model`
  which provider answered.
- **These labels are machine-generated**: the hosted model named the item, and
  the class is derived from that name. Nobody confirmed the photograph is
  correctly labelled. That is why this tree is kept apart from
  `data/waste-samples/<Class>/`, which holds **human-verified** corrections
  (`POST /waste/correction`, or the operator's own report). A trainer can weight
  or exclude the machine-named tree, and both are retained for future training.
- Bounded: `VILLAGE_WASTE_KNOWLEDGE_KEEP` (6000, oldest first, never the crop
  just written). `VILLAGE_WASTE_LEARN` (default **true**) switches it off.
- **Nothing is filed for an item the name puts in "none of our bins"** (pencil,
  crayon, eraser) or for a special-care refusal: there is no class to teach and
  the classifier's own guess must not be written back. That was a real bug —
  four pencil/eraser crops had been filed as Plastic (2026-11-19), now fixed and
  pinned by two tests.
- Git-ignored, like `data/waste-captures/`.

---

## 8. Where the model actually stands (measured, and how sure we are)

All numbers on the **served v18** checkpoint unless stated. **Read the last
column before quoting a number** — three of these sets are not the same kind of
evidence.

| set | what it is | exact | item action | are the labels human-verified? |
| --- | --- | --- | --- | --- |
| archive probe (241 photos) | real photographs of objects in rooms, on desks, in hands | **74.7 %** | **82.6 %** | yes — the datasets' own class assignments |
| venue probe (227) | *manufactured* composites: one cut-out object on a coloured sheet | 48.9 % | 59.9 % | no — inherited from the cut-outs' labels, never photographed in the real booth |
| booth crops (18) | the first real presses of the exhibit's own items | 14/18 | — | **no** — the labels are the hosted model's names |

Under the page's own bars, the 18 real booth crops produce **7** correct bin,
**1** collector referral, **10** "ask a person" and **0 wrong bins**. So offline
it answers roughly half the items and stays silent on the rest: **silence, not a
wrong bin.** Its misses are consistent — Paper and Metal read as Plastic at
0.38–0.56, under the bar, which is why they abstain.

**What each number means, stated plainly:**

- the archive probe is the only set whose labels were not produced by a model in
  this pipeline;
- the venue probe is a stand-in for the booth, not the booth;
- the 18-crop figure is the closest thing to the exhibit's real condition, and
  its labels are machine-made — a human has not confirmed them item by item.

**Retraining on those 18 crops was tried twice and rejected both times**
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

- **Naming is online.** With no internet, `wasteIdentify` returns `object: null`
  (fast), and the page says the name was unavailable.
- **Classification is offline** — ResNet50 loads from a committed checkpoint and
  runs on this laptop's CPU, so when no name comes back it decides on its own
  bars (0.70 bin / 0.50 material). That is exactly what the booth crops are for;
  today it answers about half of them and abstains on the rest.
- **Nothing here is "entirely local":** the category for a named item comes from
  the hosted name. What is local is the classifier, the rules and the crop.
- **If the backend is down, checking cannot run at all.** The camera can still be
  previewed (the browser opens it), but the classify/identify calls go to
  `127.0.0.1:8010`; with no backend there is no check button, and the page says
  so. There is no in-browser model any more (the MobileNet was removed
  deliberately).
- **If the board is down, checking still runs**: the answer is shown and spoken,
  and the card says the physical indicator is unavailable. No lamp pretends to
  have lit.

---

## 11. Invariants — do not change these without measuring

1. **The name decides the route when it arrives; the classifier is the fallback.**
   Inverting it was measured on 100 venue frames: the name states a material on
   71 and is right 39.4 % of the time, the local model is right on 50.7 % of the
   same frames.
2. **Thresholds are for the no-name regime only.** A hosted name selects the
   route; there is no probability bar to clear in that branch. When no name
   arrives, a bin needs **0.70** and a material **0.50** from the classifier.
   There is no "two models must agree" rule.
3. **A special-care cue refuses before anything else** — batteries, syringes,
   diapers, medicine, chemicals, bulbs, masks. It is the name's reading, and it
   teaches nothing (no class, no lamp).
4. **An item in none of our bins has no class** — do not "promote" a pencil
   frame to Paper or Plastic; that teaches the mistake the rule prevents.
5. **The crop is the frame's whole story.** A scene crop (a face, a wall, a
   hand) makes the answer about the room; the backdrop finder falls back to the
   centre square rather than guessing, and the details say which was used.
6. **Routing never reads translated text.** `guideFor()` decides from the
   English class label and returns message **keys**; components translate. A
   Hindi page cannot send an item to a different bin.
7. **Nothing a visitor sees is a score.** No percentages, no provider names, no
   thresholds outside *Model details*.
8. **The bin lamp is driven by the decision only** — never by a raw class, and
   never for `other`/`medical`. A non-bin answer sends no lamp command, and the
   board's own timer is what clears the previous lamp (≤ 8 s).
9. **A completed answer is final.** A hosted name that arrives after the answer
   was shown, spoken and sent must not rewrite it; it belongs in Model details.
10. **Rejected and not to be re-proposed without new evidence:** CLIP/SigLIP
   zero-shot; a local VLM (SmolVLM took 24 s per photo and answered `Box.`,
   `Cord.`, `Rock.`); a hosted model as the *sole* classifier (43.9 % exact vs
   70.7 %); letting the name promote a different top-3 class (+4 false bins);
   the u2net background remover inside the crop; a skin-colour "hand present"
   gate; training on synthetic base composites (v20 lost item action).
10. **The name-first decoder prompt and the cloud disclosure are load-bearing** —
    if the prompt learns soil/water vocabulary it invents commands out of music
    (that is a voice rule, but the same discipline applies here: no prompt or
    heuristic that can turn noise into a bin).

---

## 12. Known warts (safe to fix, worth fixing)

- `web/frontend/src/lib/wasteStabilizer.ts` is the three-frame stabiliser the
  page no longer uses; `Prediction` is still the shared type.
- The corrections UI lives behind `?operator=1`; the documented shape is
  `POST /waste/correction {file, actual}`. There is no visible button on the
  visitor card, on purpose — mistakes are reported to the operator, who files
  the correction, and that is the human check this project relies on.
- `data/waste-rejected/` holds the five crops moved out on 2026-11-19 with a
  reason per row — it is outside the training tree on purpose (any subdirectory
  of `waste-knowledge/` is read as a class).
- A *gallery* matcher (cosine similarity of backbone features against stored
  views of the exhibit's own items) is the un-built plan B. It is plausible and
  cheap to try — the features are already computed on every press — but its
  accuracy on the exhibit's items is **unknown** and must be measured before
  anyone repeats a claim about it. No code exists.

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
   wrong name files a wrong training label (these are machine-named, not
   human-verified). Skip the item, or report it so the correction can be filed.
3. **Targets:** 3 bins × 4–5 items ≈ 12–15 items, ~100–150 crops; at least
   **15–20 per bin class**.
4. **Measure on held-out views of those same items** (hold back 2 presses per
   item), *and* on the 241-photo probe, and report both. The booth number is the
   one that says "correct for the exhibit"; the probe says what it cost.
5. **Ship only if both are acceptable.** If the head is too coarse at those
   counts, the gallery is the next thing to try — and it starts with a
   measurement on the same held-out views, not with a claim.
