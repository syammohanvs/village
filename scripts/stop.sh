#!/usr/bin/env bash
# Stop only the processes this project started (PID files in data/run).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

stop_pidfile() {
  local file="$1" label="$2"
  [ -f "$file" ] || { printf '%s: not running (no PID file)\n' "$label"; return; }
  local pid
  pid="$(cat "$file" 2>/dev/null || true)"
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 25); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$pid" 2>/dev/null || true
    printf '%s stopped (pid %s)\n' "$label" "$pid"
  else
    printf '%s: process %s was already gone\n' "$label" "${pid:-?}"
  fi
  rm -f "$file"
}

stop_pidfile data/run/backend.pid "Village backend"
stop_pidfile data/run/whisper.pid "Whisper server"
