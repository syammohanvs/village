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

The board joins `ASIANET Giga Fiber` and is normally at **192.168.1.8**; the
Windows host is **192.168.1.6**. The OTA password is
`VILLAGE_OTA_PASSWORD` in `uc/include/village/secrets.h` (git-ignored — never
copy it into this file or a commit).

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
   .\espota.exe -i 192.168.1.8 -p 3232 -I 192.168.1.6 -P 3233 `
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
/home/ubuntu/.venvs/pio/bin/pio run -e esp32doit-devkit-v1-ota -t upload --upload-port 192.168.1.8
```

From WSL you can invoke Windows tools with `powershell.exe` / `cmd.exe`
(interop is enabled); that is how the verified upload was run without leaving
the session.

### Verify the board after flashing

The device API needs `X-Device-Token` (same value as `VILLAGE_DEVICE_TOKEN` in
`.env` / `secrets.h`). The state path is **`/api/v1/status`**, not `/state`:

```bash
TOKEN="$(grep -oP 'VILLAGE_DEVICE_TOKEN "\K[^"]+' uc/include/village/secrets.h)"
curl -s -H "X-Device-Token: $TOKEN" http://192.168.1.8/api/v1/status | python3 -m json.tool | head
curl -s -H "X-Device-Token: $TOKEN" http://192.168.1.8/api/v1/config | python3 -m json.tool | head
```

Through the backend (what the dashboard reads):

```bash
curl -s "http://127.0.0.1:8010/api/v1/state?mode=live" | python3 -m json.tool | head
```

Check `firmware`, `config_revision`, and
`status.sensors.light` (`raw`, `brightness`, `valid`, `age_ms`).

### Gotchas that cost time

- **A reflash does not reset the stored config.** It lives in NVS and survives
  the update; `config_revision` stays the same. If a firmware default changed,
  save the config once from Setup (or reset the config) to apply it.
- **The board's IP is DHCP.** `192.168.1.8` is the usual address; confirm from
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
  the browser). A bare `curl http://192.168.1.8/api/v1/state` returning
  `unknown endpoint` is expected, not a dead board.

## LDR calibration (this build)

Wiring: `3V3 -> 10 kΩ -> GPIO 32 -> LDR -> GND` (resistor to 3.3 V, LDR to
ground). The reading falls with light, so:

- `output_type = analog`
- `analog_bright_high = false`
- measured raw: **~3090 dark / ~1870 dim / ~730 bright**
- `dark_threshold = 1500`, `bright_threshold = 2800`, `stable_ms = 4000`

Opposite wiring (LDR to 3.3 V, resistor to GND) needs
`analog_bright_high = true`. See `docs/wiring.md` § "LDR (light sensor)".

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

The current install (2026-11-13, **V6**) was retrained after brown paper,
bottle caps, ball pens and a **car key read as Leather** were misread.
`build_waste_dataset.mjs` assembles the training tree from the bootstrap,
TrashNet's unused `cardboard` folder and Commons photos of caps, pens, paper
bags, foam, key fobs, keys, phones, watches, wallets and sunglasses; the
install repeated the **key-fob photos 6x** and left the phone/watch extras out
of its Ewaste tree (they pulled paper into e-waste). On the same 953 photos the
previous V3 scores **85.6%** and V6 **85.1%**, but item-level action accuracy
is **89.4% → 90.6%** (bin 91.8% → 87.4%, recycler 87.5% → 93.1%) and the
236-photo real-world probe is **62.3% → 64.8%**. The car-key check is the
direct result: V3 read 8 car-key photos as 4 Metal, 3 Ewaste and 1 Paper, V6
as **3 Metal and 5 Ewaste — all eight recycler materials, none Leather**.
V3 is kept at `models/waste-v3-20261113/` because its bin accuracy is better.
`evaluate_waste_model.mjs` reproduces the comparison and
`predict_waste_image.mjs` shows the top classes for one photo.

The Sort Waste camera now **focuses on the object and paints out the table**:
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
