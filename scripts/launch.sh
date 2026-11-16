#!/usr/bin/env bash
# Build and start the village on one localhost origin, with whisper.cpp if
# available.  Safe to re-run: it only stops the process recorded in
# data/run/backend.pid (or whisper.pid), never unrelated processes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p data/logs data/run

if [ ! -f .env ]; then cp .env.example .env; fi
# Before .env is sourced: the board may be on the Windows hotspot, which this
# container cannot route to, and the relay/address can have changed since the
# last start.  Best effort -- a missing board must not stop the exhibition.
./scripts/relay.sh ensure || true
# The hotspot can be switched off by Windows at any moment; the watcher puts it
# back so an unattended exhibit recovers instead of going dark.
if ! pgrep -f "relay[.]sh wat[c]h" >/dev/null 2>&1; then
  setsid ./scripts/relay.sh watch > data/logs/relay-watch.log 2>&1 < /dev/null &
  echo $! > data/run/relay-watch.pid
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a

HOST="${VILLAGE_BIND_HOST:-127.0.0.1}"
PORT="${VILLAGE_PORT:-8000}"
VENV="${VILLAGE_VENV:-$ROOT/.venv}"
WHISPER_BIN="${VILLAGE_WHISPER_BIN:-$ROOT/models/whisper/whisper-server}"
WHISPER_URL="${VILLAGE_WHISPER_URL:-http://127.0.0.1:8181}"
WHISPER_MODEL="${VILLAGE_WHISPER_MODEL:-$ROOT/models/whisper/ggml-base.bin}"
WHISPER_THREADS="${VILLAGE_WHISPER_THREADS:-$(nproc 2>/dev/null || echo 4)}"
case "$WHISPER_MODEL" in /*) ;; *) WHISPER_MODEL="$ROOT/$WHISPER_MODEL" ;; esac

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
# One implementation, shared with dev.sh: the whisper block used to live here
# only, and a dev session therefore had no speech server at all.
if ./scripts/whisper.sh start; then
  WHISPER_READY=1
else
  WHISPER_READY=0
  printf 'Voice will report "not ready" until the whisper server and model are supplied.\n'
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
