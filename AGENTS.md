# AGENTS.md — working notes for this repository

> **LOCAL ONLY — do not `git push`.** The user explicitly prefers local
> commits (2026-11-12) because a push to `origin/main` triggers a Cloudflare
> Pages build. Commit on the local `main` and leave it ahead of `origin`. Only
> push if the user asks for it in that turn. (`origin` is
> `git@github.com:syammohanvs/village.git`.)

Smart Green Village: ESP32 firmware (`uc/`), FastAPI backend
(`web/backend/`), React/Vite dashboard (`web/frontend/`), Whisper voice and a
local waste classifier. Keep the app running at <http://127.0.0.1:8010/>.

## Daily commands

```bash
./scripts/launch.sh        # build web/dist, start whisper + backend on :8010
./scripts/stop.sh          # stop only what launch.sh started
./scripts/test_all.sh      # firmware host tests + backend + frontend
```

Individual gates:

```bash
./scripts/test_firmware.sh
cd web/backend && /home/ubuntu/.venvs/aivillage/bin/python -m pytest -q tests
cd web/frontend && npm run typecheck && npx vitest run && npm run build
```

The current tree passes **438 firmware checks**, **32 backend tests** and
**83 frontend tests**. Always rebuild `web/dist` after frontend edits; the
backend serves it from disk.

## ESP32 firmware

