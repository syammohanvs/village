#!/usr/bin/env bash
# Development mode: FastAPI with reload + Vite dev server.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env
# Before .env is sourced: the board may be on the Windows hotspot, which this
# container cannot route to, and the relay/address can have changed since the
# last start.  Best effort -- a missing board must not stop the app.
./scripts/relay.sh ensure || true
# Windows switches its Mobile Hotspot off by itself (twice on 2026-11-16, once
# mid-demo), which reads as "the board is dead".  Keep a watcher on it for the
# life of this run; stop.sh kills it with the rest.
if ! pgrep -f "relay[.]sh wat[c]h" >/dev/null 2>&1; then
  setsid ./scripts/relay.sh watch > data/logs/relay-watch.log 2>&1 < /dev/null &
  echo $! > data/run/relay-watch.pid
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a
VENV="${VILLAGE_VENV:-$ROOT/.venv}"
HOST="${VILLAGE_BIND_HOST:-127.0.0.1}"
PORT="${VILLAGE_PORT:-8000}"

[ -x "$VENV/bin/uvicorn" ] || { echo "Run ./scripts/setup.sh first."; exit 1; }

cleanup() {
  trap - INT TERM EXIT
  [ -n "${VITE_PID:-}" ] && kill "$VITE_PID" 2>/dev/null || true
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  rm -f "$ROOT/data/run/backend.pid" "$ROOT/data/run/vite.pid"
}
trap cleanup INT TERM EXIT

mkdir -p "$ROOT/data/run"
# Same PID files as the non-dev launch, so ./scripts/stop.sh can stop a dev
# session too instead of leaving it to be hunted down by hand.
"$VENV/bin/uvicorn" app.main:app --app-dir web/backend --host "$HOST" --port "$PORT" --reload &
API_PID=$!
echo "$API_PID" > "$ROOT/data/run/backend.pid"
(cd web/frontend && npm run dev -- --host 127.0.0.1) &
VITE_PID=$!
echo "$VITE_PID" > "$ROOT/data/run/vite.pid"
printf '\nAPI:  http://%s:%s/api/v1/system/health\nUI:   http://127.0.0.1:5173/ (Vite proxies /api and /models)\n' "$HOST" "$PORT"
wait
