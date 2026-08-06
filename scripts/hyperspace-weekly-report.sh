#!/usr/bin/env bash
# Emails the weekly track-continuity report.
#
# Runs the report inside the backend container, which is where better-sqlite3
# and the live database both are, and mails the output using the same Resend
# transport as the heartbeat and health check.
set -o pipefail

CONF=/etc/hyperspace/heartbeat.env
[ -r "$CONF" ] && . "$CONF"

env_get() {
  grep -m1 "^$1=" /opt/hyperspace/.env 2>/dev/null \
    | cut -d= -f2- \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^['\"]//" -e "s/['\"]$//"
}
RESEND_API_KEY="${RESEND_API_KEY:-$(env_get RESEND_API_KEY)}"
RESEND_FROM_EMAIL="${RESEND_FROM_EMAIL:-$(env_get RESEND_FROM_EMAIL)}"
ALERT_EMAIL="${ALERT_EMAIL:-ln@ulisse.tech}"
FROM_EMAIL="${RESEND_FROM_EMAIL:-Hyperspace <ln@ulisse.tech>}"
WEEKS="${WEEKS:-10}"

SCRIPT=/usr/local/lib/hyperspace/weekly-continuity-report.cjs
docker cp "$SCRIPT" hyperspace-backend-1:/tmp/weekly-continuity-report.cjs >/dev/null 2>&1

# The daily re-ID samples land on the host; the report runs in the container.
REID_HISTORY="${REID_HISTORY:-/data/hyperspace/reid-audit/history.jsonl}"
if [ -r "$REID_HISTORY" ]; then
  docker cp "$REID_HISTORY" hyperspace-backend-1:/tmp/reid-history.jsonl >/dev/null 2>&1
else
  docker exec hyperspace-backend-1 rm -f /tmp/reid-history.jsonl >/dev/null 2>&1
fi

BODY=$(docker exec -e NODE_PATH=/app/node_modules hyperspace-backend-1 \
  node /tmp/weekly-continuity-report.cjs --weeks "$WEEKS" 2>&1)
STATUS=$?

echo "$BODY"
[ $STATUS -ne 0 ] && BODY="Report FAILED (exit $STATUS)

$BODY"

if [ -z "${RESEND_API_KEY:-}" ]; then
  echo "no RESEND_API_KEY configured, not emailing"
  exit $STATUS
fi

payload=$(SUBJ="[Hyperspace] Weekly continuity — Treviglio" BODY="$BODY" \
  FROM="$FROM_EMAIL" TO="$ALERT_EMAIL" python3 -c '
import json, os
print(json.dumps({
    "from": os.environ["FROM"],
    "to": [e.strip() for e in os.environ["TO"].split(",") if e.strip()],
    "subject": os.environ["SUBJ"],
    "text": os.environ["BODY"],
}))')
cfg=$(mktemp); chmod 600 "$cfg"
printf 'header = "Authorization: Bearer %s"\n' "$RESEND_API_KEY" > "$cfg"
printf '%s' "$payload" | curl -sS -X POST https://api.resend.com/emails \
  -K "$cfg" -H "Content-Type: application/json" \
  -A "hyperspace-weekly/1.0" --max-time 30 --data-binary @- -w ' HTTP:%{http_code}'
rm -f "$cfg"
echo
exit $STATUS
