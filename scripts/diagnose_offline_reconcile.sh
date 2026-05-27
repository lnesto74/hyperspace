#!/usr/bin/env bash
# Diagnose offline reconcile jobs stuck at 99% on DO production.
#
# Usage (on droplet):
#   cd /opt/hyperspace
#   ./scripts/diagnose_offline_reconcile.sh
#   ./scripts/diagnose_offline_reconcile.sh watch grocery_capture_2705_1216_Raj_103_2026-05-27T10-15-47.jsonl
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

SCRIPT="/opt/hyperspace/backend/scripts/diagnose-offline-reconcile.mjs"

echo "========== Hyperspace offline reconcile diagnostic =========="
echo "time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "source: $SOURCE"
echo "mode: $MODE"
echo

echo "========== Docker backend health =========="
$COMPOSE ps backend
echo
docker stats --no-stream hyperspace-backend-1 2>/dev/null || docker stats --no-stream "$($COMPOSE ps -q backend)" 2>/dev/null || echo "(docker stats unavailable)"
echo

echo "========== Capture + reconciled dir =========="
ls -lah "/opt/hyperspace/replay/${SOURCE}" 2>/dev/null || echo "capture missing on host"
ls -lah /opt/hyperspace/replay/reconciled/ 2>/dev/null | tail -10 || echo "reconciled dir empty"
echo

echo "========== API jobs =========="
curl -sf "${API}/api/replay/reconcile/jobs?sourceFile=${SOURCE}" | python3 -m json.tool || echo "API unreachable"
echo

if [[ "$MODE" == "logs" ]]; then
  echo "========== Backend logs (OfflineReconcile) =========="
  $COMPOSE logs backend --tail 300 2>&1 | grep -E 'OfflineReconcile|offline.reconcile|FATAL|OOM|Killed|JavaScript heap' || echo "(no matching log lines)"
  exit 0
fi

echo "========== DB + artifact (in container) =========="
$COMPOSE exec -T backend node "$SCRIPT" status --source "$SOURCE" || \
  $COMPOSE exec -T backend node /app/scripts/diagnose-offline-reconcile.mjs status --source "$SOURCE" || \
  echo "Run: git pull && ensure backend/scripts/diagnose-offline-reconcile.mjs exists"
echo

if [[ "$MODE" == "watch" ]]; then
  echo "========== Watching job + artifact (5s interval) =========="
  $COMPOSE exec -T backend node "$SCRIPT" watch --source "$SOURCE" --interval 5 || true
  exit 0
fi

if [[ "$MODE" == "sample" ]]; then
  echo "========== Sample reconcile run (80k lines, verbose) =========="
  echo "This does NOT touch the live job queue — tests pipeline in isolation."
  $COMPOSE exec -T backend node "$SCRIPT" run-sample --source "$SOURCE" --lines 80000
  exit 0
fi

echo "========== Recent backend reconcile logs =========="
$COMPOSE logs backend --tail 150 2>&1 | grep OfflineReconcile || echo "(no OfflineReconcile lines — job may be pre-fix code or hung silently)"
echo
echo "Commands:"
echo "  MODE=watch ./scripts/diagnose_offline_reconcile.sh watch $SOURCE"
echo "  MODE=sample ./scripts/diagnose_offline_reconcile.sh sample $SOURCE"
echo "  MODE=logs  ./scripts/diagnose_offline_reconcile.sh logs"
echo "  curl -X POST ${API}/api/replay/reconcile/jobs/JOB_ID/cancel   # unstick"
echo "  $COMPOSE logs -f backend | grep OfflineReconcile"
