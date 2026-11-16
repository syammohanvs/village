# Sara, the village guide

Sara is the in-app guide for visitors. She welcomes first-time visitors, explains
the village in short sentences, gives step-by-step instructions and narrates
what the live sensors can see.

She is deliberately simple:

- **no additional language model, no cloud and no internet** — Whisper only
  turns speech into text; the words are understood by fixed rules and every
  reply is written and stored in the app;
- **no invented numbers** — if a probe is uncalibrated, stale or missing, Sara
  says so instead of guessing;
- **optional audio** uses the browser's own speech synthesis, so it works
  offline on the exhibition laptop.

## First visit

On the first visit the app opens a welcome card with Sara's introduction and six
large choices:

- Show me around
- Water the plants
- Use the lights
- Sort waste
- Talk to the village
- Help me with a problem

The language is chosen in **Setup → Voice & Camera → Spoken language**, and the
**Our Village** page now shows the same three choices directly under its
microphone — the microphone stands alone, centred, with English / മലയാളം / हिन्दी
beneath it, so a visitor can switch before speaking without leaving the page.
Whichever place is used, one choice drives Sara, the voice panel and the
invitation. Inside Sara a visitor can still switch language at any time.

The card also offers a **Read aloud** switch and **Maybe later**. Choosing a
topic counts as seeing the welcome, so it does not appear again on that
browser.

Sara is read aloud as soon as she opens, and again when the topic changes —
**Setup → Voice & Camera → Read aloud as soon as Sara opens** turns that off for
a quiet screen. The reading can always be stopped with the **Read aloud**
switch on the card.

The choices are remembered in `localStorage` (`village.lia.v1` for the guide,
`village.voiceLanguage` for the language). Clearing the site's storage brings
the welcome back.

## The Talk to Sara button

Sara does not open by itself and there is no floating button. **Talk to Sara**
sits at the bottom of the sidebar (and in the top bar on a phone), so the guide
is one press away on every page. The button uses the
same theme and the same avatar.

## Talking to the village in your own words

The voice panel (the microphone in the sidebar) understands **natural phrasing**,
not just exact commands. Say or type:

| You say | What happens |
| --- | --- |
| “Lights off”, “Please switch the lights off”, “Can you turn off the streetlights?”, “Switch the lights off, please” | the lights-off command |
| “Turn on the lights”, “Put the lamps on” | the lights-on command |
| “Set the lights to automatic”, “Auto mode for the lights” | automatic mode |
| “Start watering”, “Water the plants”, “Start the pump” | the same irrigation request the button sends |
| “Stop watering”, “Turn off the pump” | the stop command |
| “Are the lights off?”, “Is the pump running?”, “Are the bins full?” | an answer from the current readings — **no action** |
| “The lights are off”, “The pump is running” | an acknowledgement — **no action** |
| “What happens if I switch off the lights?”, “Can I turn on the pump?” | guidance — **no action** |
| “Don’t switch off the lights”, “Do not water the plants” | nothing is changed |
| “Turn the lights on… no, off”, “Lights on and lights off” | asks which one, sends nothing |
| “Turn it off”, “Do the same” | asks which device, sends nothing |
| “Make me a sandwich”, “Open the gate” | says which devices it can control, sends nothing |

Typed words go through **the same parser** as speech (the box under the
microphone), so the microphone is never required to test a phrase.

### Why some sentences do nothing

The parser reads the *meaning* before it acts: a question, a statement, a
conditional, a negation, a correction or a sentence with two devices is never
turned into a command. It also requires **every content word** to be
understood, so “turn off the lights and open the gate” sends nothing rather than
half of it — and the same rule now applies in Malayalam and Hindi, not only in
English. There is no conversation memory: “it”, “that” and “do the same” ask you
to name the device.

A polite request is still a request: **“Can you turn off the streetlights?”**
and Malayalam “ലൈറ്റ് ഓഫ് ചെയ്യാമോ?” / Hindi “क्या आप लाइट बंद कर सकते हैं?”
send the command, while **“Can I / should I …?”** is advice and sends nothing.

