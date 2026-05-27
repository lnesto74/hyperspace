#!/usr/bin/env bash
# Diagnose offline reconcile jobs stuck at 99% on DO production.
#
# Usage (on droplet):
#   cd /opt/hyperspace
#   ./scripts/diagnose_offline_reconcile.sh
#   ./scripts/diagnose_offline_reconcile.sh watch grocery_capture_....jsonl
#   ./scripts/diagnose_offline_reconcile.sh sample grocery_capture_....jsonl
#
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
API="${API:-http://127.0.0.1:3001}"
SOURCE="${1:-grocery_capture_2705_1216_Raj_103_2026-05-27T10-15-47.jsonl}"
MODE="${MODE:-status}"
if [[ "${1:-}" == "watch" || "${1:-}" == "sample" || "${1:-}" == "logs" ]]; then
  MODE="$1"
  SOURCE="${2:-grocery_capture_2705_1216_Raj_103_2026-05-27T10-15-47.jsonl}"
fi

# Must run from /app inside the image (node_modules + relative imports).
run_node() {
  $COMPOSE exec -T -w /app backend node scripts/diagnose-offline-reconcile.mjs "$@"
}

echo "========== Hyperspace offline reconcile diagnostic =========="
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

echo "========== Capture + reconciled dir =========="
ls -lah "/opt/hyperspace/replay/${SOURCE}" 2>/dev/null || echo "capture missing on host"
echo "--- reconciled/ ---"
ls -lah /opt/hyperspace/replay/reconciled/ 2>/dev/null || echo "reconciled dir empty"
echo

echo "========== API jobs =========="
JOBS_JSON="$(curl -sf "${API}/api/replay/reconcile/jobs?sourceFile=${SOURCE}" || echo '{}')"
echo "$JOBS_JSON" | python3 -m json.tool 2>/dev/null || echo "$JOBS_JSON"
echo

# Orphan hint: running job but empty artifact and container restarted after job started
python3 - <<'PY' "$JOBS_JSON" "${CONTAINER_ID:-}"
import json, sys, subprocess
from datetime import datetime, timezone
jobs_json, cid = sys.argv[1], sys.argv[2]
try:
    jobs = json.loads(jobs_json).get("jobs") or []
except Exception:
    jobs = []
running = [j for j in jobs if j.get("status") in ("running", "pending")]
if not running:
    sys.exit(0)
j = running[0]
started = j.get("startedAt") or j.get("createdAt")
artifact = j.get("artifactPath") or ""
print("========== Orphan check ==========")
print(f"  running job: {j.get('id')}  progress: {round((j.get('progress') or 0)*100)}%")
if cid:
    r = subprocess.run(["docker", "inspect", "-f", "{{.State.StartedAt}}", cid], capture_output=True, text=True)
    cstart = r.stdout.strip()
    print(f"  container started: {cstart}")
    print(f"  job started:       {started}")
    if cstart and started and cstart > started[:19]:
        print("  >>> ORPHAN LIKELY: backend restarted after job started — DB says running but no worker.")
if artifact:
    import os
    host = artifact.replace("/data/replay/reconciled/", "/opt/hyperspace/replay/reconciled/")
    if not os.path.exists(host):
        print(f"  >>> NO ARTIFACT on disk: {host}")
    else:
        st = os.stat(host)
        print(f"  artifact: {st.st_size} bytes")
PY

if [[ "$MODE" == "logs" ]]; then
  echo "========== Backend logs (OfflineReconcile) =========="
  $COMPOSE logs backend --tail 400 2>&1 | grep -E 'OfflineReconcile|offline.reconcile|FATAL|OOM|Killed|JavaScript heap|ENOMEM' || echo "(no matching log lines)"
  exit 0
fi

echo "========== DB + artifact (in container, /app) =========="
if ! run_node status --source "$SOURCE" 2>/dev/null; then
  echo "(node script missing — rebuild backend after git pull: docker compose build backend && up -d backend)"
fi
echo

if [[ "$MODE" == "watch" ]]; then
  echo "========== Watching job + artifact (5s interval) =========="
  run_node watch --source "$SOURCE" --interval 5 2>/dev/null || true
  exit 0
fi

if [[ "$MODE" == "sample" ]]; then
  echo "========== Sample reconcile run (80k lines, verbose) =========="
  echo "Does NOT touch the live job queue."
  run_node run-sample --source "$SOURCE" --lines 80000
  exit 0
fi

echo "========== Recent backend reconcile logs =========="
$COMPOSE logs backend --tail 200 2>&1 | grep OfflineReconcile || echo "(no OfflineReconcile lines in last 200)"
echo
echo "Fix orphaned stuck job:"
echo "  curl -s -X POST ${API}/api/replay/reconcile/jobs/JOB_ID/cancel | python3 -m json.tool"
echo "  git pull && docker compose -f docker-compose.prod.yml build backend && docker compose -f docker-compose.prod.yml up -d backend"
echo "  (new builds auto-fail running jobs on startup — then re-run from Replay panel)"
