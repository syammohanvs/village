#!/usr/bin/env bash
# Build and start the village on one localhost origin, with whisper.cpp if
# available.  Safe to re-run: it only stops the process recorded in
# data/run/backend.pid (or whisper.pid), never unrelated processes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p data/logs data/run

if [ ! -f .env ]; then cp .env.example .env; fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a

HOST="${VILLAGE_BIND_HOST:-127.0.0.1}"
PORT="${VILLAGE_PORT:-8000}"
VENV="${VILLAGE_VENV:-$ROOT/.venv}"
WHISPER_BIN="${VILLAGE_WHISPER_BIN:-$ROOT/models/whisper/whisper-server}"
WHISPER_URL="${VILLAGE_WHISPER_URL:-http://127.0.0.1:8181}"

info() { printf '\n== %s ==\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -x "$VENV/bin/python" ] || fail "Python environment missing: $VENV. Run ./scripts/setup.sh."
[ -d web/frontend/node_modules ] || fail "Frontend dependencies missing. Run ./scripts/setup.sh."

info "Building the dashboard"
(cd web/frontend && npm run build)

info "Stopping the previous village backend (only if it is ours)"
if [ -f data/run/backend.pid ]; then
  OLD_PID="$(cat data/run/backend.pid || true)"
  if [ -n "${OLD_PID:-}" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$OLD_PID" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
  rm -f data/run/backend.pid
fi

if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q "[:.]${PORT}$"; then
  fail "Port ${PORT} is already in use by another process. Set VILLAGE_PORT in .env to a free port."
fi

info "Starting whisper.cpp (if the binary and model are present)"
WHISPER_READY=0
if curl -fsS -m 2 "${WHISPER_URL}/health" >/dev/null 2>&1; then
  WHISPER_READY=1
  printf 'Whisper is already running at %s\n' "$WHISPER_URL"
elif [ -x "$WHISPER_BIN" ] && [ -f models/whisper/ggml-base.bin ]; then
  WP="${WHISPER_URL##*:}"
  WP="${WP%%/*}"
  HOSTPART="${WHISPER_URL#*://}"
  HOSTPART="${HOSTPART%%:*}"
  if [ -f data/run/whisper.pid ]; then
    OLD_WPID="$(cat data/run/whisper.pid || true)"
    if [ -n "${OLD_WPID:-}" ] && kill -0 "$OLD_WPID" 2>/dev/null; then kill "$OLD_WPID" 2>/dev/null || true; fi
    rm -f data/run/whisper.pid
  fi
  setsid "$WHISPER_BIN" -m models/whisper/ggml-base.bin --host "$HOSTPART" --port "$WP" \
    > data/logs/whisper.log 2>&1 < /dev/null &
  echo $! > data/run/whisper.pid
  for _ in $(seq 1 40); do
    if curl -fsS -m 2 "${WHISPER_URL}/health" >/dev/null 2>&1; then WHISPER_READY=1; break; fi
    sleep 0.5
  done
  if [ "$WHISPER_READY" = 1 ]; then printf 'Whisper started; model loaded.\n'; else printf 'Whisper did not become ready; see data/logs/whisper.log\n'; fi
else
  printf 'Whisper binary or model not found. Voice will report "not ready" until supplied.\n'
  printf 'See docs/installation.md for the whisper.cpp build and model download.\n'
fi

info "Starting the village backend"
setsid "$VENV/bin/uvicorn" app.main:app --app-dir web/backend --host "$HOST" --port "$PORT" \
  > data/logs/backend.log 2>&1 < /dev/null &
echo $! > data/run/backend.pid

READY=0
for _ in $(seq 1 60); do
  if curl -fsS -m 2 "http://${HOST}:${PORT}/api/v1/system/health" >/dev/null 2>&1; then READY=1; break; fi
  sleep 0.5
done
if [ "$READY" != 1 ]; then
  printf '\nBackend did not become ready. Last log lines:\n'
  tail -40 data/logs/backend.log || true
  exit 1
fi

info "Verifying"
curl -fsS "http://${HOST}:${PORT}/api/v1/system/health" | "$VENV/bin/python" -m json.tool | head -30
printf '\nVillage URL: http://%s:%s/\n' "$HOST" "$PORT"
printf 'Backend PID: %s (data/run/backend.pid)\n' "$(cat data/run/backend.pid)"
printf 'Logs: data/logs/backend.log'
[ "$WHISPER_READY" = 1 ] && printf ', data/logs/whisper.log'
printf '\nStop with: ./scripts/stop.sh\n'
