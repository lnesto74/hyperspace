#!/usr/bin/env bash
# Daily customer KPI from the raw 10 Hz parquet archive.
# Cron: 30 4 * * * (04:30 UTC, after hyperspace-parquet-archive at 04:00).
#
# Usage:
#   hyperspace-daily-customer-kpi.sh                  # yesterday Europe/Rome
#   hyperspace-daily-customer-kpi.sh 2026-09-14       # one day
#   hyperspace-daily-customer-kpi.sh 2026-09-08 2026-09-14  # backfill inclusive
set -euo pipefail

CONF=/etc/hyperspace/heartbeat.env
[ -r "$CONF" ] && . "$CONF"

ROOT="${HYPERSPACE_ROOT:-/opt/hyperspace}"
API="${API:-http://localhost:3001}"
VENUE_ID="${VENUE_ID:-55fdd53b-3298-4355-97c0-b4e789b11d06}"
TZ_NAME="${VENUE_TZ:-Europe/Rome}"
REPORT_DIR="${DAILY_KPI_REPORT:-/data/hyperspace/reports/daily-kpi}"
PARQUET_DIR="${DAILY_KPI_PARQUET_DIR:-/data/hyperspace/raw}"
if [ -z "${DAILY_KPI_PYTHON:-}" ] && [ -x "$ROOT/.venv-daily-kpi/bin/python" ]; then
  PYTHON="$ROOT/.venv-daily-kpi/bin/python"
else
  PYTHON="${DAILY_KPI_PYTHON:-python3}"
fi
SCRIPT="$ROOT/scripts/daily-customer-kpi.py"
CFG="$ROOT/analysis/journey_lab/config/treviglio.json"

env_get() {
  # grep exits 1 when the key is missing; with `set -e` that aborted the job
  # before any day ran (prod .env has no DAILY_KPI_TOKEN yet).
  grep -m1 "^$1=" "$ROOT/.env" 2>/dev/null \
    | cut -d= -f2- \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^['\"]//" -e "s/['\"]$//" \
    || true
}

TOKEN="${DAILY_KPI_TOKEN:-$(env_get DAILY_KPI_TOKEN)}"

yesterday() {
  if date -u -d "yesterday" +%F >/dev/null 2>&1; then
    TZ="$TZ_NAME" date -d "yesterday" +%F
  else
    TZ="$TZ_NAME" date -v-1d +%F
  fi
}

add_day() {
  local d="$1"
  if date -u -d "$d +1 day" +%F >/dev/null 2>&1; then
    date -u -d "$d +1 day" +%F
  else
    date -u -j -f %Y-%m-%d -v+1d "$d" +%F
  fi
}

FROM="${1:-$(yesterday)}"
TO="${2:-$FROM}"

if [[ ! "$FROM" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || [[ ! "$TO" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "[daily-kpi] usage: $0 [YYYY-MM-DD [YYYY-MM-DD]]"
  exit 1
fi

if [ ! -f "$SCRIPT" ]; then
  echo "[daily-kpi] missing $SCRIPT"
  exit 1
fi

failed=0
day="$FROM"
while [[ "$day" < "$TO" || "$day" == "$TO" ]]; do
  parquet="$PARQUET_DIR/hyperspace-raw-$day.parquet"
  lab_out="$ROOT/analysis/journey_lab/out/$day"
  roi_dir="$ROOT/analysis/journey_lab/data/$day"
  if [[ ! -f "$roi_dir/regions_of_interest.csv" ]]; then
    mkdir -p "$roi_dir"
    latest=$(ls -1dt "$ROOT/analysis/journey_lab/data/"*/regions_of_interest.csv 2>/dev/null | head -1 || true)
    if [[ -n "${latest:-}" ]]; then
      cp "$latest" "$roi_dir/regions_of_interest.csv"
      echo "[daily-kpi] $day reused ROI CSV from $latest"
    fi
  fi
  echo "[daily-kpi] $day parquet=$( [[ -f $parquet ]] && echo yes || echo no )"

  args=(--day "$day" --venue "$VENUE_ID" --report "$REPORT_DIR" --cfg "$CFG")
  if [[ -f "$parquet" ]]; then
    args+=(--parquet "$parquet" --compute)
  elif [[ -f "$lab_out/110_average_journey.json" ]]; then
    args+=(--lab-out "$lab_out" --assemble-only)
  else
    echo "[daily-kpi] FAILED $day: no parquet and no Journey Lab JSON"
    failed=$((failed + 1))
    day=$(add_day "$day")
    continue
  fi

  if ! "$PYTHON" "$SCRIPT" "${args[@]}"; then
    echo "[daily-kpi] FAILED python $day"
    failed=$((failed + 1))
    day=$(add_day "$day")
    continue
  fi

  json="$REPORT_DIR/$VENUE_ID/$day.json"
  if [[ ! -f "$json" ]]; then
    echo "[daily-kpi] FAILED missing $json"
    failed=$((failed + 1))
    day=$(add_day "$day")
    continue
  fi

  # Persist into the live SQLite via the reporting API when the backend is up.
  ingested=0
  if [[ -n "${TOKEN:-}" ]]; then
    if curl -sS --max-time 30 -X POST \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @"$json" \
      "$API/api/reporting/daily-kpi/ingest"; then
      echo "[daily-kpi] ingested $day"
      ingested=1
    else
      echo "[daily-kpi] WARN ingest $day failed (JSON is on disk)"
    fi
  fi
  if [[ "$ingested" -eq 0 ]] && command -v docker >/dev/null && docker inspect hyperspace-backend-1 >/dev/null 2>&1; then
    if docker exec hyperspace-backend-1 node --input-type=module -e "
      import fs from 'fs';
      import Database from 'better-sqlite3';
      import { persistDailyKpi } from './services/dailyKpi/store.js';
      const p = JSON.parse(fs.readFileSync('/data/reports/daily-kpi/${VENUE_ID}/${day}.json', 'utf8'));
      const db = new Database('/data/db/hyperspace.db');
      persistDailyKpi(db, p);
      console.log('[daily-kpi] ingested via docker', p.day, p.kpis?.length);
    "; then
      ingested=1
    else
      echo "[daily-kpi] WARN docker ingest $day failed (JSON is on disk)"
    fi
  fi
  if [[ "$ingested" -eq 0 && -z "${TOKEN:-}" ]]; then
    echo "[daily-kpi] WARN no DAILY_KPI_TOKEN; JSON written, SQLite ingest skipped"
  fi

  day=$(add_day "$day")
done

if [[ "$failed" -gt 0 ]]; then
  echo "[daily-kpi] $failed day(s) failed"
  exit 1
fi
echo "[daily-kpi] done $FROM..$TO"
