# Troubleshooting

Start with the **Setup** checklist in the dashboard. It checks the controller,
calibration, pump gate, Whisper, waste model and optional reply audio.

## The dashboard does not open

- Check `data/logs/backend.log`.
- Confirm the port: `VILLAGE_PORT` in `.env` (default 8010 here). If another
  project owns 8000, keep 8010. `./scripts/launch.sh` refuses to kill an
  unrelated process.
- Verify the backend directly:
  `curl http://127.0.0.1:8010/api/v1/system/health`.

## The sign-in form will not let me in

- The default is `admin` / `village`. If that is refused, check `.env`:
  `VILLAGE_ADMIN_USER`, and either `VILLAGE_ADMIN_PASSWORD` or
  `VILLAGE_ADMIN_PASSWORD_HASH`. The backend reads `.env` once at start, so a
  change needs a restart (`./scripts/stop.sh && ./scripts/launch.sh`).
- Five wrong attempts from the same address pause the form for a minute
  ("too many attempts; wait a minute and try again"). That is a pause, not a
  lockout — wait and try the right password.
- `The village service did not answer` on the card is **not** a password
  problem: the backend is not running. Check `data/logs/backend.log`.
- Nothing about the password is emailed or shown anywhere, so a forgotten one
  is reset in `.env` (see **Signing in** in `docs/operation.md`).

## The controller is unreachable

**The board is on the laptop's own hotspot**, so "two different networks" is not
usually the fault any more. Decide which of these three it is, in this order.

### 1. Is there a network for the board at all?

```bash
./scripts/relay.sh status
```

That one line prints the board, the relay and the **hotspot state**. If it says
`windows hotspot -> Off`, that is the whole problem: the board's only credential
is the hotspot's name, so with the hotspot off it has nothing to join and looks
exactly like a dead board (no `192.168.137.x` address on Windows, no reply on
the subnet).

- Switch it back on **in the app's own tooling**: `./scripts/relay.sh hotspot-on`
  (no administrator needed), or Windows Settings → Network & internet → Mobile
  hotspot.
- `hotspot=NoInternetProfile` means the laptop itself has no uplink to share;
  join a Wi-Fi network first, then switch the hotspot on.
- Starting the dashboard runs the same check (`relay.sh ensure`), so
  `./scripts/dev.sh` or `./scripts/launch.sh` repairs a switched-off hotspot by
  itself.

### 2. Is the board powered?

The hotspot can be on and the board still absent because it has no power — a
powerbank that has switched itself off, a loose USB cable, a flat cell. The
board gives no sign over the network in that state. Check the LED on the board.

### 3. It is on the network, but at a different address

Normal, and handled for you. The board's address is DHCP and it moves (it has
been `.168`, `.197` and `.222` in one session). The relay on the Windows host
sweeps the hotspot subnet for a host answering the device API and switches to it,
so there is no address to maintain by hand. `VILLAGE_DEVICE_DIRECT` is only the
first guess.

**Do not** set `VILLAGE_DEVICE_DISCOVER=true` with the relay: the backend would
sweep the WSL network (`172.29.x`) instead of the hotspot, find nothing, and
waste a sweep a minute.

### The ordinary checks, if all three are fine

1. Confirm the token in `.env` exactly equals `VILLAGE_DEVICE_TOKEN` in
   `uc/include/village/secrets.h`.
2. `curl http://<board-ip>/api/v1/health` **from Windows** (this endpoint is
   public; `/status` needs the token). Windows can always reach the board when
   WSL cannot — that difference is the relay's whole reason to exist.
3. Serial monitor at 115200 baud to read the board's own scan and join lines.
4. If station mode failed at boot the board starts `Village-Setup` (password in
   `secrets.h`). It retries the real network every 60 seconds while nobody is
   connected to that setup AP, so it usually recovers on its own — connect to it
   only for recovery.
5. The dashboard shows **stale** and **disconnected** rather than inventing a
   zero. That is deliberate.

## Pump does not start

