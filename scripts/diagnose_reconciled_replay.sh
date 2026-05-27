#!/usr/bin/env bash
# Diagnose reconciled MQTT replay on DO production.
#
# Usage (on droplet):
#   cd /opt/hyperspace
#   ./scripts/diagnose_reconciled_replay.sh
#   ./scripts/diagnose_reconciled_replay.sh grocery_capture_....jsonl
#   ./scripts/diagnose_reconciled_replay.sh logs
#   ./scripts/diagnose_reconciled_replay.sh start JOB_ID
#
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
API="${API:-http://127.0.0.1:3001}"
SOURCE="${1:-grocery_capture_2705_1216_Raj_103_2026-05-27T10-15-47.jsonl}"
MODE="${MODE:-status}"
if [[ "${1:-}" == "logs" || "${1:-}" == "start" ]]; then
  MODE="$1"
  SOURCE="${2:-grocery_capture_2705_1216_Raj_103_2026-05-27T10-15-47.jsonl}"
  EXTRA="${3:-}"
fi

echo "========== Hyperspace reconciled replay diagnostic =========="
echo "time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "source: $SOURCE"
echo "mode: $MODE"
echo

echo "========== Docker backend health =========="
$COMPOSE ps backend
CONTAINER_ID="$($COMPOSE ps -q backend 2>/dev/null || true)"
if [[ -n "$CONTAINER_ID" ]]; then
  echo "container started: $(docker inspect -f '{{.State.StartedAt}}' "$CONTAINER_ID" 2>/dev/null || echo '?')"
  docker stats --no-stream "$CONTAINER_ID" 2>/dev/null || true
fi
echo

echo "========== Replay status =========="
curl -sf "${API}/api/replay/status" | python3 -m json.tool 2>/dev/null || echo "(status API failed)"
echo

echo "========== Reconcile jobs for capture =========="
JOBS_JSON="$(curl -sf "${API}/api/replay/reconcile/jobs?sourceFile=${SOURCE}" || echo '{}')"
echo "$JOBS_JSON" | python3 -m json.tool 2>/dev/null || echo "$JOBS_JSON"
echo

echo "========== Reconciled artifacts on disk =========="
ls -lah "/opt/hyperspace/replay/${SOURCE}" 2>/dev/null || echo "capture missing: /opt/hyperspace/replay/${SOURCE}"
echo "--- reconciled/ ---"
ls -lah /opt/hyperspace/replay/reconciled/*"${SOURCE%.jsonl}"* 2>/dev/null || ls -lah /opt/hyperspace/replay/reconciled/ 2>/dev/null || echo "reconciled dir empty"
echo

python3 - <<'PY' "$JOBS_JSON"
import json, sys, os, glob
jobs_json = sys.argv[1]
try:
    jobs = json.loads(jobs_json).get("jobs") or []
except Exception:
    jobs = []
complete = [j for j in jobs if j.get("status") == "complete"]
if not complete:
    print("========== Hints ==========")
    print("  No complete reconcile job for this capture — run post-process first.")
    sys.exit(0)
j = complete[0]
artifact = j.get("artifactPath") or ""
host = artifact.replace("/data/replay/reconciled/", "/opt/hyperspace/replay/reconciled/")
print("========== Latest complete job ==========")
print(f"  id:       {j.get('id')}")
print(f"  preset:   {j.get('presetLabel')}")
print(f"  venueId:  {j.get('venueId')}")
print(f"  batches:  {(j.get('meta') or {}).get('metrics', {}).get('batch_count', '?')}")
print(f"  tracks:   {(j.get('meta') or {}).get('metrics', {}).get('merged_tracks', '?')}")
if host and os.path.exists(host):
    st = os.stat(host)
    mb = st.st_size / 1024 / 1024
    print(f"  artifact: {host} ({mb:.1f} MB)")
    if mb > 500:
        print("  >>> Large artifact — old backend loaded ALL batches into RAM (OOM risk).")
        print("  >>> Pull latest main + rebuild backend (streaming replay fix).")
else:
    print(f"  >>> ARTIFACT MISSING: {host}")
PY

if [[ "$MODE" == "logs" ]]; then
  echo
  echo "========== Backend logs (Replay / OOM) =========="
  $COMPOSE logs backend --tail 500 2>&1 | grep -E '\[Replay\]|Reconciled|OOM|Killed|heap|ENOMEM|FATAL|JavaScript heap' || echo "(no matching log lines in last 500)"
  exit 0
fi

if [[ "$MODE" == "start" ]]; then
  JOB_ID="${EXTRA:-}"
  if [[ -z "$JOB_ID" ]]; then
    JOB_ID="$(python3 - <<'PY' "$JOBS_JSON"
import json, sys
jobs = json.loads(sys.argv[1]).get("jobs") or []
c = next((j for j in jobs if j.get("status") == "complete"), None)
print(c["id"] if c else "")
PY
)"
  fi
  if [[ -z "$JOB_ID" ]]; then
    echo "No complete job id — pass: ./scripts/diagnose_reconciled_replay.sh start SOURCE JOB_ID"
    exit 1
  fi
  echo "========== POST /api/replay/start (reconciled jobId=$JOB_ID) =========="
  curl -sv -X POST "${API}/api/replay/start" \
    -H 'Content-Type: application/json' \
    -d "{\"jobId\":\"${JOB_ID}\",\"reconciled\":true,\"speed\":4,\"rewriteTimestamps\":true,\"startProgress\":0}" 2>&1
  echo
  sleep 2
  echo "========== Status after start =========="
  curl -sf "${API}/api/replay/status" | python3 -m json.tool
  echo
  echo "========== Last 30 Replay log lines =========="
  $COMPOSE logs backend --tail 200 2>&1 | grep '\[Replay\]' | tail -30 || true
  exit 0
fi

echo "Commands:"
echo "  ./scripts/diagnose_reconciled_replay.sh logs"
echo "  ./scripts/diagnose_reconciled_replay.sh start ${SOURCE} [JOB_ID]"
echo "  hyperspace-deploy   # pull + rebuild after fix"
