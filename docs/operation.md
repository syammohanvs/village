# Operation and the exhibition

## Startup order

1. Power the router (the local Wi-Fi network; internet is optional).
2. Put the reservoir water in place, with the probes at the minimum level and
   the pump intake under water.
3. Power the ESP32 from the 5 V power bank. The serial log prints its IP.
4. Start the laptop:
   ```bash
   ./scripts/launch.sh
   ```
5. Open the printed URL, usually <http://127.0.0.1:8010/>, and sign in
   (see **Signing in** below).
6. Check the **Setup** checklist before the audience arrives.

During the exhibition, do not change Wi-Fi modes or power-cycle the router.

### Powering the board without the laptop

The USB cable is only power once the image is flashed. To free the laptop:

- use a **phone charger or 5 V power bank** into the board's USB port, or
- feed a regulated **5 V** into `VIN`/`5V` and `GND`.

Never put 5 V on the `3V3` pin, and never feed external 5 V while the USB data
cable is also plugged into the laptop. If the router gives the board a different
address after a reboot, update `VILLAGE_DEVICE_URL` in `.env` and restart the
backend; Windows can also resolve `village.local`.

Firmware can be updated over Wi-Fi once the board is on the network — see
`docs/installation.md` (“Updating firmware without the USB cable”).

## Signing in

The dashboard is behind one password. It is there for the case the exhibit
actually has: a screen left open in a room of visitors, where somebody can
otherwise press the pump's **On** switch or walk into **Setup** and change the calibration.

- **Account** — this exhibit signs in as **`mahi$haru`** with password
  `village` (a fresh install defaults to `admin` / `village`). Both are set in
  `.env`:

  ```bash
  # Single quotes on purpose: a name with a '$' in it is otherwise read as a
  # variable by both the shell and python-dotenv, leaving "mahi" on its own.
  VILLAGE_ADMIN_USER='mahi$haru'
  VILLAGE_ADMIN_PASSWORD=choose-something-you-can-type-on-the-day
  VILLAGE_SESSION_HOURS=12
  ```

  Change the password before the exhibit is public. The start-up log says so
  out loud while the default is still in use:
  `the sign-in password for 'admin' is the built-in default …`.
- **Press Enter, not a remember-me box.** A session lasts `VILLAGE_SESSION_HOURS`
  (12 by default), so a fresh laptop opens on the form once a day and a running
  exhibit does not.
- **It locks the screen, not the village.** The board keeps running, the camera
  keeps classifying and the pump stays under its own rules while nobody is
  signed in — which is what makes the gate safe to leave on: `./scripts/launch.sh`
  can start the app before anyone is at the keyboard.
- **Signing out** is the last row in the side menu, under the source line
  (**ESP32 over Wi-Fi** or **Simulator**). It ends the session on the laptop, so
  the next person has to sign in again.
- **Switching the gate off** is one line in `.env`,
  `VILLAGE_AUTH_ENABLED=false`, and a restart — for a bench session where the
  form is only in the way. The start-up log then warns that every screen is
  open.
- **A forgotten password** is not recoverable from the app (nothing is shown
  and nothing is emailed). Set `VILLAGE_ADMIN_PASSWORD` — or
  `VILLAGE_ADMIN_PASSWORD_HASH`, a `pbkdf2$…` value — in `.env` and restart.
  Any signed-in browser is asked to sign in again, because the cookie is signed
  with the password.

## Sara, the village guide

The **Help with Sara** button at the bottom right opens a guide written for
children and first-time visitors. On the first visit it opens by itself with a
short welcome and six large choices: show me around, water the plants, use the
lights, sort waste, talk to the village, or help with a problem.

- Choose **English**, **മലയാളം** or **हिन्दी**. The choice is remembered.
- **Read aloud** uses the browser's own voice. It works without internet; if
  the laptop has no voice for that language, the words are still shown.
- **Maybe later** dismisses the welcome. The helper button stays on every page.
- **What is happening now?** explains the current soil, tank, bins, lamps and
  pump in plain words. It says *not calibrated*, *stale* or *offline* instead of
  inventing a number, and it never reports litres or savings.

Topics that touch hardware show a **With a grown-up** note. The last step
usually gives a safe physical demonstration, such as covering the LDR to watch
the lamps come on. Young children should always do those with an adult.

