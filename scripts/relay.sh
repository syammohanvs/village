#!/usr/bin/env bash
# Reach the board when it is on the Windows Mobile Hotspot.
#
#   ./scripts/relay.sh ensure    # make sure the board is reachable (safe to call every start)
#   ./scripts/relay.sh status    # is the whole chain working, and where is the board?
#   ./scripts/relay.sh start     # run the relay on the Windows host
#   ./scripts/relay.sh hotspot     # is the hotspot on? (the board's only network)
#   ./scripts/relay.sh hotspot-on  # switch it back on if Windows turned it off
#   ./scripts/relay.sh stop
#
# Why: Windows Mobile Hotspot is ICS.  It gives the board 192.168.137.x and
# refuses to route that subnet from anywhere else, so the backend in this
# container cannot poll the board directly -- the board answers Windows (200)
# and times out for us (000).  The relay runs on Windows, which can reach the
# board, and forwards a local port; the backend points at that port.
#
# Two things move under this setup, and `ensure` handles both:
#   * the board's DHCP lease on the hotspot can change -- the relay sweeps the
#     subnet for the device API instead of trusting a remembered address
#     (scripts/windows-device-relay.py);
#   * the Windows host's address on the WSL network can change when WSL
#     restarts (the subnet is picked per boot) -- `ensure` rewrites
#     VILLAGE_DEVICE_URL in .env before the backend reads it.
#
# The alternative, if this file ever becomes a nuisance: compile the board with
# the Wi-Fi the laptop itself uses (uc/include/village/secrets.h) and the
# container reaches it directly.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LISTEN_PORT="${VILLAGE_RELAY_PORT:-8090}"

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

set_env_value() {
  local key="$1" value="$2"
  [[ -f "$ROOT/.env" ]] || return 0
  if grep -qE "^${key}=" "$ROOT/.env"; then
    # `|` as the delimiter: values here are URLs, not sed scripts.
    sed -i "s|^${key}=.*|${key}=${value}|" "$ROOT/.env"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ROOT/.env"
  fi
}

DEVICE_MODE="$(env_value VILLAGE_DEVICE_MODE "real")"
DEVICE_URL="$(env_value VILLAGE_DEVICE_URL "http://172.29.192.1:${LISTEN_PORT}")"
DIRECT_URL="$(env_value VILLAGE_DEVICE_DIRECT "http://192.168.137.168")"

