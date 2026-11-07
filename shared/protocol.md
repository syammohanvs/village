# Village protocol v1

This document is the contract between three separate pieces:

- the **ESP32 firmware** in `uc/`,
- the **local FastAPI backend** in `web/backend/`,
- the **React dashboard** in `web/frontend/`.

The firmware is the authority for every physical output. The backend never
pretends a command ran, and the browser never shows a command as complete
before the controller acknowledges it.

```
browser  ──HTTP──▶  FastAPI (laptop)  ──HTTP──▶  ESP32 (local Wi-Fi)
   │                    │
   └── camera + mic     └── whisper.cpp (localhost)
```

## 1. Transport and security

- ESP32 endpoints are plain HTTP on the private LAN: `http://<device-ip>/api/v1/...`.
- Every route except `GET /api/v1/health` requires the header
  `X-Device-Token: <token>`.
- The token is compile-time firmware configuration (`uc/include/village/secrets.h`,
  git-ignored) and backend environment configuration (`VILLAGE_DEVICE_TOKEN`).
  It is never sent to the browser.
- The FastAPI server binds to `127.0.0.1` by default. Do not expose the device
  or the dashboard to the public internet.
- HTTP is used because the demonstration network is local and isolated. Do not
  port-forward these endpoints.

## 2. Identity and time

| Field | Meaning |
| --- | --- |
| `protocol_version` | Always `1` for this build. |
| `device_id` | Stable per board, derived from the MAC (e.g. `village-a1b2c3`). |
| `boot_id` | New random value on every boot (e.g. `b-7f3a91c2`). |
| `uptime_ms` | Monotonic milliseconds since boot. |
| `sample_seq` | Increments when fresh sensor data is produced. |
| `config_revision` | Increments on every accepted configuration write. |

The device has no wall clock. The backend timestamps every received frame and
computes staleness. A device reading's `age_ms` is measured against the
device's own `millis()`.

## 3. Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | no | Identity, board, uptime, Wi-Fi, pin map. |
| GET | `/api/v1/status` | yes | Full sensor, actuator and irrigation state. |
| GET | `/api/v1/config` | yes | Validated persisted configuration + revision. |
| PUT | `/api/v1/config` | yes | Replace configuration (optimistic revision check). |
| POST | `/api/v1/commands` | yes | Idempotent command with a command id. |

`GET /api/v1/health` response:

```json
{
  "protocol_version": 1,
  "device_id": "village-a1b2c3",
  "boot_id": "b-7f3a91c2",
  "firmware": "0.1.0",
  "uptime_ms": 84210,
  "board": {
    "profile": "esp32doit-devkit-v1",
    "module": "ESP32-WROOM-32",
    "description": "30-pin NodeMCU-style ESP32-WROOM-32 DevKit V1",
    "chip_model": "ESP32-D0WDQ6",
    "revision": 1,
    "flash_size": 4194304,
    "mac": "AA:BB:CC:11:22:33",
    "pin_map_version": "1.0.0-30pin"
  },
  "wifi": { "mode": "sta", "ssid": "VillageLab", "ip": "192.168.1.50", "rssi": -58 },
  "pump_commissioned": false,
  "pin_map": {
    "soil_moisture_adc": 34,
    "reservoir_excite": 25,
    "reservoir_sense_adc": 35,
    "ldr": 32,
    "pump_gate": 26,
    "streetlight_leds": [13, 14, 19, 21],
    "waste_leds": { "organic": 33, "plastic": 22, "paper": 23 },
    "bin_trig": [4, 16, 17],
    "bin_echo": [36, 39, 18]
  }
}
```

## 4. Status

