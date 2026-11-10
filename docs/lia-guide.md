# Lia, the village guide

Lia is the in-app guide for visitors. She welcomes first-time visitors, explains
the village in short sentences, gives step-by-step instructions and narrates
what the live sensors can see.

She is deliberately simple:

- **no language model, no cloud and no internet** — every sentence is written
  and stored in the app;
- **no invented numbers** — if a probe is uncalibrated, stale or missing, Lia
  says so instead of guessing;
- **optional audio** uses the browser's own speech synthesis, so it works
  offline on the exhibition laptop.

## First visit

On the first visit the app opens a welcome card with Lia's introduction and six
large choices:

- Show me around
- Water the plants
- Use the lights
- Sort waste
- Talk to the village
- Help me with a problem

The card also offers **English / മലയാളം / हिन्दी**, a **Read aloud** switch and
**Maybe later**. Choosing a topic counts as seeing the welcome, so it does not
appear again on that browser.

The choice is remembered in `localStorage` under `village.lia.v1`. Clearing the
site's storage brings the welcome back. The chosen language and the read-aloud
setting are remembered too.

## The Talk to Lia button

Lia does not open by itself and there is no floating button. **Talk to Lia**
sits at the bottom of the sidebar (and in the top bar on a phone), so the guide
is one press away on every page. The button uses the
same theme and the same avatar.

## Topics and steps

Each topic is a small set of steps. Every step has a picture, one short
sentence and a **Next** button. Some steps have an **Open this page** button
that takes the reader to the page being described.

Topics that involve hardware include a **With a grown-up** note and, on the
last step, a physical demonstration to do together. Young children should never
handle the pump, mains power or dirty waste alone.

## Live narration

**What is happening now?** turns the current state into a list of sentences:

- connection: live, stale (with its age) or offline;
- soil: the calibrated percentage and state, or "not calibrated";
- tank: water at the low level, low, or "not calibrated";
- bins: the estimated fill for each bin that answered;
- lamps: on or off, or "the light sensor is not fitted";
- pump: running or off, and "locked for safety" when it is not commissioned;
- the last message or two recorded by the village.

When the link is offline or stale, Lia stops describing sensors: a stale figure
is not presented as a current one. She never reports litres, capacity, battery,
solar or wind, because none of those are measured.

## Languages and audio

The three languages live in `web/frontend/src/lib/lia.ts`. Each language has the
welcome, the interface strings, the six topics and the live-narration templates.
Adding another language means adding one more entry to that file and to
`LIA_LANGUAGES`.

**Read aloud** uses `speechSynthesis` with `en-IN`, `ml-IN` or `hi-IN`. If the
device has no voice for the chosen language, Lia shows a note but still displays
the words. Nothing is downloaded and no audio is sent anywhere. Prepared clips
in `web/frontend/public/audio/` are supported by the existing voice panel, not
by Lia.

## When to use it

- A visitor arrives: leave the welcome card for them.
- A child asks what the village does: **Show me around**.
- A grandparent wants to know why the lamps are on: **What is happening now?**
- The dashboard looks wrong: **Help me with a problem**.
- The stall is busy: **Maybe later** gets out of the way; the helper button is
  still there.

## Tests

```bash
cd web/frontend
npm run typecheck
npm test          # includes lia.test.ts and LiaGuide.test.tsx
npm run build
```

The component test drives the welcome, all six topics, the language switch,
dismissal and reopening, read-aloud calls, live narration, uncalibrated probes
and the offline state. The live state is mocked; the real browser check is
recorded in `docs/verification.md`.
