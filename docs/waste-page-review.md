# The Sort Waste page — a briefing for review

*Written 2026-11-19 for an AI reviewer. Everything here is measured or read out
of the code; nothing is aspirational. Where a number is a limit, it is stated as
one.*

## 1. What the page is for

The exhibit has **three physical bins** — organic, plastic, paper/cardboard —
each with one indicator LED (D21 green, D22 red, D23 blue). A visitor holds an
item up to a camera, presses **Check the item**, and the page says **what it is**
and **where it goes**, out loud in English, Hindi or Malayalam.

It is **an aid, not the authority**: the card on the right already lists what
goes where, and the wording for special items. The camera exists for someone who
cannot read that, or wants a quick answer. That is why the page has three
controls and nothing else.

## 2. What a visitor sees

```
  [ Camera: USB Video Device ▾ ]   [ Start camera ]   [ Check the item ]
  ┌───────────────────────────┐   ┌──────────────────────────────────────┐
  │                           │   │  I see: clear plastic lid            │
  │      live camera          │   │  My classifier says: Plastic         │
  │   (whole frame, uncropped)│   │  Put it in the plastic bin.          │
  │                           │   │  ○ organic  ● plastic  ○ paper       │
  └───────────────────────────┘   └──────────────────────────────────────┘
```

States of the card, in order:

| state | card says |
| --- | --- |
| camera off | the welcome sentence and *“Hold the item up and press Check the item.”* |
| camera on, nothing read | *“Waiting for the camera to see something.”* |
| pressed, reading | title **Reading the item…**, line *“Hold the item still — I am reading three frames.”* |
| naming | title **Naming the item…**, line *“Asking the camera what this is…”* |
| accepted | **I see: …** (if a namer is configured) then **My classifier says: X** and the instruction; a bin lamp lights |
| under the bar | *“Not sure what this is — a bin needs 70% on 2 frames in a row.”* plus **I see: …** if a name came back; nothing recorded |
| nothing shown | *“Nothing to sort — this does not look like waste.”* |
| network/board failure | the error in place, and the card still says what it knows |

## 3. The interaction, step by step

1. The operator picks a camera once. The choice is remembered per browser and the
   list refreshes when a camera is plugged in. Device names only appear after the
   page has been allowed a camera once (a browser rule, and the page says so).
2. **Start camera** acquires the stream (`getUserMedia`, a ladder that tolerates a
   missing rear camera or a vanished deviceId), waits for a real frame, and keeps
   the camera on until **Stop camera**.
3. The visitor places the item on the **red, green or white sheet** and presses
   **Check the item**.
4. Three frames are read 250 ms apart and averaged, so a wobble cannot decide.
5. The card fills in as described above; Sara says the sentence.
6. The camera stays on. The next item is one press away.

## 4. What happens on a press

```
video frame (160×120)  ──►  backdrop.ts: find the item on the sheet
                              │  (sheet colour = median of a 3-px border band;
                              │   item = pixels >48/channel from it; box grown
                              │   12 %, squared; refuses if <2 %, >85 %, or the
                              │   scene has no plain backdrop)
                              ▼
                     224×224 JPEG q=0.92  ──►  POST /api/v1/waste/classify
                              │                   ResNet50, 11 classes, 50–85 ms
                              │                   (the crop is kept for training)
                              ▼
                    group by action  ──►  accept?  ──►  POST /api/v1/waste/recognition
                              │                               │
                              │                               ├─ stored in `recognitions`
                              │                               └─ INDICATE_WASTE → board
                              ▼
              POST /api/v1/waste/identify  (the same crop, in parallel)
              Cloudflare Workers AI, llama-3.2-11b-vision, ~1 s, 4 s cap,
              cached by crop hash — a NAME only, never a bin
```

## 5. The decision rules

The classifier has **11 classes**; the page turns them into **four outcomes**:

| class | outcome | lamp |
| --- | --- | --- |
| Organic | organic bin | D21 |
| Plastic | plastic bin | D22 |
| Paper | paper/cardboard bin | D23 |
| Glass, Metal, Textile, Leather, Footwear, Thermocol | hand to the recycling agent / keep separate | none |
| Ewaste | keep separate, authorised e-waste collection | none |
| Background | nothing to sort, nothing recorded | none |