```json
{
  "protocol_version": 1,
  "device_id": "village-a1b2c3",
  "boot_id": "b-7f3a91c2",
  "uptime_ms": 84210,
  "sample_seq": 512,
  "config_revision": 4,
  "sensors": {
    "soil": {
      "valid": true, "calibrated": true, "raw": 2310,
      "percent": 27.6, "state": "dry", "age_ms": 180, "fault": null
    },
    "reservoir": {
      "valid": true, "calibrated": true, "state": "available",
      "millivolts": 640, "conductive": true, "age_ms": 820, "fault": null
    },
    "light": {
      "valid": true, "raw": 1980, "brightness": "dark",
      "output_type": "analog", "age_ms": 240, "fault": null
    },
    "bins": [
      {
        "id": "organic", "installed": true, "valid": true,
        "distance_cm": 38.4, "fill_pct_estimate": 45.5,
        "state": "available", "age_ms": 310, "fault": null,
        "near_blind_zone": false
      },
      {
        "id": "plastic", "installed": true, "valid": true,
        "distance_cm": 14.0, "fill_pct_estimate": 95.8,
        "state": "full", "age_ms": 760, "fault": null,
        "near_blind_zone": false
      },
      {
        "id": "paper", "installed": true, "valid": false,
        "distance_cm": null, "fill_pct_estimate": null,
        "state": "unavailable", "age_ms": 2400,
        "fault": "no echo", "near_blind_zone": false
      }
    ]
  },
  "actuators": {
    "pump": {
      "commanded": false, "commissioned": false, "feedback": "none"
    },
    "streetlights": {
      "mode": "auto", "commanded": false, "led_count": 4,
      "installed": true, "feedback": "none"
    },
    "waste_indicator": {
      "category": null, "active": false, "remaining_ms": 0
    }
  },
  "irrigation": {
    "auto_enabled": true,
    "state": "idle",
    "session": "none",
    "pulses_done": 0,
    "pulse_limit": 4,
    "cumulative_pump_ms": 0,
    "max_cumulative_pump_ms": 15000,
    "cooldown_remaining_ms": 0,
    "reason_code": "IDLE_PUMP_NOT_COMMISSIONED",
    "reason": "Soil is dry and water is available, but the pump is not commissioned.",
    "last_session": null
  },
  "faults": [],
  "recent_events": [
    {
      "at_uptime_ms": 82000,
      "code": "IDLE_PUMP_NOT_COMMISSIONED",
      "text": "Soil is dry and water is available, but the pump is not commissioned."
    }
  ]
}
```

### Sensor states

- `soil.state`: `dry` | `adequate` | `wet` | `uncalibrated` | `unavailable`.
  `percent` is a **calibrated relative value**, never a laboratory volumetric
  measurement. It is `null` when `calibrated` is false.
- `reservoir.state`: `available` | `low` | `uncalibrated` | `unavailable`.
  There is deliberately no percentage, litre or capacity field. Two wire probes
  detect one minimum-water level.
- `light.brightness`: `bright` | `dark` | `unknown`. `light.valid` is false when
  the reading is stale. A stale light reading never stays `bright` or `dark`.
- `bins[].state`: `available` | `nearly_full` | `full` | `unavailable` |
  `not_installed`. `fill_pct_estimate` is an **estimated fill height**, not a
  measured waste volume. A missing echo sets `valid: false`, `distance_cm:
  null`, `fill_pct_estimate: null` and `state: "unavailable"`; it must never
  become an empty bin.

### Staleness

The device reports `valid` and `age_ms` for each sensor. The backend adds
`connection.stale` when the whole status frame is older than
`VILLAGE_STALE_AFTER_MS` (default 4000 ms) and `connection.connected: false`
after `VILLAGE_DISCONNECT_AFTER_MS` (default 9000 ms). When stale or
disconnected, the API still returns the last frame but marks it as such. The
dashboard must grey it out and must not show it as live.

## 5. Commands

Request:

```json
{
  "protocol_version": 1,
  "command_id": "9f3d2a0e-6a8b-4d2e-9d1f-2c7e5b8a4f10",
  "type": "IRRIGATION_REQUEST",
  "parameters": {},
  "issued_at_ms": 90000
}
```