The controller refuses with a reason. Check, in order:

- `Irrigation blocked: the pump is switched off in the configuration.` —
  **Automatic watering allowed** is off in Setup. The manual **On** switch on
  the village page still runs the pump, because only the tank can stop it.
  (The old "not commissioned" line came from a build flag that no longer
  exists: the hardware is finished, 2026-11-17.)
- `reservoir water is low` / `state is unknown` — calibrate the probes and make
  sure probe B is grounded and probe A is on the 47 kΩ/ADC node.
- `soil moisture is not calibrated` — capture dry and wet endpoints.
- `the soil is already wet enough` — the reading is at or above the dry-start
  threshold. This is correct behaviour.
- `a required sensor reading is stale or invalid` — check the probe wiring and
  the age shown in **Setup → Sensors & Calibration**.
- `a watering session is already running` — press Stop first.
- `the post-session lockout is still active` — wait for the cooldown; after a
  no-rise failure it is 30 minutes. Fix the probe and/or wet the soil to clear
  the failure lockout.

### The dashboard says it started, but the pump does not turn

That is electrical, not the controller — the reason line would say otherwise.
Measure, in this order:

1. **D19 to GND** with the pump requested: **3.3 V**? If it stays at 0 V the
   request never reached the driver (check the reason line first).
2. **Gate to source**: should be about the same 3.3 V. Much less means a
   pulled-off gate wire or the 10 kΩ in the wrong row.
3. **Voltage across the pump**: 4–5 V while running. **About 1.3 V is the
   signature of a collapsed supply**, not a bad transistor — the pump's
   start-up surge is several times its running current and a USB port cannot
   deliver it. Power the pump from the **5 V 2 A bank** with the grounds
   joined.
4. **Drain to source**: under ~1.5 V is on. If it is 3–4 V the transistor is
   not being switched at 3.3 V; see `docs/wiring.md` §4.

A resistor or lamp dummy load passing does **not** prove the pump will: it
draws a steady 171 mA, while the motor wants several times that for a fraction
of a second. Measure with the real pump on the real supply.

## Pump stops immediately

Look at the last stop reason: low water, invalid sensor, maximum runtime,
maximum pulses, manual link loss, or explicit stop. Low water and sensor
failure are hard safety stops. The link-loss stop applies only to a manual
session; local automatic watering continues if the laptop disappears.

## Soil percentage behaves oddly

- Confirm the probe interface is powered at 3.3 V, or that its analogue output
  cannot exceed 3.3 V.
- Dry and wet endpoints must differ by at least the minimum span. Either
  polarity is accepted.
- A resistive probe in continuously wet soil can corrode; power it only while
  the exhibit runs.
- The reading is a calibrated relative value, not a laboratory measurement.

## Reservoir always says low or unavailable

- Check the 47 kΩ resistor and that probe B goes to GND.
- Measure the ADC node with a multimeter while the probes are dry and wet.
- The excitation pin must be high impedance when not measuring. The firmware
  does this; a wiring short to 3.3 V would keep the node high.
- Set thresholds from the measured millivolts; the defaults are starting
  values.
- A calibration of “uncalibrated” blocks irrigation. That is deliberate.

## A bin LED does not light

The bins have **indicator LEDs only** — there is no distance sensor, no fill
level and no "bin full" alert to troubleshoot.

- The organic LED is **GPIO 21**, plastic **GPIO 22**, paper **GPIO 23**. Each
  needs a series resistor and its cathode to GND (see `docs/wiring.md` §6).
- A recognition only lights an LED for the three real bins. Sanitary waste,
  sharps, mixed bags and the recyclable materials (glass, metal, textile,
  leather, footwear, thermocol, e-waste) are referred to a person and
  deliberately light **nothing**, because there is no bin for them.
- If the camera suggests the right bin and the LED stays dark, check the board is
  connected and the command came back accepted: the app records the LED
  acknowledgement separately and says "not confirmed" when it did not arrive.
- A LED that is on with no item shown means the command's duration has not
  expired yet; each recognition lights it for eight seconds.

