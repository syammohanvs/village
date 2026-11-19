# Our AI-Powered Smart Green Village

A child's school exhibition project for **Tuesday, 10 November 2026**. A 30-pin
ESP32 runs the physical village; a laptop provides the dashboard, local speech
recognition and local image recognition. After setup it runs entirely offline
and uses no paid API.

## Current status

| Part | State |
| --- | --- |
| Git, structure, protocol, 30-pin GPIO map | **done** |
| Firmware safety core + host tests | **433 checks, 0 failed** |
| ESP32 board | **flashed 2026-11-08; on home Wi-Fi at 192.168.1.8** |
| Wireless firmware updates (OTA) | **verified 2026-11-08 from the Windows host** |
| LDR sensor + auto streetlights | **verified 2026-11-08 (LM393 module, GPIO 32)** |
| ESP32 firmware image for `esp32doit-devkit-v1` | **builds successfully** |
| FastAPI backend, SQLite, simulator, demo isolation | **done; 17 tests pass** |
| Whisper.cpp + multilingual `ggml-base.bin` | **built and running on 8181** |
| Dashboard (React/Vite, charcoal/burgundy/gold) | **built and served; 37 tests pass** |
| Sara guide (welcome, tours, live narration, 3 languages) | **done; verified in Chromium 16/16** |
| Cloudflare deploy | **Worker + static assets, repo `village`, branch `main`** |
| Hardware wiring | **streetlights, LDR and reservoir probes working; soil bench-only; bins and pump not wired** |
| Reservoir probes | **verified 2026-11-08 (well water; 2300 / 2800 mV thresholds)** |
| Waste model (ResNet50, offline fallback) | **installed (v18); 74.7% exact / 82.6% item action on the 241-photo probe, 14/18 on the booth's own first crops (labels machine-made, not human-verified)** |

The exhibition can run today in **simulator** mode with no hardware. The
physical part needs the commissioning checks below.

The board itself is programmed and reachable: it joins the home Wi-Fi in
station mode (so the laptop keeps its internet) and `/api/v1/state?mode=live`
reports `source.kind: "esp32"`. The four streetlight lamps and the LDR module
are wired and working, including automatic lamps in the dark. The soil probe is
connected but calibrated only against wheat flour so far, so treat its
percentage as a bench check until it is redone in real soil. The reservoir
probes, bin rangefinders and pump are not wired yet; the pump stays disabled by
both safety gates.

## Quick start

```bash
./scripts/setup.sh          # first time only
./scripts/download_models.sh
./scripts/launch.sh
```

Open the URL printed by the launcher, normally:

**http://127.0.0.1:8010/**

Port 8000 may be used by another project on this laptop; the launcher refuses
to kill anything it did not start and uses `VILLAGE_PORT` from `.env`.

Stop only this project:

```bash
./scripts/stop.sh
```

## What the demonstration does

- **Dashboard** — soil moisture, reservoir availability, pump state and reason,
  streetlights, three bins, connection health, AI readiness, recent activity.
- **“What the village is doing and why”** — the controller's own reason text,
  e.g. “Soil is dry and water is available. Watering for a short pulse.” or
  “Irrigation blocked: reservoir water is low.”
- **Irrigation** — short pulses, soak intervals, a fresh moisture check,
  cumulative runtime and pulse limits, a no-rise lockout, and immediate Stop.
  It requires valid calibrated soil, dry soil and available water, and the
  pump has a separate commissioning gate.
- **Streetlights** — Auto (LDR with hysteresis and a stable delay), Manual On
  and Manual Off. Stale sensor → Auto stays off and says why.
- **Three bins** — three **VL53L0X time-of-flight laser rangefinders** on one
  I²C bus, read in turn, with estimation and confirmation and a loud
  **unavailable** when a module does not answer (never “empty”).
- **Voice** — push-to-talk, English/Malayalam/Hindi, local Whisper, deterministic
  command allowlist. Negated, ambiguous and unsupported phrases never actuate.
