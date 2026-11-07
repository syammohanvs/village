# Our AI-Powered Smart Green Village

A child's school exhibition project for **Tuesday, 10 November 2026**. A
30-pin ESP32 runs the physical village; a laptop provides the dashboard, local
speech recognition and local image recognition. After setup it runs entirely
offline and uses no paid API.

> **Status:** under active construction. This README is updated at the end of
> each work package with verified commands and test results.

## What it does

- Soil-moisture-controlled drip irrigation with short pulses, soak intervals,
  runtime limits and a hard pump-off safety policy.
- Rainwater reservoir detection with two wire probes (available / low only —
  no invented litres or percentages).
- Automatic streetlights with LDR hysteresis.
- Three waste bins monitored by HC-SR04, with honest “unavailable” states.
- Local waste recognition (Teachable Machine / TensorFlow.js) that lights the
  correct category LED — organic, plastic or paper.
- Push-to-talk voice commands in English, Malayalam and Hindi using local
  whisper.cpp with the multilingual `ggml-base.bin` model.
- One dashboard that explains **what the village is doing and why**.

The static solar panels, windmill and model buildings are display models. They
are not instrumented, and the app does not invent generation, battery or
savings figures.

## Repository map

```
uc/              PlatformIO ESP32 Arduino firmware and native core tests
web/frontend/    React + TypeScript + Vite dashboard
web/backend/     FastAPI + SQLite local backend, whisper proxy, demo simulator
shared/          Protocol, phrase dictionary, JSON examples
docs/            Wiring, installation, calibration, operation, troubleshooting
scripts/         Setup, development, model download, launch, tests
models/          Downloaded models (git-ignored)
```

## Quick start (Linux / WSL / macOS)

```bash
./scripts/setup.sh          # installs frontend + backend dependencies
./scripts/download_models.sh
./scripts/launch.sh         # builds the UI and serves everything on :8000
```

Open <http://127.0.0.1:8000>.

Without an ESP32 connected, the app starts on its clearly labelled simulator.
For the real board, set `VILLAGE_DEVICE_MODE=real` and
`VILLAGE_DEVICE_URL=http://<board-ip>` in `.env`.

## Documentation

- [Wiring and power](docs/wiring.md)
- [Installation](docs/installation.md)
- [Calibration](docs/calibration.md)
- [Operation](docs/operation.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Bench test checklist](docs/bench-test.md)
- [Protocol](shared/protocol.md)

## Honest limits

- Soil moisture is a calibrated relative reading, not a laboratory
  volumetric measurement.
- The reservoir reports only whether the probes are covered.
- Bin fill is estimated from ultrasonic distance, not measured waste volume.
- Camera recognition identifies waste, not people, and does not prove that an
  item was deposited.
- An acknowledged command proves the controller decided; it does not prove
  water flowed or an LED lit.
