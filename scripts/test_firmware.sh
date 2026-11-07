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

if command -v pio >/dev/null 2>&1; then
  echo
  echo "PlatformIO found. Building the ESP32 firmware..."
  (cd "$ROOT/uc" && pio run -e esp32doit-devkit-v1)
else
  echo
  echo "PlatformIO not on PATH; firmware image not built."
  echo "Install it with: pip install platformio"
fi
