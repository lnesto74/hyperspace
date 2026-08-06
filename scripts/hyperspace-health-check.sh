#!/usr/bin/env bash
# Alerts on the platform failures that have actually happened here.
#
# Each check below corresponds to a real incident:
#   reconciler off      the Treviglio reconciler sat disabled after the July
#                       outage; dwell silently degraded to raw perception
#                       quality (mean 3.3 s) for weeks with nobody watching.
#   config drift        a partial PATCH reset the owner-tuned gates to factory
#                       defaults, which looks healthy but tracks like the
#                       vendor's raw output.
#   disk               the droplet reached 82% full, mostly Docker build cache
#                       and free pages inside a database that never shrinks.
#   stale backup       the nightly backup cron was specified but never
#                       installed, so no backup existed at all.
#
# Companion to hyperspace-edge-heartbeat.sh, and deliberately shares its
# conventions: same Resend transport, same state directory, same re-alert
# throttle, so operators have one mental model for both.

set -o pipefail

CONF=/etc/hyperspace/heartbeat.env
[ -r "$CONF" ] && . "$CONF"

# RESEND_* live in the app config, which cannot be sourced: some values are
# unquoted and contain shell metacharacters (e.g. "Name <addr@host>").
env_get() {
  grep -m1 "^$1=" /opt/hyperspace/.env 2>/dev/null \
    | cut -d= -f2- \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^['\"]//" -e "s/['\"]$//"
}
RESEND_API_KEY="${RESEND_API_KEY:-$(env_get RESEND_API_KEY)}"
RESEND_FROM_EMAIL="${RESEND_FROM_EMAIL:-$(env_get RESEND_FROM_EMAIL)}"

VENUE_ID="${VENUE_ID:-55fdd53b-3298-4355-97c0-b4e789b11d06}"
VENUE_NAME="${VENUE_NAME:-Treviglio}"
BACKEND="${BACKEND:-http://127.0.0.1:3001}"
ALERT_EMAIL="${ALERT_EMAIL:-ln@ulisse.tech}"
FROM_EMAIL="${RESEND_FROM_EMAIL:-Hyperspace <ln@ulisse.tech>}"
REALERT_HOURS="${HEALTH_REALERT_HOURS:-12}"

DISK_PCT_MAX="${DISK_PCT_MAX:-80}"
BACKUP_MAX_AGE_H="${BACKUP_MAX_AGE_H:-36}"
BACKUP_DIR="${BACKUP_DIR:-/data/hyperspace/backups}"
DB_PATH="${DB_PATH:-/data/hyperspace/db/hyperspace.db}"
DB_FREE_PCT_MAX="${DB_FREE_PCT_MAX:-50}"

STATE_DIR=/var/lib/hyperspace-heartbeat
LAST_ALERT_FILE="$STATE_DIR/health_last_alert"
mkdir -p "$STATE_DIR"

# Resend sits behind Cloudflare, which rejects python-urllib's User-Agent with
# error 1010. Send with curl.
send_mail() {
  local subject="$1" body="$2" payload cfg resp
  if [ -z "${RESEND_API_KEY:-}" ]; then
    echo "no RESEND_API_KEY configured, cannot email; subject was: $subject"
    return 1
  fi
  payload=$(SUBJ="$subject" BODY="$body" FROM="$FROM_EMAIL" TO="$ALERT_EMAIL" python3 -c '
import json, os
print(json.dumps({
    "from": os.environ["FROM"],
    "to": [e.strip() for e in os.environ["TO"].split(",") if e.strip()],
    "subject": os.environ["SUBJ"],
    "text": os.environ["BODY"],
}))')
  cfg=$(mktemp); chmod 600 "$cfg"
  printf 'header = "Authorization: Bearer %s"\n' "$RESEND_API_KEY" > "$cfg"
  resp=$(printf '%s' "$payload" | curl -sS -X POST https://api.resend.com/emails \
    -K "$cfg" \
    -H "Content-Type: application/json" \
    -A "hyperspace-health/1.0" \
    --max-time 20 --data-binary @- -w ' HTTP:%{http_code}')
  rm -f "$cfg"
  echo "resend: $resp"
}

PROBLEMS=()
add() { PROBLEMS+=("$1"); }

# ---------------------------------------------------------------- reconciler
CFG_JSON=$(curl -sS --max-time 15 "$BACKEND/api/venues/$VENUE_ID/reconciler-config" 2>/dev/null)
if [ -z "$CFG_JSON" ]; then
  add "Cannot read reconciler config from the backend (API unreachable?)."
else
  # The expected gates are the locked 'luca' preset. Drift here is as damaging
  # as the reconciler being off outright, and far less visible.
  RECON_CHECK=$(CFG="$CFG_JSON" python3 - <<'PY'
import json, os, sys
want = {
    "enabled": True,
    "reid_max_gap_s": 12,
    "reid_max_distance_m": 12.7,
    "reid_max_implied_speed_m_s": 2.6,
    "smoothing_alpha": 0.12,
    "ghost_static_timeout_s": 90,
    "ghost_static_displacement_m": 1.6,
    "active_to_lost_timeout_ms": 6000,
}
try:
    cfg = json.loads(os.environ["CFG"])["reconciler"]
except Exception as exc:
    print(f"unparseable reconciler config: {exc}")
    sys.exit(0)

if cfg.get("enabled") is not True:
    print("RECONCILER IS DISABLED - dwell and zone KPIs are raw vendor output.")

drift = [f"{k}={cfg.get(k)} (expected {v})"
         for k, v in want.items() if k != "enabled" and cfg.get(k) != v]
if drift:
    print("Reconciler config drifted from the locked 'luca' preset: " + ", ".join(drift))
PY
)
  [ -n "$RECON_CHECK" ] && add "$RECON_CHECK"
fi

# ------------------------------------------------------------ ingest liveness
# Every zone KPI is written from the track aggregator's emit loop, and that loop
# used to be started only when a browser subscribed over the tracking socket. A
# restart with nobody watching therefore stopped all recording silently, while
# the broker, the MQTT connection, the reconciler config and the container
# health check all still looked perfectly fine (2026-08-06, ~40 min lost).
# Ingest starts the loop itself now, but no other check here would notice if
# writing stopped for some different reason, so test the only thing that
# ultimately matters: are rows still landing?
INGEST_MAX_AGE_MIN="${INGEST_MAX_AGE_MIN:-20}"
if [ -r "$DB_PATH" ] && command -v sqlite3 >/dev/null; then
  HOUR_LOCAL=$(TZ=Europe/Rome date +%-H)
  OPEN_H=$(sqlite3 "$DB_PATH" \
    "SELECT COALESCE(opening_hour, 8) FROM venues WHERE id='$VENUE_ID';" 2>/dev/null)
  CLOSE_H=$(sqlite3 "$DB_PATH" \
    "SELECT COALESCE(closing_hour, 21) FROM venues WHERE id='$VENUE_ID';" 2>/dev/null)
  # Only meaningful while the store is trading; an empty aisle at 03:00 is not a fault.
  if [ -n "$OPEN_H" ] && [ -n "$CLOSE_H" ] \
     && [ "$HOUR_LOCAL" -ge "$OPEN_H" ] && [ "$HOUR_LOCAL" -lt "$CLOSE_H" ]; then
    LAST_TS=$(sqlite3 "$DB_PATH" \
      "SELECT COALESCE(MAX(timestamp), 0) FROM track_positions WHERE venue_id='$VENUE_ID';" 2>/dev/null)
    if [ -n "$LAST_TS" ] && [ "$LAST_TS" -gt 0 ]; then
      AGE_MIN=$(( ( $(date +%s) * 1000 - LAST_TS ) / 60000 ))
      if [ "$AGE_MIN" -gt "$INGEST_MAX_AGE_MIN" ]; then
        add "No track positions written for ${AGE_MIN} min while the store is open (${OPEN_H}:00-${CLOSE_H}:00). Every zone KPI is stalled. Check that the track aggregator is emitting: docker logs hyperspace-backend-1 | grep 'Live pipeline started'."
      fi
    else
      add "track_positions has no rows for this venue at all — ingest has never written."
    fi
  fi
fi

# ---------------------------------------------------------------------- disk
DISK_PCT=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ -n "$DISK_PCT" ] && [ "$DISK_PCT" -ge "$DISK_PCT_MAX" ]; then
  add "Root filesystem is ${DISK_PCT}% full (threshold ${DISK_PCT_MAX}%). Try: docker builder prune -af, then /usr/local/bin/hyperspace-db-vacuum."
fi

# -------------------------------------------------------------------- backup
NEWEST=$(ls -1t "$BACKUP_DIR"/hyperspace_*.db.gz 2>/dev/null | head -1)
if [ -z "$NEWEST" ]; then
  add "No database backup found in $BACKUP_DIR."
else
  AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$NEWEST") ) / 3600 ))
  if [ "$AGE_H" -gt "$BACKUP_MAX_AGE_H" ]; then
    add "Newest database backup is ${AGE_H}h old (threshold ${BACKUP_MAX_AGE_H}h): $(basename "$NEWEST")."
  fi
fi

# ------------------------------------------------------- raw archive conversion
# The recorder can only write gzipped JSONL, and a nightly job converts each
# finished day to Parquet and deletes the JSONL. If that job fails the archive
# keeps growing in a format none of the analysis tooling can actually open —
# which looks fine from the outside, exactly like the reconciler being off did.
# Days older than yesterday are given no benefit of the doubt; yesterday is,
# because the conversion runs at 04:00.
RAW_DIR="${RAW_ARCHIVE_DIR:-/data/hyperspace/raw}"
if [ -d "$RAW_DIR" ]; then
  CUTOFF=$(date -u -d '2 days ago' +%Y-%m-%d)
  STALE=$(ls -1 "$RAW_DIR"/hyperspace-raw-*.jsonl.gz 2>/dev/null \
    | sed -e 's|.*/hyperspace-raw-||' -e 's|\.jsonl\.gz$||' \
    | awk -v c="$CUTOFF" '$0 <= c' | tr '\n' ' ')
  if [ -n "$STALE" ]; then
    add "Raw archive not converted to Parquet for: ${STALE% }. See /var/log/hyperspace-parquet-archive.log."
  fi
fi

# ------------------------------------------------------------------ db bloat
if [ -r "$DB_PATH" ] && command -v sqlite3 >/dev/null; then
  PAGES=$(sqlite3 "$DB_PATH" "PRAGMA page_count;" 2>/dev/null)
  FREE=$(sqlite3 "$DB_PATH" "PRAGMA freelist_count;" 2>/dev/null)
  if [ -n "$PAGES" ] && [ -n "$FREE" ] && [ "$PAGES" -gt 0 ]; then
    PCT=$(( FREE * 100 / PAGES ))
    if [ "$PCT" -ge "$DB_FREE_PCT_MAX" ]; then
      add "Database is ${PCT}% free pages — purges are not returning space. Run the vacuum-and-swap script."
    fi
  fi
fi

# ------------------------------------------------------------------- dispatch
if [ ${#PROBLEMS[@]} -eq 0 ]; then
  echo "$(date -u +%FT%TZ) all checks passed"
  rm -f "$LAST_ALERT_FILE"
  exit 0
fi

BODY="Hyperspace health check — $VENUE_NAME
$(date -u +%FT%TZ)

"
for p in "${PROBLEMS[@]}"; do BODY="$BODY  - $p
"; done

echo "$BODY"

# Throttle: alert once, then stay quiet until the problem clears or the window
# passes. An alert that fires every 5 minutes gets filtered and then ignored.
NOW=$(date +%s)
if [ -f "$LAST_ALERT_FILE" ]; then
  LAST=$(cat "$LAST_ALERT_FILE" 2>/dev/null || echo 0)
  if [ $(( (NOW - LAST) / 3600 )) -lt "$REALERT_HOURS" ]; then
    echo "(within ${REALERT_HOURS}h re-alert window, not emailing)"
    exit 1
  fi
fi

send_mail "[Hyperspace] $VENUE_NAME health check: ${#PROBLEMS[@]} problem(s)" "$BODY"
echo "$NOW" > "$LAST_ALERT_FILE"
exit 1
