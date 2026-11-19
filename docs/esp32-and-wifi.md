# The ESP32, its firmware, and how it talks to the web app

A brief for a reviewing agent. It describes the physical controller, what the
firmware does, the HTTP protocol the dashboard uses, and the network path that
makes that possible in this venue (a Windows hotspot and a relay, because the
backend runs in WSL). Read `docs/voice-languages.md` for speech and
`docs/waste-approach.md` for the waste page; this file is the hardware and the
wire.

Everything below is a path in the repository, a value in the source, or a
measured/live observation. Where something is an assumption it says so.

---

## 1. The one-minute version

- **Board:** a 30-pin NodeMCU-style **ESP32-WROOM-32 DevKit V1**, 4 MB flash,
  Arduino framework via PlatformIO.
- **Firmware:** one loop, no RTOS tasks. It samples five analogue inputs on
  fixed periods, runs two small controllers (irrigation and streetlights), holds
  one waste-indicator LED at a time, and serves a **five-endpoint HTTP API** on
  port 80.
- **Network:** station mode on **one compiled Wi-Fi credential** (the Windows
  Mobile Hotspot). It prints a scan at boot, joins, and exposes itself on
  `http://<dhcp-ip>/` and `village.local`. A rescue access point exists if the
  join fails.
- **The dashboard never talks to the board.** The FastAPI backend does, over
  HTTP, and the browser talks only to the backend. **The device token never
  reaches a browser.**
- **In this venue** the board is on the Windows hotspot's `192.168.137.0/24`,
  which Windows ICS does not route from WSL — so a small TCP relay on the Windows
  host forwards `:8090` to the board, and the backend points at that relay.

---

## 2. Hardware

### 2.1 Board

`uc/include/village/pins.h` is the authority for every pin (GPIO numbers, never
header positions). The map is versioned `1.6.0-30pin` and reported by the board
itself.

| function | GPIO | note |
| --- | --- | --- |
| soil moisture | **34** | ADC1, input-only |
| rain-water-tank sense | **35** | ADC1, input-only |
| tank probe excitation | **25** | driven HIGH for ~5 ms per measurement, then high-Z |
| LDR (light) | **32** | ADC1 |
| solar panel voltage | **39** (VN) | ADC1, input-only |
| solar LED junction | **36** (VP) | ADC1, input-only |
| wind generator voltage | **33** | ADC1, the last free ADC1 pin |
| pump MOSFET gate | **19** | logic only; pump has its own 5 V supply |
| streetlights (all five lamps) | **13** | one pin, ~9 mA total |
| waste LED — organic | **21** | green |
| waste LED — plastic | **22** | red |
| waste LED — paper/cardboard | **23** | blue |
| free | 4, 16, 17, 18, 26 | kept free on purpose |

Two rules are enforced at **compile time** (a bad edit fails the build, not the
exhibit): analogue inputs must be **ADC1** (ADC2 shares the radio and is unusable
while Wi-Fi runs), and outputs must not be flash, input-only, strapping or UART0
pins. GPIO 12 is allowed only for a source-wired lamp (it must be pulled low at
boot).

There is **no bin level sensing** and no fill percentage: the three waste LEDs
are indicators of what the camera last recognised.

### 2.2 Probes and outputs — the wiring facts that explain the readings

- **Soil** and **tank** are both dividers with the fixed resistor on the 3V3 side
  and the probe to GND, so **wet = lower voltage**. Soil is calibrated with two
  measured endpoints; the tank probe's margins are thin (3145 mV dry, ~2760–2800
  mV wet) because water conducts weakly through it.
- The **pump** is switched by a MOSFET on D19; the board carries only the logic
  signal. A pump on the same 5 V bank as the ESP32 browned the board out twice
  (documented in `docs/wiring.md`) — separate supply.
- The **streetlights** are five lamps on one pin, each with its series resistor.
- The **waste LEDs** are one per category; the firmware holds at most one lit at
  a time, for `indicate_ms` (8000 default), and `CLEAR_WASTE` ends it early.

---

## 3. Firmware

`uc/src/main.cpp` is a single Arduino `loop()` with `delay(2)`. Order matters:

1. `networkLoop` — join/keep Wi-Fi, AP fallback and retries, mDNS, OTA service.
2. `otaLoop` — `ArduinoOTA.handle()`.
3. `handleApi()` — serve any pending HTTP request.
4. `sampleSensors(now)` — fixed periods: soil **400 ms**, light **500 ms**,
   reservoir **2000 ms** (7 samples, 5 ms settle after raising the excite pin),
   solar+wind **1000 ms**. `sample_seq` increments per sample.
