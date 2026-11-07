#!/usr/bin/env bash
# One-time setup for the Smart Green Village.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

info() { printf '\n== %s ==\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

info "Checking prerequisites"
command -v python3 >/dev/null || fail "python3 is required"
command -v node >/dev/null || fail "Node.js is required (22 or newer)"
command -v npm >/dev/null || fail "npm is required"
PY_VERSION="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
NODE_VERSION="$(node -v)"
printf 'python %s, node %s\n' "$PY_VERSION" "$NODE_VERSION"
python3 - <<'PY'
import sys
if sys.version_info < (3, 11):
    raise SystemExit("Python 3.11+ is required")
PY
node - <<'JS'
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) { console.error('Node 22+ is required'); process.exit(1); }
JS

info "Environment file"
if [ ! -f .env ]; then
  cp .env.example .env
  printf 'Created .env from .env.example. Edit the device IP/token before using real hardware.\n'
else
  printf '.env already exists; leaving it untouched.\n'
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a

info "Python virtual environment"
VENV="${VILLAGE_VENV:-$ROOT/.venv}"
if [ -x "$VENV/bin/python" ]; then
  printf 'Using existing virtual environment at %s\n' "$VENV"
elif python3 -m venv "$VENV" >/dev/null 2>&1; then
  printf 'Created %s\n' "$VENV"
elif command -v virtualenv >/dev/null 2>&1; then
  virtualenv -q "$VENV"
  printf 'Created %s with virtualenv\n' "$VENV"
else
  fail "Could not create a Python virtual environment. On Debian/Ubuntu run:
  sudo apt install python3-venv
or
  python3 -m pip install --user --break-system-packages virtualenv
then re-run ./scripts/setup.sh"
fi
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r web/backend/requirements.txt

info "Frontend dependencies"
if [ -f web/frontend/package-lock.json ]; then
  (cd web/frontend && npm ci)
else
  (cd web/frontend && npm install)
fi

info "Local folders"
mkdir -p models/whisper models/waste data/logs data/run
if [ ! -f uc/include/village/secrets.h ]; then
  cp uc/include/village/secrets.example.h uc/include/village/secrets.h
  printf 'Created uc/include/village/secrets.h. Fill in Wi-Fi and the device token, then flash.\n'
fi
if [ ! -f models/whisper/ggml-base.bin ]; then
  printf '\nWhisper model missing. Run ./scripts/download_models.sh (about 142 MB).\n'
fi
if [ ! -f models/waste/model.json ]; then
  printf '\nWaste model missing. See docs/waste-model.md; the app will say "Recognition model not installed".\n'
fi

info "Done"
printf 'Next:\n  1. ./scripts/download_models.sh\n  2. edit .env for real hardware (VILLAGE_DEVICE_MODE=real)\n  3. ./scripts/launch.sh\n'
