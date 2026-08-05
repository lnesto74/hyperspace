#!/usr/bin/env bash
# Rolling retention for the raw MQTT archive.
#
# Keeps the last N days in full, and additionally keeps the first archive of
# each month forever. The monthly keepsakes cost about 270 MB each — roughly
# 3 GB for a year — and exist because the expensive lesson from the vendor
# dispute was that a single 34-minute capture from 19 May had to carry the
# entire argument. A sampled day per month means there is always something to
# point at, however old the question turns out to be.
set -euo pipefail

ARCHIVE_DIR="${ARCHIVE_DIR:-/data/hyperspace/raw}"
KEEP_DAYS="${RAW_KEEP_DAYS:-30}"

cd "$ARCHIVE_DIR" 2>/dev/null || { echo "[raw-retention] no archive dir yet"; exit 0; }

cutoff=$(date -u -d "$KEEP_DAYS days ago" +%Y-%m-%d)
today=$(date -u +%Y-%m-%d)
kept=0; pruned=0; keepsakes=0

for f in hyperspace-raw-*.jsonl.gz; do
  [ -e "$f" ] || continue
  day=${f#hyperspace-raw-}; day=${day%.jsonl.gz}

  # Never touch today's file — it is open and being appended to.
  if [ "$day" = "$today" ]; then kept=$((kept+1)); continue; fi

  if [[ ! "$day" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "[raw-retention] skipping unrecognised name: $f"
    continue
  fi

  if [[ "$day" > "$cutoff" || "$day" == "$cutoff" ]]; then
    kept=$((kept+1))
    continue
  fi

  # Outside the window: keep it only if it is the oldest surviving archive of
  # its month, which makes it that month's sample.
  month=${day%-*}
  oldest_of_month=$(ls -1 hyperspace-raw-"$month"-*.jsonl.gz 2>/dev/null | head -1)
  if [ "$f" = "$oldest_of_month" ]; then
    keepsakes=$((keepsakes+1))
    continue
  fi

  rm -f -- "$f"
  pruned=$((pruned+1))
done

echo "[raw-retention] $(date -u +%FT%TZ) kept=$kept monthly_keepsakes=$keepsakes pruned=$pruned total=$(du -sh "$ARCHIVE_DIR" | cut -f1)"
