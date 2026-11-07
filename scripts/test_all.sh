#!/usr/bin/env bash
# Run every local gate and print a short summary.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi
VENV="${VILLAGE_VENV:-$ROOT/.venv}"
if [ ! -x "$VENV/bin/python" ] && [ -x "$HOME/.venvs/aivillage/bin/python" ]; then
  VENV="$HOME/.venvs/aivillage"
fi

echo "== Firmware safety core =="
./scripts/test_firmware.sh

echo
echo "== Backend =="
(cd web/backend && "$VENV/bin/python" -m pytest -q tests)

echo
echo "== Frontend =="
(cd web/frontend && npm run typecheck && npm test -- --run && npm run build)

echo
echo "All local gates passed."