The full guide, including how to edit its sentences, is in
[lia-guide.md](lia-guide.md).

## What the dashboard shows

- **What the village is doing and why** — the controller's own reason, such as
  “Soil is dry and water is available. Watering for a short pulse.” or
  “Irrigation blocked: reservoir water is low.”
- **Soil moisture** — a calibrated relative percentage, state and age.
- **Rain Water Tank** — Available / Low only. It is not a tank gauge.
- **Pump** — its switch (Auto / On / Off), the commanded state, the session
  reason and the cumulative runtime, plus `pin_high`: whether the driver pin
  (D19) is actually high. The pin is the honest answer to “did pressing On do
  anything?”; the commanded state is only what the controller asked for.
- **Streetlights** — mode, Bright/Dark and commanded state.
- **Bins** — one indicator LED per category. No fill level is measured or shown.
- **Connection** — live, stale, disconnected, last update and last error.
- **AI services** — whether Whisper and the waste model are ready.
- **Talk to Sara** — the microphone at the top, with its name beside it. The
  buttons under it choose **Sara's** language only; the page itself stays
  English. The panel it opens is described under *Voice commands* below.
- **The sentence under each row** — the rule that decided, in the controller's
  own words on Auto and in plain words on a manual switch. It is there in Live
  as well as in Simulation, because "why is the pump off?" is a question for
  both.
- **The two pictures** — the solar panel with its LED, and the windmill — are on
  the page in both modes. In Simulation they follow the sliders; in Live they
  follow the measured volts, so a dark panel shows an unlit LED and an unwired
  turbine stands still.
- **Recent activity** — commands, recognitions, alerts and connection events.