# The board's address as Windows sees it: host only, used as the relay's hint.
direct_host="${DIRECT_URL#http://}"; direct_host="${direct_host#https://}"; direct_host="${direct_host%%/*}"
direct_host="${direct_host%%:*}"
subnet="${direct_host%.*}"; [[ "$subnet" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || subnet="192.168.137"

# The Windows host, as this container sees it: the default gateway of the WSL
# network.  This is the one address that is always right for the current boot.
wsl_gateway() { ip route show default 2>/dev/null | awk '{print $3; exit}'; }

# Where to stage the relay on Windows.  Override with VILLAGE_FLASH_DIR.
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
RELAY_SCRIPT="$FLASH_DIR/tcp-relay.py"
RELAY_LOG="$FLASH_DIR/relay.log"
HOTSPOT_PS1="$FLASH_DIR/windows-hotspot.ps1"

need_interop() {
  if ! command -v powershell.exe >/dev/null 2>&1; then
    echo "relay: powershell.exe not found -- this helper needs WSL on the laptop that runs the hotspot." >&2
    return 1
  fi
}

ps() { powershell.exe -NoProfile -Command "$1" 2>&1 | sed 's/\r$//'; }

relay_pids() {
  ps "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { \$_.CommandLine -like '*tcp-relay.py*' } | Select-Object -ExpandProperty ProcessId" 2>/dev/null | tr -d '[:space:]' || true
}

# Ask the board a question through the relay.  /api/v1/health is unauthenticated
# on the device, so a 200 here means the whole path works.
probe() {
  curl -s -m 5 -o /dev/null -w "%{http_code}" "${DEVICE_URL%/}/api/v1/health" 2>/dev/null || true
}

start_relay() {
  mkdir -p "$FLASH_DIR"
  cp "$ROOT/scripts/windows-device-relay.py" "$RELAY_SCRIPT"
  local win_dir
  win_dir="$(wslpath -w "$FLASH_DIR")"
  ps "Start-Process -FilePath python -ArgumentList 'tcp-relay.py','--listen','$LISTEN_PORT','--subnet','$subnet','--upstream','${direct_host}:80','--log','relay.log' -WorkingDirectory '$win_dir' -WindowStyle Hidden"
  echo "  relay started on the Windows host: 0.0.0.0:$LISTEN_PORT -> board on $subnet.0/24"
}

# The Windows Mobile Hotspot, which is the board's only network.  `state`
# answers On/Off/NoInternetProfile -- the difference between "the board is off"
# and "there is nothing for the board to join" is the whole diagnosis.
hotspot() {
  cp "$ROOT/scripts/windows-hotspot.ps1" "$HOTSPOT_PS1" 2>/dev/null || true
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$HOTSPOT_PS1")" -Action "$1" 2>&1 | sed 's/\r$//'
}
hotspot_state() { hotspot state | grep -oE 'hotspot=[A-Za-z]+' | tail -1 | cut -d= -f2; }

wait_for_board() {
  local tries="${1:-20}" code
  for _ in $(seq 1 "$tries"); do
    code="$(probe)"
    if [[ "$code" == "200" ]]; then return 0; fi
    sleep 1
  done
  return 1
}

ensure() {
  # Demo mode never touches the device, so there is nothing to bridge.
  if [[ "$DEVICE_MODE" != "real" ]]; then
    echo "relay: device mode is '$DEVICE_MODE' -- nothing to bridge"
    return 0
  fi

  # Already working?  The common case, and it costs one request.
  if [[ "$(probe)" == "200" ]]; then
    echo "relay: board reachable at $DEVICE_URL"
    return 0
  fi

  # Not on WSL/Windows (or someone runs the backend elsewhere): say so once and
  # carry on.  The app degrades to "not connected", it does not crash.
  need_interop || return 0

  # The host address can change when WSL restarts; fix it before the backend
  # reads .env, which is why this runs from launch.sh/dev.sh BEFORE sourcing.
  local gateway
  gateway="$(wsl_gateway)"
  if [[ -n "$gateway" ]]; then
    local wanted="http://${gateway}:${LISTEN_PORT}"
    if [[ "$DEVICE_URL" != "$wanted" ]]; then
      set_env_value VILLAGE_DEVICE_URL "$wanted"
      DEVICE_URL="$wanted"
      echo "  .env: VILLAGE_DEVICE_URL -> $wanted (the WSL gateway changed)"
    fi
  fi

  local pids
  pids="$(relay_pids)"
  if [[ -z "$pids" ]]; then
    start_relay
  else
    echo "  relay already running (pid $pids)"
  fi

  if wait_for_board "${VILLAGE_RELAY_WAIT:-6}"; then
    echo "  board reachable at $DEVICE_URL"
    return 0
  fi

  # Before blaming the board, ask whether there is a network for it to join at
  # all.  This is the single failure that looks identical to a dead board.
  local state
  state="$(hotspot_state)"
  if [[ "$state" == "Off" ]]; then
    echo "  the Windows Mobile Hotspot is OFF -- switching it back on"
    hotspot on | sed 's/^/    /'
    if wait_for_board "${VILLAGE_RELAY_HOTSPOT_WAIT:-25}"; then
      echo "  board reachable at $DEVICE_URL (after switching the hotspot on)"
      return 0
    fi
  elif [[ "$state" == "NoInternetProfile" ]]; then
    echo "  the laptop has no internet connection to share, so the hotspot cannot run." >&2
    echo "  Join a Wi-Fi network, then: ./scripts/relay.sh hotspot-on" >&2
    return 0
  fi

  echo "  the relay is up but no board answered." >&2
  echo "  Check that the Windows Mobile Hotspot is ON and the board's LED is on:" >&2
  echo "    powershell.exe \"Invoke-WebRequest -UseBasicParsing http://${direct_host}/api/v1/health\"" >&2
  echo "  The backend will start anyway and reconnect as soon as the board appears." >&2
  return 0
}

case "${1:-ensure}" in
  ensure)
    ensure
    ;;
  start)
    need_interop
    if [[ -n "$(relay_pids)" ]]; then
      echo "relay already running (pid $(relay_pids))"
    else
      start_relay
    fi
    DEVICE_URL="http://$(wsl_gateway):${LISTEN_PORT}"
    if wait_for_board 25; then
      echo "  board answers through $DEVICE_URL  ✓"
    else
      echo "  relay up, no board answered (HTTP $(probe))" >&2
      exit 1
    fi
    ;;
  stop)
    need_interop
    pids="$(relay_pids)"
    if [[ -z "$pids" ]]; then
      echo "relay is not running"
      exit 0
    fi
    for pid in $pids; do ps "Stop-Process -Id $pid -Force"; done
    echo "relay stopped (was pid $pids)"
    ;;
  hotspot)      need_interop; hotspot state ;;
  hotspot-on)   need_interop; hotspot on; if wait_for_board "${VILLAGE_RELAY_HOTSPOT_WAIT:-25}"; then echo "  board reachable at $DEVICE_URL"; else echo "  hotspot on, no board yet (it rejoins by itself)" >&2; fi ;;
  hotspot-off)  need_interop; hotspot off ;;
  status)
    code="$(probe)"
    printf 'board via %-32s -> HTTP %s %s\n' "$DEVICE_URL" "${code:-000}" \
      "$([[ "$code" == "200" ]] && echo '✓ connected' || echo '✗ not reachable')"
    if command -v powershell.exe >/dev/null 2>&1; then
      pids="$(relay_pids)"
      echo "relay on the Windows host          -> ${pids:-not running}${pids:+ (pid)}"
      state="$(hotspot_state)"
      echo "windows hotspot                    -> ${state:-unknown}$([[ "$state" == "Off" ]] && echo '  <- the board has no network; ./scripts/relay.sh hotspot-on')"
      if [[ -f "$RELAY_LOG" ]]; then
        echo "where the relay last found the board:"
        grep -E "found the board|board is at|no board answered|did not accept" "$RELAY_LOG" 2>/dev/null | tail -3 | sed 's/^/  /'
      fi
    fi
    ;;
  *)
    echo "usage: $0 {ensure|status|start|stop|hotspot|hotspot-on|hotspot-off}" >&2
    exit 2
    ;;
esac
