#!/usr/bin/env bash
# Development mode: FastAPI with reload + Vite dev server.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env
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
}
trap cleanup INT TERM EXIT

"$VENV/bin/uvicorn" app.main:app --app-dir web/backend --host "$HOST" --port "$PORT" --reload &
API_PID=$!
(cd web/frontend && npm run dev -- --host 127.0.0.1) &
VITE_PID=$!
printf '\nAPI:  http://%s:%s/api/v1/system/health\nUI:   http://127.0.0.1:5173/ (Vite proxies /api and /models)\n' "$HOST" "$PORT"
wait
