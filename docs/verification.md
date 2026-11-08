# Verification record

Recorded on 2026-11-07 and updated 2026-11-08 on the exhibition laptop. This is a log of what was
actually run, not a claim about hardware that was not connected.

## Firmware

```text
$ cd uc && pio run -e esp32doit-devkit-v1
========================= [SUCCESS] Took 9.82 seconds =========================
Environment          Status    Duration
esp32doit-devkit-v1  SUCCESS   00:00:09.825

$ pio run -e esp32doit-devkit-v1 -t size
   text    data     bss     dec     hex filename
 734713  157128   22729  914570   df48a .pio/build/esp32doit-devkit-v1/firmware.elf
```

`firmware.bin`: 856 KB. The board profile is `esp32doit-devkit-v1` (30-pin
ESP32-WROOM-32).

### Physical flash performed — 2026-11-08

The user connected the board and asked for it to be programmed. The port was
confirmed, not assumed:

```text
COM3  Silicon Labs CP210x USB to UART Bridge
Chip type:  ESP32-D0WD-V3 (revision v3.1)
Features:   Wi-Fi, BT, Dual Core + LP Core, 240MHz
Flash size: 4MB
MAC:        68:09:47:df:ed:40
```

Install method: portable Python 3.14.4 + esptool 5.6.0, writing the merged
image at offset `0x0` at 460800 baud. The write reported:

```text
Wrote 941632 bytes (574391 compressed) at 0x00000000 in 14.6 seconds
Hash of data verified.
Verification successful (digest matched).
```

Boot log from the flashed board:

```text
=== Our AI-Powered Smart Green Village ===
firmware 0.1.0, protocol 1
[net] connecting to 'VillageLab'...
[api] listening on :80
[boot] village-470968, boot b-8eead1d6, pump gate DISABLED
[boot] pump output is LOW; config revision 1
[net] station mode failed; AP fallback started, SSID 'Village-Setup', IP 192.168.4.1
```

The first boot reports `nvs_open failed: NOT_FOUND` because no settings have
been saved yet; this is expected and the firmware uses its defaults. The pump
gate is **DISABLED** in this build. The board is running and broadcasting
`Village-Setup` because `secrets.h` still contained the placeholder Wi-Fi
values at that point.

### Station mode on the home Wi-Fi — same day

The user did not want to lose internet, so the board was reconfigured to join
the laptop's own network instead of starting its access point.
`ASIANET Giga Fiber` and its saved key were written into the git-ignored
`uc/include/village/secrets.h` and the image was rebuilt and reflashed. Boot log:

```text
[net] connecting to 'ASIANET Giga Fiber'...
[net] connected: IP 192.168.1.8, RSSI -79 dBm
[net] mDNS: http://village.local/
[boot] village-470968, boot b-232ec7db, pump gate DISABLED
```

The laptop reaches the board directly (no AP switch, no client-isolation
problem):

```text
$ curl http://192.168.1.8/api/v1/health
{"protocol_version":1,"device_id":"village-470968","boot_id":"b-232ec7db",
 "firmware":"0.1.0", ... "wifi":{"mode":"sta","ssid":"ASIANET Giga Fiber",
 "ip":"192.168.1.8","rssi":-78,"connected":true}, "pump_commissioned":false}
```

With `.env` set to `VILLAGE_DEVICE_MODE=real` and
`VILLAGE_DEVICE_URL=http://192.168.1.8`, `/api/v1/state?mode=live` reports
`physical: true`, `source.kind: "esp32"`, `connected: true`, and the values the
hardware can actually support:

```text
soil        state "uncalibrated"  percent null
reservoir   state "uncalibrated"  no percentage
light       installed false       no reading
bins        all "unavailable"     no distance
pump        commissioned false, enabled false, commanded false
```

That is the honest state of an unwired board: the link works, nothing pretends a
sensor is fitted.

### Wireless firmware update (OTA) verified — same day

The firmware gained a password-protected ArduinoOTA listener on port 3232. It
only starts after station mode connects, and `[ota] ready on 192.168.1.8 port
3232 (password required)` appears in the boot log.

The first attempts stalled at `No response from device`:

- from WSL, because espota advertises `0.0.0.0` as the host, and WSL is behind
  a NAT the board cannot reach;
- from Windows until espota was told the host address, because the same
  `0.0.0.0` default left the board with nowhere to send the image.

Passing the Windows LAN address fixed it (`-I 192.168.1.6`, detected
automatically by `scripts/ota_flash_win.py`). The board's own log:

```text
[ota] update starting; pump and lamps forced off
[ota] 0%
[ota] 10%
...
[ota] 80%
```

and the health endpoint changed boot id from `b-d2b83a86` to a new one after
the reboot, with the app reconnecting on its own. The OTA password was then
rotated and the whole update repeated to prove the new secret is the one in
force: `b-213ac95f` → `b-6a29256e`.

USB flashing still works and remains the recovery path.

### LDR streetlight sensor verified — same day

