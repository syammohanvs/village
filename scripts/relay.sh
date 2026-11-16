#!/usr/bin/env bash
# Start, stop or check the relay that lets this container reach the board when
# it is on the Windows Mobile Hotspot.
#
#   ./scripts/relay.sh start     # copy the relay to Windows and run it
#   ./scripts/relay.sh status    # is it up, and does the board answer through it?
#   ./scripts/relay.sh stop
#
# Why: Windows Mobile Hotspot (ICS) gives the board 192.168.137.x and will not
# route that subnet from WSL, so the backend cannot poll the board directly —
# it answers Windows, not us.  The relay runs on Windows (which can reach the
# board) and forwards a local port; the backend points at that port.  See
# scripts/windows-device-relay.py for the long version, and docs/bench-test.md
# for the exhibit side.
#
# The alternative, if this file ever becomes a nuisance: compile the board with
# the Wi-Fi the laptop itself uses (uc/include/village/secrets.h) and the
# container reaches it directly.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LISTEN_PORT="${VILLAGE_RELAY_PORT:-8090}"

# The board's own address, as Windows sees it.  Read from .env so the port and
# the IP live in one place.
env_value() {
  local key="$1" default="${2:-}"
  if [[ -f "$ROOT/.env" ]]; then
    local value
    value="$(grep -E "^${key}=" "$ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
    if [[ -n "$value" ]]; then
      echo "$value"
      return
    fi
  fi
  echo "$default"
}

DIRECT_URL="$(env_value VILLAGE_DEVICE_DIRECT "http://192.168.137.168")"
UPSTREAM="${DIRECT_URL#http://}"; UPSTREAM="${UPSTREAM#https://}"; UPSTREAM="${UPSTREAM%%/*}"
[[ "$UPSTREAM" == *:* ]] || UPSTREAM="$UPSTREAM:80"

APP_URL="$(env_value VILLAGE_DEVICE_URL "http://172.29.192.1:$LISTEN_PORT")"

# Where to put the relay on the Windows side.  Override with VILLAGE_FLASH_DIR.
find_flash_dir() {
  if [[ -n "${VILLAGE_FLASH_DIR:-}" ]]; then
    echo "$VILLAGE_FLASH_DIR"; return
  fi
  local dir
  for dir in /mnt/c/Users/*/village-flash; do
    if [[ -d "$dir" ]]; then echo "$dir"; return; fi
  done
  echo "/mnt/c/Users/Public/village-flash"
}

FLASH_DIR="$(find_flash_dir)"
RELAY_PS1="$FLASH_DIR/tcp-relay.py"

need_interop() {
  if ! command -v powershell.exe >/dev/null 2>&1; then
    echo "powershell.exe not found: this helper only works from WSL on the laptop that runs the hotspot." >&2
    exit 1
  fi
}

ps() { powershell.exe -NoProfile -Command "$1" 2>&1 | sed 's/\r$//'; }

relay_pids() {
  ps "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { \$_.CommandLine -like '*tcp-relay.py*' } | Select-Object -ExpandProperty ProcessId" || true
}

probe() {
  # Ask the board a question through the relay.  /api/v1/health is unauthenticated
  # on the device, so a 200 here means the whole path works.
  local url="${APP_URL%/}"
  curl -s -m 5 -o /dev/null -w "%{http_code}" "$url/api/v1/health" 2>/dev/null || true
}

case "${1:-status}" in
  start)
    need_interop
    mkdir -p "$FLASH_DIR"
    cp "$ROOT/scripts/windows-device-relay.py" "$RELAY_PS1"
    if [[ -n "$(relay_pids | tr -d '[:space:]')" ]]; then
      echo "relay already running (pid $(relay_pids | tr -d '[:space:]'))"
    else
      local_win_dir="$(wslpath -w "$FLASH_DIR")"
      ps "Start-Process -FilePath python -ArgumentList 'tcp-relay.py','--listen','$LISTEN_PORT','--upstream','$UPSTREAM' -WorkingDirectory '$local_win_dir' -WindowStyle Hidden"
      sleep 3
      echo "relay started on the Windows host: 0.0.0.0:$LISTEN_PORT -> $UPSTREAM"
    fi
    code="$(probe)"
    if [[ "$code" == "200" ]]; then
      echo "  board answers through $APP_URL  ✓"
    else
      echo "  the relay is up but the board did not answer (HTTP ${code:-000})." >&2
      echo "  Is the board on the hotspot?  Check: powershell.exe \"Invoke-WebRequest -UseBasicParsing http://$UPSTREAM/api/v1/health\"" >&2
      exit 1
    fi
    ;;
  stop)
    need_interop
    pids="$(relay_pids | tr -d '[:space:]')"
    if [[ -z "$pids" ]]; then
      echo "relay is not running"
      exit 0
    fi
    for pid in $pids; do ps "Stop-Process -Id $pid -Force"; done
    echo "relay stopped (was pid $pids)"
    ;;
  status)
    code="$(probe)"
    echo "board via $APP_URL      -> HTTP ${code:-000} $([[ "$code" == "200" ]] && echo '✓ connected' || echo '✗ not reachable')"
    if command -v powershell.exe >/dev/null 2>&1; then
      pids="$(relay_pids | tr -d '[:space:]')"
      echo "relay on the Windows host -> ${pids:-not running}${pids:+ (pid)}"
    fi
    ;;
  *)
    echo "usage: $0 {start|stop|status}" >&2
    exit 2
    ;;
esac