- **Sort Waste** — one item placed on the marked base, one press of **Check the
  item**. A hosted vision model names the item (Cloudflare
  `@cf/meta/llama-3.2-11b-vision-instruct` on two accounts, then DeepSeek
  `deepseek-v4.1-flash` as the last resort), and small rules turn that name into
  a route: organic, plastic and paper light the matching bin LED; everything
  else (glass, metal, cloth, leather, footwear, thermocol, pencils, electronics
  and anything uncertain) says **keep it separate and contact the Gram Sahayak
  office for further sorting, collection and recycling instructions** and lights
  no bin. Batteries, sharps and chemicals get their own special-handling
  sentence instead. A local ResNet50 runs on
  every press as the **offline fallback** — it decides only when no name comes
  back, and every named press saves its crop for a future retrain (saved, not
  learned: the weights change only when the model is retrained and redeployed).
  A check starts by **clearing the previous item's lamp** (`CLEAR_WASTE`, so the
  old indication cannot outlive its answer), and an empty base answers "nothing
  to sort" rather than guessing. Nothing is measured about bin fullness; the LEDs
  are indicators only, and their selection has been verified on the board.
- **Demo mode** — clearly labelled simulated data and simulated commands. It
  cannot reach real hardware; demo events are stored separately.
- **What Happened** — one timeline of actions and reasons; raw codes, filters
  and CSV export live under Advanced details.
- **Navigation** — four pages (Our Village, Sort Waste, What Happened, About &
  Help), a smaller Setup link, and one Talk to Sara entry. Old addresses
  (`/sensors`, `/controls`, `/settings`, `/villagers`) redirect.

## Architecture

```
browser (React/Vite) ──HTTP──▶ FastAPI (laptop) ──HTTP──▶ ESP32 (LAN)
        │                          │
        ├─ camera + mic            └── whisper.cpp (localhost)
        └─ TensorFlow.js model
```

- `uc/` — PlatformIO Arduino firmware. Portable safety core in
  `uc/include/village/core/`; host tests in `uc/test/`.
- `web/frontend/` — React 19 + TypeScript + Vite.
- `web/backend/` — FastAPI + SQLite + simulator + Whisper proxy.
- `shared/` — protocol, multilingual phrase dictionary, JSON examples.
- `docs/` — wiring, installation, calibration, operation, Sara guide,
  Cloudflare deployment, troubleshooting, waste model, bench test.
- `scripts/` — setup, download, launch, stop, dev, tests; `scripts/waste/`
  trains and installs the waste classifier.

**Cloudflare builds only `web/frontend`.** The firmware (`uc/`) and the
Python backend (`web/backend/`) sit outside that root, so a firmware commit
cannot affect the site build. A push to `main` triggers the build; see
[docs/deployment-cloudflare.md](docs/deployment-cloudflare.md).

## Board and wiring

The purchased board is the **30-pin NodeMCU-style ESP32-WROOM-32 DevKit V1**
(4 MB flash, AMS1117, micro-USB). The pin map uses GPIO numbers only:
soil **34**, reservoir sense **35** / excite **25**, LDR **32**, solar panel
**33** / current sense **36**, pump gate **19**, streetlights **13**, waste LEDs
**21/22/23**, and the bin rangefinders on an I²C bus — SDA **4**, SCL **16**,
XSHUT **17/18/26**. All analogue inputs are **ADC1** because Wi-Fi is active.
Flash pins, input-only misuse, strapping pins and UART0 are avoided; the
firmware has `static_assert` checks. See [docs/wiring.md](docs/wiring.md) for
the power branch, MOSFET/flyback requirements, the ToF bus and address
sequence, probe circuit and the unidentified driver-component warning.

## Tests run locally

```bash
./scripts/test_firmware.sh      # 438 checks + PlatformIO build
cd web/backend && .venv/bin/python -m pytest -q   # or VILLAGE_VENV
cd web/frontend && npm run typecheck && npm test && npm run build
```

- Firmware core: **438 checks, 0 failed** (irrigation safeguards, stop,
  duplicate commands, stale sensors, calibration polarity, LDR hysteresis,
  bin echo loss, persisted command ids).
