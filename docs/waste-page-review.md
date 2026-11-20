# The Sort Waste page — a briefing for review

*Rewritten 2026-11-19 after the review of the two-model pipeline. Everything here
is measured or read out of the code; the limits are stated as limits.*

## 1. What the page is for

Three physical bins — wet (organic), plastic, paper/cardboard — each with one
indicator LED (D21 green, D22 red, D23 blue). A visitor puts one item on a plain
red, green or white sheet, presses **Check the item**, and the page says **what
it is**, **what the local model thinks it is made of**, and **what to do with
it**, out loud in English, Hindi or Malayalam.

It is an **aid, not the authority**: the card says so itself, and a collapsed
guidance section under it covers everything the three bins do not.

## 2. The two models, kept apart on purpose

```
                    ┌─────────────────────────────────────────┐
   one press ──────►│ local ResNet50     ~70 ms   11 classes  │──► material + scores
                    │ (this laptop, no internet)              │
                    └─────────────────────────────────────────┘
                    ┌─────────────────────────────────────────┐
                    │ cloud vision model  ~1 s    a NAME      │──► "clear plastic lid"
                    │ (Workers AI, one 224 crop per press)    │
                    └─────────────────────────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────────┐
                    │ decision (wasteDecision.ts)             │
                    │  accepted · uncertain · conflict · none │
                    └─────────────────────────────────────────┘
                                      │
                        only "accepted" may open a bin
```

- **They run in parallel and neither feeds the other.** The namer is not an input
  to ResNet50; the classifier is not an input to the namer. The page says so in
  the panel ("Cloud vision model" / "Local ResNet50") and in the docs.
- **The decision waits for both**, or for the namer's 6 s cap, before anything
  physical happens. A bin is never lit and then reconsidered.
- **Only an accepted handling decision** posts a bin category; everything else is
  recorded as `other`, which sends no `INDICATE_WASTE`. A raw classifier result
  never lights a lamp.

## 3. What a visitor sees

```
  [ Camera: USB Video Device ▾ ]   [ Start camera ]   [ Check the item ]
  ┌──────────────────────┐   ┌──────────────────────────────────────────────┐
  │   live camera        │   │  Item identification      Cloud vision model │
  │                      │   │    Item identified: clear plastic lid        │
  │                      │   │  Waste classification     Local ResNet50     │
  │                      │   │    Waste category: Plastic                   │
  │                      │   │  ─────────────────────────────────────────   │
  │                      │   │  Suggested action                            │
  │                      │   │    Use the plastic bin.                      │
  └──────────────────────┘   └──────────────────────────────────────────────┘
      [ 72 px crop of what was read ]     [ technical details ▸ ]
      [ Other waste or unsure where it goes? ▸ ]
```

States per row: identification — *waiting / AI is identifying the item / Item
identified … / Item identification unavailable*; classification — *waiting /
checking the material / Waste category … / … · Not certain*. Exact provider and
model names, the per-class scores and the internal route id live in the
collapsed technical details. **"Not certain" stands alone**: a weak reading
says only that, never the material it was unsure about ("Plastic · Not certain"
reads as a decision the page did not make; the per-class scores are in the
details). An item refused on purpose says what the refusal is: a battery or a
syringe reads **Special handling**, a pencil **Not one of our three bins**
(reported 2026-11-21).

## 4. What happens on a press

1. **One check identity.** `checkSeq` is incremented; every result carries it.
   A late answer, or a frame that finished after the button was pressed again, is
   **dropped** — it cannot change the action, the record or the lamp.
2. Three frames, 250 ms apart, averaged. They are **related observations, not
   three independent confirmations**; the bar is what decides, not the count.
3. Each frame is cropped by `lib/backdrop.ts` (the sheet's colour from a 3-px
   border band, the item is what differs from it, box grown 12 % and squared) or
   by the **centre square** when there is no plain backdrop — and the centre
   fallback is **shown**, not hidden, with the guide square on the preview.
4. The first crop goes to the classifier and, in parallel, to the namer.
5. `decide()` combines them. Only `status: accepted` with a bin may open a lamp.
6. One `POST /waste/recognition` per check (guarded by `acceptingRef`), and Sara
   speaks the action **once**.

## 5. The decision rules (`web/frontend/src/lib/wasteDecision.ts`)

Order matters, and it is the safety argument:

**The item name decides; the classifier is the fallback** (the operator's
instruction, 2026-11-19).  The hosted model reads an *object* far better than
this classifier reads a *material* on the booth's own base, so when the name
states what the item is, that is the answer — “clear plastic bag” is plastic
whatever the local model thinks — and the classifier's own reading is reported
beside it rather than overruling it.