A reply is only “done” after the controller acknowledges it. If the board is
offline, or the acknowledgement does not arrive, the panel says so and does not
claim success. It says “already off/on” **only from a fresh, connected frame**;
a stale or cached reading never makes it skip an action you asked for.

**Bin fullness is not measured.** “Are the bins full?” is answered with “Our
model does not measure bin fullness. The three bins have indicator LEDs only.” —
never with a number.

### Languages

The same rules exist in English, Malayalam and Hindi, including the code-mixed
phrases the catalogue already had (“light off”, “light band karo”, “pump on
cheyyuka”). Whichever language is selected in the panel is the one Whisper is
asked for and the one the reply is spoken in.

**That one setting is the whole app's**, including the answer after a waste item:
the Sort Waste page speaks its result in the chosen language (the sentences are
held in English, Malayalam and Hindi, so the words and the voice agree). It used
to hardcode English there, so a visitor who chose Malayalam in Setup still heard
an English answer — reported and fixed 2026-11-16.

Questions are recognised by their words, not by a full stop: Hindi **“क्या” is a
question word** at the start, while Malayalam can also mark a question on the verb
(“…ഉണ്ടോ”, “…ആണോ”). Negation is read the same way in meaning — Hindi “मत” and
Malayalam “വേണ്ട / അരുത്” anywhere in the sentence, because both languages negate
after the verb. This is not unrestricted conversation and it is not every
language.

### Repeating a command

One utterance carries one command id. A duplicated event for the same recording
is therefore answered by the controller as a duplicate instead of acting twice,
while saying the same thing again later — or retyping it after the box clears —
is a new request and does run.

### Where the rules live

- `shared/intents.json` — the languages, device aliases, on/off/auto words,
  politeness and question markers, the wording of every reply, and one list of
  example phrases per intent (also what the help list shows).
- `web/backend/app/intents.py` — the parser: sentence type first, then one
  device and one state, else nothing.

Adding a phrase to an existing intent is a one-line change in the JSON; adding a
device means adding its aliases and a row in `device_commands`.

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
- lamps: on or off, or "the light sensor is not fitted";
- pump: running or off, and "locked for safety" when it is not commissioned;
- the last message or two recorded by the village.

When the link is offline or stale, Sara stops describing sensors: a stale figure
is not presented as a current one. She never reports litres, capacity, battery,
solar or wind, because none of those are measured.

## Languages and audio

The three languages live in `web/frontend/src/lib/lia.ts`. Each language has the
welcome, the interface strings, the six topics and the live-narration templates.
Adding another language means adding one more entry to that file and to
`LIA_LANGUAGES`.

**Read aloud** uses `speechSynthesis` with `en-IN`, `ml-IN` or `hi-IN`. If the
device has no voice for the chosen language, Sara shows a note but still displays
the words. Nothing is downloaded and no audio is sent anywhere. Prepared clips
in `web/frontend/public/audio/` are supported by the existing voice panel, not
by Sara.

## When to use it

- A visitor arrives: leave the welcome card for them.
- A child asks what the village does: **Show me around**.
- A grandparent wants to know why the lamps are on: **What is happening now?**
- The dashboard looks wrong: **Help me with a problem**.
- The stall is busy: **Maybe later** gets out of the way; the helper button is
  still there.

## Tests

```bash
cd web/backend
python -m pytest -q tests/test_intents.py     # parsing, all three languages
cd ../frontend
npm run typecheck
npm test          # includes lia.test.ts, LiaGuide.test.tsx, VoicePanel.test.tsx
npm run build
```

The parser tests need no hardware: they feed sentences to the matcher and assert
what it returns. The panel tests drive the typed box and the recorded path with
the API mocked, including a duplicate submission, a disconnected board and an
unconfirmed command. Only the microphone itself needs the real laptop.

The component test drives the welcome, all six topics, the language switch,
dismissal and reopening, read-aloud calls, live narration, uncalibrated probes
and the offline state. The live state is mocked; the real browser check is
recorded in `docs/verification.md`.