Supported types:

| Type | Parameters | Notes |
| --- | --- | --- |
| `LIGHTS_ON` | none | Manual mode, all four LEDs on. |
| `LIGHTS_OFF` | none | Manual mode, all four LEDs off. |
| `LIGHTS_AUTO` | none | Follow the LDR with hysteresis. |
| `IRRIGATION_REQUEST` | none | Starts a new session only if every safety condition passes. |
| `IRRIGATION_STOP` | none | Stops immediately; idempotent when idle. |
| `INDICATE_WASTE` | `{"category":"organic"\|"plastic"\|"paper", "duration_ms": 8000}` | Known categories only; duration is bounded by the config. |

Acknowledgement (HTTP 200, even when the action is refused):

```json
{
  "protocol_version": 1,
  "command_id": "9f3d2a0e-6a8b-4d2e-9d1f-2c7e5b8a4f10",
  "type": "IRRIGATION_REQUEST",
  "result": "ACCEPTED",
  "reason_code": "IRRIGATION_STARTED",
  "reason": "Soil is dry and water is available. Starting a short pulse.",
  "at_uptime_ms": 90120,
  "irrigation": { "state": "pumping", "pump_on": true }
}
```

`result` is one of `ACCEPTED`, `REJECTED`, `DUPLICATE`.

- `REJECTED` means the controller received the command and refused it. This is
  a successful protocol exchange, not a transport failure.
- `DUPLICATE` means this `command_id` was already processed. The original
  decision is repeated; no new action is performed. The firmware keeps recent
  command ids in NVS so a retry after a reboot is still a duplicate. Recent
  command ids are safe to persist; a pump-ON command never is.
- The backend retries only transport failures and always reuses the same
  `command_id`. A timeout is reported as **not confirmed**, never as success.

Example refusals:

| reason_code | Meaning |
| --- | --- |
| `IRRIGATION_BLOCKED_SOIL_WET` | Soil is already wet enough. |
| `IRRIGATION_BLOCKED_SOIL_UNCALIBRATED` | Calibration is missing or invalid. |
| `IRRIGATION_BLOCKED_SENSOR_INVALID` | A required reading is stale or invalid. |
| `IRRIGATION_BLOCKED_WATER_LOW` | Reservoir probes say low water. |
| `IRRIGATION_BLOCKED_WATER_UNKNOWN` | Reservoir state is uncalibrated/unavailable. |
| `IRRIGATION_BLOCKED_PUMP_NOT_COMMISSIONED` | Hardware commissioning gate is still closed. |
| `IRRIGATION_BLOCKED_ALREADY_ACTIVE` | A session is already running. |
| `IRRIGATION_BLOCKED_COOLDOWN` | The post-session lockout is still active. |
| `IRRIGATION_BLOCKED_BOOT_GUARD` | The post-boot guard has not elapsed. |
| `IRRIGATION_STOPPED_LOW_WATER` | Water ran low during a pulse. |
| `IRRIGATION_STOPPED_SENSOR_INVALID` | A required reading became invalid mid-session. |
| `IRRIGATION_STOPPED_MAX_RUNTIME` | Cumulative pump time limit reached. |
| `IRRIGATION_STOPPED_MAX_PULSES` | No moisture rise after the allowed pulses. |
| `IRRIGATION_STOPPED_LINK_LOST` | A **manual** session lost laptop communication. |
| `IRRIGATION_STOPPED_USER` | Explicit stop. |
| `WASTE_INDICATED` | Category LED activated for the bounded duration. |
| `WASTE_UNKNOWN_CATEGORY` | Category was not organic/plastic/paper; no LED changed. |
| `DUPLICATE_COMMAND` | Repeated command id; original decision returned. |

### Idempotency and reconnect rules

1. The browser generates a `request_id` per press. The backend uses it as the
   device `command_id`.
