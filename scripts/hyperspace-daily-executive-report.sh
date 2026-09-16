#!/usr/bin/env bash
# Emails the Esselunga executive report from daily_kpi only.
# Fails (non-zero) if the day's daily_kpi is missing or headline KPIs are unreliable.
# Do not fall back to the old zone_visits computation.
#
# Run after scripts/hyperspace-daily-customer-kpi.sh (04:30 UTC for yesterday,
# or a same-day run after close).
set -euo pipefail

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
REPORT_EMAIL="${REPORT_EMAIL:-${ALERT_EMAIL:-ln@ulisse.tech}}"

VENUE_ID="${VENUE_ID:-55fdd53b-3298-4355-97c0-b4e789b11d06}"
API="${API:-http://localhost:3001}"
REPORT_DIR="${REPORT_DIR:-/data/hyperspace/reports}"
KEEP_DAYS="${REPORT_KEEP_DAYS:-90}"
TZ_NAME="${VENUE_TZ:-Europe/Rome}"

DAY="${1:-$(TZ="$TZ_NAME" date +%F)}"
START=$(( $(TZ="$TZ_NAME" date -d "$DAY 00:00" +%s 2>/dev/null || TZ="$TZ_NAME" date -j -f %Y-%m-%d "$DAY" +%s) * 1000 ))
END=$(( START + 24 * 60 * 60 * 1000 - 1 ))

mkdir -p "$REPORT_DIR"
PDF="$REPORT_DIR/esselunga-executive-$DAY.pdf"
JSON=$(mktemp); trap 'rm -f "$JSON"' EXIT

curl -sS --max-time 30 -o "$JSON" \
  "$API/api/reporting/daily-kpi?venueId=$VENUE_ID&day=$DAY" \
  || { echo "[daily-report] FAILED: daily-kpi request failed"; exit 1; }

if ! python3 - "$JSON" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
if d.get("error") or not d.get("kpis"):
    print("daily_kpi missing or empty")
    raise SystemExit(1)
bad = [k["kpi_id"] for k in d["kpis"]
       if k.get("slot") == "giorno"
       and k["kpi_id"] in ("entrances", "visit_min", "people_mean", "queue_wait_min_per_entrance")
       and k.get("status") != "ok"]
if bad:
    print("unreliable headline KPIs:", ",".join(bad))
    raise SystemExit(1)
print("daily_kpi ok", d.get("day"))
PY
then
  echo "[daily-report] FAILED: daily_kpi missing or unreliable for $DAY"
  exit 1
fi

BODY=$(python3 - "$JSON" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
h = d.get("headline") or {}
lines = [
    f"Treviglio {d.get('day')}: {h.get('entrances')} ingressi, visita {h.get('visit_min')} min, "
    f"{h.get('people_mean')} persone in media, coda {h.get('queue_wait_min_per_entrance')} min/cliente.",
    "",
]
for kid, label in [
    ("entrances", "Ingressi"),
    ("visit_min", "Durata visita"),
    ("people_mean", "Persone medie"),
    ("queue_wait_min_per_entrance", "Attesa coda"),
]:
    row = next((k for k in d.get("kpis") or [] if k["kpi_id"] == kid and k["slot"] == "giorno"), None)
    if not row:
        continue
    lines.append(f"{label:<22} {row.get('value')}  [{row.get('label')}]")
fails = [c["check_id"] for c in d.get("checks") or [] if not c.get("passed")]
if fails:
    lines += ["", "Controlli falliti: " + ", ".join(fails)]
lines += ["", "The attached PDF is the full report from daily_kpi."]
print("\n".join(lines))
PY
)

HTTP=$(curl -sS --max-time 180 -o "$PDF" -w '%{http_code}' \
  "$API/api/reporting/esselunga-executive/pdf?venueId=$VENUE_ID&startTs=$START&endTs=$END&day=$DAY")

if [ "$HTTP" != "200" ] || [ ! -s "$PDF" ]; then
  echo "[daily-report] FAILED: PDF render failed (HTTP $HTTP) — not falling back to the old computation"
  rm -f "$PDF"
  exit 1
fi

if [ "$(head -c 5 "$PDF")" != "%PDF-" ]; then
  echo "[daily-report] rendered file is not a PDF"
  rm -f "$PDF"
  exit 1
fi

echo "[daily-report] $DAY · $(du -h "$PDF" | cut -f1)"
echo "$BODY"

find "$REPORT_DIR" -name 'esselunga-executive-*.pdf' -type f -mtime "+$KEEP_DAYS" -delete 2>/dev/null

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