| step | rule | result |
| --- | --- | --- |
| 1 | a special-care cue in the name (diaper, syringe, battery, medicine, chemical, bulb, mask…) | **conflict** — no bin, "ask the Gram Sahayak" (a safety rule, before anything else) |
| 2 | the name states an **object** with its own route (remote, keyboard, pencil, business card…) | that route — a bin lights only for the three bins; a pencil is “none of our three bins” |
| 3 | the name states a **material** — the **first** one in the sentence wins (“glass bottle with a plastic cap” is glass) | that route |
| 4 | the name says nothing usable | the classifier, as before: background → nothing; a bin needs **70 %**; a material needs **50 %**; else “keep separate and ask” |

Because the name decides, the old “conflict” branch (two models disagree → ask)
no longer fires for a named item: the name wins.  **The measured cost is stated
in §7b** — on synthetic venue frames the name is a worse *classifier* than the
local model (37.0 % against 45.0 % exact), and the operator's own items were all
named correctly.  The exhibits to watch are the ones where the namer describes a
casing (“black plastic pen”) rather than the whole item.

**An object in the name outranks the material it is made of.** A remote control
is made of plastic and is still e-waste, so “Remote control made of plastic”
must not read as a claim on the plastic bin — which is exactly what it did on
2026-11-19, before this layer existed. The object list is deliberately small
(remote, keyboard, mouse, cable, charger, phone, laptop, watch, circuit board …;
pencil, crayon, eraser) because a word in it must have a **route of its own**,
not a material's. `keychain` and `bottle` are not in it: a keychain can be metal
or electronic and a bottle can be any of three materials, so those stay material
questions, where a disagreement refuses the answer.

**There is no grouping by outcome any more.** Ewaste 45 % + Metal 35 % is *not*
80 % recycling: the decision uses the strongest class's own probability. Two
materials are never added together, and a sum is never presented as confidence in
a material. `wasteActions.ts` (the old grouping) is no longer used by the page.

**Degraded mode.** If a namer is configured but answers nothing (timeout, quota,
offline), a bin is **not** lit: the page says *"Item identification unavailable.
Ask the Gram Sahayak before using a bin."* — the category is still shown, the
action is not taken. A deployment with **no namer at all** keeps the documented
local-only policy and accepts bins on the classifier alone.

## 6. Provider chain

`VILLAGE_CF_API_TOKEN`, `VILLAGE_CF_API_TOKEN_2`, … (each with its own account id,
resolved from the token when blank) are tried in order and the choice is
**sticky**: once account 1 answers quota, the session stays on account 2. If every
Workers AI account is spent, `VILLAGE_VISION_API_KEY` (DeepSeek on OpenCode Go,
~7 s) is the last resort, so the exhibit gets an answer rather than
"unavailable". `status().chain` reports how many chances there are.

## 7. Measured behaviour — the numbers to judge this by

`scripts/waste/evaluate_pipeline.py` and `scripts/waste/evidence_experiment.py`,
241 held-out probe photos, the served checkpoint. Two paths are quoted because
they answer different questions: the page sends a **224 crop at q0.92**, and the
classifier's own accuracy is measured on the unresized photograph.

Classifier only (no name), on the page's path:

| | value |
| --- | ---: |
| exact class | **72.2 %** (174/241) |
| right handling route | 47.7 % |
| bins opened | 76 |
| of those, **wrong bin** | **6** (7.9 %) |
| abstentions | 110 |

