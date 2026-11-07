#!/usr/bin/env bash
# Download the multilingual Whisper model and show the waste-model steps.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p models/whisper models/waste

MODEL="models/whisper/ggml-base.bin"
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
SHA="60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"

if [ -f "$MODEL" ]; then
  echo "Model already present: $MODEL"
else
  echo "Downloading the multilingual base model (~142 MB)..."
  curl -L --fail --retry 3 -o "$MODEL.part" "$URL"
  mv "$MODEL.part" "$MODEL"
fi

echo "Checking SHA-256..."
ACTUAL="$(sha256sum "$MODEL" | awk '{print $1}')"
if [ "$ACTUAL" != "$SHA" ]; then
  echo "WARNING: checksum mismatch."
  echo "  expected $SHA"
  echo "  actual   $ACTUAL"
  echo "Delete the file and re-run, or verify your download."
  exit 1
fi
echo "OK: $ACTUAL"

if [ ! -x models/whisper/whisper-server ] && [ ! -x /tmp/opencode/whisper.cpp/build/bin/whisper-server ]; then
  cat <<'EOF'

whisper-server is not installed here. Build it once:
  pip install cmake            # or use your system cmake
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp
  cd whisper.cpp
  cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=ON
  cmake --build build -j --target whisper-server
Then either copy build/bin/whisper-server to models/whisper/whisper-server
or set VILLAGE_WHISPER_BIN=/path/to/whisper-server in .env.
EOF
fi

cat <<'EOF'

Waste classifier (must be supplied by you):
  1. Open https://teachablemachine.withgoogle.com/train/image
  2. Train four classes: Organic, Plastic, Paper, Background.
  3. Export -> TensorFlow.js -> download.
  4. Copy model.json, metadata.json and weights.bin into models/waste/.
  See docs/waste-model.md for collection and testing advice.

The app reports "Recognition model not installed" until those files exist.
It never substitutes random predictions.
EOF
