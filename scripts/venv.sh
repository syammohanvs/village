#!/usr/bin/env bash
# Where the Python environment is.
#
# `.env` may name one with an **absolute path** — this laptop keeps its venv in
# /home/ubuntu/.venvs/aivillage, outside the checkout.  A clone on another
# laptop inherits that line and has no such directory, so a setup that died on a
# path nobody chose would defeat the point of the repository being a complete
# copy (2026-11-17: "use another laptop and run the app as is").
#
# The rule, in order:
#   1. the configured path, when it really holds a Python;
#   2. one beside the checkout ($ROOT/.venv), which is what a fresh clone gets;
#   3. for a first-time setup, wherever a new one can actually be created.
#
# Source it, then: VENV="$(village_venv "$ROOT" "${VILLAGE_VENV:-}")"
village_venv() {
  local root="$1" configured="${2:-}" candidate

  for candidate in "${configured:-}" "$root/.venv"; do
    [ -n "$candidate" ] || continue
    if [ -x "$candidate/bin/python" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  # Neither exists yet.  A new one belongs where it was configured if that can
  # be created; otherwise beside the checkout, which always can.
  if [ -n "${configured:-}" ]; then
    local parent
    parent="$(dirname "$configured")"
    if { [ -d "$parent" ] && [ -w "$parent" ]; } || mkdir -p "$parent" 2>/dev/null; then
      printf '%s\n' "$configured"
      return 0
    fi
  fi

  printf '%s\n' "$root/.venv"
}