> **ALWAYS FLASH AN OTA-CAPABLE IMAGE. This is a standing rule (2026-11-15).**
> Never write a firmware whose USB image has OTA compiled out, and always check
> the OTA port is answering after a flash. **The mistake it prevents, measured:**
> on 2026-11-14 the board was flashed, USB was then disconnected, and the board
> turned out to be running an image with **no OTA server** — `192.168.1.41:3232`
> refused six connections over 18 s while `:80` answered. There was no way in: no
> USB (the CP210x had gone from Windows) and no OTA. Nothing could be updated
> until a cable was produced. One minute of checking would have avoided it.
>
> - The **USB image** must have OTA compiled in — `VILLAGE_ENABLE_OTA` defaults
>   to 1 in `uc/include/village/build_config.h`; **do not set it to 0** in any
>   build flag, and check the image carries it:
>   `python3 -c "print(open('uc/.pio/build/esp32doit-devkit-v1/firmware.bin','rb').read().count(b'[ota] ready on'))"`
>   must print **1** (0 means that image can never be updated over Wi-Fi).
> - **OTA on this firmware is UDP on 3232, not TCP** — `ArduinoOTA.begin()` opens
>   `_udp_ota.begin(3232)` and only creates a TCP listener when an update arrives.
>   So **a TCP connect to 3232 is refused even on a perfectly healthy board**;
>   probing it that way and concluding "no OTA" is a wrong diagnosis that cost an
>   hour on 2026-11-15. The honest checks are the device's own report —
>   `GET /api/v1/health` → `ota: {started, port, password_set}` — and an actual
>   `espota` run.
> - **The working upload runs `espota.exe` on the Windows host** (the board must
>   be able to reach the uploader, and it cannot reach WSL's NAT address):
>   ```powershell
>   netsh advfirewall firewall add rule name="village-ota-3233" dir=in action=allow protocol=TCP localport=3233
>   cd %USERPROFILE%\village-flash
>   .\espota.exe -i <board-ip> -p 3232 -I 192.168.1.36 -P 3233 -a "<password>" -f ota-firmware.bin -r
>   ```
>   Verified end to end 2026-11-15: `Uploading: 100% Done`, board rebooted into the
>   new image. Build the image with `-e esp32doit-devkit-v1-ota`, copy it plus
>   `espota.exe` to that folder.
> - **Know which image is running, from the device itself — and read the right
>   endpoint.** `/api/v1/health` carries the `board`, `wifi`, `free_heap` and
>   `pin_map` blocks; **`/api/v1/status` does not, by design** (it stops after
>   `recent_events`). Checking `status` for `pin_map` and concluding "old image"
>   is a wrong diagnosis that cost an hour on 2026-11-15. Use `firmware` in
>   either payload for the version, and `health` for the pin map.
> - **`VILLAGE_OTA_PASSWORD` (16 chars in `secrets.h`) must be present**, or the
>   board refuses the upload even when the port is open.

### The SSID can carry trailing spaces, and Windows hides them (2026-11-15)

Moving the venue to a phone hotspot cost a session because **`netsh wlan show
profiles` and the Windows UI both trim trailing whitespace from an SSID**, while
the ESP32 does not. The hotspot's name is

```
'motorola edge 30_3782    '   len 25   (four trailing spaces)
```

The firmware was compiled with the 21-character version and the board answered
**`station mode failed (status 1: not found)`** while the laptop sat at 89%
signal — the board was looking for a network that does not exist. The only
reliable reading is the board's own scan, which now prints at boot:

```
[net] scan: 5 network(s) visible
[net]   'motorola edge 30_3782    ' (len 25) rssi -21 ch 1 enc 3
```

`enc 3` is WPA2-PSK. A phone hotspot that offers only **WPA3-Personal** cannot be
joined at all — switch it to WPA2-Personal first. Two more things learned the
hard way: `WiFi.scanNetworks()` **fails with -2 while a join is in progress**, so
the scan must run at boot before `WiFi.begin`, not in the failure path; and
`WiFi.mode(WIFI_AP)` **resets the station status**, so `WiFi.status()` must be
read before it or it answers 255 and says nothing.

The backend finds the board by sweeping the /24 of `VILLAGE_DEVICE_URL`, so point
that at any address on the current LAN (not the old one) and discovery follows
the board's DHCP lease.

### Build

```bash
cd uc
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1          # USB image
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1-ota      # OTA image
```

- `esp32doit-devkit-v1` builds the normal app image at
  `uc/.pio/build/esp32doit-devkit-v1/firmware.bin`.
- `esp32doit-devkit-v1-ota` builds `firmware.bin` for over-the-air upload.
- Flash use is ~67% of the app partition; builds take seconds.
- Run `pio` **inside `uc/`**; from the repo root it says "Not a PlatformIO
  project".

### USB (COM3 / /dev/ttyUSB*)

This is the normal route when the board is plugged into the machine running
the command:

```bash
cd uc
# Windows
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1 -t upload --upload-port COM3
# Linux
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1 -t upload --upload-port /dev/ttyUSB0
```

**This WSL container cannot see the board's USB port.** `COM3` belongs to the
Windows host; there is no `/dev/ttyUSB*` or `/dev/ttyACM*` here, and WSL does
not pass the USB device through. That is why the USB command above is the
standard procedure, not something this container can execute. Run it on the
Windows host (or attach the USB device to the Linux host) when USB flashing is
wanted. Do **not** report "the board is broken" because `/dev/ttyUSB*` is
missing — check where the cable is plugged in first.

### Wi-Fi / OTA (verified on this machine, 2026-11-12)

The board joins `ASIANET Giga Fiber`. **Its address is DHCP and it moves**: it
has been 192.168.1.8, then 192.168.1.6, and on **2026-11-13 it was
192.168.1.4**. The Windows host is **192.168.1.6**. Do not trust a remembered
address — on 2026-11-13 the board looked "offline" for 90 minutes because the
backend still pointed at `.6` while the board was answering at `.4` with the
same `boot_id` it had before. Find it before concluding anything:

```bash
TOKEN="$(grep -oP 'VILLAGE_DEVICE_TOKEN "\K[^"]+' uc/include/village/secrets.h)"
# 1. which hosts answer on :80.  The whole /24 is reachable through the WSL
#    NAT, and the router at 192.168.1.1 answers too, so this also proves
#    whether the LAN itself is silent.
python3 - <<'PY'
import socket, concurrent.futures
def probe(h):
    s = socket.socket(); s.settimeout(0.35)
    try:
        s.connect((h, 80)); return h
    except OSError:
        return None
    finally:
        s.close()
hosts = [f"192.168.1.{i}" for i in range(1, 255)]
with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
    print([h for h in pool.map(probe, hosts) if h])
PY
# 2. the host that answers the device API with this token IS the board
curl -s -H "X-Device-Token: $TOKEN" http://<ip>/api/v1/status | head -c 200
```

Then point `VILLAGE_DEVICE_URL` in `.env` at the address found and restart the
backend — it reads that variable once at start-up. A DHCP reservation for the
board's MAC on the router is the permanent fix.

The OTA password is `VILLAGE_OTA_PASSWORD` in
`uc/include/village/secrets.h` (git-ignored — never copy it into this file or a
commit).

**Why plain OTA from this container fails** (read this before retrying):

- This WSL container is behind NAT (`172.29.x`). The board can reach the
  Windows LAN (`192.168.1.x`), but it **cannot connect back to the container**
  to receive the image. `espota` authenticates, then reports
  `No response from device` — that is the callback, not the password.
- The Windows Wi-Fi profile is **Public** with inbound blocked. Even running
  `espota.exe` on Windows, the board's callback is dropped until an inbound
  rule exists for the host port.

**Working recipe** (run the upload from Windows, not from WSL):

1. Build the OTA image:
   ```bash
   cd uc
   /home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1-ota
   ```
2. Copy the image and `espota.exe` somewhere Windows can read (the WSL path
   works too, but a plain Windows folder is easier):
   ```bash
   cp uc/.pio/build/esp32doit-devkit-v1-ota/firmware.bin /mnt/c/Users/<you>/village-firmware.bin
   cp /home/ubuntu/.platformio/packages/framework-arduinoespressif32/tools/espota.exe /mnt/c/Users/<you>/espota.exe
   ```
3. One-time firewall rule (admin) for the callback port. Pick a fixed host
   port so the rule is narrow:
   ```powershell
   netsh advfirewall firewall add rule name="village-ota-3233" dir=in action=allow protocol=TCP localport=3233
   ```
4. From PowerShell/cmd on Windows, with the board's IP and the **Windows**
   host IP:
   ```powershell
   Set-Location C:\Users\<you>
   .\espota.exe -i <board-ip> -p 3232 -I 192.168.1.6 -P 3233 `
     -a "<VILLAGE_OTA_PASSWORD>" -f village-firmware.bin -r
   ```
   Expected output: `Authenticating...OK`, progress, `Result: OK`,
   `Success`.
5. The board reboots. Wait ~10 s, then verify (below).

The equivalent PlatformIO one-liner works from a host on the same LAN with the
firewall allowed:

```bash
cd uc
export VILLAGE_OTA_PASSWORD="$(sed -n 's/.*VILLAGE_OTA_PASSWORD "\(.*\)"/\1/p' include/village/secrets.h)"
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1-ota -t upload --upload-port <board-ip>
```

From WSL you can invoke Windows tools with `powershell.exe` / `cmd.exe`
(interop is enabled); that is how the verified upload was run without leaving
the session.

### Verify the board after flashing

The device API needs `X-Device-Token` (same value as `VILLAGE_DEVICE_TOKEN` in
`.env` / `secrets.h`). The state path is **`/api/v1/status`**, not `/state`:

```bash
TOKEN="$(grep -oP 'VILLAGE_DEVICE_TOKEN "\K[^"]+' uc/include/village/secrets.h)"
curl -s -H "X-Device-Token: $TOKEN" http://192.168.1.6/api/v1/status | python3 -m json.tool | head
curl -s -H "X-Device-Token: $TOKEN" http://192.168.1.6/api/v1/config | python3 -m json.tool | head
```

Through the backend (what the dashboard reads):

```bash
curl -s "http://127.0.0.1:8010/api/v1/state?mode=live" | python3 -m json.tool | head
```

Check `firmware`, `config_revision`, and
`status.sensors.light` (`raw`, `brightness`, `valid`, `age_ms`).

### Gotchas that cost time

- **Never `erase_flash` to prove which image is running — it wipes NVS.**  On
  2026-11-15 I erased the chip while chasing a false "the board is running an
  old image" diagnosis (the real answer was that `/api/v1/status` does not carry
  `pin_map`).  The erase threw away the soil and LDR calibration, the lamp
  flags and the config revision, and nothing could restore them: the backend
  logs only "Revision N acknowledged", not the values.  Read `firmware` from
  `/api/v1/health` or `/api/v1/status` instead; the only honest reason to erase
  is a genuinely corrupt flash, and even then say so before doing it.
- **A board with no OTA server cannot be updated remotely, and that is
  self-inflicted.** See the standing rule at the top of this section: build the
  USB image with OTA in it, and check port 3232 straight after flashing.
- **A reflash does not reset the stored config.** It lives in NVS and survives
  the update; `config_revision` stays the same. If a firmware default changed,
  save the config once from Setup (or reset the config) to apply it.
- **The board's IP is DHCP.** `192.168.1.6` is the usual address; confirm from
  the router or the backend's `VILLAGE_DEVICE_URL`.
- **The OTA callback is the hard part.** If `espota` says
  `Authenticating...OK` then `No response from device`, the board cannot reach
  the host: run the upload on the Windows LAN host, use `-I <windows-ip> -P
  <port>`, and add the inbound firewall rule. Do not keep retrying from WSL.
- **`VILLAGE_OTA_PASSWORD` is a secret.** Read it from `secrets.h`; do not
  print it in logs, commits, or this file.
- **Do not run `pio` from the repo root.** `cd uc` first.
- The backend's `device.py` uses `/api/v1/status` and `/api/v1/config`; the
  board does not implement `/api/v1/state` (the backend exposes that path to
  the browser). A bare `curl http://192.168.1.6/api/v1/state` returning
  `unknown endpoint` is expected, not a dead board.

## Bins are indicator LEDs only (2026-11-15)

There is **no waste-level sensing**, and there must not be: no time-of-flight
or ultrasonic rangefinder, no distance, no fill percentage, no "bin full"
alert.  A bin is something a person can see into; three LEDs (organic D21,
plastic D22, paper D23) say which category the camera last recognised.

- Firmware 0.2.0 removed `bins.h`/`tof.h`, `BinState`, `BinConfig`/`BinModel`
  and the VL53L0X dependency.  `/api/v1/status` has no `sensors.bins`, no
  `BIN_*` events and no bin faults; `/api/v1/config` has no `bins` section.
- GPIO **4, 16, 17, 18, 26** are free again and listed in `pins.h` as
  `kFreePins` (a `static_assert` fails if one is also assigned).  11 pins are
  assigned; the pin map is `1.6.0-30pin`.
- The backend records no bin state and raises no bin alert; the dashboard,
  the Sensors page and Sara's narration no longer mention fill.
- Settings now live in NVS as **JSON** (0.2.1), not as a raw `DeviceConfig`
  dump.  The dump was tied to `sizeof(DeviceConfig)`, so adding the solar block
  (2026-11-13) and removing the bin settings (2026-11-15) each made the stored
  bytes unreadable and the next boot silently replaced every calibration with
  defaults.  JSON is self-describing: a missing key keeps its default, so a
  field may come or go without losing the rest.  `revision` is stored beside
  the settings (not inside them) so the optimistic-concurrency check survives a
  reboot.
- If a boot finds no stored configuration it adds a **`CONFIG_DEFAULTS`** event
  ("No saved configuration was found, so defaults are in use…").  A board that
  comes up uncalibrated now says so on the dashboard instead of looking like a
  dead sensor.
- A sensor that is deliberately **not fitted** is not a fault: the light fault
  line only appears when `light.sensor_fitted` is true.

## LDR calibration (this build)

The LM393 module was **replaced by a bare LDR and one pull-up resistor**
(2026-11-15) — the same change the soil probe had.  Wiring:
`3V3 -> resistor -> GPIO 32 -> LDR -> GND`, so the reading **falls** with
light:

- `output_type = analog`, `analog_bright_high = false`
- the pull-up value is not critical (4.7–47 kΩ); this build measures **raw
  800–890 in a lit room**, i.e. a brightness metric of **3200–3300**
  (`metric = 4095 − raw`)
- thresholds are on the **metric**, not the raw: `dark_threshold = 1800`
  (raw ≥ 2295) and `bright_threshold = 2800` (raw ≤ 1295), `stable_ms = 4000`
  — 1800 is measured here: a hand over the LDR reaches raw ~2560 (metric
  ~1536), which the earlier 1500 line missed by 36 counts, so covering the
  sensor did nothing until it was lowered (2026-11-15)
- `light.sensor_fitted = true` must be saved or the board reports no brightness
  at all (by design: a floating pin reads plausible noise); `light.installed`
  is the **separate** fact that the five streetlight lamps are wired
- on this build both are now **true** (set 2026-11-15), so Auto drives D13 and
  the "lights not installed" event is gone; soil calibration is still pending

Opposite wiring (LDR to 3.3 V, resistor to GND) needs
`analog_bright_high = true`. See `docs/wiring.md` § "LDR (light sensor)".

**A chip tone is not a style.** `ChipTone` included `live` but `styles.css` had
no `.chip--live`, so every "Live"/"Available"/"Model ready" pill rendered as the
base grey chip while saying the opposite.  `web/frontend/src/components/
chipTones.test.ts` now reads the stylesheet (a CSS import is stubbed under
vitest, so `?raw` asserts nothing) and fails when a tone has no rule.  The same
round also made the solar pill say **Generating** in green only when current
actually flows, and **Not generating** in neutral when the panel reads volts but
no current — a red LED needs ~1.8 V before it conducts, so a dark panel honestly
reads 0 mA.

## Solar panel, measured (2026-11-15)

Panel voltage on **VN (GPIO 39)**, LED junction on **VP (GPIO 36)**, 330 Ω in
series with a red LED, `sense_ohms = 330`. Dark: both taps 142 mV, 0 mA.
Phone torch on the panel for 10 s:

| panel | junction | drop | current | power |
| ---: | ---: | ---: | ---: | ---: |
| 2019 mV | 1827 mV | 192 mV | 0.58 mA | 1.17 mW |

- The junction stopping at **~1.83 V** (red LED Vf) while the panel varied is
  the check that the LED is in the load path and the polarity is right; a
  reversed/open LED makes the junction follow the panel.  **The LED visibly lit
  at 0.58 mA** — dim, but clearly on — which is the human confirmation of the
  same fact.
- The current is small because the cell only reached **2.0 V** under a phone
  torch — `I = (Vpanel − Vf)/330`. The 4.5 mA / 15 mW in the wiring doc is the
  **3.3 V** case, not this one.
- `solar.installed` is now true (it gates nothing in the app; the card reads the
  numbers regardless).
- **Board off, panel lit, verified on the bench (2026-11-15):** USB unplugged
  with a torch on the panel, the LED glowed and the board stayed off — no
  phantom boot, and it came back normally when USB was reconnected.  The 10 kΩ
  taps limit the clamp current to ~0.26 mA each, which is why.

## Voice commands (natural language, 2026-11-15)

Sara understands phrasing, not just exact commands, without any **additional**
language model or cloud call.  Whisper is the only model and it only transcribes;
the meaning is decided by fixed rules.  The pipeline has four separate steps:

1. **transcription** — the browser records a WAV and posts it to
   `POST /api/v1/voice/transcribe`; the local whisper.cpp server returns text.
2. **parsing** — `web/backend/app/intents.py` (`IntentMatcher`) decides what the
   sentence *means*.  Typed text uses the same parser through
   `POST /api/v1/voice/interpret`, so the two paths cannot disagree.
3. **validation/execution** — the panel sends the command through
   `/api/v1/commands` with a **stable request id per utterance**; the firmware's
   command history answers DUPLICATE for a repeated id, so a double event cannot
   move anything twice.  All firmware gates (soil, low water, pump limits, kill
   switch) still apply — speech has no bypass.
4. **response** — pending / done / already / blocked wording from
   `shared/intents.json`; a reply is only "done" after the controller acks.

### The parser is a small grammar, not a phrase list

`shared/intents.json` holds the data: languages, **device aliases**, **on/off/
auto words**, politeness and question markers, negation and correction markers,
the reply wording, and per-intent example phrases (also used by the help list).
`intents.py` applies, in this order:

1. silence → NO_SPEECH;
2. hypothetical/conditional ("what happens if…", "should I…", "can I…") → no action;
3. explicit correction ("actually", "I mean", "rather", "instead") → ambiguous;
4. negation (English before the verb; Malayalam/Hindi anywhere, because they
   negate after it) → NEGATED, nothing sent;
5. two different states ("on… no, off", "on and off") → ambiguous (a question
   like "are the lights on or off?" is a status query instead);
6. one device (more than one → ambiguous); pronouns with no device → ask which;
7. question or status word → the device's status intent, never an action.  A
   polite request is a command, not a question: "Can you turn off the
   streetlights?" and "…ചെയ്യാമോ?" / "…कर सकते हैं?" execute, while "can I /
   should I…" is advice and does not;
8. copula with no imperative ("the lights are off") → statement, never an action;
9. exactly one device + one state → the command in `device_commands`;
10. otherwise fall back to whole-phrase catalogue matching (this is what keeps
    the hand-written Malayalam/Hindi phrases working), then UNKNOWN.

**Every language refuses a sentence with an unaccounted content word**
(`_unaccounted`), so "turn off the lights and open the gate", "വിളക്കുകൾ
അണയ്ക്കുക ഗേറ്റ് തുറക്കുക" and "लाइट बंद करो और गेट खोलो" all send nothing
instead of half of it.  The known-word set is per language, so an unfamiliar
inflected form is refused rather than guessed.

### Replies and exact wording

- unrecognised: “Please ask me to control a supported device or check its status.
  For other help, contact Gram Sahayak.”
- bin fullness: “Our model does not measure bin fullness. The three bins have
  indicator LEDs only.” — never a number, because nothing measures it.
- ambiguous between on and off: “Would you like the lights on or off?”
- statement / hypothetical / negation / disconnected / unconfirmed: in
  `shared/intents.json` under `messages`, translated for all three languages.
- a matched command carries `pending_text`, `done_text` and `already_text`; the
  panel says “already off” **without sending** only when the frame is connected,
  not stale and younger than 5 s.  A cached/stale frame never skips an action.
- one utterance carries one id: the recording's start for speech, the current
  typed text until the box clears for typing.  A retry of that utterance reuses
  it (the controller answers DUPLICATE); a later deliberate repetition is a new
  id and does run.

The parser returns `confidence` as 0.0 or 1.0 only, and the UI no longer shows a
percentage: this is a deterministic allowlist, not a model, and a percentage
would invent a probability.

### Known limits (state them, do not hide them)

- No conversation memory: “it”, “that”, “do the same” ask you to name the device.
- No arbitrary devices: only lights, pump/watering, and the status surfaces.
- The lexicon is conservative; a new synonym that is not in the JSON is treated
  as unsupported rather than guessed.
- Whisper transcription errors are the dominant failure mode in a noisy room;
  the parser cannot recover a word it never received.
- Malayalam/Hindi question detection uses the words (Hindi "क्या" is a word, not
  a suffix); Malayalam verbs can also carry the question suffix, so both are
  checked.  Negation is read by meaning, not by removing words.
- Free-form conversation, questions about the app in general and multi-step
  instructions are out of scope (Help and Sara's topics cover those).

### Adding a phrase or a device

- A new way to say an existing command: one line in that intent's `phrases`, and
  (for the structural path) the word in `devices` / `states`.
- A new device: its aliases in `devices`, a row in `device_commands`, and intents
  with labels/phrases for any actions. No Python change unless the sentence
  shape is new.

### Tests

```bash
cd web/backend && python -m pytest -q tests/test_intents.py   # 19 parser tests
cd web/frontend && npx vitest run src/components/VoicePanel.test.tsx
```

The parser tests are hardware-free; the panel tests mock the API and cover the
typed path, duplicate submission, already-off, disconnected, unconfirmed and a
rejected pump.  The live check is `POST /api/v1/voice/interpret` on the running
app (it needs no microphone), plus one real spoken sentence through Whisper.

## Soil moisture polarity

The soil probe is read as an analogue value on GPIO 34 (D34).  A bare
two-prong probe with a 10 kΩ resistor divider works directly — no LM393
module needed (its digital output was never used).

`SoilConfig` gained `rises_with_moisture` (default **false**, matching the
pull-up wiring: resistor to 3.3 V, probe to GND, raw falls with moisture).
When false, the firmware inverts the raw reading (`4095 - raw`) before
mapping, so calibration endpoints recorded with the opposite wiring still
work.  When true, no inversion is applied.

- `soilPercent()` applies the inversion via the flag.
- The Setup page has a **"The reading rises with moisture"** checkbox
  (ticking it sets the flag true; changing it clears the calibration).
- The simulator mirrors the flag and keeps its raw values inverted.
- `docs/wiring.md` and `docs/calibration.md` document both wirings.

If the soil reading is backwards, flip the checkbox in Setup → Sensors &
Calibration.  The calibration endpoints themselves are preserved.

## Waste classifier

`models/waste/` is git-ignored. It holds the 11-class model trained in
`scripts/waste/`; the recycler classes (glass, metal, textile, leather,
footwear, thermocol, e-waste) all map to **Recycling agent** in the UI with no
bin LED. Medical waste is handled by the manual **Hazardous / medical** button,
not a model class. See `docs/waste-model.md` and `scripts/waste/README.md`.

The current install (2026-11-13, **V12**) was retrained after brown paper,
bottle caps, ball pens, a **car key read as Leather**, a **handkerchief that
never resolved**, a **business card read as Thermocol** and **folded paper** were
misread.
`build_waste_dataset.mjs` assembles the training tree from the bootstrap,
TrashNet's unused `cardboard` folder and Commons photos of caps, pens, paper
bags, foam, key fobs, keys, phones, watches, wallets and sunglasses; the
install repeated the **key-fob photos 6x** and left the phone/watch extras out
of its Ewaste tree (they pulled paper into e-waste). On the same 953 photos
V3 scores **85.6%**, V6 **85.1%**, V8 **86.7%** and V12 **90.9%**; item-level
action accuracy is **89.4% → 90.6% → 91.4% → 94.0%** (bin 91.8% → 87.4% → 86.0%
→ 90.6%, recycler 87.5% → 93.1% → 95.8% → 96.7%) and the 236-photo real-world
probe is **62.3% → 64.8% → 64.0% → 62.7%**. V8 added 20 handkerchief photos to
Textile; V9 added 20 business-card photos to Paper; V12 added 20 more handkerchief
and 20 more business-card photos plus 20 pin photos to Metal. The held-out
results are mixed: handkerchief **4/8 → 1/8 → 1/8 → 3/8**, business card **14/25 →
25/25 → 3/5 → 5/5**, car key **8/8 recycler in every build since V6**, pins
**3/8 Metal**. The pattern is the ceiling of this approach: adding photos of one
object dilutes another, and no single build is best on all three. **V8 is kept
as the backup for handkerchief accuracy; V9 is the best probe build.** The
installed V12 is the best general build (94.0% item action) and fixes business
cards and folded paper, at the cost of two handkerchief photos.
Backups: `models/waste-v8-20261113/`, `models/waste-v6-20261113/` (best probe)
and `models/waste-v3-20261113/` (best bin accuracy); restoring one is copying
four files. `evaluate_waste_model.mjs` reproduces the comparison and
`predict_waste_image.mjs` shows the top classes for one photo.

**The classifier is ResNet50 on the backend now (2026-11-13), not MobileNetV1
in the browser.** Measured on the same 953 held-out photos it is **91.5% exact,
95.5% item action, 91.8% bin, 98.5% recycler and 71.6% on the 236-photo probe**,
against 86.7 / 91.4 / 86.0 / 95.8 / 64.0 for the last MobileNetV1 build. It fixes
the **business card** (25/25, was 14/25) and improves **pins** (4/8, was 3/8); the
handkerchief is the one regression (1/8 against 4/8) and stays hard. The model is
`models/waste-resnet50/model.pt` (~95 MB, git-ignored), loaded by
`web/backend/app/waste_resnet.py` and served by **`POST /api/v1/waste/classify`**
(about 50-85 ms per frame on this CPU, no internet). The browser sends the 224x224
crop as a JPEG data URL; `SortWaste.tsx` no longer imports TensorFlow, and
`@teachablemachine/image` + `@tensorflow/tfjs` were removed from package.json.
Reproduce with `scripts/waste/train_resnet50.py` then `export_resnet50.py`.

**The venue case is an item held in a hand, not an item on a table
(2026-11-13).** The user said so explicitly, and the numbers agreed: on 528
hand-held composites the old checkpoint scored **26.3% item action**, and **252
of 528 frames were read as "Background"** — "not a waste item" while somebody
held one up. The fix is training data, not architecture:
`scripts/waste/make_handheld_set.py` cuts each training object out (u2netp,
offline, **training only**) and composites it into a room photo with a drawn
arm and hand — 15 skin tones, random angle, fingers over the object, optional
sleeve, random scale/rotation/position, plus hand-only negatives.
`train_handheld_head.py` does 30 archive epochs then 18 more on archive +
composites at a small learning rate. Measured through the backend's own HTTP
route: hand-held **26.3% → 63.6%** item action, real probe **74.3% → 76.3%**,
withheld archive **91.1% → 90.5%** (all at JPEG quality 0.85).

**The browser's JPEG quality was worth more than the model** (2026-11-13): the
camera sends `toDataURL('image/jpeg', q)` and q 0.85 cost 4-5 points against
0.92 on every set (hand-held 63.6 → **67.6**, probe 76.3 → **77.6**, archive
90.5 → **91.7**); q 1.00 is no better than 0.92. `SortWaste.tsx` now sends
**0.92** and a component test pins it, so a future payload tidy-up cannot give
the accuracy back. The backend's resize filter is now `BILINEAR` like the
trainer's (it was `LANCZOS`; identical scores, but no train/serve skew). The previous checkpoint is at
`models/waste-resnet50-backup-v13/model.pt`. **The hands are drawn, not
photographed** — ten real photos of a person holding an item are still the
measurement that counts, and `scripts/waste/hand_eval.py` scores whatever model
the backend is serving.

**A confident wrong answer is fixed with photographs, not with a rule**
(2026-11-13, the user's choice). A handkerchief read as Plastic 0.75 lit the
plastic bin, so a higher bar for bins was measured and **rejected**: 0.80 for the
hand-held path gains 1.3 points but diverts 35 of 528 correct bin items, and on
clean table photos the same bar costs 9.7. Routing is unchanged. The ceramic tea
cup (read Thermocol 0.95) is also left alone — ceramic is not one of the 11
classes and its *action*, hand it to the agent, was already right.

The path for a misread is one command now: photos in
`data/waste-samples/<Class>/` (the class the item **actually** is), then
`train_handheld_head.py --extra-train data/waste-samples`. New photos go into
**training only**, so the withheld set and the probe stay an honest measurement;
an unreadable file is skipped and named. Then export, restart, re-check with
`hand_eval.py`.

**A whole datum can be missing, not just under-represented** (2026-11-15, the
book). A book was refused at Paper 0.66 (four points under the bar) and accepted
at 0.79 on a second, better-lit look. The corpus held **no book at all** — 0 of
24,569 archive views, 0 of 141 Paper composites — and no newspaper or notepad
either; Paper was packaging (bags, brochures, cards, flyers, tissue, cardboard).
Seven venue frames plus 49 curated Commons photos went into
`data/waste-samples/Paper/`, and the served model moved to **71.0% exact / 78.8%
item action** on the 241-photo probe (was 68.5 / 77.6) with every probe class
equal or better. Two things to keep: **135 Commons photos were fetched and 86
discarded** — "newspaper" returns newspaper *offices* and vending boxes,
"notepad" returns Windows Notepad screenshots, "paperback book" returns scans of
typography-specimen grids, and a letter-grid would teach a shortcut that collides
with circuit boards, so a fetched photo is looked at before it is trusted; and
**the trainer's hand-held figure runs ~9 points above `hand_eval.py`'s** (53.6
in-process vs 45.7 over HTTP) because q0.92 JPEG hits a 224-px composite at the
exact resolution the model reads — that gap predates this build (52.9 vs 43.6),
so compare in-process with in-process and live with live. Checkpoint before this
change: `models/waste-resnet50-backup-v14/`.

**The frame can be the whole fault, and more photos of the object will not fix
it** (2026-11-15, the scrunchie). A cloth scrunchie was read Thermocol **0.89**
and accepted. The five saved frames are a child's face, a hand and a blown-out
window with the scrunchie a fifth of the picture — and `SortWaste.tsx` already
says this is a limit it cannot detect ("the person is the change and they are in
the middle"). Cropped to the item alone the same frame gives a **different**
answer: Leather 0.50, Paper 0.14, Plastic 0.13, Textile 0.09. So the confident
Thermocol was the room; and the item was not Textile either, because Textile held
only flat white cloth — 40 handkerchiefs, 30 napkins, 15 white cotton — with no
patterned or bunched fabric at all. **Growing Textile 88 → 131 (10 scrunchie /
hair-tie photos + 33 printed/knitted fabric, curated out of 160 fetched — 117
discarded: athletes, buildings, fossils, a man in a suit, bow ties, printing
blocks, looms, a bat, a tunnel) cost the probe 71.0 → 68.5 exact with Plastic
−3**, and moved the scrunchie frames not at all (Thermocol 0.72–0.89 →
0.65–0.85). It was **rejected and reverted** — model and samples tree back to
v15/88. The lesson worth keeping: **before adding photos, check what the
classifier was actually shown.** A scene crop makes the data irrelevant, and an
item-only crop upscaled from ~100 px is mush. What works is a clean photo of the
item filling the guide square with nobody behind it, and (offered, not built) a
guard that declines when the changed region covers most of the frame.

**Follow-up the same day: the not-sure line no longer names a material.** The
venue reported "still thermocol" three times while the press had chosen **no**
bin (Thermocol 0.59/0.59/0.40, mean 0.53 — under the 0.70 bar); what was being
read was the live preview line *"Best guess Thermocol at 59%"*. That is now
*"Not sure what this is — hold one item on its own, filling the square, and keep
still."* — no material, because the near-guess is a property of the crop, not of
the item. The same frame cropped to the scrunchie alone reads **Textile 0.35**
(0.39 tighter); grouped the way the app decides a referral, the seven recycler
materials sum to **0.64**, above the **0.50** referral bar, so **it is accepted
as Textile**. Same frame, same model, two crops: cloth or Thermocol 0.74. A bin
is held to 0.70 but a *referral* to 0.50, which is why a 0.35 top class is still
a decided answer. **The crop is the fix, not the model.**

**A class can be a junk drawer, and Thermocol was one** (2026-11-15). A frosted
plastic box read **Thermocol 0.95**, a scrunchie 0.74, corrugated card 0.45. The
class held 218 files but only **112 unique** (106 exact duplicates — a silent 2×
weight) and only ~**25 were thermocol**: the rest were **food photographs** (the
foam trays were shot *containing* curry, noodles, roast meat, coffee), **street
scenes and landscapes** (roads, rivers, rooftops, corridors, a bridge), **people**
(crowds, festivals, athletes), plus a circuit board, a laptop, an AMD chip, docs
and a truck. It had learned "a plate" and "a place", so anything pale or
scene-like came back Thermocol. Cleaned 218 → **25** genuine, composites rebuilt
150 → 96 from the clean 25, val deduplicated, and **50 curated foam photos**
added (out of 198 fetched: the searches return chemical diagrams, buildings,
tomatoes, a fire extinguisher). Live on the same 241-photo probe: exact **71.0 →
72.2%**, item action **78.8 → 80.5%**, Thermocol recall unchanged at **15/27**;
the box went 0.95 → 0.36 and the scrunchie 0.74 → 0.20. **Do not delete the junk
without replacing the photos** — an intermediate build at 25 photos dropped
Thermocol recall to 7/27 and the probe to 75.9%; that build was rejected. The
hand-held figure is no longer like-for-like (that set lost its junk composites:
129 photos, not 140).


**The room is learned, so it cannot be classified as an item** (2026-11-14).
Reported from the venue: *"Sara classified the background as textile and ignored
the key fob held in hand."* With no stored backdrop the page had no reference,
so it classified the wall. `web/frontend/src/lib/sceneMemory.ts` keeps a
slowly-updated average of the frame as the reference: the first ~8 frames are
the room (nothing is classified, the page says so), a door or a lamp drifts in,
the memory **freezes while an item is shown** so a held item is not absorbed,
and a moved camera relearns instead of classifying the blur. The crop and the
paint-out are the existing measured subtraction path — the learned room is just
a background that maintains itself.

**A skin-colour "is a hand present?" gate was measured and rejected first**: it
fired on **46 of 60** hand-free product photos, so it would not have stopped the
room. Do not re-add a skin gate without new evidence.

The empty table is still available as an **optional aid** (**Set background**)
for a fixed booth; the copy no longer tells the operator to clear a table they
do not have.

The Sort Waste camera can still **focus on a fixed table and paint it out**:
`web/frontend/src/lib/focus.ts` diffs each frame against **up to three**
empty-scene snapshots (`diffBoxMulti`), crops the changed box, and then
`objectMask` replaces every pixel **inside that crop that still matches the
stored empty scene** with a plain white plate — the same picture a cutout site
produces, by subtraction instead of by a model. `SortWaste.tsx` exposes **Set
background / Add background**, **Clear backgrounds** and **Focus on the
object**, and `lib/backgroundStore.ts` keeps the snapshots in `localStorage` so
they survive a reload until cleared. An unchanged scene is reported as “Not a
waste item” without asking the model. After a confirmed item the camera **stays
on**: removing the item re-arms the stabilizer and the next item is classified
without pressing Start Camera. The geometry has **21** unit tests (weighted-middle
crop, the edge-touch hand warning, and the four ways the mask can go wrong),
storage 5, and the controls/re-arming/the drawing order are component tested;
the live camera path is not exercised in this container (no webcam), so confirm
it in a browser at the exhibition/home table.

**An AI background remover was measured and rejected — do not re-add one
without new evidence.** On 222 scenes (a real object photo pasted onto a real
room photo) item-level action accuracy is **8.6%** whole frame, **32.9%** with
the crop alone, **52.7%** with a subject-cutout model (`u2net`) inside the crop,
and **about 60%** with the stored-scene subtraction. Run on the whole frame the
cutout keeps the largest salient object — the **furniture** — and deleted the
item in the test scenes; on the eight car-key photos it made the black plastic
shell semi-transparent (`u2netp`) or left holes (`u2net`), and it costs
4.4–168 MB plus 0.26–0.51 s per photo against a few milliseconds for the
subtraction. The subtraction also cannot make the picture emptier than the crop
already was: a moved camera makes everything differ (whole crop kept) and a mask
keeping under 2% is refused, both falling back to the plain crop.

The confidence is **action-level**: `lib/wasteActions.ts` adds the seven
recycler probabilities, so Ewaste 45% + Metal 35% is accepted as 80% recycling
and named by the stronger material. A bin still has to win on its own. This is
what stops a car-key fob split between Ewaste and Metal sitting on “not sure”.
