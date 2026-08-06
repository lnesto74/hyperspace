#!/usr/bin/env bash
# Daily re-ID miss-reason sample, appended to a history file.
#
# The weekly continuity report says *how much* track continuity we are getting.
# This says *why* we are not getting more: which gate — distance, implied speed,
# gap, isolation, NN ambiguity — is rejecting the merges that a human watching
# the live canvas would call obvious. One run is noise. The value is the trend,
# because a sensor drifting out of alignment or a vendor firmware change shows
# up as a shift in the rejecting gate weeks before it moves dwell enough to
# notice.
#
# Runs against the live MQTT feed inside the backend container, mirroring the
# reconciler rather than touching it, and opens the database read-only. It
# cannot affect what production stores.
#
# Exit code 2 from the audit means misses were found. That is the normal state
# of affairs and is deliberately not treated as a failure here.
set -o pipefail

VENUE="${VENUE_ID:-55fdd53b-3298-4355-97c0-b4e789b11d06}"
WINDOW_S="${WINDOW_S:-300}"
MIN_TRACKS="${MIN_TRACKS:-20}"
HIST_DIR="${HIST_DIR:-/data/hyperspace/reid-audit}"
HIST="$HIST_DIR/history.jsonl"
KEEP_LINES="${KEEP_LINES:-400}"
CONTAINER="${CONTAINER:-hyperspace-backend-1}"
SCRIPT_IN_CONTAINER=/opt/hyperspace/analysis/live_reid_audit.mjs

mkdir -p "$HIST_DIR"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[reid-audit] $(date -u +%FT%TZ) container $CONTAINER not running, skipping"
  exit 0
fi

# Write inside the container: the analysis mount is read-only from in there.
TMP_IN_CONTAINER=/tmp/reid-audit-run.jsonl
docker exec "$CONTAINER" rm -f "$TMP_IN_CONTAINER" 2>/dev/null

echo "[reid-audit] $(date -u +%FT%TZ) sampling ${WINDOW_S}s"
docker exec -e NODE_PATH=/app/node_modules "$CONTAINER" \
  node "$SCRIPT_IN_CONTAINER" "$VENUE" "$WINDOW_S" "$MIN_TRACKS" \
    --quiet --json "$TMP_IN_CONTAINER"
STATUS=$?

# 0 = clean, 2 = misses found (expected). Anything else is a real failure.
if [ $STATUS -ne 0 ] && [ $STATUS -ne 2 ]; then
  echo "[reid-audit] FAILED: audit exited $STATUS"
  exit $STATUS
fi

LINE=$(docker exec "$CONTAINER" cat "$TMP_IN_CONTAINER" 2>/dev/null | tail -1)
if [ -z "$LINE" ]; then
  echo "[reid-audit] FAILED: audit produced no summary"
  exit 1
fi

# Reject anything that is not parseable JSON rather than corrupting the history
# the weekly report reads.
if ! printf '%s' "$LINE" | python3 -c 'import json,sys; json.loads(sys.stdin.read())' 2>/dev/null; then
  echo "[reid-audit] FAILED: summary was not valid JSON"
  exit 1
fi

printf '%s\n' "$LINE" >> "$HIST"
docker exec "$CONTAINER" rm -f "$TMP_IN_CONTAINER" 2>/dev/null

if [ "$(wc -l < "$HIST")" -gt "$KEEP_LINES" ]; then
  tail -n "$KEEP_LINES" "$HIST" > "$HIST.tmp" && mv "$HIST.tmp" "$HIST"
fi

printf '%s' "$LINE" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
m = d["misses"]
print("[reid-audit] emitted=%d reid_rate=%.1f%% misses=%d (resume=%d lost=%d nn=%d)%s" % (
    d["emitted"], d["reid_rate_pct"], m["total"],
    m["interrupt_resume"], m["lost_nearby"], m["nn_would_match"],
    "  [THIN SAMPLE]" if d.get("thin") else ""))
top = sorted(d["failure_reasons"].items(), key=lambda kv: -kv[1])[:3]
if top:
    print("[reid-audit] top gates: " + ", ".join("%s=%d" % (k, v) for k, v in top))
sys.exit(3 if d.get("errors") else 0)
'
ERRS=$?

echo "[reid-audit] $(date -u +%FT%TZ) done — $(wc -l < "$HIST") samples retained"

# A run that threw on every frame still prints a tidy zero, which is
# indistinguishable from a quiet store unless it is called out here.
if [ $ERRS -eq 3 ]; then
  echo "[reid-audit] WARNING: frames threw during this run — sample recorded but marked unusable"
  exit 1
fi
exit 0
