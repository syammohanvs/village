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
| Lia guide (welcome, tours, live narration, 3 languages) | **done; verified in Chromium 16/16** |
| Cloudflare deploy | **Worker + static assets, repo `village`, branch `main`** |
| Hardware wiring | **streetlights, LDR and reservoir probes working; soil bench-only; bins and pump not wired** |
| Reservoir probes | **verified 2026-11-08 (well water; 2300 / 2800 mV thresholds)** |
| Waste model (Teachable Machine) | **you must supply the three exported files** |

The exhibition can run today in **simulator** mode with no hardware. The
physical part needs the commissioning checks below.

The board itself is programmed and reachable: it joins the home Wi-Fi in
station mode (so the laptop keeps its internet) and `/api/v1/state?mode=live`
reports `source.kind: "esp32"`. The four streetlight lamps and the LDR module
are wired and working, including automatic lamps in the dark. The soil probe is
connected but calibrated only against wheat flour so far, so treat its
percentage as a bench check until it is redone in real soil. The reservoir
probes, ultrasonic bins and pump are not wired yet; the pump stays disabled by
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
- **Three bins** — sequential HC-SR04 readings, estimation and confirmation,
  loud **unavailable** on a missing echo (never “empty”).
- **Voice** — push-to-talk, English/Malayalam/Hindi, local Whisper, deterministic
  command allowlist. Negated, ambiguous and unsupported phrases never actuate.
- **Waste camera** — local Teachable Machine model, stable predictions, one
  event per item, correct category LED, full-bin warning without redirecting.
- **Demo mode** — clearly labelled simulated data and simulated commands. It
  cannot reach real hardware; demo events are stored separately.
- **Activity** — commands, acknowledgements, recognitions, connection events,
  CSV export.

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
- `docs/` — wiring, installation, calibration, operation, Lia guide,
  Cloudflare deployment, troubleshooting, waste model, bench test.
- `scripts/` — setup, download, launch, stop, dev, tests.

**Cloudflare builds only `web/frontend`.** The firmware (`uc/`) and the
Python backend (`web/backend/`) sit outside that root, so a firmware commit
cannot affect the site build. A push to `main` triggers the build; see
[docs/deployment-cloudflare.md](docs/deployment-cloudflare.md).

## Board and wiring

The purchased board is the **30-pin NodeMCU-style ESP32-WROOM-32 DevKit V1**
(4 MB flash, AMS1117, micro-USB). The pin map uses GPIO numbers only:
soil **34**, reservoir sense **35** / excite **25**, LDR **32**, pump gate **19**,
streetlights **13/12/14/27** (one lamp each), waste LEDs **21/22/23**, bin triggers **4/16/17**,
bin echoes **36/39/18**. All analogue inputs are **ADC1** because Wi-Fi is
active. Flash pins, input-only misuse, strapping pins and UART0 are avoided;
the firmware has `static_assert` checks. See [docs/wiring.md](docs/wiring.md)
for the power branch, MOSFET/flyback requirements, HC-SR04 dividers, probe
circuit and the unidentified driver-component warning.

## Tests run locally

```bash
./scripts/test_firmware.sh      # 433 checks + PlatformIO build
cd web/backend && .venv/bin/python -m pytest -q   # or VILLAGE_VENV
cd web/frontend && npm run typecheck && npm test && npm run build
```

- Firmware core: **433 checks, 0 failed** (irrigation safeguards, stop,
  duplicate commands, stale sensors, calibration polarity, LDR hysteresis,
  bin echo loss, persisted command ids).
- ESP32 build: **SUCCESS** for `esp32doit-devkit-v1`.
- Backend: **17 passed** (demo isolation, ack-not-assumed, retries with the same
  command id, stale/disconnected, config validation, waste/full-bin, voice
  rejection, settings).
- Frontend: typecheck clean, **15 tests passed**, production build succeeded.
- Browser walk: **7/7 routes render, 0 console errors**; Demo toggle, demo
  scenario, confirmed Start, Lights Off and the 10-phrase voice panel were
  driven in Chromium against the running server.
- Whisper: `GET /health` → `{"status":"ok"}` with `ggml-base.bin` loaded.
- Hardware: **not tested**; the bench checklist is in
  [docs/bench-test.md](docs/bench-test.md).

## Models you must supply

1. **Whisper** — `models/whisper/ggml-base.bin` (multilingual). The download
   script verifies SHA-256
   `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`.
2. **Whisper server** — build `whisper-server` (instructions in
   [docs/installation.md](docs/installation.md)) or set
   `VILLAGE_WHISPER_BIN` in `.env`.
3. **Waste classifier** — train a Teachable Machine image model with classes
   Organic, Plastic, Paper, Background and copy `model.json`,
   `metadata.json`, `weights.bin` into `models/waste/`. See
   [docs/waste-model.md](docs/waste-model.md). The app reports the model as
   missing rather than inventing predictions.

## Honest data rules

The app never displays a tank percentage, litres, capacity, household water
use, pressure, flow, battery charge, solar/wind generation or energy savings.
The reservoir has two wire probes at one minimum level; bin fill is an
estimated height from ultrasonic distance; soil moisture is a calibrated
relative value. The solar panels, windmill and model buildings are static.
An acknowledged command proves the controller decided, not that water flowed.

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
