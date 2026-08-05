#!/usr/bin/env bash
# Nightly compact backup of the analytics database.
#
# Uses VACUUM INTO rather than `.backup`: the online backup API copies the file
# page for page including free pages, which on this database meant a 17 GB copy
# of 4 GB of data. VACUUM INTO writes only live pages, and takes a read
# transaction rather than a lock, so it is safe to run against the live backend.
#
# Install: /usr/local/bin/hyperspace-backup, run daily from cron.
set -euo pipefail

DB="${DB_PATH:-/data/hyperspace/db/hyperspace.db}"
DEST="${BACKUP_DIR:-/data/hyperspace/backups}"
KEEP="${BACKUP_KEEP:-7}"
MIN_FREE_GB="${BACKUP_MIN_FREE_GB:-15}"

mkdir -p "$DEST"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
tmp="$DEST/hyperspace_${stamp}.db"
out="$tmp.gz"

free_gb=$(df -BG --output=avail "$DEST" | tail -1 | tr -dc '0-9')
if [ "$free_gb" -lt "$MIN_FREE_GB" ]; then
  echo "[backup] ABORT: only ${free_gb}G free on $DEST, need ${MIN_FREE_GB}G" >&2
  exit 1
fi

echo "[backup] $(date -u +%FT%TZ) starting"
sqlite3 "$DB" "VACUUM INTO '$tmp';"

if ! sqlite3 "$tmp" "PRAGMA integrity_check;" | head -1 | grep -q '^ok$'; then
  echo "[backup] ABORT: integrity check failed, discarding" >&2
  rm -f "$tmp"
  exit 2
fi

gzip -1 "$tmp"
echo "[backup] wrote $out ($(du -h "$out" | cut -f1))"

# Retain the newest $KEEP archives.
ls -1t "$DEST"/hyperspace_*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "[backup] pruning $(basename "$old")"
  rm -f "$old"
done

echo "[backup] $(date -u +%FT%TZ) done — $(ls -1 "$DEST"/hyperspace_*.db.gz 2>/dev/null | wc -l) archives retained"
