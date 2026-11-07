#!/usr/bin/env bash
# Run every local gate and print a short summary.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VENV="${VILLAGE_VENV:-$ROOT/.venv}"

echo "== Firmware safety core =="
./scripts/test_firmware.sh

echo
echo "== Backend =="
"$VENV/bin/python" -m pytest -q web/backend/tests

echo
echo "== Frontend =="
(cd web/frontend && npm run typecheck && npm test -- --run && npm run build)

echo
echo "All local gates passed."
