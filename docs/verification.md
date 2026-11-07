# Verification record

Recorded on 2026-11-07 on the exhibition laptop. This is a log of what was
actually run, not a claim about hardware that was not connected.

## Firmware

```text
$ cd uc && pio run -e esp32doit-devkit-v1
========================= [SUCCESS] Took 9.82 seconds =========================
Environment          Status    Duration
esp32doit-devkit-v1  SUCCESS   00:00:09.825

$ pio run -e esp32doit-devkit-v1 -t size
   text    data     bss     dec     hex filename
 734649  157128   22729  914506   df44a .pio/build/esp32doit-devkit-v1/firmware.elf
```

`firmware.bin`: 856 KB. The board profile is `esp32doit-devkit-v1` (30-pin
ESP32-WROOM-32). Flashing was **not** performed: no board was connected to this
session, and the instructions say not to flash hardware without explicit
instruction.

Host safety-core tests:

```text
$ ./scripts/test_firmware.sh
Running 32 firmware core tests
...
404 checks, 0 failed
ALL FIRMWARE CORE TESTS PASSED
```

They cover wet-soil blocking, low-water blocking and stopping, invalid sensor
stops, maximum runtime, pulse limits and lockout, boot pump-off, duplicate
commands, stop interruption, LDR hysteresis, bin echo loss, calibration
polarity, command history persistence and the GPIO rules.

## Backend

```text
$ cd web/backend && python -m pytest -q
.................                                                        [100%]
17 passed in 0.29s
```

Coverage includes demo isolation (a demo command never reaches the recording
real device), an unacknowledged command reported as 503/`confirmed: false`,
retry with the same command id, duplicate-request suppression, stale and
disconnected state, configuration revision conflicts and validation, waste
recognition with a full bin, voice rejection without actuation, and settings.

## Speech pipeline

Model:

```text
models/whisper/ggml-base.bin
sha256 60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe
```

whisper.cpp server:

```text
$ curl -s http://127.0.0.1:8181/health
{"status":"ok"}
```

Real transcription through the backend using the whisper.cpp sample:

```text
transcript: And so my fellow Americans, ask not what your country can do for you,
            ask what you can do for your country.
intent: NEGATED | reason: negated | command: None
```

The pipeline transcribed correctly and the safety matcher refused to act on a
sentence containing “not”. The positive intent paths are covered by the intent
unit tests; Malayalam/Hindi must be tested with the child's speech.

## API

```text
GET /api/v1/system/health
{"status":"ok", ... "device_mode":"simulator", "physical":false,
 "voice":{"ready":true,"server_reachable":true,"model_name":"ggml-base.bin"}}

GET /api/v1/state?mode=demo
mode demo, physical false, source demo, status present

POST /api/v1/commands  (mode demo, IRRIGATION_STOP)
confirmed true, physical false, ack.result ACCEPTED,
ack.reason "Irrigation is already stopped. The pump is off."
```

Demo mode was shown to be independent of the live simulator:
`POST /api/v1/demo/scenario {"soil_pct":61.0}` changed the demo state while the
live state stayed at its previous soil reading.

## Frontend

```text
$ cd web/frontend && npm run typecheck
(clean)

$ npm test
Test Files  5 passed (5)
Tests       15 passed (15)

$ npm run build
✓ built in 4.02s
```

Tests cover live/stale/offline rendering, honest bin states, Demo mode command
routing, Stop remaining visible and reporting an unconfirmed 503, the waste
stabiliser (repeated frames, low confidence, background re-arm, cooldown),
the missing-model state, settings draft/validation, and voice unknown/matched
behaviour.

## Browser walk in Chromium

All seven routes were opened against the running server:

```text
/          Village Dashboard
/sensors   Sensors & calibration
/controls  Controls
/waste     Waste camera (Recognition model not installed)
/activity  Activity (4 of 4 events)
/settings  Settings (no validation errors; fields populated)
/villagers Villagers
```

**0 console errors.** Demo mode was toggled on, the banner appeared, the Dry
soil scenario changed the demo simulator, Start irrigation was sent and
**confirmed by the controller**, Lights Off was accepted, the Stop control
stayed available, and the voice panel listed all 10 supported phrases.

## Setup checklist at verification time

```text
device ok · soil ok · reservoir ok · pump ok · voice ok
waste_model missing · audio warn
```

`ready` is therefore **false**: the waste model has not been supplied yet. This
is the honest result; the app reports “Recognition model not installed”.

## Not verified

- Any physical ESP32, pump, LED, probe, LDR or HC-SR04 behaviour.
- Flashing the firmware image.
- Malayalam or Hindi recognition with the child's voice.
- The Teachable Machine model (not supplied), and therefore live camera
  classification in this build.
- A physical Stop while water is flowing.

The bench checklist in `docs/bench-test.md` is the required next physical step.
