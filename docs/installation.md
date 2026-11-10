# Installation

This build is designed to run on one laptop, offline, after the one-time setup.
The laptop serves the dashboard, runs the local Whisper server and talks to the
ESP32 over the school Wi-Fi.

## 1. What you need

| Item | Minimum |
| --- | --- |
| Laptop | Linux, macOS or Windows with WSL2; 8 GB RAM recommended |
| Python | 3.11 or newer |
| Node.js | 22 or newer |
| PlatformIO | for flashing the ESP32 only |
| Browser | Chromium-based browser recommended (camera, microphone, speech synthesis) |
| Board | The purchased **30-pin NodeMCU-style ESP32-WROOM-32** board |
| Network | A private Wi-Fi network (no internet needed during the exhibition) |

The 30-pin board was confirmed from the seller's page and product photo
(ESP32-WROOM-32 shield, AMS1117, 4 MB flash, micro-USB). Read
[`wiring.md`](wiring.md) before connecting anything.

## 2. One-time setup

```bash
cd /path/to/aivillage
./scripts/setup.sh
```

The script creates `.env` and `uc/include/village/secrets.h` if they are
missing, installs the backend into a Python virtual environment and installs
the frontend packages.

If Python reports that `ensurepip` is missing (common on Ubuntu), install
`python3-venv` with `sudo apt install python3-venv`, or install `virtualenv`:

```bash
python3 -m pip install --user --break-system-packages virtualenv
./scripts/setup.sh
```

## 3. Download the speech model

```bash
./scripts/download_models.sh
```

This downloads the **multilingual** `models/whisper/ggml-base.bin` (about
142 MB) and verifies its SHA-256. Do **not** use `ggml-base.en.bin`; it only
understands English.

### Choosing a larger model

The model is whatever `VILLAGE_WHISPER_MODEL` in `.env` names, and
`scripts/launch.sh` starts the server with it. Any multilingual ggml build
works:

| File | Size | Use |
| --- | ---: | --- |
| `ggml-base.bin` | 142 MB | default; fine for clear English commands |
| `ggml-small.bin` | ~466 MB | sensible minimum for Malayalam/Hindi |
| `ggml-large-v3-turbo.bin` | ~1.6 GB | near-large accuracy at much lower cost — recommended for ml/hi |
| `ggml-large-v3.bin` | ~2.9 GB | best accuracy, heaviest |

Download the extra file into `models/whisper/` and point the variable at it,
for example:

```bash
curl -L -o models/whisper/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
# .env
VILLAGE_WHISPER_MODEL=models/whisper/ggml-large-v3-turbo.bin
```

An English-only `*.en.bin` file is refused by the backend with
`WHISPER_MODEL_WRONG`, whichever name it has.

### Build whisper.cpp once

```bash
python3 -m pip install --user cmake     # or install cmake normally
git clone --depth 1 https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=ON
cmake --build build -j --target whisper-server
```

Then either copy `build/bin/whisper-server` to
`models/whisper/whisper-server`, or set in `.env`:

```
VILLAGE_WHISPER_BIN=/absolute/path/to/whisper-server
```

`scripts/launch.sh` starts it automatically if the binary and model exist. The
model stays loaded between requests.

### Waste classifier

Train a Teachable Machine image model and copy its three exported files into
`models/waste/`. Full instructions: [`waste-model.md`](waste-model.md). If the
files are missing, the Waste page honestly says **Recognition model not
installed** and no prediction is made.

## 4. Configure the backend

Edit `.env`:

```dotenv
VILLAGE_DEVICE_MODE=simulator     # simulator | real
VILLAGE_DEVICE_URL=http://192.168.1.50
VILLAGE_DEVICE_TOKEN=replace-with-a-long-random-token
VILLAGE_WHISPER_URL=http://127.0.0.1:8181
VILLAGE_PORT=8010
```

- **simulator**: no hardware; everything is simulated and clearly labelled.
- **real**: the backend talks to the ESP32 at `VILLAGE_DEVICE_URL`.
- The token must exactly match `VILLAGE_DEVICE_TOKEN` in
  `uc/include/village/secrets.h`.
- The backend binds to `127.0.0.1` by default. Do not expose it to the
  internet. Leave the default unless you deliberately want another laptop on
  the same private network to open the dashboard.

If port 8000 is already used by another project, keep `VILLAGE_PORT=8010`.
`launch.sh` refuses to kill an unrelated process on the port.

## 5. Firmware: configure and flash

1. Copy `uc/include/village/secrets.example.h` to
   `uc/include/village/secrets.h` (the setup script does this).
2. Fill in `VILLAGE_WIFI_SSID`, `VILLAGE_WIFI_PASS`, and a long random
   `VILLAGE_DEVICE_TOKEN` matching `.env`.
3. Set the board/profile in `uc/platformio.ini`:
   `board = esp32doit-devkit-v1` (the 30-pin DOKit V1 layout). Verify the
   physical module says **ESP32-WROOM-32**, not WROVER, before connecting the
   bin triggers on GPIO 16/17.
4. Build:
   ```bash
   cd uc
   pio run -e esp32doit-devkit-v1
   ```
5. Connect the board by USB and flash:
   ```bash
   pio run -e esp32doit-devkit-v1 -t upload
   pio device monitor -b 115200
   ```