## Streetlights flicker or stay off

- Auto mode uses hysteresis and a 4 s stable delay. A brief change should not
  flip the LEDs.
- If the reading is stale, auto mode stays off and says the sensor is not
  ready.
- For a digital LDR module set `output_type=digital` and the correct
  `digital_dark_when_high` value.
- For an analogue module verify `analog_bright_high` with a lamp; some modules
  are inverted.
- A commanded off state is not a connectivity test. Check the LED and resistor
  in the bench test.
- **Everything reads “Not installed” and the lamps never switch on:** the
  controller starts with both hardware facts false on purpose. A floating ADC
  pin reads plausible noise, so an unwired LDR must not report “dark”, and
  unwired lamps must not be driven. Tick the matching box in **Setup → Sensors & Calibration** —
  **The streetlight lamps are wired** for the four outputs, **The LDR is
  wired** for the sensor — then save. They are independent: you can test the
  lamps before the LDR is fitted.

## Wireless update says “No response from device”

- Run the uploader from **Windows**, not from WSL. The board sends the image
  back over UDP to the machine that invited it, and WSL is behind a NAT the
  LAN cannot reach.
- The uploader must tell the board a reachable host address. `tools\ota_flash.py`
  detects it automatically; a raw `espota.py` call needs `-I <this-pc-lan-ip>`.
- Check the board is on the same network and still answers
  `http://<board-ip>/api/v1/health`.
- `Authenticating...OK` followed by silence means the invitation was accepted
  and the return path failed — that is the host-address problem above, not a
  wrong password. A wrong password fails before authentication.
- If Windows Defender Firewall blocks the inbound UDP reply, allow Python on
  private networks, or use USB flashing.

## Sara does not read aloud

- Sara reads aloud as soon as she opens. **Setup → Voice & Camera → Read aloud
  as soon as Sara opens** turns that off; the **Read aloud** switch on the Sara
  card stops or restarts the reading for that visit.
- If the card says the browser cannot read aloud, use Chrome or Edge. Firefox
  may have no speech synthesis.
- English prefers an Indian English voice installed on the device, and falls
  back to the bundled local voice; Malayalam and Hindi always use the bundled
  local voices.
- If it says the device has no voice for Malayalam or Hindi, install that
  language's voice in the operating system. The words are still displayed.
- Nothing is downloaded: speech is generated locally by the browser.

## Sara says a probe is not calibrated

That is the honest state, not a fault. A probe reports a real percentage only
after the two endpoints are captured and confirmed in **Setup → Sensors & Calibration**. Until then
Sara refuses to guess. See [calibration.md](calibration.md).

## Voice does not work

- `curl http://127.0.0.1:8181/health` should return `{"status":"ok"}`.
- Check `data/logs/whisper.log` and `VILLAGE_WHISPER_BIN`.
- The file named by `VILLAGE_WHISPER_MODEL` must be a **multilingual** ggml
  build (`ggml-base.bin`, `ggml-small.bin`, `ggml-large-v3-turbo.bin`, …). An
  English-only `*.en.bin` file is refused with `WHISPER_MODEL_WRONG`.
- Allow microphone permission in the browser. Use Chromium if speech
  recognition or audio capture is restricted.
- Push-to-talk records for at most 10 seconds; silence returns “No speech was
  detected”.
- Unsupported, ambiguous or negated phrases intentionally do nothing. The
  panel shows the support sentence.
- Malayalam/Hindi need testing with the child's real speech; edit
  `shared/intents.json` if the words differ.
- The app will not record while it is speaking a reply. If the microphone
  button is disabled, wait for the reply to finish.

## Sara answers in English (or something odd) when I speak Malayalam

Fixed 2026-11-17. She used to read the *controller's* reason aloud, which the
firmware writes in English — so a Malayalam request was confirmed by an English
sentence in a Malayalam voice. She now answers with the parsed sentence in the
chosen language; a refusal says so in that language and prints the controller's
reason underneath. If it happens again, check that the language buttons under
**Talk to Sara** show the language you are speaking.