- **A bin needs 70 %** on its own class (`BIN_CONFIDENCE`) — a wrong bin has a
  physical consequence.
- **A referral needs 50 %**, and the seven recycler materials are grouped into one
  action: Ewaste 45 % + Metal 35 % is “recycling” at 80 %, named by the stronger
  material.
- **Below the bar nothing is recorded and no lamp lights.** The page names its best
  guess and the bar it missed, so the operator can improve the framing.
- Routing is decided by `wasteGuide.ts` from the **English** label only, so
  switching the page to Hindi cannot change where an item is sent.

## 6. What it deliberately does not do

- **It does not measure bin fullness.** Three LEDs, no distance sensor. The card
  says so.
- **It does not identify people, weight, or prove an item was binned.**
- **It does not let the vision model choose a bin.** Measured on the venue's 241-photo
  probe: local ResNet50 **74.7 % exact / 82.6 % item-action**; the hosted model
  **53.7 % / 75.6 %**. The name is context for the visitor, the category is local.
- **It does not guess when the scene is not a booth.** With no plain sheet (a wooden
  table) the auto-crop refuses and the middle square is used, which is what the
  page always did.

## 7. Data and privacy

- **Every crop the classifier judged is kept** in `data/waste-captures/`, bounded
  at 20 000 files with an index; a misread is one press from becoming training
  data (**Wrong? It was…** → `POST /api/v1/waste/correction` → `data/waste-samples/<Class>/`).
- **No audio is kept by this page.** Voice is a different page (Talk to Sara).
- **With a hosted namer configured, the 224 square is sent to Cloudflare** and a
  name comes back. The panel says so, in the reader's language, **only when one is
  configured**; on a deployment with no key the note is absent and nothing leaves
  the machine.
- The page records a recognition (category, material, confidence, top-3) in
  `data/village.db`.

## 8. Language and accessibility

- **English · हिन्दी · മലയാളം**, one selector for the page *and* Sara's voice.
- Every sentence is a key in `messages.ts`; the three languages are checked for
  completeness and for matching `{placeholders}` by a test.
- The answer is **spoken** as well as written: the object first, then the
  instruction (`/api/v1/voice/speak`, Piper).
- Numbers and units are never translated; only the words around them.

## 9. Known limits and open questions — the honest list

1. **The classifier is a material classifier at 74.7 % exact.** Its weakest class
   is **Metal** (0/6 on a probe sample, and `data/waste-samples/Metal/` held no
   photos until 2026-11-19). A metal pipe is read as Plastic.
2. **The namer is good, not reliable**: 3 of 4 unambiguous venue items named
   correctly, ~1 s each; a torn brown cardboard piece is called “bread” by every
   model tried (the operator judged the item itself ambiguous).
3. **Auto-crop needs the sheet.** On a busy scene it falls back to the centre
   square; the sheet's colour does not matter, but a pattern or a wooden table
   defeats it.
4. **The pencil / sanitary / sharps routes have no button any more** (removed for
   simplicity, 2026-11-19). The rules remain in `wasteGuide.ts`; nothing on the
   page asks the visitor for them.
5. **A name that arrives after 4 s is shown but not spoken**, to keep the answer
   prompt.

## 10. Where to look

| file | what it owns |
| --- | --- |
| `web/frontend/src/pages/SortWaste.tsx` | the page: camera, press, card, speech |
| `web/frontend/src/lib/backdrop.ts` | finding the item on the sheet (6 unit tests) |
| `web/frontend/src/lib/wasteGuide.ts` | the routing table: label → destination + sentence |
| `web/frontend/src/lib/wasteActions.ts` | the seven recycler labels grouped into one action |
| `web/frontend/src/lib/messages.ts` | every visitor-facing sentence, three languages |
| `web/backend/app/waste_resnet.py` | the local classifier, the crop log, the learning loop |
| `web/backend/app/vision.py` | the hosted namer (name only), cache, 8 s timeout |
| `web/backend/app/main.py` | `/waste/classify`, `/waste/identify`, `/waste/recognition`, `/waste/correction` |
| `scripts/waste/*.py` | training, evaluation, the labeller |
| `docs/waste-model.md` | how the model was built and what it scores |

Tests: **412 frontend** (vitest + jsdom, including the page driven end to end) and
**160 backend** (pytest, including the namer's cache, failure and unconfigured
paths).
