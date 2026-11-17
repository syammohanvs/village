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

- **Default account** — username `admin`, password `village`. Both are set in
  `.env`:

  ```bash
  VILLAGE_ADMIN_USER=admin
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
   The panel opens with **Try saying…** and three examples that work, each
   explained in plain words (“Please turn on the lights.” — turns the
   streetlights on). Speak one of them, then show **Your request** (what was
   heard) beside **Sara's reply**. Try “do not start irrigation” to show that a
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
- soil moisture
- start irrigation
- stop irrigation
- water availability
- bin status
- help

Push-to-talk is deliberate: the app does not listen continuously. It rejects
unsupported, ambiguous and negated phrases with the exact support sentence.
A **polite question is a command** when it asks for an act — “Can you turn off
the lights?” turns them off — while “should I…” and “what happens if…” are
advice and move nothing.
Whisper is speech-to-text only; replies are prepared text, optional local
recordings, or the browser's own voice. If a language voice is unavailable,
the app says so rather than using a remote service.

### Sara's English voice

Sara's own voice is the local neural model (`en_US-lessac-medium`), which is
**American** English — it is the same speaker as her Hindi and Malayalam, and it
is the smoothest of the three. If the exhibit wants an **Indian** accent for
English, **Setup → Voice & Camera → Sara's English voice → Indian English**
switches English to this computer's own voice (Windows ships *Microsoft Heera*
and *Microsoft Ravi*, both English (India); Android and some Linux setups have
an `en-IN` voice too).

- It is a **per-device** choice, like the camera: the voice is installed on the
  machine, not on the account.
- **Hindi and Malayalam always stay on Sara's own voice** — they are already
  Indian voices.
- The row names the voice it found, and says what to install when it finds none
  (Windows: Settings → Time & language → Language & region → English (India) →
  Language options → Speech).
- Quality depends on that voice: the Windows one is a formant voice, so it is
  more robotic than the neural model. If a *neural* Indian-English voice is
  wanted, the alternative is a community Piper `en_IN` model, which is a
  third-party download rather than part of the official voice set.

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

1. **The language**, with the state beside it — and in Simulation the sentence
   *“Simulation — physical model is not controlled.”*
2. **Start speaking** / **Stop speaking**, with “up to 10 seconds”.
3. **Your request** — the words that were heard, or *“Your words will appear
   here.”*
4. **Sara's reply** — the answer, with one short state word: *Listening*,
   *Understanding…*, *Sending…*, *Confirmed*, *Answer*, *Blocked*, *Not
   connected*. The reply stays until a new request replaces it.
5. **Or type your request**, which goes to the same parser as speech.
6. **Try saying…** — three examples, then **More examples** (that list scrolls
   inside itself, so the reply above never moves off screen).

The examples are the three things a visitor actually tries: turn the lights on,
ask whether the tank has water, ask how wet the soil is. Each is explained in
plain words, and every one of them is checked against the real parser by the
backend test suite.

The panel deliberately does **not** show command names, intent ids, confidence
scores or parser rules. What it shows is what a visitor can act on.

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
| Rain Water Tank | **Water available** / **Low water** | Two wires in the tank can say one thing: water at the low level, or not. There is no percentage and no litre count. |
| Lights | **Outside light**, Dark → Bright | The room's light. **Outside: Dark** and **Streetlights: On** are shown separately, because they are different facts. |
| Solar | **Light on solar panel**, Low → Strong | The panel's own light. Volts, the current through the 330 Ω resistor and power are one circuit: **mW = V × mA**. |
| Wind | **Windmill speed**, Still → Fast | Voltage only. Power is not measured, and nothing claims it is. |
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
through a real panel and a red LED as the load) and the **wind** generator's
volts once a turbine is wired to GPIO 33 — the wind card reads "Not fitted"
until then, and it deliberately reports no current or power, because one
analogue input cannot measure both.

The model **buildings** are static display models. The bins have indicator LEDs
only: nothing measures how full a bin is.