6. The serial log prints the IP address and the boot identity. Use that IP as
   `VILLAGE_DEVICE_URL`. If station mode fails, the board starts its fallback
   access point (`Village-Setup`) after 15 seconds; it does not switch networks
   again during the demonstration.

**The pump is disabled by default in two places:** the compile-time flag
`VILLAGE_PUMP_COMMISSIONED` in `uc/include/village/build_config.h` is `0`, and
`config.irrigation.pump_enabled` is `false`. Complete the
[bench test](bench-test.md), then set `VILLAGE_PUMP_COMMISSIONED 1`, reflash,
and enable the pump in **Setup → Advanced → Pump commissioning**. That two-key gate is
deliberate.

### Windows-ready merged image

For flashing from Windows without PlatformIO, build and export a single image:

```bash
./scripts/export_firmware.sh
```

It writes to:

```
C:\Users\<your-windows-user>\Downloads\aivillage-firmware\
    village-firmware-merged.bin   <-- flash at 0x0
    FLASH-WINDOWS.txt
    flash-merged.bat
    bootloader.bin / partitions.bin / boot_app0.bin / firmware.bin
```

The merged image is the correct one for a fresh board. Use esptool:

```bat
py -m pip install esptool
py -m esptool --chip esp32 --port COM5 --baud 921600 write_flash -z 0x0 village-firmware-merged.bin
```

Or use the Espressif Flash Download Tool: ESP32, DIO, 40 MHz, 4 MB, the merged
file at `0x0`. The individual files are exported too, for the multi-file
alternative in `FLASH-WINDOWS.txt`.

**The Wi-Fi values come from `uc/include/village/secrets.h`, which is
git-ignored.** A fresh checkout has the placeholder SSID `VillageLab`, so if
you flash it unchanged station mode fails after 15 s and the board starts its
fallback access point `Village-Setup` (password `village1234`, address
`http://192.168.4.1`). That fallback is usable for a demonstration — connect the
laptop to that AP, set `VILLAGE_DEVICE_MODE=real` and
`VILLAGE_DEVICE_URL=http://192.168.4.1`, then restart the backend — but the
laptop then has no internet.

For the home Wi-Fi (so the laptop keeps its internet), put the SSID and
password in `secrets.h`, re-run the export script, flash the refreshed image,
and use the IP printed in the boot log:

```text
[net] connected: IP 192.168.1.8, RSSI -79 dBm
[net] mDNS: http://village.local/
```

### Updating firmware without the USB cable (OTA)

The build starts a password-protected ArduinoOTA listener on **port 3232** as
soon as it joins the Wi-Fi. The password is `VILLAGE_OTA_PASSWORD` in
`uc/include/village/secrets.h`. Turn the feature off entirely with
`#define VILLAGE_ENABLE_OTA 0` in `uc/include/village/build_config.h`.

**Run the uploader on Windows, not inside WSL.** The board opens a UDP
connection back to the sender, and WSL sits behind a NAT the LAN cannot reach;
an upload started in WSL authenticates and then stalls with
`No response from device`.

Copy the exported folder (`scripts/export_firmware.sh` does this) and then, in
`C:\Users\<you>\Downloads\aivillage-firmware\`:

1. Put the OTA password in `ota_auth.tmp` — just the password, nothing else.
   The helper deletes the file as it reads it, so the password never appears on
   the command line.
2. Run:
   ```bat
   python\python.exe tools\ota_flash.py 192.168.1.8
   ```

Expected output:

```text
Sending invitation to 192.168.1.8
Authenticating...OK
Uploading ... 100%
```

The board prints `[ota] update starting; pump and lamps forced off`, shows
progress every 10%, then reboots. Because the flash layout has two app slots
(`app0`/`app1`), a failed update does not brick the board: it boots the image
that was already working.

If you prefer PlatformIO on a Linux host that shares the board's LAN (not WSL):

```bash
export VILLAGE_OTA_PASSWORD="$(sed -n 's/.*VILLAGE_OTA_PASSWORD "\(.*\)"/\1/p' uc/include/village/secrets.h)"
cd uc
pio run -e esp32doit-devkit-v1-ota -t upload --upload-port 192.168.1.8
```

USB flashing always remains the recovery path.

## 6. Run

```bash
./scripts/launch.sh
```

The script builds the dashboard, starts Whisper if available, starts FastAPI,
waits for the health check and prints the URL. Typical output:

```
Village URL: http://127.0.0.1:8010/
```

Open it in a browser. For development with hot reload:

```bash
./scripts/dev.sh
```

Stop only this project's processes:

```bash
./scripts/stop.sh
```

## 7. Offline check

Before the exhibition, disconnect the laptop from the internet (keep the local
Wi-Fi router on) and confirm:

- the dashboard loads;
- the simulator or ESP32 is reachable;
- Whisper transcribes a short English phrase;
- the camera model loads.

No fonts, icons, scripts or models are fetched from a CDN. The app uses
locally bundled fonts and inline SVG icons.

## 8. Windows notes

The Python and Node commands are the same. Use PowerShell equivalents for the
shell scripts, or run them inside WSL2. The camera/microphone permissions are
managed by Windows Settings → Privacy. PlatformIO installs a USB-serial driver
for the board's CP2102/CH340 chip; install it if the port does not appear.
