#!/usr/bin/env bash
# Compile and run the portable firmware safety core on the host.
# No ESP32, no PlatformIO and no internet are required for this test.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/uc/.pio/native"
mkdir -p "$OUT_DIR"
BIN="$OUT_DIR/village_core_tests"

CXX="${CXX:-g++}"
"$CXX" -std=c++17 -Wall -Wextra -Werror \
  -I "$ROOT/uc/include" \
  "$ROOT"/uc/test/*.cpp \
  -o "$BIN"

"$BIN"

PIO_BIN="$(command -v pio || true)"
if [ -z "$PIO_BIN" ] && [ -x "$HOME/.venvs/pio/bin/pio" ]; then
  PIO_BIN="$HOME/.venvs/pio/bin/pio"
fi

if [ -n "$PIO_BIN" ]; then
  echo
  echo "PlatformIO found. Building the ESP32 firmware..."
  (cd "$ROOT/uc" && "$PIO_BIN" run -e esp32doit-devkit-v1)
else
  echo
  echo "PlatformIO not found; firmware image not built."
  echo "Install it with: pip install platformio"
fi