- ESP32 build: **SUCCESS** for `esp32doit-devkit-v1`.
- Backend: **31 passed** (demo isolation, ack-not-assumed, retries with the same
  command id, stale/disconnected, config validation, waste/full-bin, voice
  rejection, settings).
- Frontend: typecheck clean, **81 tests in 9 files**, production build succeeded.
- Browser walk: **7/7 routes render, 0 console errors**; Demo toggle, demo
  scenario, confirmed Start, Lights Off and the 10-phrase voice panel were
  driven in Chromium against the running server.
- Whisper: `GET /health` → `{"status":"ok"}` with the multilingual model loaded.
- Waste classifier: **74.7% exact / 82.6% item action on the 241-photo probe**
  (v18 ResNet50, the offline fallback), and **14/18** on the exhibit's own first
  crops — a figure whose labels are the hosted model's names, not human-verified.
  See [docs/waste-approach.md](docs/waste-approach.md) for what each set means.
- Hardware: streetlights, LDR, reservoir probes and the pump driver have been
  exercised; the bench checklist in [docs/bench-test.md](docs/bench-test.md)
  remains the gate for soil and the bin rangefinders.

## Models you must supply

1. **Whisper** — a multilingual ggml model, selected by
   `VILLAGE_WHISPER_MODEL`. `scripts/download_models.sh` fetches
   `ggml-base.bin` (142 MB) and verifies its SHA-256
   `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`;
   this deployment runs `ggml-base.bin` (142 MB) for the fastest reply.
   `ggml-small.bin` (~466 MB) and `ggml-large-v3-turbo.bin` (~1.6 GB) are also
   installed: small answers in ~3 s, turbo gives the most accurate transcript
   at ~22 s per command on this CPU. English-only `*.en.bin` files are
   refused.
2. **Whisper server** — build `whisper-server` (instructions in
   [docs/installation.md](docs/installation.md)) or set
   `VILLAGE_WHISPER_BIN` in `.env`.
3. **Waste classifier** — already installed from a local training run
   (`models/waste-resnet50/model.pt`, git-ignored like the other model files).
   It is **ResNet50** with a frozen backbone and a small head; it scores
   **74.7 % exact class** and **82.6 % right action** on the 241-photo probe,
   and **14/18** on the exhibit's own first crops (labels machine-made). It runs
   on this laptop's CPU as the **offline fallback** — the category normally
   comes from a hosted vision model's name. Retrain it with photos of the
   exhibit's own items using [`scripts/waste/`](scripts/waste/README.md); see
   [docs/waste-approach.md](docs/waste-approach.md) and
   [docs/waste-model.md](docs/waste-model.md). The app reports the model as
   missing rather than inventing predictions.

## Honest data rules

The app never displays a tank percentage, litres, capacity, household water
use, pressure, flow, battery charge, wind energy or energy savings. The reservoir
has two wire probes at one minimum level; the bins carry indicator LEDs only and
nothing measures how full they are; soil moisture is a calibrated relative
value. The solar panel is a real one (volts, milliamps, milliwatts), and so is
the wind circuit's power — `generator → blue LED → 47 Ω resistor`, measured
across the resistor, so it is the power delivered to that circuit and not the
wind's power. The model buildings are static. An acknowledged command proves the
controller decided, not that water flowed.

## Exhibition checklist

1. Charge the 5 V 2 A power bank.
2. Put water in the reservoir, probes at the minimum level, pump intake
   submerged.
3. Complete the bench test and open the pump gate only then.
4. Start the router, ESP32, then `./scripts/launch.sh`.
5. Check the Setup checklist; turn **Demo mode off** for the physical part.
6. Keep `Stop irrigation` in reach.
7. After the talk: `./scripts/stop.sh`, pump off, power down.

More: [installation](docs/installation.md), [calibration](docs/calibration.md),
[operation](docs/operation.md), [Lia guide](docs/lia-guide.md),
[Cloudflare deployment](docs/deployment-cloudflare.md),
[troubleshooting](docs/troubleshooting.md).