## Sara's English has the wrong accent

Default is **Indian English**: Sara's neural Indian model
(`models/piper/voices/en_IN-spicor-medium.onnx`), else this computer's English
(India) voice. "Sara's own" is the American neural voice, chosen deliberately in
**Setup → Voice & Camera**. If the Indian model is missing,
`scripts/install_piper.sh` downloads it (AGPL-3.0, ~61 MB, git-ignored).

## Sara's English sounds American

That is Sara's own voice: the local neural model is American English, and it is
the same speaker as her Hindi and Malayalam. For an Indian accent, choose
**Setup → Voice & Camera → Sara's English voice → Indian English**, which uses
this computer's own English (India) voice (Windows: *Heera* or *Ravi*). If the
row says no such voice is installed, add English (India) under Windows settings
→ Time & language → Language & region → English (India) → Language options →
Speech. The choice is remembered on this device only.

## The simulation sliders do nothing

They only exist in **Simulation** — choose it on the knob at the top. In **Live**
the page shows the controller's readings and none of the lab controls, because
they would have nothing to change.

If a slider moves and the village does not answer, look at the sentence under
that row: it names the rule that decided. A manual **On** with a low tank, for
example, keeps the pump off on purpose.

## The camera opens the wrong one (a laptop with a USB camera)

A laptop usually has a built-in camera, and the browser's default is the
built-in one. **Camera device** on the Sort Waste page, just under the
Start/Stop button, lists every camera the browser can see; pick the external one
and the app remembers it for next time (per device, not per account).

- **Names are blank until the page may use a camera once.** Press **Start
  camera**, allow it, stop, and the list fills in with real names (the page says
  this too).
- **A camera plugged in while the page is open appears by itself** — no reload.
- **Stop the camera before changing device**: the list is disabled while the
  camera runs, so the choice is never half-applied.
- If the remembered camera is unplugged, the app falls back and clears the
  choice rather than failing the whole call.
- On Windows, make sure the camera is recognised first (Settings → Bluetooth &
  devices → Cameras), and check the site is allowed a camera (the padlock in the
  address bar → Site settings → Camera).

## The camera says “Recognition model not installed”

Copy `model.json`, `metadata.json` and `weights.bin` into `models/waste/`, then
reload. The app never substitutes random predictions. See
`docs/waste-model.md`.

## The camera opens but predictions are poor

- Train with the same lighting and backgrounds used at the exhibition.
- Include a real `Background` class with empty scenes, hands and the table.
- Increase the confidence threshold and the stable-frame count.
- One item is counted once; the camera stops after an accepted item. Press
  Start Camera again for the next one. A refused request leaves the camera
  running so the item can be removed and shown again.
- **Glass, metal, cloth, leather, footwear, thermocol and electronic waste
  light no bin LED.** The page says “Recycling agent” and asks you to contact
  the operator. That is deliberate, not a failed recognition.
- A **clear plastic bottle** can be read as glass (or vice versa). Use a
  coloured plastic bottle or a bag for the demo, and retrain with photos from
  the exhibition table if it happens on the real items.
- The camera identifies waste, not people, and does not prove deposition.

## Demo mode

Demo mode uses a separate simulator. Its commands can never reach the ESP32.
Two things say so: the gold pill in the top bar reads **Simulation** where the
live clock normally sits, and the side menu's source line says **Simulator**.

If the cards show moisture and a full tank while the probes are out of the
soil and the tank — that is the signature of Demo mode, not a broken sensor.
The simulator reports about 28 % soil and an available tank on purpose.
Press the **Simulation pill** in the top bar: it should change to **Live** with a
ticking clock, and only then does the page show what the board measured.

## Logs and data

- `data/logs/backend.log` — API, polls, sampler.
- `data/logs/whisper.log` — Whisper server.
- `data/village.db` — SQLite events, recognitions, settings, demo data.
- No raw microphone or camera recordings are stored by default.