An LM393 "digital LDR module" was wired as VCC → 3V3, GND → GND, DO → **GPIO 32**.
Measured at DO: **0 V in light**, **3.3 V covered**, so the module is LOW for
light and HIGH for dark — the firmware's `digital_dark_when_high = true`.

A real firmware defect surfaced during the test: `analogRead()` on the pin
leaves the pad configured for the ADC, after which `digitalRead()` returns 0
forever. The controller had run in analog mode at boot, so switching to digital
without a reboot never worked and no cover was ever seen. `sensors.cpp` now
restores the pad mode (`pinMode(LDR_ADC, digital ? INPUT : ANALOG)`) at setup
and whenever the configured mode changes.

With that fixed, a recorded hold test gave:

```text
68.0 s  raw=4095            hand covers the LDR
71.3 s  brightness=dark     lamps ON   (~3.3 s stabilising delay)
93.0 s  raw=0               hand removed
95.5 s  brightness=bright   lamps OFF  (~2.5 s)
```

A 25-second cover held steady, so the lamps do not feed enough light back into
the LDR to cycle it in this arrangement. Digital mode is threshold-only by
design: the dashboard reports bright/dark, not a light level.

Host safety-core tests:

```text
$ ./scripts/test_firmware.sh
Running 33 firmware core tests
...
433 checks, 0 failed
ALL FIRMWARE CORE TESTS PASSED
```

They cover wet-soil blocking, low-water blocking and stopping, invalid sensor
stops, maximum runtime, pulse limits and lockout, boot pump-off, duplicate
commands, stop interruption, LDR hysteresis (and that an uninstalled LDR
reports nothing), bin echo loss, calibration polarity, command history
persistence and the GPIO rules.

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

## Lia guide — browser check (2026-11-08)

The guide was driven in headless Chromium 156 through the DevTools protocol
against the running build, not read from the source. **16/16 checks passed:**

- the welcome message and all six topic buttons render;
- the language switch changes the whole card to Malayalam, including the six
  labels and the "Maybe later" button;
- "Maybe later" closes the card, stores `dismissed: true` and keeps the
  **Help with Lia** button;
- the helper button reopens the guide and is **not covered by the existing
  Voice launcher** (it sits above it; the browser check hit-tests the centre of
  the button);
- **What is happening now?** narrates the live village in Malayalam and contains
  no litre claim;
- switching back to English and opening **Show me around** shows the dashboard
  step, and **Next** advances to the sensors step.

Screenshots: `/tmp/opencode/lia-welcome.png` (800×600),
`/tmp/opencode/lia-desktop.png` (1440×900), `/tmp/opencode/lia-mobile.png`
(390×844), `/tmp/opencode/lia-fab.png` (both launchers in place) and
`/tmp/opencode/lia-live.png` (offline narration). On desktop the card is 702 px
tall and fits a 900 px window without scrolling; on the phone it scrolls in one
column. The Lia launcher occupies x 1266–1418, y 762–816 and the Voice launcher
x 1313–1418, y 829–878 — no overlap.

The component and content tests are part of the normal suite
(`lia.test.ts`, `LiaGuide.test.tsx`). They cover uncalibrated probes, offline
and stale links, demo mode, the adult notes, the read-aloud call and closing
with Escape. The suite is 37 web tests in 7 files.

## Reservoir probes — bench check (2026-11-08)

Two wire probes on a 15 kΩ excitation resistor were read through the running
server:

```text
probes in air       3145 mV   state low       conductive false
probes in well water ~1600 mV state available conductive true
```

The default 1200 / 2400 mV thresholds did not fit this water, so they were
changed to **wet ≤ 2300 mV** and **dry ≥ 2800 mV**. The state takes about six
seconds to change because it requires three consecutive two-second samples.
A brief ~190 mV reading occurred when the prongs touched; it still reported
*available*, which is correct — water is present.

The reservoir is calibrated (`calibrated: true`, config revision 8) and is
reported as **Available / Low** only; no percentage or volume is produced.

## Setup checklist at verification time

```text
device ok · soil ok · reservoir ok · pump ok · voice ok
waste_model missing · audio warn
```

`ready` is therefore **false**: the waste model has not been supplied yet. This
is the honest result; the app reports “Recognition model not installed”.

## Not verified

- Physical soil, reservoir, pump and ultrasonic-bin behaviour. The ESP32 is
  flashed, joins the home Wi-Fi and serves the API over the LAN. One
  streetlight LED was measured at 100 Ω (Vf 2.93 V) and the LDR module was
  tested end to end, but the other three lamps were only exercised as GPIO
  outputs, not measured individually.
- A physical Stop while water is flowing.
- Malayalam or Hindi recognition with the child's voice.
- The Teachable Machine model (not supplied), and therefore live camera
  classification in this build.
- An OTA update interrupted midway (power loss during the transfer). The two
  app slots should keep the previous image bootable, but that has not been
  provoked on hardware.

The bench checklist in `docs/bench-test.md` is the required next physical step.