Both models, as shipped (the page's actual policy):

| | value |
| --- | ---: |
| exact class | 72.2 % (the name never changes the class) |
| right handling route | **54.4 %** (+16) |
| bins opened | **88** (+12) |
| of those, **wrong bin** | **7** (8.0 %) |
| abstentions | **91** (−19) |

So the second model buys **twelve more items answered** and costs **one** wrong
bin — the false-bin *rate* does not move (7.9 % → 8.0 %). The one wrong bin is a
photograph of oranges **in cardboard boxes** whose class label is Thermocol; a
person would call it paper too.

On the unresized path the same checkpoint scores **74.7 % exact / 82.6 % item
action**, opens **86** bins with **7** wrong, and abstains on 92 — the difference
is the crop the page really sends, not a different model.

Per class: Plastic 85.0 %, Paper 84.7 %, Ewaste 82.5 %, Leather 80.0 %,
Thermocol 55.6 %, Glass 53.8 %, **Metal 17.6 %** (Metal is read as Ewaste 10
times, Paper 1, Thermocol 1). The wrong bins above 0.70 include Glass→Plastic at
0.82/0.80, Ewaste→Paper 0.73, Leather→Paper 0.71, Metal→Paper 0.65.

**No accuracy has been improved in this round.** Metal did not move: the metal
pipe added to `data/waste-samples` is one training photo, and the probe is
untouched by design (training never sees it). Adding photos of one object to this
pipeline has already been measured to move the probe *down* (a two-photo retrain
took it from 74.7 % to 73.0 %), so the honest statement is: **Metal needs a batch
of venue photos and a probe comparison, not a threshold change.**

**Why the false-bin number matters:** 25 of 241 photos would have opened the
wrong physical bin with the local model alone. That is exactly the case the namer
and the conflict rules exist for — and exactly why a deployment with no namer is
a deliberate, documented choice rather than the default.

**Should the name be passed to the classifier as evidence?** Measured on the same
241 photos with `scripts/waste/evidence_experiment.py`:

| policy | exact | item action | false bins |
| --- | ---: | ---: | ---: |
| A classifier only (what ships below the bar) | 72.2 % | 80.5 % | 27 |
| B let the name *promote a different* top-3 class | 73.9 % | 83.0 % | 26 |
| C let the name *corroborate the same* class (materials only) | 72.2 % | 80.5 % | 27 |

B looks better here and worse in a second run of the same probe (**+4 false
bins**, and the gain moved between runs), because the namer confuses
metal-looking electronics in both directions: it called watches and keychains
“metal” (wrong) and a glass bottle “plastic” (wrong). A promotion that opens the
wrong physical bin is worse than an abstention, so **B is not shipped**. C
changes nothing on the probe and is not a claim of accuracy — it fixes the
exhibit's own case, where the picture had already chosen the right class and the
name agreed with it.

**The two items actually checked on 2026-11-19** (a white remote, pressed twice),
through the running server:

| | averaged classifier | name | before | now |
| --- | --- | --- | --- | --- |
| item A | Ewaste **37.6 %** | “Remote control made of plastic” | not sure | e-waste collection |
| item B | Ewaste **45.6 %** | “White plastic remote control” | not sure | e-waste collection |
| business card | Paper **under 70 %** | “White paper with red and black text” | not sure | paper bin |

The card is the case that added the corroborated-bin rule (§5, row 4b): Paper was
the classifier's own top class, the name said paper, and the page still asked a
person — because one model alone has to reach 70 % before a lamp is lit. Two
models agreeing reach it at 50 %, and the measurement above is the argument.

Both are **referrals, not bins**: no lamp is lit, and the record stores the
classifier's own 0.38/0.46 — never a number inflated by the name.

## 7b. The venue condition — the model has never seen it

Every number above is measured on **archive photographs**: objects on desks, in
hands, in rooms. The exhibit is different — one item placed on a **fixed base**
(a coloured sheet), read by a webcam from above. That is a different
distribution, and nothing in the training data or the probe looks like it.

`scripts/waste/make_venue_set.py` manufactures the condition (cut-out object on
a sheet, under a lamp, with a contact shadow, no hand) so the gap can be
measured before there are real photographs of it. 227 held-out objects:

| | archive probe | venue probe (item on a sheet) |
| --- | ---: | ---: |
| exact class (v18, served) | 72.2 % | **44.9 %** |
| item action | 83.0 % | **61.7 %** |
| median confidence | 0.66 | **0.46** |
| frames under 0.70 | 126 / 241 | **187 / 227** |
| top confusions | Metal→Ewaste, Glass→Plastic | **Plastic→Metal, Paper→Background, Ewaste→Metal** |

**A retrain on the manufactured condition was measured and rejected.** v20 put
the venue composites into the second training stage (with the hand-held ones
kept):

| | archive | venue |
| --- | ---: | ---: |
| v18 (shipped) | 72.2 / 83.0 | 44.9 / 61.7 |
| v20 | 69.3 / 80.5 | 48.5 / **58.6** |

Exact class gains 3.6 points at the venue and item action *loses* 3.1 — the
project's own rule is that the probe line decides, so **v20 was not shipped**
(`models/waste-resnet50/model.pt` is still v18). Synthetic sheets are not the
real base; the fix is real photographs of it.

**Should the vision model decide the bin instead?** Asked directly, and measured
on 100 venue frames against the class the object actually is:

| | value |
| --- | ---: |
| local ResNet50 exact | **45.0 %** |
| namer stated a material | 71 / 100 |
| … and was right | **39.4 %** |
| … local was right on those same 71 | **50.7 %** |
| on the 47 disagreements: local right / namer right / neither | **16 / 8 / 23** |

So inverting the rule — "trust the name for the bin" — would make it **worse**,
not better. The name is good at naming an object (it said "clear plastic bag"
and it was right) and bad at the material question, because it calls the plastic
casing of an e-waste item "plastic". When the two disagree the honest answer is
still *"ask"*; the real fix is a classifier that has seen the base.

**Capture square.** Widened from a 12 % pad to **20 %** (10 % margin each side)
on 2026-11-19, at the operator's request — a business card is all corner, and a
fixed base means the margin is plain base rather than a hand. Measured on the
venue probe, against the 12 % square: 20 % costs **0** exact and **2.7** points
of item action; 30 % costs 5.3 and 5.3. So 20 % ships, and it can grow once the
model is retrained on the real base.

### The name decides — what it scores on the two probes

The same two probe sets, with the name allowed to choose the class whenever it
states one (`/tmp/opencode/measure_namefirst.py`, the page's own word map):

| | exact class | item action |
| --- | ---: | ---: |
| venue probe — local model only | **45.0 %** | 61.7 % |
| venue probe — the name decides (70 % of frames) | 37.0 % | 59.0 % |
| archive probe — local model only | **72.2 %** | 83.0 % |
| archive probe — the name decides (77 % of frames) | 53.1 % | 66.8 % |

**This is the cost of the operator's choice, stated plainly**: the hosted model
names an *object* well and a *material* badly — it calls the plastic casing of an
e-waste item “plastic”, and on these probes that costs more classes than it wins.
The operator's own items (a plastic bag, a business card, a remote, a card) were
all named correctly, and the booth is judged on those, so the name decides. The
classifier keeps its own answer in the details, and it still decides whenever the
name says nothing usable.

## 8. Guidance below the page (restored)

A collapsed **"Other waste or unsure where it goes?"** section carries, in all
three languages: wet waste (damp ≠ wet waste), paper (pencils are not paper),
plastic (chemical containers separate), glass (broken glass; bulbs are not
ordinary glass), metal (batteries and contaminated containers excepted), textile/
leather/footwear (reuse, repair, donate, else local route), thermocol (check
acceptance; no recyclability promise), e-waste, batteries, sanitary waste,
pencils, sharps (never handle for a demonstration), special-care waste, other dry
waste, and unknown/several items/closed bags. It closes with *"Our three
demonstration bins do not cover every waste type"* and *"Recycling depends on the
item and on the collection facilities near you."*

**There is no physical "Other" bin**, and the guidance is text — it is not a
claim that the model recognises a new class.

## 9. Data handling

- **Every judged crop is kept only if an operator turns it on**
  (`VILLAGE_WASTE_SAVE_CROPS=1`, **off by default**). Visitor presses do not
  silently write pictures to disk; the retention limit and the delete path are
  the existing capture folder (`VILLAGE_WASTE_CAPTURE_KEEP`, the Data page's
  capture list).
- **Corrections are an operator action**: `?operator=1` on the page reveals the
  **Wrong? It was…** row. A visitor never writes into `data/waste-samples/`.
- **The disclosure is shown before any cloud call**, in the reader's language:
  *"When you press Check the item, a cropped picture is sent to our configured
  cloud AI service for identification. Waste classification runs on this laptop."*
- Only the 224 crop is sent — never the stream.
- **No claim is made about provider-side retention or deletion.** The panel does
  not promise either.
- The recognition metadata (category, material, confidence, top-3) is stored in
  `data/village.db`, separately from any image.

## 10. Honest limits — the list a reviewer should attack

1. **Metal is 17.6 %** on the probe (mostly read as Ewaste) and the pipe was read
   as Plastic at the venue. One photo does not fix a class.
2. **25 false bins in 241 probe photos** with the local model alone — the reason
   degraded mode refuses to light a bin.
3. **The namer is fallible**: it calls a torn brown cardboard piece "bread"
   (a human would too), and it named a pipe "foam roller". Its 6 s cap trades
   completeness for a prompt answer — measured: the first call after a backend
   restart takes ~4.7 s, later ones 0.8–1.0 s.
4. **Auto-crop needs the plain sheet**; on a busy scene it falls back to the
   centre square, which the page now says out loud.
5. **The conflict rules are a small, conservative word list** — they catch the
   cases listed in §5 and **cannot detect every hazardous or misclassified
   object**. They are a demonstration aid, not a waste authority.
6. **No physical lamp is claimed without the board**: the lamp state comes from
   the board's own telemetry, and with the ESP32 disconnected the page says
   *"Physical indicator unavailable"* while the answer still stands.

## 11. Where to look

| file | what it owns |
| --- | --- |
| `web/frontend/src/pages/SortWaste.tsx` | camera, press, the two-model panel, speech |
| `web/frontend/src/lib/wasteDecision.ts` | the decision (19 unit tests) |
| `web/frontend/src/lib/backdrop.ts` | finding the item on the sheet (6 tests) |
| `web/frontend/src/lib/messages.ts` | every sentence, three languages |
| `web/backend/app/waste_resnet.py` | local classifier, crop log (off by default) |
| `web/backend/app/vision.py` | provider chain, name only, cache, 8 s timeout |
| `web/backend/app/main.py` | `/waste/classify`, `/waste/identify`, `/waste/recognition`, `/waste/correction` |
| `scripts/waste/evaluate_pipeline.py` | the table in §7 |
| `scripts/waste/vision_bench.py` | naming accuracy per model |

Tests: **427 frontend**, **162 backend**.