5. Irrigation controller and the pump pad (Auto = rules and the tank; On/Off =
   the operator's switch, watched only by the tank).
6. Streetlight controller (LDR hysteresis, `stable_ms`).
7. Waste indicator tick (timer) and LED write.
8. The test page's outputs, if its master switch is on (session-only).

**Configuration lives in NVS as JSON** (`Preferences`, namespace `village`),
alongside a `revision`. A missing key keeps its default, so a firmware field can
be added or removed without wiping calibration; `config_revision` is stored
beside the settings, not inside them. A boot with no saved configuration adds a
`CONFIG_DEFAULTS` event so an uncalibrated board says so on the dashboard.

**Safety behaviour that is not negotiable:**

- **Boot guard:** no irrigation start for **5 s** after boot; the pump pad is LOW
  while the rest of the system settles.
- **Two pump gates** on the automatic path (`pump_enabled` in the saved config,
  plus the controller's own rules) and a **tank check** that stops a manual run
  only when the controller *knows* the tank is low.
- **OTA forces the pump and lamps off before the flash is written.**
- **The test page's master switch is session-only** and takes all five outputs;
  a reboot clears it, so a forgotten switch cannot survive a power cycle.
- **Command idempotency:** the last **10** command ids are remembered with their
  result; a repeated `command_id` answers `DUPLICATE` and moves nothing.

Bench-only build flags exist (`VILLAGE_PUMP_BENCH_DRIVE`,
`VILLAGE_PUMP_DRIVE_INVERTED`, `VILLAGE_WASTE_LEDS_ALWAYS_ON`,
`VILLAGE_FORCE_AP`) and each is reported by `/health` (`board.*`) and logged at
boot, so an image in the field can never be mistaken for a normal one.

---

## 4. Networking

`uc/src/net.cpp`, credentials in `uc/include/village/secrets.h` (committed to
this private repository on purpose, see AGENTS.md).

- **One network credential, compiled in.** The board does not scan-and-join by
  itself: it tries `VILLAGE_WIFI_SSID`/`VILLAGE_WIFI_PASS` and nothing else. That
  is deliberate — at any venue the laptop only has to keep the same hotspot name
  alive; it does not have to reflash the board.
- **2.4 GHz and WPA2-Personal only.** A WPA3-only hotspot cannot be joined (the
  board's `enc` value and the failure text say so).
- **SSIDs can carry trailing spaces and Windows trims them.** The board prints
  `[net] scan:` with each network's **exact name and length** before it joins, so
  a spelling difference is visible in the serial log rather than guessed at.
- **Join and fallback:** `WiFi.begin` at boot; if it is not connected after
  **15 s**, the board starts a **rescue access point** (`VILLAGE_AP_SSID`,
  `rt.ap_mode`). In AP mode it retries station mode every **60 s** while no
  client is using the AP, so a single bad join does not need a power cycle.
- **mDNS** `village.local` (HTTP only; OTA's own mDNS is disabled because it
  would fight this one). The IP printed at boot is authoritative.
- **DHCP**, and the lease really moves (seen at `.168`, `.197`, `.222`, `.230`
  in one weekend). `VILLAGE_STATIC_IP` exists but is not used here.
- **OTA** is **UDP on 3232**, password-protected (`VILLAGE_OTA_PASSWORD`),
  started only once station mode is connected. A TCP connect to 3232 is refused
  even on a healthy board — that is the protocol, not a fault.

---

## 5. The HTTP API the backend uses

Served by `WebServer` on port **80** (`uc/src/api.cpp`). Every response is JSON.

| method | path | auth | what it is |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | **none** | board identity, `wifi`, `free_heap`, `ota`, `pin_map`, firmware/protocol versions |
| GET | `/api/v1/status` | token | sampled state: sensors, actuators, test outputs, recent events |
| GET | `/api/v1/config` | token | `{config_revision, config}` |
| PUT | `/api/v1/config` | token | `{config_revision, config}` — **optimistic concurrency** |
| POST | `/api/v1/commands` | token | one command, `protocol_version: 1` |

- **Auth** is the header **`X-Device-Token`**, compared to the compiled
  `VILLAGE_DEVICE_TOKEN`. The backend holds that token; the browser never sees
  it. `/health` is open on the LAN because it carries no state and is what
  discovery probes.
- **`/status` carries identity**: `device_id`, `boot_id`, `firmware`,
  `uptime_ms`, `sample_seq`, `config_revision` — the backend uses `boot_id` to
  notice a reboot and `sample_seq`/`uptime` to notice a frozen board.
- **`/config` PUT** requires the revision that was read; a mismatch is **409**
  with the current revision, and an invalid value is **400** naming the field.
  The board validates *and* saves to NVS before answering.
- **Commands** are `{protocol_version, command_id, type, parameters}`. Types:
  `LIGHTS_ON/OFF/AUTO`, `PUMP_ON/OFF/AUTO`, `IRRIGATION_REQUEST`,
  `IRRIGATION_STOP`, `INDICATE_WASTE` (`category`, `duration_ms`),
  `CLEAR_WASTE`, `TEST_MODE` (`on`), `TEST_OUTPUT` (`output`, `on`).
- **The ack is the contract:** `{protocol_version, command_id, type, result
  (ACCEPTED | REJECTED | DUPLICATE), reason_code, reason, at_uptime_ms,
  irrigation{...}}`. A **202/200 with `ACCEPTED` is the board's own statement**;
  nothing in the backend assumes a command worked because it was sent.
- **Every command has a reason code** (e.g. `IRRIGATION_BLOCKED_SOIL_WET`,
  `PUMP_MANUAL_ACTIVE`, `WASTE_INDICATED_PLASTIC`,
  `WASTE_INDICATOR_CLEARED`, `DUPLICATE_COMMAND`, `TEST_MODE_DISABLED`), which
  the app relays in the visitor's language where it has a sentence.

---

## 6. How a browser press becomes a pin

The path is **browser → backend → board → pin**, and each hop has one job:

1. **Browser** posts to `127.0.0.1:8010/api/v1/...` with a session cookie/token.
2. **Backend gateway** (`web/backend/app/device.py`) owns the only client:
   `httpx.AsyncClient(base_url=VILLAGE_DEVICE_URL, timeout=3 s,
   headers={"X-Device-Token": ...})`.
   - **Polling:** one background loop reads `/status` every
     `VILLAGE_POLL_INTERVAL_MS` (**1000 ms**); a snapshot older than
     `VILLAGE_STALE_AFTER_MS` (**4000 ms**) is marked **stale** and the page says
     so. Failures back off (the interval doubles, capped at 30 s) instead of
     hammering a board that is off.
   - **Commands** are sent with the browser's `request_id` as `command_id`, so a
     retry is the *same* command and the board answers `DUPLICATE` rather than
     acting twice.
   - **Config** writes carry the revision the page read; a 409 is surfaced as a
     conflict, not retried blindly.
3. **Demo vs Live is one place.** `VILLAGE_DEVICE_MODE=demo` uses a
   `SimulatedDevice`; `real` uses the HTTP client. Demo can never reach the
   hardware, and the page labels every simulated answer ("Simulated: …").
4. **Discovery** (`VILLAGE_DEVICE_DISCOVER=true`, currently **false** here):
   sweep the /24 of the configured URL for a host answering `/api/v1/health` with
   the token, at most once per `VILLAGE_DEVICE_DISCOVER_SECS` (60 s).

**Status the page shows comes from the board, not from the app's last command.**
A lamp, a pump state or a sensor reading is what `/status` reports; the ack only
says the command was accepted.

---

## 7. This venue: Windows hotspot + relay

The board's only network is the **Windows Mobile Hotspot**
(`192.168.137.0/24`). Windows ICS does **not route that subnet into WSL**, so the
backend in WSL cannot reach the board directly (a `curl` times out while the same
request from Windows answers 200). The fix in use:

```
backend (WSL) → Windows host :8090 → board :80 → pin
```

- `scripts/windows-device-relay.py` runs **on Windows** (copied to
  `%USERPROFILE%\village-flash\tcp-relay.py` by `scripts/relay.sh`), listens on
  `0.0.0.0:8090`, and forwards to the board's address.
- It **discovers** the board: probes the configured hint, and after two failures
  sweeps `192.168.137.0/24` for a host that looks like the board (a /80 that
  accepts a connection), then caches the new lease.
- `VILLAGE_DEVICE_URL=http://172.29.192.1:8090` (the Windows host on the WSL
  network); `VILLAGE_DEVICE_DISCOVER=false` because the relay does the sweeping.
- `scripts/relay.sh ensure` fixes the two things that move: the **WSL gateway**
  address (rewritten into `.env` before the backend starts) and the **hotspot**
  (asks Windows to switch it back on, then waits up to
  `VILLAGE_RELAY_HOTSPOT_WAIT`, 25 s). It is called by both `launch.sh` and
  `dev.sh`; `relay.sh watch` reruns it every 30 s and is started with them.
- `relay.sh status` is the one command that says whether the whole chain works —
  including `windows hotspot -> Off`, which looks exactly like a dead board.

**The hotspot switching itself off is the usual false alarm.** Windows turns it
back on within ~14 s while the laptop has an uplink to share; a hotspot found
`Off` almost always means the laptop lost Wi-Fi or woke from sleep.

---

## 8. OTA

- Build the OTA image: `uc/.pio/build/esp32doit-devkit-v1-ota/firmware.bin`
  (`pio run -e esp32doit-devkit-v1-ota`). The USB image
  (`esp32doit-devkit-v1`) must also be built with OTA compiled in — the default
  — because a board that is flashed without it can never be updated over Wi-Fi
  again.
- **Check the image before flashing:**
  `python3 -c "print(open('.../firmware.bin','rb').read().count(b'[ota] ready on'))"`
  must print **1**.
- The upload runs **on the Windows host** (the board cannot reach WSL's NAT
  address): `espota.exe -i <board-ip> -p 3232 -I <windows-hotspot-ip> -P 3233
  -a "<VILLAGE_OTA_PASSWORD>" -f ota-firmware.bin -r`.
- **Verify from the board, not from espota's output:** `/api/v1/status` →
  `firmware` (now `0.2.9`) and a **new `boot_id`**.
- A reflash does **not** reset configuration: NVS keeps calibration and the
  revision.

---

## 9. Failure modes, and what each looks like

| symptom | most likely cause | check |
| --- | --- | --- |
| `connected: false`, `stale: true`, Setup says `DEVICE_UNREACHABLE` | hotspot off, or the board is not powered | `./scripts/relay.sh status` (hotspot state + board) |
| app works from Windows but not from WSL | ICS does not route 192.168.137.0/24 | run the relay; `VILLAGE_DEVICE_URL` must point at the WSL gateway, not the board |
| board answered yesterday at .168, now nothing | DHCP lease moved | the relay's sweep finds it; `relay.sh status` names the address |
| board in AP mode (`village-…`) | it could not join the hotspot | serial log's `[net] scan` and the status code text |
| commands answer `REJECTED` with a reason | a real gate (wet soil, low tank, manual switch, test mode disabled) | `/status` `actuators`, `test`, `recent_events` |
| `/status` frozen but `/health` answers | sensor/loop problem rather than the network | `uptime_ms` and `sample_seq` |
| a 400 `CONFIG_REVISION_CONFLICT` | someone else saved first | reload the page, save again |

---

## 10. What is verified, and what is not

- The board's identity (`firmware 0.2.8` at the time of writing), Wi-Fi join,
  polling, commands, config save/load and the **bin LED selection** have all been
  exercised on the physical board. The operator has confirmed the LEDs light for
  the selected bin.
- **`CLEAR_WASTE` (firmware 0.2.9) is new** and has been tested on the host and
  the simulator only; it needs one press on the board. The 8-second automatic
  switch-off is the existing, verified behaviour and is unchanged.
- **Not verified here:** USB flashing from this container (the CP210x belongs to
  Windows; WSL does not see it), and OTA while the board is unreachable.

---

## 11. Invariants — do not change these without a board in hand

1. **The token stays server-side.** No browser request carries
   `X-Device-Token`.
2. **An ack is the only proof.** Never report a pin state from what was sent.
3. **Demo can never reach hardware** (`VILLAGE_DEVICE_MODE`, one selection).
4. **A command id is idempotent**; retries reuse it.
5. **Config writes are revision-checked**; a conflict is shown, not retried.
6. **The pump has two gates and a tank check**; the boot guard stays.
7. **Only ADC1 for analogue** while Wi-Fi is on.
8. **OTA image must be able to OTA** (marker = 1) and the pump is forced off
   during an update.
9. **The hotspot is part of the chain**, not an accessory: no hotspot, no board.

---

## 12. File map and commands

| path | what it is |
| --- | --- |
| `uc/platformio.ini` | board, framework, the two environments (USB, OTA) |
| `uc/include/village/pins.h` | pin map + compile-time safety checks |
| `uc/include/village/build_config.h` | firmware/protocol versions, boot guard, OTA and bench flags |
| `uc/src/main.cpp` | the loop and the order of work |
| `uc/src/net.cpp` | Wi-Fi join, AP fallback, mDNS, OTA service |
| `uc/src/api.cpp` | the five endpoints, commands, acks, status/health payloads |
| `uc/src/sensors.cpp` | sampling periods, reservoir state machine |
| `uc/src/config_store.cpp`, `config_json.cpp` | NVS JSON, revision, defaults |
| `uc/test/` | host tests for the portable safety core (68 tests / 513 checks) |
| `web/backend/app/device.py` | HTTP device client, polling, staleness, commands |
| `web/backend/app/simulator.py` | the demo device (never the hardware) |
| `scripts/relay.sh`, `scripts/windows-device-relay.py` | the Windows-side TCP relay |
| `scripts/whisper.sh` | not the board — listed so a reader does not confuse the two local servers |

```bash
cd uc
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1        # USB image
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1-ota    # OTA image
cd .. && ./scripts/test_firmware.sh                              # host tests, no board
./scripts/relay.sh status                                        # is the chain healthy?
curl -s -H "X-Device-Token: $TOKEN" http://<board-ip>/api/v1/health
```
