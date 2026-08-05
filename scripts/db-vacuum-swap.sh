#!/usr/bin/env bash
# Compact hyperspace.db by rewriting it without free pages, then swap it in.
#
# Seven-day purges delete rows but never return the space to the filesystem, so
# the file grows monotonically while most of it is free pages. VACUUM INTO
# rewrites only the live pages into a new file; the original stays untouched
# until the copy has passed an integrity check and a row-count comparison.
#
# The row-count comparison is also the concurrency guard: if anything wrote to
# the database while the copy was being made, the counts diverge and we abort
# without swapping, so no writes can be lost.
#
# The original is kept as .prevacuum for rollback and must be deleted manually
# once the backend has been verified healthy.
set -euo pipefail

D="${DB_DIR:-/data/hyperspace/db}"
C="${CONTAINER:-hyperspace-backend-1}"
SRC="$D/hyperspace.db"
NEW="$D/hyperspace.db.vacuumed"
OLD="$D/hyperspace.db.prevacuum"

TABLES="zone_visits track_positions zone_occupancy zone_kpi_hourly
        zone_kpi_daily ingress_perimeter_crossings venues regions_of_interest"

cd "$D"

restart_backend() {
  echo "=== starting $C ==="
  docker start "$C" >/dev/null
  for _ in $(seq 1 30); do
    if docker inspect "$C" --format '{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; then
      echo "  healthy"; return 0
    fi
    sleep 2
  done
  echo "  WARNING: did not report healthy within 60 s — check logs" >&2
}
trap 'restart_backend' EXIT

echo "=== stopping $C ==="
docker stop "$C" >/dev/null
sqlite3 "$SRC" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null

echo "=== before ==="
ls -la "$SRC" | awk '{print "  " $5 " bytes  " $9}'

rm -f "$NEW"
echo "=== VACUUM INTO ==="
time sqlite3 "$SRC" "VACUUM INTO '$NEW';"
ls -la "$NEW" | awk '{print "  " $5 " bytes  " $9}'

echo "=== integrity check ==="
sqlite3 "$NEW" "PRAGMA integrity_check;" | head -3

echo "=== row counts: original vs vacuumed ==="
FAIL=0
for t in $TABLES; do
  a=$(sqlite3 "$SRC" "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo ERR)
  b=$(sqlite3 "$NEW" "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo ERR)
  if [ "$a" = "$b" ]; then s=OK; else s=DIFF; FAIL=1; fi
  printf "  %-30s %12s  %12s  %s\n" "$t" "$a" "$b" "$s"
done

if [ "$FAIL" -ne 0 ]; then
  echo "ABORT: counts diverged — something wrote during the copy. Original untouched." >&2
  rm -f "$NEW"
  exit 2
fi

echo "=== swapping ==="
mv "$SRC" "$OLD"
mv "$NEW" "$SRC"
# The old WAL/SHM describe the previous file and must not be reused.
rm -f "$SRC-wal" "$SRC-shm"
ls -la "$D" | grep hyperspace.db

echo
echo "Swapped. Rollback copy at $OLD — delete once the backend is verified healthy."