2. The backend keeps a short-lived memory cache of `request_id` → result so a
   double-click does not send a second frame.
3. The device keeps recent command hashes in NVS and refuses to repeat actions.
4. On reconnect, the backend fetches `/status` and **does not replay** any
   command. Any command that was not acknowledged is reported to the operator
   as unconfirmed.
5. A new `boot_id` is recorded as a reconnect event. No old actuator request is
   re-sent.

## 6. Configuration

`GET /api/v1/config`:

```json
{
  "protocol_version": 1,
  "device_id": "village-a1b2c3",
  "config_revision": 7,
  "config": {
    "soil": {
      "dry_raw": 2800, "wet_raw": 1100, "min_span_raw": 400,
      "samples": 9, "max_age_ms": 5000
    },
    "reservoir": {
      "wet_threshold_mv": 1200, "dry_threshold_mv": 2400,
      "confirm_readings": 3, "max_age_ms": 5000, "calibrated": false
    },
    "light": {
      "installed": true, "output_type": "analog",
      "analog_bright_high": true, "digital_dark_when_high": true,
      "dark_threshold": 1600, "bright_threshold": 2400,
      "stable_ms": 4000, "max_age_ms": 5000
    },
    "bins": [
      {
        "id": "organic", "installed": true, "empty_cm": 60, "full_cm": 12,
        "near_full_pct": 75, "full_pct": 90, "median_samples": 5,
        "confirm_readings": 3, "timeout_us": 30000,
        "blind_zone_cm": 3, "max_range_cm": 400
      },
      { "id": "plastic", "installed": true, "empty_cm": 60, "full_cm": 12, "near_full_pct": 75, "full_pct": 90, "median_samples": 5, "confirm_readings": 3, "timeout_us": 30000, "blind_zone_cm": 3, "max_range_cm": 400 },
      { "id": "paper", "installed": true, "empty_cm": 60, "full_cm": 12, "near_full_pct": 75, "full_pct": 90, "median_samples": 5, "confirm_readings": 3, "timeout_us": 30000, "blind_zone_cm": 3, "max_range_cm": 400 }
    ],
    "irrigation": {
      "auto_enabled": true, "pump_enabled": false,
      "dry_start_pct": 35, "stop_pct": 55,
      "dry_confirm_ms": 30000, "pulse_ms": 4000, "max_pulse_ms": 8000,
      "soak_ms": 45000, "max_cumulative_ms": 15000, "max_pulses": 4,
      "cooldown_ms": 300000, "link_timeout_ms": 30000
    },
    "waste": { "indicate_ms": 8000 }
  }
}
```

`PUT /api/v1/config` body:

```json
{ "config_revision": 7, "config": { "...": "the whole document, not a patch" } }
```

- If `config_revision` does not match the device's current revision, the device
  answers HTTP 409 with the current revision. The UI must then show a conflict
  and re-read the config; it must not overwrite blindly.
- Validation failures are HTTP 400 with a `field` and a human-readable
  `message`. Nothing is saved.
- `pump_enabled: true` is accepted only when the firmware was compiled with
  `VILLAGE_PUMP_COMMISSIONED 1`. Otherwise the response is 400 with
  `reason_code: "PUMP_NOT_COMMISSIONED"`. This is a deliberate two-key gate.
- A successful PUT increments `config_revision`, stores only the configuration
  in NVS, and applies the new settings live. It never stores actuator state.

### Calibration

Soil calibration is two raw ADC endpoints (`dry_raw`, `wet_raw`) captured from
the real probe. Either polarity is accepted: the firmware maps `dry_raw` to 0 %
and `wet_raw` to 100 %, so a sensor whose output rises with moisture works
without a separate polarity switch. The endpoints must be 0…4095 and differ by
at least `min_span_raw`.

Reservoir calibration is two millivolt endpoints measured with the probes dry
(in air) and wet (in the real water at the real spacing). A reading below
`wet_threshold_mv` means conductive/available; above `dry_threshold_mv` means
low. The band between them is a deliberate dead zone.

