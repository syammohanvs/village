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
otherwise press **Water** or walk into **Setup** and change the calibration.

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
- **Reservoir** — Available / Low only. It is not a tank gauge.
- **Pump** — commanded state, mode, session reason and cumulative runtime.
- **Streetlights** — mode, Bright/Dark and commanded state.
- **Bins** — one indicator LED per category. No fill level is measured or shown.
- **Connection** — live, stale, disconnected, last update and last error.
- **AI services** — whether Whisper and the waste model are ready.
- **Recent activity** — commands, recognitions, alerts and connection events.

A green “accepted” means the controller decided. It does **not** prove that
water physically flowed. The dashboard keeps the two statements separate.

## The safe demonstration sequence

1. **Dashboard.** Point out the reason panel, then the soil, reservoir and bin
   cards. Say clearly that the tank has two probes, not a level sensor.
2. **Streetlights.** Show **Auto**, cover the LDR (or press the demo Night
   button in Demo mode) and watch the state change after the stable delay.
   Show Manual On and Off, then return to Auto.
3. **Irrigation.** Press **Start irrigation** only if the soil is dry and the
   reservoir is available. The controller may refuse with a reason — that is a
   feature, not a failure. Point out the pulse → soak → re-check sequence.
   Press **Stop irrigation** to show the immediate stop.
4. **Sort Waste.** Hold a plastic item in front of the camera. The stable
   prediction lights the plastic LED. Move it away; show that repeated frames
   do not count as new items. Point out that recognition is not proof of
   disposal.
5. **Voice.** Press the microphone at the top of **Our Village** (the language
   choices sit directly under it if a visitor wants another language first),
   speak one command, show the recognised text and the matched command. Try “do not start irrigation” to show that a
   negated request is refused without action.
6. **What Happened.** Show the command log and the recognition event.
   **The connection state is reported in exactly one place**, the pill in the top
   bar: Live / Stale / Offline / Simulation, with the raw reason (and the last
   frame's age) on hover, and a press to leave Simulation. No banner sits under
   it — there are none left in the app.
7. **Demo mode (optional).** Turn it on in **Setup → Simulation** for a fast
   scenario demonstration. The same card carries the scenario buttons —
   **Reset**, **Dry soil**, **Low water**, **Night** — because the simulator
   starts dry but gets wet once you water it, and without a reset the Water
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
| Start irrigation | Sends `IRRIGATION_REQUEST`; the controller applies every safety check. |
| Stop irrigation | Sends `IRRIGATION_STOP`; the pump stops immediately. Always visible during a session. |
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
Whisper is speech-to-text only; replies are prepared text, optional local
recordings, or the browser's own voice. If a language voice is unavailable,
the app says so rather than using a remote service.

Malayalam and Hindi recognition must be tested with the child's actual speech.
The phrase dictionary is `shared/intents.json`; add the words the child really
uses, then re-run the backend.

## Shutdown

```bash
./scripts/stop.sh
```

This stops only the PIDs recorded by `launch.sh`. Then power off the ESP32 and
the router. The ESP32 starts with the pump OFF next time; it never resumes an
interrupted session.

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