Every card is **one row**: the name and its state chip on the left, then the
reading, then the control where the card has one (the pump's Auto / On / Off,
the lamps', or **Identify waste**). Solar and Wind read as a single line too —
`2.40 V · 1.52 mA · 3.6 mW` — and below about 900 px wide each row wraps back to
the column layout.

A green “accepted” means the controller decided. It does **not** prove that
water physically flowed. The dashboard keeps the two statements separate.

## The safe demonstration sequence

1. **Dashboard.** Point out the reason panel, then the soil, reservoir and bin
   cards. Say clearly that the tank has two probes, not a level sensor.
2. **Streetlights.** Show **Auto**, cover the LDR (or press the demo Night
   button in Demo mode) and watch the state change after the stable delay.
   Show Manual On and Off, then return to Auto.
3. **Irrigation.** The Watering card carries the pump's own switch —
   **Auto / On / Off** — and nothing else. On **Auto**, with dry soil and water
   available, the controller waters in pulses: pulse → soak → re-check. Choose
   **On** to hold the pump running and **Off** to stop it, then give it back to
   **Auto**. The controller may refuse with a reason — that is a feature, not a
   failure — and the reason is written under the switch.
4. **Sort Waste.** Check **Camera device** under the Start/Stop button — a
   laptop with a USB camera has two, and the list remembers the one chosen. Hold
   a plastic item in front of the camera. The stable
   prediction lights the plastic LED. Move it away; show that repeated frames
   do not count as new items. Point out that recognition is not proof of
   disposal.
5. **Voice.** Press **Talk to Sara** at the top of **Our Village** — the
   microphone with its name under it, the language choices directly beneath.
   The panel opens with **Try saying…** and three buttons at the top, with
   **More commands** beside them for the rest of the catalogue. Each names the
   thing in plain words and shows the sentence to say, and pressing one sends
   that sentence — so the phrase is learned by watching it work. Speak one, or
   press one, then show **Your request** (what was asked) beside **Sara's
   reply**. Try “do not start irrigation” to show that a
   negated request is refused without action, and “can you turn off the
   lights?” to show that a polite question is a command.
6. **What Happened.** Show the command log and the recognition event.
   **The connection state is reported in exactly one place**, the pill in the top
   bar: Live / Stale / Offline / Simulation, with the raw reason (and the last
   frame's age) on hover, and a press to leave Simulation. No banner sits under
   it — there are none left in the app.
7. **Demo mode (optional).** Turn it on in **Setup → Simulation** for a fast
   scenario demonstration. The same card carries the scenario buttons —
   **Reset**, **Dry soil**, **Low water**, **Night** — because the simulator
   starts dry but gets wet once you water it, and without a reset the pump
   button stays correctly disabled for the next twenty minutes. There is no
   banner: the connection pill reads **Simulation** instead of Live — a simulated
   page never claims the board is answering — and **pressing the pill** returns to
   live readings in one press. Never leave Demo mode on for the real hardware
   part of the talk.
   *(There is no "Fill a bin" scenario: nothing measures bin fullness — the bins
   have indicator LEDs only.)*

## Buttons and what they mean

| Control | Effect |
| --- | --- |
| Pump Auto / On / Off | Sends `PUMP_AUTO`, `PUMP_ON` or `PUMP_OFF`. Auto is every rule; On and Off are yours, and only a tank the controller knows to be low stops On. |
| Spoken “stop the pump” | Sends `IRRIGATION_STOP`; it also releases a manual **On**, so answering “stopped” is always true. |
| Lights Auto / On / Off | Sends `LIGHTS_AUTO`, `LIGHTS_ON` or `LIGHTS_OFF`. Auto uses the LDR. |
| Voice command | Push-to-talk, maximum 10 seconds. |
| Sort Waste | Opens the local camera classifier. |
| Demo mode | Simulated readings and simulated commands only. |

## Voice commands

Supported in English, Malayalam and Hindi:

- village status
- lights on
- lights off
- automatic lights
- automatic pump
- soil moisture
- start irrigation
- stop irrigation
- water availability
- help

There is deliberately **no "bin status"**: the three bins are LEDs lit by the
classifier, and nothing measures them. (There used to be a reply that only said
so; it was removed on 2026-11-18 because a catalogue entry is a promise that
asking does something.)

Push-to-talk is deliberate: the app does not listen continuously. It rejects
unsupported, ambiguous and negated phrases with the exact support sentence.
A **polite question is a command** when it asks for an act — “Can you turn off
the lights?” turns them off — while “should I…” and “what happens if…” are
advice and move nothing.
Whisper is speech-to-text only; replies are prepared text, optional local
recordings, or the browser's own voice. If a language voice is unavailable,
the app says so rather than using a remote service.

### Sara's English voice

English has **two** voices, and the Indian one is the default:

| Choice | What speaks |
| --- | --- |
| **Indian English** (default) | Sara's neural Indian model `en_IN-spicor-medium`; if that file is missing, this computer's own English (India) voice (Windows: *Heera*, *Ravi*); if neither, Sara's own voice |
| **Sara's own** | `en_US-lessac-medium` — American, and the same speaker as her Hindi and Malayalam |

Hindi and Malayalam never change: they are already Indian voices
(`hi_IN-priyamvada`, `ml_IN-meera`).

**Where the choice lives.** It is saved in the village's own settings
(`/api/v1/settings`), not only in the browser, so a cleared profile, a new
laptop or a **reflash of the ESP32** does not bring the American voice back. The
page writes it to the device copy as well, so speech changes immediately and
still works with the backend unreachable.

**The Indian model** is a community voice (NavGurukul, `en_IN-spicor-medium`),
installed by `scripts/install_piper.sh` into `models/piper/voices/`. That folder
is **committed** (2026-11-17) so a lost laptop cannot leave Sara silent: losing
her voice would mean re-downloading it on a machine that can reach the internet.
**Its licence is AGPL-3.0**, unlike the MIT engine and the official voices: free
to download and use, including for an exhibition; if the app or the model is
ever published or handed out, the AGPL terms follow the *model*. To skip the
download on a new machine, run the installer with `VILLAGE_INDIAN_VOICE=0`.

What is *not* affected by a reflash: the voice choice, the language, spoken
replies on/off, the camera id, the waste thresholds — all in the village
database on the laptop. The board's own calibration lives in its NVS and also
survives a normal OTA/USB reflash; only an explicit `erase_flash` wipes it.

### How words are said

English speech is not always the text on screen: two words are spelled
differently for the engine, in `lib/speech.ts` (`ENGLISH_SAY`). The page always
shows the normal spelling.

**"Sara" is said "Sahra".** The English voice reads `Sara` the American way —
/ˈsɛrə/, "SEH-ra" — while the Malayalam and Hindi voices say സാറ / सारा,
/ˈsɑːrə/, **"SAA-ra"**. `Sahra` phonemises to exactly `s ˈ ɑː ɹ ə`, and was
chosen over `Saara` because the latter doubles the r (`s ˈ ɑː ɹ ɹ ə`), measured
with `piper_phonemize` (asked 2026-11-17).

**A sentence-final "you" is said "yoo".** At the end of a sentence English makes
the pronoun unstressed, and the voice reduced it to a short vowel squeezed into
the gap before the question mark: in the greeting the closing word measured
**140 ms at 13.3 %** of the sentence's peak — audible on a phone, easy to lose
across a room. `yoo` is the *same* sound with stress (`j ˈ uː`, still one long
vowel — `yuu` would double it) and measured **200 ms at 15.9 %**, a fully spoken
word. Only a sentence-final `you` is respelled: mid-sentence it is an ordinary
unstressed pronoun, so "Can you turn off the lights?" is passed through
untouched. The rendering is 200 → 280 ms on the same measurement.

Both substitutions are speech only, English only: Malayalam and Hindi already
write the name in their own script, and their text is handed over unchanged.

### The language of the page

The selector on the kiosk page — **English · हिन्दी · മലയാളം** — sets the
language of **the whole page and of Sara**: the cards, the buttons, the
simulation controls, the waste dialog, Sara's panel and her voice. There is
deliberately only one selector (the panel has a copy of the same control, and
both read one shared state, so they cannot disagree).

The choice is remembered on this device (`village.voiceLanguage`) and applied to
`<html lang>` so a screen reader and the font fallback agree with it. It is a
reading choice, not an action: changing it never sends a command, never changes
a device state and never resets the simulation.

**Which surfaces are translated:** the exhibit page and everything it opens —
Sara's panel, the waste sorter, the sample dialog, the bin LEDs, the mode knob
and the connection pill.

**Which are not, and why:** the operator pages (Setup, Sensors, About, What
Happened, Help) are English. They are reachable by address for a presenter, not
by a visitor, and keeping them out keeps the translation table to what a visitor
actually reads. The firmware's own reason sentences and backend error text are
written in English; where one would otherwise appear on a translated page, a
translated sentence says the same thing.

**Adding a language:** add it to `LANGS` in `lib/lang.ts` and add one entry per
key in `lib/messages.ts` — `messages.test.ts` fails until every key has it, which
is what stops a half-translated page from shipping with a raw key on screen.

**The translations were not reviewed by a fluent speaker.** They were written
for this project in short, everyday language (Class 6, exhibition visitors). If
a sentence reads oddly, it is wrong in exactly one place — `lib/messages.ts` —
and fixing it needs no code change.

### The language Sara answers in

**Sara speaks the visitor's language, always.** The controller's own reason is
written in English by the firmware ("Streetlights switched off manually."), and
it used to be what she read aloud — a Malayalam voice pronouncing an English
sentence, which a visitor reported as *"she answered in something weird"*
(2026-11-17). Now:

- a **confirmed** command is spoken and shown as the parser's own sentence in
  that language (`തെരുവ് വിളക്കുകൾ അണച്ചു.`);
- a **refusal** is spoken as *"the village did not accept that — the reason is
  on the screen"*, in that language, with the controller's reason shown as text
  beneath it;
- **"already on/off"** uses the catalogue's own sentence.

Typed and spoken requests take the same path, so the two cannot answer
differently.

### The panel itself

**Talk to Sara** opens a panel whose order is fixed, so a visitor learns it in
one go:

1. **Try saying…** — three buttons across the top, the first thing in the
   panel because it is the first thing a visitor needs. Each one says what it
   is for (*Streetlights on*, *Water in the tank*, *Soil moisture*) and shows
   the sentence underneath, and one press sends that sentence.
2. **The language**, with the state beside it — and in Simulation the sentence
   *“Simulation — physical model is not controlled.”*
3. **Start speaking** / **Stop speaking**, with “up to 10 seconds”.
4. **Your request** — the words that were heard, or *“Your words will appear
   here.”* Pressing an example fills this card with the sentence it sent.
5. **Sara's reply** — the answer, with one short state word: *Listening*,
   *Understanding…*, *Sending…*, *Confirmed*, *Answer*, *Blocked*, *Not
   connected*. The reply stays until a new request replaces it.
6. **Or type your request**, which goes to the same parser as speech.
7. **More commands** — the link at the right of *Try saying…* opens the rest of
   the catalogue **there, at the top**, as a two-column list in which every row
   is a button. Choosing one sends it and closes the list. Nothing lives below
   the fold any more: if the window is short the panel scrolls rather than
   hiding its own foot.

The examples are the three things a visitor actually tries: turn the lights on,
ask whether the tank has water, ask how wet the soil is. Each is explained in
plain words, and every one of them is checked against the real parser by the
backend test suite.

The panel deliberately does **not** show command names, intent ids, confidence
scores or parser rules. What it shows is what a visitor can act on.

**A refusal is answered in the visitor's language.** When the controller refuses
— the soil is already wet, the tank is low, the pump is on the manual switch —
the reason is a sentence in the chosen language, spoken and shown, not the
controller's English. A recording that never moved, or that came back in a
script nobody here reads, is answered "I did not hear that" instead of being
printed.

Malayalam and Hindi recognition must be tested with the child's actual speech.
The phrase dictionary is `shared/intents.json`; add the words the child really
uses, then re-run the backend.

### The speech server and the model

Speech is recognised by whisper.cpp on this laptop, started by whichever script
started the app (`./scripts/whisper.sh start` does it on its own; `status` says
whether it is answering). The model is chosen with `VILLAGE_WHISPER_MODEL` in
`.env`:

| model | size | a command takes | English | Malayalam and Hindi |
| --- | --- | --- | --- | --- |
| `ggml-base.bin` (default) | 148 MB | 1–2 s | good | weak |
| `ggml-small.bin` | 488 MB | ~3 s | good | weak, sometimes better on accents |
| `ggml-large-v3-turbo.bin` | 1.6 GB | 18–25 s here | good | weak, and far too slow |
| `ggml-large-v3.bin` | 3.1 GB | 25–90 s here | good | not usable on this CPU |

### A child's voice, and the one word that breaks it (2026-11-18)

Two children and one adult gave English commands at the exhibit and several came
back "not understood".  The app keeps no audio — only the transcript in
**What happened** — so the question was measured instead, with the exhibit's own
voices read back through the running server and then degraded to stand in for a
child across a room (pitch raised, volume dropped, room noise mixed in): 9
command sentences × 2 voices × 3 degradations = **54 clips**, scored on how many
the *parser* then read correctly.

| setup | read correctly | a command takes |
| --- | ---: | ---: |
| `ggml-base.bin`, as shipped | **42 / 54** | 0.84 s |
| the same with beam search (`-bs 5`) | 43 / 54 | 0.88 s |
| `ggml-small.bin` | 45 / 54 | **3.05 s** |

So a bigger model and a wider search buy almost nothing here, and `small` costs
three seconds of a visitor's sentence. **The fault was one word.** The exhibit's
own Indian English voice saying **"Pump on!"** is written `Bum on!` by
whisper-base *and* by whisper-small, and `Turn on the pump` came back as
`Don't hold the bump` / `Turn on the Pope`.  The children produced `Dumb on!`
and `Bounce on!` for the same two words.

That is why the fix is in the vocabulary and not in the model: the spellings the
exhibit has actually produced are listed on the pump in `shared/intents.json`
(`bum`, `bump`, `dumb`, `thumb`, `pum`, `pomp`), each pinned by a test that
quotes it.  With them, "Pump on!" reads correctly in 5 of 6 variants — and the
one that still fails is heard as "Come on.", which is left unread on purpose.

### The last few recordings are kept, and they cannot fill the disk

Until 2026-11-18 the app kept **nothing** it heard; a refused sentence left only
its transcript, which is the one thing under suspicion. So the newest recordings
are now written to **`data/voice-clips/`**, each with a `.json` beside it holding
what it produced — language, engine, duration, transcript, intent and reason.

It is bounded by **two** limits and prunes itself on every recording, so a
season of visitors cannot fill the laptop:

| setting | default | meaning |
| --- | --- | --- |
| `VILLAGE_VOICE_CLIPS` | **100** | how many recordings to keep; the oldest goes first |
| `VILLAGE_VOICE_CLIP_BYTES` | **64 MB** | a hard ceiling on the whole folder |
| `VILLAGE_VOICE_CLIP_DIR` | `data/voice-clips` | a blank value switches it off entirely |

A 10-second recording is about 320 kB, so a hundred of them is about **32 MB** —
the byte ceiling is headroom for a deployment that asks for more clips. A
recording and its `.json` are deleted together, and the newest recording is
never deleted to honour the ceiling (an empty folder would lose exactly the
sentence just misheard).

`./scripts/voice_replay.py` reads the folder and answers the question a voice fix
is really about: **does the sentence the exhibit got wrong work now?** It re-runs
each stored transcript through the parser and marks the answers that changed:

```bash
./scripts/voice_replay.py                 # every kept recording
./scripts/voice_replay.py --fails-only    # only the ones it could not read
./scripts/voice_replay.py --audio         # ask whisper again, e.g. after a model change
```

Turning it off is one line (`VILLAGE_VOICE_CLIPS=0`); the panel's own privacy
line says the recordings are kept on this laptop, so a visitor is never told
something that is not true.

### Malayalam has its own speech model

The multilingual `ggml-base` model cannot write Malayalam.  It hears the sentence
— the sounds are right — but it spells them in **Tamil letters** (or Devanagari,
or even Arabic ones) and mangles the less common word, so the parser has nothing
to match.  Measured through the app's own `/api/v1/voice/transcribe` route on six
catalogue sentences: **2 of 6**.

So Malayalam is read by a **Whisper-small fine-tuned on Malayalam**
(`kavyamanohar/whisper-small-malayalam`) in `models/whisper/ml-asr/`, which
writes Malayalam script and gets the words right: the same six sentences are
**6 of 6** at about **2.5–3 s each** on this laptop (the first one waits a few
seconds while the model loads).  `scripts/download_models.sh` fetches it
(~950 MB, too big for git).

- It is only used for **Malayalam**.  English and Hindi stay on whisper.cpp,
  which is fast and good at them.
- If the model is missing, or fails to load, the app **falls back** to
  whisper-server: a missing model must never stop the exhibit from listening.
- The language is **always sent**, never detected: the request carries
  `language=ml`.  Measured directly against the server — the same clip with
  `language=en` comes back as English ("Vila Google Cut Tikuga"), and a request
  with the field misspelled (`lang=ml`) is ignored and falls through to
  auto-detection.  So the field name matters, and it is right.
- Malayalam gets **no decoder prompt** (see above); the fine-tuned model is given
  a short list of the village's own phrases instead, which straightens spelling
  ("വിലക്കുകൾ" → "വിളക്കുകൾ") without pulling the decoder off track.

**Do not give the model a Malayalam prompt.**  The app sends a short Hindi
prompt because it settles the script for Hindi, but Malayalam is the opposite
case: measured on the same three sentences, a Malayalam prompt made the model
wander (one answer came back as a single nonsense word) while the same audio
without a prompt transcribed consistently enough to run the command.  The
prompt is per language in `voice.py` — leave `ml` out of it.

The decoder is **primed with a short sample of the words the village listens
for**, in the language's own script (`app/voice.py`, `LANGUAGE_PROMPTS`).  That
settles which script comes back: the same Hindi clip gave `Light Bandkaru.`
with no prompt and Devanagari with one.  It is not a cure for a misheard word —
"लाइट" was dropped from one clip even with the prompt — but a transcript in the
right script is the one the parser, and the visitor, can read.

Measured 2026-11-17 on this laptop: **English is reliable on every model**, and
a *synthesized* Malayalam sentence was misheard by all of them (Tamil,
Devanagari or Gurmukhi script). The parser itself is fine — the same sentence
typed as Malayalam gives the right command — so the gap is in recognition, and
it may be the synthetic test voice rather than the model. Test with real speech
before changing the model; the big ones are unusable at 20 s per command here.

### A transcript in the wrong script is still read

If the speech model answers in a sister script — it once heard Malayalam and
wrote **Tamil** — the village still understands it.  The words are shifted into
the Malayalam alphabet by their Unicode position (Tamil is 0x180 below it,
Devanagari 0x400, Kannada 0x80, Telugu 0x100, Bengali 0x380) and romanised with
one table, so `വിളക്കുകൾ അണയ്ക്കുക` and `விலக்குகள் ஆனக்குக்கா` meet on
`vilakkukal anakkuka`.  English words spoken while Malayalam is chosen
("light off") work the same way, because the vocabulary already lists those
spellings.

It is deliberately narrow: exactly one device and one state, and never when a
refusal or a question word is recognised — so a pump whose state could not be
read is refused rather than started.  If nothing matches, the panel says the
model did not hear the language clearly and keeps the words on screen.

## Shutdown

```bash
./scripts/stop.sh
```

This stops only the PIDs recorded by `launch.sh`. Then power off the ESP32 and
the router. The ESP32 starts with the pump OFF next time; it never resumes an
interrupted session.

### The simulation lab

**Simulation** turns the page into a lab, and says so twice: under the mode
knob, and again above the cards —

> Try changing the light, soil and water conditions. See how the village
> responds.
> Simulation — physical model is not controlled.

Six conditions can be changed, each under the row it belongs to, and each row
then says what the village did about it:

| Row | Control | What it means |
| --- | --- | --- |
| Watering | **Soil moisture indication**, Dry → Wet | The simulated probe. It is an indication, not a measured amount of water in the soil. The chip beside the card name is the **pump**: running or off. |
| Rain Water Tank | **Water available** / **Low water** | Two wires in the tank can say one thing: whether the water reaches the low level, or not. **Available** is answered as "there is enough water in the tank" — enough to water with, not full, and never a percentage or a litre count. |
| Lights | **Outside light**, Dark → Bright | The room's light. **Outside: Dark** and **Streetlights: On** are shown separately, because they are different facts. |
| Solar | **Light on solar panel**, Low → Strong | The panel's own light. Volts, the current through the 330 Ω resistor and power are one circuit: **mW = V × mA**. |
| Wind | **Windmill speed**, Still → Fast | One circuit: the ADC reads the 47 Ω resistor behind the blue LED, so the card shows **voltage, current and power**. It is the electrical power delivered to that circuit, not the wind's power. |
| Waste | **Try a sample** | Five preset items showing the guidance the camera would give. Not an AI result. |

Every row ends with a sentence naming the rule that decided: *“It is dark and
Auto is selected → streetlights on.”*, *“Manual Off selected → pump off.”*, or
the controller's own reason on Auto.

**Quick demonstrations** are one press each, and each says what it changed:

- **Night-time** — outside light to dark, streetlights on Auto.
- **Dry soil** — moisture below the dry threshold, water available, pump on Auto.
- **Low water** — dry soil and a low tank on Auto, so watering is *blocked*.
- **Reset demo** — the documented defaults, and the pending timers cleared.

A preset changes only the conditions it names; everything else is left alone.

**Nothing here touches the board.** The sliders, the presets, the samples and
Sara's requests all go to the simulator, and the answers are labelled as
simulated. Switching back to **Live** does not replay anything and shows only
what the controller reports; the simulator's state ends with the simulation.

**The pump switch and the tank.** Only a tank the controller *knows* to be low
stops a manual **On**. A probe that is missing, uncalibrated or stale cannot say
that, so the switch runs the pump anyway — this board has no tank probe fitted
(2026-11-17), so that is its normal state and the Rain Water Tank card reads
**Not calibrated**. The Watering card says nothing about it: a line repeated on
every visit is furniture, and the tank card already answers the question. Fit and
calibrate the probe and a low tank starts refusing again.

## Honest data

The village does **not** measure tank percentage, litres, household consumption,
pump pressure, flow, battery charge or energy savings, and those figures never
appear anywhere.

What **is** measured, and may be quoted: soil moisture, the tank's one minimum
level, the light level, the **solar** panel (volts, milliamps and milliwatts,
through a real panel and a red LED as the load) and the **wind** circuit (volts,
milliamps and milliwatts). The wind card reads "Not fitted" until a turbine is
wired to GPIO 33.

The wind reading is one measurement of one circuit: `generator + → blue LED →
ADC junction → 47 Ω → ground`, so the ADC is across the resistor. Current is
`V_resistor / 47`, the generator's voltage is that plus the LED's **measured
2.8 V** forward voltage, and power is volts × milliamps. **It is the electrical
power delivered to the LED-and-resistor circuit — not the wind's power, and not
energy generated over time.** Below the noise floor the LED is not conducting,
so there is no current and no way to know the generator's voltage: the card shows
a dash and "No measurable output" rather than 2.8 V for a stopped windmill.

The model **buildings** are static display models. The bins have indicator LEDs
only: nothing measures how full a bin is.

## Sharing the app (Cloudflare Pages)

Pushing to GitHub builds the dashboard on Cloudflare Pages — that build is the
**SPA only** (`web/dist`).  It has no backend, no whisper, no Piper, no camera
and no waste classifier, so on its own it cannot listen or control anything.

To share it with another student, point the shared build at a running backend:
set **`VITE_API_BASE_URL`** in the Cloudflare Pages environment variables to
the backend's public URL (a Cloudflare Tunnel over `http://127.0.0.1:8010` is
the least invasive way to get one) and redeploy.  On the first visit the student
opens the link once with `?api=https://…` and the choice is remembered in the
browser; the login screen also has a "Connect to a backend" box for it.

For the exhibit itself, run locally: `./scripts/launch.sh` serves everything on
`:8010`.

### What the hosted copy can do (and what it cannot)

**With no backend at all, it runs a demonstration.** Cloudflare Pages serves the
dashboard only, so there is no controller to poll — and the page says so and
shows the village anyway: a built-in simulation (soil drying, a pulse of water,
the tank draining, the lamps following the daylight, a bin lighting) locked to
**Simulation**, with the note *"This copy has no village service, so it runs on
a built-in demonstration."* Nothing it shows is a measurement and nothing it
does touches hardware. Speech and the waste classifier are the parts that
genuinely need the models, so there they read as not installed and the
microphone stays off.

**With a backend, it is the real app.** The page talks to whichever backend it
is told about, and it keeps its session as a **token** rather than a cookie,
because a browser refuses a third-party cookie:

1. Open `https://<your-site>.pages.dev/?api=https://<backend>` once. The
   address is remembered (`localStorage.village.apiBase`) and taken out of the
   URL; after that the site opens straight onto the backend.
2. Sign in with the account as usual. The backend answers with a signed token
   as well as the cookie, and the hosted page keeps the token.
3. Setup → **A link for students** now offers the hosted link
   `https://<your-site>.pages.dev/?api=https://<backend>&share=<key>`; that is
   the one to hand out. It exchanges the key for a guest token in one request,
   so no cookie (and no redirect off the page) is involved. The guest is still
   Simulation-only, and the backend still refuses a live command from it.

CORS: `https://*.pages.dev` is allowed by default; a custom domain goes in
`VILLAGE_CORS_ORIGINS`. The backend must be reachable **from the visitor's
browser**: an https page will not call `http://` on anything but the same
machine (loopback), so share an https address for anyone else.

Speech recognition, the spoken replies and the waste classifier all run on the
backend, not in the page, so the hosted copy gets them whenever the backend is
the laptop that has the models. A backend without them is not broken: the
readiness line says what is missing, the microphone stays off and the waste
page says the model is not installed — the rest of the app keeps working.

### The share link (students, no password)

Setup shows **A link for students** — one URL. Opening it signs the visitor in
as `guest` and lands them in **Simulation**, so nothing they press moves the
pump, the lights or the calibration:

- **Live and Test are locked** for that visit. The server enforces it too: the
  guest cookie is refused any live command, and any write other than the
  visitor page (commands in Simulation, the simulation knobs, Sara, the waste
  classifier) is a `403`. Setup, calibration and the bench panel are readable
  but never writable.
- **The link is derived from the password**, so changing
  `VILLAGE_ADMIN_PASSWORD` (or the hash) retires every copy that was handed
  out, and there is no second secret to keep.
- **`VILLAGE_SHARE_LINK=0`** switches the route off entirely; the Setup card
  then says so instead of offering a link.
- The guest session lasts `VILLAGE_SESSION_HOURS` like any other, and
  **Sign out** in the header ends it.
