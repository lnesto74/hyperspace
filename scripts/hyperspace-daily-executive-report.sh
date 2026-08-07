#!/usr/bin/env bash
# Emails the Esselunga executive report for today's trading day, with the PDF
# attached, and keeps a copy on disk.
#
# The document is rendered by the backend from the same payload the dashboard
# tab reads, so what management receives each evening is what the store director
# saw during the day. Nothing is recomputed here.
#
# Runs after closing. The window is midnight to now in the venue's timezone,
# which is the whole trading day once the store is shut.
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
FROM_EMAIL="${RESEND_FROM_EMAIL:-Hyperspace <ln@ulisse.tech>}"
# Deliberately separate from ALERT_EMAIL: alarms wake an engineer, this goes to
# whoever reads the trading numbers.
REPORT_EMAIL="${REPORT_EMAIL:-${ALERT_EMAIL:-ln@ulisse.tech}}"

VENUE_ID="${VENUE_ID:-55fdd53b-3298-4355-97c0-b4e789b11d06}"
API="${API:-http://localhost:3001}"
REPORT_DIR="${REPORT_DIR:-/data/hyperspace/reports}"
KEEP_DAYS="${REPORT_KEEP_DAYS:-90}"
TZ_NAME="${VENUE_TZ:-Europe/Rome}"

START=$(( $(TZ="$TZ_NAME" date -d 'today 00:00' +%s) * 1000 ))
END=$(( $(date +%s) * 1000 ))
DAY=$(TZ="$TZ_NAME" date +%F)

if [ "$END" -le "$START" ]; then
  echo "[daily-report] refusing to run: computed an empty window"
  exit 1
fi

mkdir -p "$REPORT_DIR"
PDF="$REPORT_DIR/esselunga-executive-$DAY.pdf"
JSON=$(mktemp); trap 'rm -f "$JSON"' EXIT

# ------------------------------------------------------------------- payload
curl -sS --max-time 120 -o "$JSON" \
  "$API/api/reporting/summary?personaId=esselunga-executive&venueId=$VENUE_ID&startTs=$START&endTs=$END&variant=hq" \
  || { echo "[daily-report] summary request failed"; exit 1; }

BODY=$(python3 - "$JSON" <<'PY'
import json, sys

with open(sys.argv[1]) as fh:
    d = json.load(fh)

j = (d.get("supporting") or {}).get("esselungaJourney") or {}
if not j:
    print("No journey data was returned for this window.")
    raise SystemExit(0)

lines = [(j.get("headline") or {}).get("text", "No summary available."), ""]

for k in j.get("headlineKpis") or []:
    delta = ""
    if k.get("deltaPct") is not None:
        arrow = "up" if k["direction"] == "up" else "down" if k["direction"] == "down" else "flat"
        delta = f"  ({arrow} {abs(k['deltaPct'])}% vs last week)"
    lines.append(f"{k['label']:<18} {k['display']:>10}{delta}")

insights = j.get("insights") or []
if insights:
    lines += ["", "What to act on:"]
    for i in insights[:3]:
        lines.append(f"  - {i['title']}: {i['message']}")
        if i.get("action"):
            lines.append(f"    Action: {i['action']}")

t = (j.get("metricThresholds") or {}).get("dwellSec")
if t:
    lines += ["", f"Stopping power counts a pause of {t}s or more, per Esselunga's KPI specification."]

lines += ["", "The attached PDF is the full report."]
print("\n".join(lines))
PY
)

# ----------------------------------------------------------------------- pdf
HTTP=$(curl -sS --max-time 180 -o "$PDF" -w '%{http_code}' \
  "$API/api/reporting/esselunga-executive/pdf?venueId=$VENUE_ID&startTs=$START&endTs=$END&variant=hq")

if [ "$HTTP" != "200" ] || [ ! -s "$PDF" ]; then
  echo "[daily-report] PDF render failed (HTTP $HTTP)"
  rm -f "$PDF"
  exit 1
fi

# A PDF that is not a PDF has happened before, via an error page served with a
# 200. Check the magic rather than trusting the status line.
if [ "$(head -c 5 "$PDF")" != "%PDF-" ]; then
  echo "[daily-report] rendered file is not a PDF"
  rm -f "$PDF"
  exit 1
fi

echo "[daily-report] $DAY · $(du -h "$PDF" | cut -f1)"
echo "$BODY"

# --------------------------------------------------------------- retention
find "$REPORT_DIR" -name 'esselunga-executive-*.pdf' -type f -mtime "+$KEEP_DAYS" -delete 2>/dev/null

# ------------------------------------------------------------------- email
if [ -z "${RESEND_API_KEY:-}" ]; then
  echo "[daily-report] no RESEND_API_KEY configured, not emailing"
  exit 0
fi

payload=$(SUBJ="[Hyperspace] Esselunga executive — $DAY" BODY="$BODY" \
  FROM="$FROM_EMAIL" TO="$REPORT_EMAIL" PDF="$PDF" DAY="$DAY" python3 -c '
import base64, json, os

with open(os.environ["PDF"], "rb") as fh:
    content = base64.b64encode(fh.read()).decode("ascii")

print(json.dumps({
    "from": os.environ["FROM"],
    "to": [e.strip() for e in os.environ["TO"].split(",") if e.strip()],
    "subject": os.environ["SUBJ"],
    "text": os.environ["BODY"],
    "attachments": [{
        "filename": "esselunga-executive-%s.pdf" % os.environ["DAY"],
        "content": content,
    }],
}))')

cfg=$(mktemp); chmod 600 "$cfg"
printf 'header = "Authorization: Bearer %s"\n' "$RESEND_API_KEY" > "$cfg"
printf '%s' "$payload" | curl -sS -X POST https://api.resend.com/emails \
  -K "$cfg" -H "Content-Type: application/json" \
  -A "hyperspace-daily-executive/1.0" --max-time 60 --data-binary @- -w ' HTTP:%{http_code}'
rm -f "$cfg"
echo
