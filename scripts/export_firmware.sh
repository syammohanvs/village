#!/usr/bin/env bash
# Build the ESP32 firmware and export a Windows-ready merged image.
# The output folder is outside git; the binary contains the Wi-Fi/token values
# from uc/include/village/secrets.h, so review that file before exporting.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PIO_BIN="${VILLAGE_PIO:-$(command -v pio || true)}"
if [ -z "$PIO_BIN" ] && [ -x "$HOME/.venvs/pio/bin/pio" ]; then
  PIO_BIN="$HOME/.venvs/pio/bin/pio"
fi
[ -n "$PIO_BIN" ] || { echo "PlatformIO not found. Install it or set VILLAGE_PIO."; exit 1; }

BUILD="$ROOT/uc/.pio/build/esp32doit-devkit-v1"
BOOTAPP="$HOME/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin"
ESPTOOL="$HOME/.platformio/packages/tool-esptoolpy/esptool.py"
PIO_PY="$HOME/.venvs/pio/bin/python"
[ -x "$PIO_PY" ] || PIO_PY="$(command -v python3)"
[ -f "$BOOTAPP" ] || { echo "boot_app0.bin not found at $BOOTAPP"; exit 1; }
[ -f "$ESPTOOL" ] || { echo "esptool.py not found at $ESPTOOL"; exit 1; }

echo "== Building firmware =="
(cd "$ROOT/uc" && "$PIO_BIN" run -e esp32doit-devkit-v1)

echo "== Creating one-file merged image =="
"$PIO_PY" "$ESPTOOL" --chip esp32 merge_bin \
  -o "$BUILD/village-firmware-merged.bin" \
  --flash_mode dio --flash_freq 40m --flash_size 4MB \
  0x1000 "$BUILD/bootloader.bin" \
  0x8000 "$BUILD/partitions.bin" \
  0xe000 "$BOOTAPP" \
  0x10000 "$BUILD/firmware.bin"

WIN_USER="${VILLAGE_WIN_USER:-$(cmd.exe /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r\n' || true)}"
[ -n "$WIN_USER" ] || WIN_USER="$(whoami)"
DEST="${VILLAGE_EXPORT_DIR:-/mnt/c/Users/$WIN_USER/Downloads/aivillage-firmware}"
mkdir -p "$DEST"

cp "$BUILD/village-firmware-merged.bin" "$DEST/"
cp "$BUILD/firmware.bin" "$DEST/"
cp "$BUILD/bootloader.bin" "$DEST/"
cp "$BUILD/partitions.bin" "$DEST/"
cp "$BOOTAPP" "$DEST/boot_app0.bin"
cp "$ROOT/uc/include/village/secrets.example.h" "$DEST/secrets.example.h"

# Show the configured SSID (never the password/token) and warn if placeholders
# are still in use.
SSID="$(grep -E '^#define VILLAGE_WIFI_SSID' "$ROOT/uc/include/village/secrets.h" | sed -E 's/.*"(.*)"/\1/' || true)"
PLACEHOLDER=0
grep -q 'YOUR_WIFI_NAME\|VillageLab' "$ROOT/uc/include/village/secrets.h" && PLACEHOLDER=1
grep -q 'not-a-real-password' "$ROOT/uc/include/village/secrets.h" && PLACEHOLDER=1

cat > "$DEST/FLASH-WINDOWS.txt" <<EOF
Smart Green Village — ESP32 firmware
====================================

Files
-----
village-firmware-merged.bin   <-- flash THIS at 0x0 (one file)
firmware.bin                  app only (0x10000) — not for a fresh board
bootloader.bin                (0x1000)
partitions.bin                (0x8000)
boot_app0.bin                 (0xe000)
secrets.example.h             reference only

Board
-----
30-pin NodeMCU-style ESP32-WROOM-32 DevKit V1, 4 MB flash.
Flash mode: DIO   Frequency: 40 MHz   Size: 4 MB

CURRENT BUILD
-------------
Configured SSID: ${SSID:-unknown}
Placeholder Wi-Fi/password still in use: $([ "$PLACEHOLDER" = 1 ] && echo YES || echo no)

The pump is DISABLED in this build (VILLAGE_PUMP_COMMISSIONED 0 and
pump_enabled false). A first flash cannot move water.

If the placeholder SSID is used, station mode will fail after 15 s and the
board starts its fallback access point:
  SSID:     Village-Setup
  Password: village1234
  Address:  http://192.168.4.1
Connect the laptop to Village-Setup and set VILLAGE_DEVICE_URL to
http://192.168.4.1 (VILLAGE_DEVICE_MODE=real) if you want to use that mode.

For your home Wi-Fi instead:
  1. Edit WSL file
     /home/ubuntu/aivillage/uc/include/village/secrets.h
     (or \\\\wsl.localhost\\Ubuntu\\home\\ubuntu\\aivillage\\uc\\include\\village\\secrets.h)
     Set VILLAGE_WIFI_SSID, VILLAGE_WIFI_PASS and a long VILLAGE_DEVICE_TOKEN.
     Put the same token in /home/ubuntu/aivillage/.env.
  2. Re-run:  ./scripts/export_firmware.sh
  3. Flash the refreshed village-firmware-merged.bin.

Flash with esptool (Windows)
----------------------------
Install Python, then:  py -m pip install esptool
Open Command Prompt in this folder and run:

  py -m esptool --chip esp32 --port COM5 --baud 921600 ^
      write_flash -z 0x0 village-firmware-merged.bin

Replace COM5 with the board's port (Device Manager -> Ports).
If it cannot connect, hold BOOT, start the command, release BOOT after
"Connecting...". Use a data-capable USB cable.

Or use the Espressif Flash Download Tool (Windows GUI):
  Chip: ESP32   Mode: DIO   Freq: 40MHz   Size: 4MB
  Add village-firmware-merged.bin at 0x0, choose the COM port, START.

Multi-file alternative (same result)
------------------------------------
  py -m esptool --chip esp32 --port COM5 --baud 921600 ^
    write_flash -z 0x1000 bootloader.bin 0x8000 partitions.bin ^
    0xe000 boot_app0.bin 0x10000 firmware.bin

After flashing
--------------
- Open a serial monitor at 115200 baud. The board prints its IP and boot id.
- If you changed the token, update VILLAGE_DEVICE_TOKEN in .env and restart:
    ./scripts/launch.sh
- Set VILLAGE_DEVICE_MODE=real and VILLAGE_DEVICE_URL=http://<board-ip>.
- Do not connect the pump until docs/bench-test.md is complete.
EOF

cat > "$DEST/flash-merged.bat" <<'BAT'
@echo off
setlocal
where py >nul 2>nul
if %errorlevel%==0 (set PY=py) else (set PY=python)
set /p PORT=Enter COM port (for example COM5): 
%PY% -m esptool --chip esp32 --port %PORT% --baud 921600 write_flash -z 0x0 "%~dp0village-firmware-merged.bin"
pause
BAT

echo
echo "Exported to Windows:"
echo "  C:\\Users\\$WIN_USER\\Downloads\\aivillage-firmware\\"
ls -lh "$DEST"
echo
if [ "$PLACEHOLDER" = 1 ]; then
  echo "WARNING: secrets.h still has placeholder Wi-Fi. The board will use the"
  echo "         Village-Setup AP fallback until you edit it and re-export."
fi