## 7. Backend API (browser-facing)

All routes are under `/api/v1` on `http://127.0.0.1:8000`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/system/health` | App health, device mode, service readiness summary. |
| GET | `/state?mode=live\|demo` | Connection envelope + full device status. |
| POST | `/commands` | Send a command; returns only after a device ack. |
| GET | `/device/config?mode=` | Proxy of the device configuration. |
| PUT | `/device/config` | Proxy of a configuration write. |
| POST | `/calibration/soil` | Read-modify-write of soil endpoints with validation. |
| POST | `/calibration/reservoir` | Read-modify-write of reservoir thresholds. |
| GET | `/events?mode=&limit=` | Persisted activity, live or demo separated. |
| POST | `/waste/recognition` | Log one accepted recognition + indicate the category. |
| GET | `/waste/model-status` | Is the local Teachable Machine model installed? |
| POST | `/waste/disposals` | Confirm a physical disposal (separate record). |
| GET/POST | `/profiles` | Optional fictional villager profiles. |
| POST | `/voice/transcribe` | Whisper transcription + deterministic intent match. |
| GET | `/voice/intents?language=` | Editable phrase dictionary for the UI/help panel. |
| GET | `/voice/readiness` | Whisper server/model and audio-asset checks. |
| GET | `/setup/checklist` | First-run and pre-exhibition checks. |
| GET/PUT | `/settings` | App preferences (language, TTS, model path, camera). |
| POST | `/demo/scenario` | Set demo-only simulated conditions. |
| POST | `/demo/reset` | Reset the demo simulator. |
| POST | `/simulator/scenario` | Simulator-mode only; 409 for real hardware. |

`GET /state` envelope:

```json
{
  "mode": "live",
  "physical": true,
  "source": { "kind": "esp32", "label": "ESP32 over Wi-Fi" },
  "server_time": "2026-11-07T12:34:56.789Z",
  "connection": {
    "connected": true, "stale": false, "age_ms": 420,
    "last_success_at": "2026-11-07T12:34:56.300Z",
    "last_error": null, "boot_id": "b-7f3a91c2",
    "device_id": "village-a1b2c3", "reconnects": 1
  },
  "status": { "...": "device status document" }
}
```

When the device has never answered, `status` is `null`, `connected` is false
and `last_error` says why. Fields are never filled with zero to look live.

`POST /commands` request:

```json
{
  "mode": "live",
  "type": "IRRIGATION_STOP",
  "parameters": {},
  "request_id": "9f3d2a0e-6a8b-4d2e-9d1f-2c7e5b8a4f10"
}
```

Response when acknowledged:

```json
{
  "confirmed": true,
  "mode": "live",
  "physical": true,
  "ack": { "...": "device acknowledgement" },
  "error": null
}
```

Response when not acknowledged (HTTP 503):

```json
{
  "confirmed": false,
  "mode": "live",
  "physical": true,
  "ack": null,
  "error": {
    "code": "DEVICE_UNREACHABLE",
    "message": "The controller did not acknowledge the command. Do not assume the pump started."
  }
}
```

Acknowledgement proves that the **controller received and decided** the
command. It does not prove that water physically flowed or that an LED lit.
The dashboard must keep that distinction visible.

## 8. Honest data rules

These fields must never be invented, estimated or shown without this protocol
providing them:

- reservoir percentage, litres, tank capacity;
- household water consumption;
- pump pressure, flow rate, dispensed litres;
- battery percentage;
- solar or wind generation, energy savings;
- waste weight, confirmed disposal from a camera image alone.

The solar panels, windmill and buildings are static models. The dashboard
labels them "static display — not instrumented".

## 9. Versioning

Any breaking change increments `protocol_version`. Additive fields may be added
without a bump; clients must ignore unknown fields. Example documents live in
`shared/examples/`.
