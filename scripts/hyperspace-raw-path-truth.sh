#!/usr/bin/env bash
#
# Nightly raw-feed forensics: measure true walked distance from the supplier's
# archived 10 Hz messages and replay the same frames through the production
# reconciler, so the Measurement Audit tab has a fresh before-and-after for the
# day that just ended.
#
# Timing matters. The raw JSONL for a day is complete at UTC midnight and is
# converted to Parquet and deleted at 04:00 UTC, so this has to run in between.
# It is scheduled at 03:00 UTC for that reason, not by preference.
#
# Install:
#   0 3 * * * /opt/hyperspace/scripts/hyperspace-raw-path-truth.sh >> /var/log/hyperspace-raw-path-truth.log 2>&1
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-/opt/hyperspace/docker-compose.prod.yml}"
RAW_DIR="${RAW_DIR:-/data/hyperspace/raw}"
OUT_DIR="${OUT_DIR:-/data/hyperspace/reports}"
VENUE_ID="${VENUE_ID:-55fdd53b-3298-4355-97c0-b4e789b11d06}"
KEEP_RUNS="${KEEP_RUNS:-30}"

DAY="${1:-$(date -u -d 'yesterday' +%F)}"
SRC="${RAW_DIR}/hyperspace-raw-${DAY}.jsonl.gz"
OUT="${OUT_DIR}/raw_path_truth_${DAY}.json"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

if [[ ! -f "$SRC" ]]; then
  log "No raw archive for ${DAY} at ${SRC} — nothing to do."
  exit 0
fi

mkdir -p "$OUT_DIR"
TMP="${OUT}.partial"

log "Replaying ${SRC} ($(du -h "$SRC" | cut -f1)) for venue ${VENUE_ID}"

# The job streams the archive and holds only the people currently in the store,
# so it stays around 30 MB; the cap is a guard, not a working set.
docker compose -f "$COMPOSE_FILE" run --rm -T --no-deps \
  -v "${RAW_DIR}:/data/raw:ro" \
  `# Not /data/reports: the backend service already mounts that read-only so the` \
  `# API can serve finished runs, and a service volume wins over this flag.` \
  -v "${OUT_DIR}:/data/out" \
  -e DB_PATH=/data/db/hyperspace.db \
  backend node --max-old-space-size=2048 \
  /opt/hyperspace/analysis/raw_path_truth.mjs \
  --file "/data/raw/$(basename "$SRC")" \
  --venue-id "$VENUE_ID" \
  --out "/data/out/$(basename "$TMP")" \
  --quiet > /dev/null

if [[ ! -s "$TMP" ]]; then
  log "ERROR: run produced no output"
  rm -f "$TMP"
  exit 1
fi

# Only publish a run the API can actually parse, so a truncated write can never
# replace a good report with a broken one.
if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$TMP" 2>/dev/null; then
  log "ERROR: run produced malformed JSON"
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$OUT"
log "Wrote ${OUT} ($(du -h "$OUT" | cut -f1))"

ls -1 "${OUT_DIR}"/raw_path_truth_*.json 2>/dev/null \
  | sort -r \
  | tail -n "+$((KEEP_RUNS + 1))" \
  | while read -r old; do
      log "Pruning $(basename "$old")"
      rm -f "$old"
    done
