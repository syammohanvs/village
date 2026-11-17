#!/usr/bin/env bash
# Back up everything in this project that git does NOT carry.
#
# `models/piper` is committed (Sara's voice is part of the project).  What is
# left is too large for a git repository:
#
#   models/whisper/      the speech-recognition models (2.2 GB, one file 1.6 GB)
#   models/waste*/       the waste classifier weights (~1.2 GB with history)
#   data/                the live village database, caches and backups
#   .env                 settings and the admin/e-mail credentials
#   uc/include/village/secrets.h   the OTA password and the device token
#
# Usage:
#   ./scripts/backup.sh                 # to ~/village-backups
#   ./scripts/backup.sh /media/usb/village
#   ./scripts/backup.sh --all           # also the old waste models
#   ./scripts/backup.sh --dry           # say what it would copy, copy nothing
#
# It mirrors (rsync --delete) into the target, so a second run only copies what
# changed and removes files you deleted here — the target is a copy, not an
# ever-growing pile.  Point it at an external disk or a synced folder: a copy on
# the same disk does not survive that disk failing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET=""
ALL=0
DRY=0
for arg in "$@"; do
  case "$arg" in
    --all) ALL=1 ;;
    --dry) DRY=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) TARGET="$arg" ;;
  esac
done
TARGET="${TARGET:-${VILLAGE_BACKUP_DIR:-$HOME/village-backups}}"

command -v rsync >/dev/null 2>&1 || { echo "ERROR: rsync is required." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required." >&2; exit 1; }

RSYNC=(rsync -a --delete)
if [ "$DRY" = "1" ]; then RSYNC+=(--dry-run --itemize-changes); fi

info() { printf '\n== %s\n' "$*"; }
[ "$DRY" = "1" ] && printf 'DRY RUN — nothing will be written.\n'
printf 'Backing up to: %s\n' "$TARGET"
mkdir -p "$TARGET/models" "$TARGET/data" "$TARGET/uc/include/village"

# ---------------------------------------------------------------- the models ---
info "Whisper speech models"
"${RSYNC[@]}" "$ROOT/models/whisper" "$TARGET/models/"

info "Waste classifier"
"${RSYNC[@]}" --exclude '*-backup-*' --exclude '*-v[0-9]*' \
  "$ROOT/models/waste" "$ROOT/models/waste-resnet50" "$TARGET/models/"
if [ "$ALL" = "1" ]; then
  info "Older waste models (--all)"
  for dir in "$ROOT"/models/waste-*; do
    [ -d "$dir" ] || continue
    "${RSYNC[@]}" "$dir" "$TARGET/models/"
  done
fi

# ------------------------------------------------------ the database, properly ---
# A live SQLite file cannot be copied with `cp` while the app writes to it: the
# copy can miss the write-ahead log.  SQLite's own backup API takes a consistent
# snapshot, and it is the same file whether the server is running or not.
info "Village database (consistent snapshot)"
if [ "$DRY" = "1" ]; then
  printf 'would snapshot %s -> %s\n' "$ROOT/data/village.db" "$TARGET/data/village.db"
else
  mkdir -p "$TARGET/data"
  python3 - "$ROOT/data/village.db" "$TARGET/data/village.db" <<'PY'
import os, sqlite3, sys
source, target = sys.argv[1], sys.argv[2]
if not os.path.exists(source):
    print("  no database yet; nothing to copy")
    raise SystemExit(0)
temporary = target + ".tmp"
for path in (temporary, temporary + "-wal", temporary + "-shm"):
    if os.path.exists(path):
        os.unlink(path)
with sqlite3.connect(source) as src, sqlite3.connect(temporary) as dst:
    src.backup(dst)
os.replace(temporary, target)
print(f"  {target} ({os.path.getsize(target) / 1e6:.1f} MB)")
PY
fi

# ------------------------------------------------------------ the credentials ---
info "Settings and secrets"
for file in ".env" "uc/include/village/secrets.h"; do
  if [ -f "$ROOT/$file" ]; then
    if [ "$DRY" = "1" ]; then
      printf 'would copy %s\n' "$file"
    else
      mkdir -p "$TARGET/$(dirname "$file")"
      cp -p "$ROOT/$file" "$TARGET/$file"
      chmod 600 "$TARGET/$file"
    fi
  else
    printf '  %s not present, skipped\n' "$file"
  fi
done

printf '\n== Done\n'
printf 'Restore by copying these back over the same paths in a fresh clone:\n'
printf '  %s/models/  %s/data/  %s/.env  %s/uc/include/village/secrets.h\n' \
  "$TARGET" "$TARGET" "$TARGET" "$TARGET"
printf 'Then: ./scripts/launch.sh\n'
