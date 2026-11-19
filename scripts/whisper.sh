#!/usr/bin/env bash
# Start or check the local whisper.cpp server.
#
# One implementation on purpose.  It used to live inline in launch.sh only, so
# `./scripts/dev.sh` never started it and the voice panel sat there with a
# disabled microphone and the honest-but-useless line "Whisper server is not
# reachable" (found 2026-11-17).  Both entry points now call this.
#
#   ./scripts/whisper.sh start     start it if it is not already healthy
#   ./scripts/whisper.sh status    exit 0 when healthy, 1 when not
#
# Reuses a server already answering at WHISPER_URL only when its command line
# names the model this configuration wants, so switching models cannot silently
# keep the old one.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# .env may set any of the VILLAGE_WHISPER_* names; it is read the same way the
# launch scripts read it.
if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

BIN="${VILLAGE_WHISPER_BIN:-$ROOT/models/whisper/whisper-server}"
URL="${VILLAGE_WHISPER_URL:-http://127.0.0.1:8181}"
MODEL="${VILLAGE_WHISPER_MODEL:-$ROOT/models/whisper/ggml-base.bin}"
THREADS="${VILLAGE_WHISPER_THREADS:-$(nproc 2>/dev/null || echo 4)}"
case "$MODEL" in /*) ;; *) MODEL="$ROOT/$MODEL" ;; esac
PIDFILE="$ROOT/data/run/whisper.pid"

# A second server, for Hindi only, with a bigger model.  Optional: when
# VILLAGE_WHISPER_MODEL_HI is unset (or its file is missing) one server serves
# every language, exactly as before.
MODEL_HI="${VILLAGE_WHISPER_MODEL_HI:-}"
URL_HI="${VILLAGE_WHISPER_URL_HI:-}"
THREADS_HI="${VILLAGE_WHISPER_THREADS_HI:-$THREADS}"
case "$MODEL_HI" in /*|"") ;; *) MODEL_HI="$ROOT/$MODEL_HI" ;; esac
PIDFILE_HI="$ROOT/data/run/whisper-hi.pid"
healthy_hi() { [ -n "$URL_HI" ] && curl -fsS -m 2 "$URL_HI/health" >/dev/null 2>&1; }

healthy() { curl -fsS -m 2 "$URL/health" >/dev/null 2>&1; }

# The whisper-server processes belonging to THIS repository (an older one can
# outlive its PID file, and two would each hold a model in memory).
server_pids() {
  for proc in /proc/[0-9]*/cmdline; do
    pid="${proc#/proc/}"; pid="${pid%/cmdline}"
    [ "$pid" = "$$" ] && continue
    cmd="$(cat "$proc" 2>/dev/null | tr '\0' ' ' || true)"
    case "$cmd" in
      *"$BIN"*) printf '%s\n' "$pid" ;;
    esac
  done
}

case "${1:-start}" in
  status)
    ok=1
    if healthy; then
      printf 'whisper is answering at %s\n' "$URL"
    else
      printf 'whisper is NOT answering at %s\n' "$URL"
      ok=0
    fi
    if [ -n "$URL_HI" ]; then
      if healthy_hi; then
        printf 'whisper (Hindi) is answering at %s\n' "$URL_HI"
      else
        printf 'whisper (Hindi) is NOT answering at %s\n' "$URL_HI"
        ok=0
      fi
    fi
    exit $((1 - ok))
    ;;
  stop)
    for pid in $(server_pids); do
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 25); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
      kill -9 "$pid" 2>/dev/null || true
    done
    if [ -f "$PIDFILE" ]; then
      pid="$(cat "$PIDFILE" || true)"
      [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true
      rm -f "$PIDFILE"
    fi
    if [ -f "$PIDFILE_HI" ]; then
      pid="$(cat "$PIDFILE_HI" || true)"
      [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true
      rm -f "$PIDFILE_HI"
    fi
    printf 'whisper stopped\n'
    ;;
  start) ;;
  *)
    printf 'usage: %s start|status|stop\n' "$0" >&2
    exit 2
    ;;
esac

mkdir -p data/logs data/run

if [ -f "$PIDFILE" ]; then
  old="$(cat "$PIDFILE" || true)"
  if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
    running="$(tr '\0' ' ' < "/proc/$old/cmdline" 2>/dev/null || true)"
    if printf '%s' "$running" | grep -Fq -- "$MODEL" && healthy; then
      printf 'whisper already running at %s with %s\n' "$URL" "$(basename "$MODEL")"
      exit 0
    fi
    printf 'whisper is running a different model (or is wedged); restarting with %s\n' "$(basename "$MODEL")"
    kill "$old" 2>/dev/null || true
    for _ in $(seq 1 25); do kill -0 "$old" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$old" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
fi

if healthy; then
  printf 'whisper is answering at %s (started elsewhere; its model was not checked)\n' "$URL"
  exit 0
fi

if [ ! -x "$BIN" ] || [ ! -f "$MODEL" ]; then
  printf 'whisper binary or model missing: %s / %s\n' "$BIN" "$MODEL" >&2
  printf 'See docs/installation.md for the build and the model download.\n' >&2
  exit 1
fi

host="${URL#*://}"; host="${host%%:*}"
port="${URL##*:}"; port="${port%%/*}"

setsid "$BIN" -m "$MODEL" -t "$THREADS" --host "$host" --port "$port" \
  > data/logs/whisper.log 2>&1 < /dev/null &
echo $! > "$PIDFILE"

for _ in $(seq 1 120); do
  if healthy; then
    # `$!` is setsid's pid, not the server's; record the one that owns the port
    # so stop.sh and this script act on the process they mean.
    real="$(server_pids | head -1)"
    [ -n "$real" ] && echo "$real" > "$PIDFILE"
    printf 'whisper started at %s with %s (pid %s)\n' "$URL" "$(basename "$MODEL")" "$(cat "$PIDFILE")"
    if [ -n "$MODEL_HI" ] && [ -f "$MODEL_HI" ] && [ -n "$URL_HI" ]; then
      if healthy_hi; then
        printf 'whisper (Hindi) already answering at %s\n' "$URL_HI"
        exit 0
      fi
      host_hi="${URL_HI#*://}"; host_hi="${host_hi%%:*}"
      port_hi="${URL_HI##*:}"; port_hi="${port_hi%%/*}"
      setsid "$BIN" -m "$MODEL_HI" -t "$THREADS_HI" --host "$host_hi" --port "$port_hi" \
        > data/logs/whisper-hi.log 2>&1 < /dev/null &
      echo $! > "$PIDFILE_HI"
      for _ in $(seq 1 240); do
        if healthy_hi; then
          printf 'whisper (Hindi) started at %s with %s\n' "$URL_HI" "$(basename "$MODEL_HI")"
          exit 0
        fi
        sleep 0.5
      done
      printf 'whisper (Hindi) did not become ready; see data/logs/whisper-hi.log\n' >&2
    fi
    exit 0
  fi
  sleep 0.5
done

printf 'whisper did not become ready; see data/logs/whisper.log\n' >&2
exit 1
