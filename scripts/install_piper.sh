#!/usr/bin/env bash
# Install the local neural voice (Piper) used for spoken replies.
#
# Piper is a VITS text-to-speech engine: it sounds like a person rather than
# the formant synthesis of espeak, and it runs far faster than real time on
# this CPU.  The dashboard uses one female voice per language so English,
# Hindi and Malayalam sound like the same speaker family.
#
# The engine is the MIT standalone release; it bundles its own onnxruntime and
# espeak-ng, so no system packages and no sudo are needed.
#
# Everything lands in models/ (git-ignored), like the Whisper model:
#   models/piper/piper            the engine
#   models/piper/voices/*.onnx    the voices
#
# Re-running is safe: existing files are kept.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${VILLAGE_PIPER_DIR:-$ROOT/models/piper}"
VOICES="$DEST/voices"
VERSION="2023.11.14-2"
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main"

# English has no en_IN voice in Piper; Lessac is a clear female US voice and is
# the only English voice of the three that this engine build can phonemise.
# (Newer voices such as en_GB-jenny_dioco use a phoneme map this build rejects.)
VOICE_LIST=(
  "en/en_US/lessac/medium/en_US-lessac-medium"
  "hi/hi_IN/priyamvada/medium/hi_IN-priyamvada-medium"
  "ml/ml_IN/meera/medium/ml_IN-meera-medium"
)

info() { printf '\n== %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { printf 'ERROR: %s is required.\n' "$1" >&2; exit 1; }; }

need curl
need tar
need python3

mkdir -p "$DEST" "$VOICES"

if [ ! -x "$DEST/piper" ]; then
  info "Downloading the Piper engine (MIT, ~26 MB, bundles onnxruntime + espeak-ng)"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fL --retry 3 -o "$TMP/piper.tgz" \
    "https://github.com/rhasspy/piper/releases/download/$VERSION/piper_linux_x86_64.tar.gz"
  mkdir -p "$TMP/extract"
  tar xzf "$TMP/piper.tgz" -C "$TMP/extract"
  cp -r "$TMP/extract/piper/." "$DEST/"
  chmod +x "$DEST/piper"
else
  info "Piper engine already present"
fi

for spec in "${VOICE_LIST[@]}"; do
  name="$(basename "$spec")"
  if [ -s "$VOICES/$name.onnx" ] && [ -s "$VOICES/$name.onnx.json" ]; then
    info "Voice $name already present"
    continue
  fi
  info "Downloading voice $name (~61 MB)"
  curl -fL --retry 3 -o "$VOICES/$name.onnx" "$BASE/$spec.onnx"
  curl -fL --retry 3 -o "$VOICES/$name.onnx.json" "$BASE/$spec.onnx.json"
done

info "Check"
printf '%s\n' "The village is ready." \
  | "$DEST/piper" -m "$VOICES/ml_IN-meera-medium.onnx" -f /tmp/piper-check.wav >/dev/null 2>&1 \
  && python3 - <<'PY'
import wave
with wave.open('/tmp/piper-check.wav') as w:
    print(f"  synthesised {w.getnframes() / w.getframerate():.2f}s of Malayalam at {w.getframerate()} Hz")
PY
rm -f /tmp/piper-check.wav

printf '\nPiper is installed in %s\n' "$DEST"
printf 'Models: English (Lessac), Hindi (Priyamvada), Malayalam (Meera) — all female, 22,050 Hz.\n'
printf 'Licences: Piper engine MIT; voices repository MIT (rhasspy/piper-voices).\n'
printf '          The Meera model card attributes its training data to the Kaggle\n'
printf '          Indic TTS Malayalam corpus; check that licence before publishing publicly.\n'
