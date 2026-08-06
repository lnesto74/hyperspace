#!/usr/bin/env bash
# Convert completed days of the raw archive to Parquet, then age the Parquet out.
#
# The recorder can only write gzipped JSONL, because that is the one format
# that survives being appended to from a live MQTT pipe. Parquet needs whole
# row groups and a footer, so it can only be written once a day is finished.
# This runs after midnight and converts every day that is no longer being
# written to.
#
# Conversion is not only about size — on this feed Parquet is barely smaller
# than gzip. It is about the archive being usable: `analysis/01_explore.py`
# and everything downstream of it read `messages.parquet` column names, and
# they cannot read the recorder's bare-payload JSONL at all. An archive that
# no tool can open is not evidence.
#
# The JSONL is deleted only after the Parquet has been re-opened and its row
# count confirmed, and the Parquet carries the JSONL's SHA-256 in its metadata
# so the converted day can always be tied back to the bytes it came from.
#
# Exit 1 if any day failed to convert — those days keep their JSONL, and the
# 30-day JSONL retention gives roughly a month to notice and fix it.
set -uo pipefail

ARCHIVE_DIR="${ARCHIVE_DIR:-/data/hyperspace/raw}"
IMAGE="${PARQUET_IMAGE:-hyperspace-parquet:1}"
KEEP_DAYS="${PARQUET_KEEP_DAYS:-90}"

cd "$ARCHIVE_DIR" 2>/dev/null || { echo "[parquet] no archive dir yet"; exit 0; }

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "[parquet] FAILED: image $IMAGE not present"
  exit 1
fi

today=$(date -u +%Y-%m-%d)
converted=0; failed=0; skipped=0

# ------------------------------------------------------------------ convert
for f in hyperspace-raw-*.jsonl.gz; do
  [ -e "$f" ] || continue
  day=${f#hyperspace-raw-}; day=${day%.jsonl.gz}

  if [[ ! "$day" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "[parquet] skipping unrecognised name: $f"
    skipped=$((skipped+1))
    continue
  fi

  # Today's file is still open. Converting it would produce a truncated day
  # and, worse, delete the source it was truncated from.
  if [ "$day" = "$today" ]; then
    skipped=$((skipped+1))
    continue
  fi

  echo "[parquet] converting $day"
  if docker run --rm -v "$ARCHIVE_DIR":/raw "$IMAGE" \
       "/raw/$f" --verify --rm-source; then
    converted=$((converted+1))
  else
    echo "[parquet] FAILED to convert $day — keeping $f"
    failed=$((failed+1))
  fi
done

# ---------------------------------------------------------------- retention
# Same shape as the JSONL retention: a rolling window plus the oldest file of
# each month kept indefinitely, so there is always something to point at
# however old the question turns out to be.
cutoff=$(date -u -d "$KEEP_DAYS days ago" +%Y-%m-%d)
kept=0; pruned=0; keepsakes=0

for f in hyperspace-raw-*.parquet; do
  [ -e "$f" ] || continue
  day=${f#hyperspace-raw-}; day=${day%.parquet}
  [[ "$day" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue

  if [[ "$day" > "$cutoff" || "$day" == "$cutoff" ]]; then
    kept=$((kept+1))
    continue
  fi

  month=${day%-*}
  oldest_of_month=$(ls -1 hyperspace-raw-"$month"-*.parquet 2>/dev/null | head -1)
  if [ "$f" = "$oldest_of_month" ]; then
    keepsakes=$((keepsakes+1))
    continue
  fi

  rm -f -- "$f"
  pruned=$((pruned+1))
done

echo "[parquet] $(date -u +%FT%TZ) converted=$converted failed=$failed skipped=$skipped" \
     "| parquet kept=$kept monthly=$keepsakes pruned=$pruned" \
     "| dir=$(du -sh "$ARCHIVE_DIR" | cut -f1)"

[ "$failed" -eq 0 ] || exit 1
exit 0
