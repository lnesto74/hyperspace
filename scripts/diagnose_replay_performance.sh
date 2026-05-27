#!/usr/bin/env bash
# Replay performance diagnostic for DO production.
#
# Usage (on droplet):
#   cd /opt/hyperspace
#   ./scripts/diagnose_replay_performance.sh              # snapshot (run anytime)
#   ./scripts/diagnose_replay_performance.sh sample       # 15s effective-speed sample (replay must be running)
#   ./scripts/diagnose_replay_performance.sh flush        # stop replay + restart backend (free memory)
#   ./scripts/diagnose_replay_performance.sh start-raw FILE [speed]
#   ./scripts/diagnose_replay_performance.sh start-reconciled JOB_ID [speed]
#
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
API="${API:-http://127.0.0.1:3001}"
MODE="${1:-snapshot}"
ARG2="${2:-}"
ARG3="${3:-4}"

section() { echo; echo "========== $* =========="; }

json_status() {
  curl -sf "${API}/api/replay/status" 2>/dev/null || echo '{}'
}

print_status() {
  json_status | python3 -m json.tool 2>/dev/null || json_status
}

host_snapshot() {
  section "Host resources"
  echo "uptime: $(uptime)"
  free -h
  echo
  df -h / /opt/hyperspace/replay 2>/dev/null || df -h /
  if command -v vmstat >/dev/null 2>&1; then
    echo
    echo "--- vmstat (1 sample) ---"
    vmstat 1 2 | tail -1
  fi
  if command -v iostat >/dev/null 2>&1; then
    echo
    echo "--- iostat ---"
    iostat -x 1 2 2>/dev/null | tail -5 || true
  fi
}

docker_snapshot() {
  section "Docker services"
  $COMPOSE ps
  CID="$($COMPOSE ps -q backend 2>/dev/null || true)"
  if [[ -n "$CID" ]]; then
    echo
    docker stats --no-stream "$CID" 2>/dev/null || true
    echo
    echo "--- backend process (RSS) ---"
    docker exec "$CID" sh -c 'ps aux --sort=-rss 2>/dev/null | head -8 || ps -eo pid,rss,comm | sort -k2 -nr | head -8' 2>/dev/null || true
  fi
}

replay_files() {
  section "Replay files on disk"
  ls -lah /opt/hyperspace/replay/*.jsonl 2>/dev/null | tail -5 || echo "(no captures)"
  echo "--- reconciled ---"
  ls -lah /opt/hyperspace/replay/reconciled/*.jsonl 2>/dev/null | tail -5 || echo "(no reconciled artifacts)"
}

replay_status_block() {
  section "Reconciled artifact sample (first batch)"
  SAMPLE=$(ls /opt/hyperspace/replay/reconciled/*GROCERY_BALANCED*.jsonl 2>/dev/null | head -1)
  if [[ -n "$SAMPLE" ]]; then
    python3 - <<'PY' "$SAMPLE"
import json, sys
path = sys.argv[1]
meta = batch = None
with open(path, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try: row = json.loads(line)
        except: continue
        if row.get("_type") == "meta" and meta is None:
            meta = row
        elif row.get("_type") == "batch" and row.get("tracks"):
            batch = row
            break
print(f"file: {path}")
if meta:
    print(f"  meta venueId: {meta.get('venueId')}")
    print(f"  span: {meta.get('firstTs')} → {meta.get('lastTs')}")
if batch:
    t = batch["tracks"][0]
    vp = t.get("venuePosition") or {}
    print(f"  first batch: {len(batch['tracks'])} tracks @ ts={batch.get('timestamp')}")
    print(f"  sample trackKey: {t.get('trackKey')}")
    print(f"  sample venuePosition: x={vp.get('x')} z={vp.get('z')}")
    if not all(isinstance(vp.get(k), (int, float)) for k in ("x", "z")):
        print("  >>> INVALID coords — tracks will not render (re-run post-process)")
else:
    print("  >>> No batch rows found")
PY
  else
    echo "(no reconciled artifact)"
  fi

  section "Replay API status"
  print_status
  python3 - <<'PY'
import json, subprocess, sys
try:
    raw = subprocess.check_output(["curl", "-sf", "http://127.0.0.1:3001/api/replay/status"], text=True)
    s = json.loads(raw)
except Exception as e:
    print(f"(could not parse status: {e})")
    sys.exit(0)
running = s.get("running")
speed = s.get("speed")
delivery = s.get("delivery")
progress = s.get("progress") or 0
msgs = s.get("messagesPublished") or 0
started = s.get("startedAt")
err = s.get("lastError")
file = s.get("file")
print()
print("Interpretation:")
if not running:
    print("  Replay is STOPPED.")
    if err:
        print(f"  lastError: {err}")
else:
    print(f"  running: {file}  speed={speed}x  delivery={delivery}")
    print(f"  progress={progress*100:.2f}%  messagesPublished={msgs}")
    if delivery == "mqtt":
        print("  >>> WARNING: delivery=mqtt (slow). Expected direct injection in-process.")
    if speed and float(speed) <= 1:
        print("  >>> Speed <=1x plays near real-time — bump to 4x or 10x in UI.")
    if file and str(file).endswith(".reconciled.jsonl"):
        print("  Reconciled mode: ~7200 batches / 30min span → at 10x expect ~3min full replay.")
    elif file and file.endswith(".jsonl"):
        print("  Raw mode: ~900k MQTT msgs through live reconciler — much heavier than reconciled.")
PY
}

sample_speed() {
  section "15s effective replay speed sample"
  S0="$(json_status)"
  RUNNING="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('running'))" "$S0")"
  if [[ "$RUNNING" != "True" && "$RUNNING" != "true" ]]; then
    echo "Replay is not running. Start replay first, then re-run:"
    echo "  ./scripts/diagnose_replay_performance.sh sample"
    exit 1
  fi
  echo "Sampling for 15 seconds..."
  sleep 15
  S1="$(json_status)"
  python3 - <<'PY' "$S0" "$S1"
import json, sys
s0 = json.loads(sys.argv[1])
s1 = json.loads(sys.argv[2])
dt = 15.0
p0, p1 = s0.get("progress") or 0, s1.get("progress") or 0
m0, m1 = s0.get("messagesPublished") or 0, s1.get("messagesPublished") or 0
configured = float(s0.get("speed") or 1)
dp = p1 - p0
dm = m1 - m0
print(f"configured speed:     {configured}x")
print(f"progress delta:       {dp*100:.3f}% in {dt:.0f}s")
print(f"messages/batches:     +{dm} in {dt:.0f}s ({dm/dt:.1f}/s)")
if dp > 0:
    # If linear progress, ETA for remainder
    remain = max(0, 1 - p1)
    rate = dp / dt
    eta_s = remain / rate if rate > 0 else float('inf')
    print(f"projected ETA:        {eta_s/60:.1f} min to finish at current rate")
    # Rough effective speed vs real-time (needs span — grocery ~30min)
    span_min = 30.0
    effective = (dp * span_min * 60) / dt if "reconciled" in str(s0.get("delivery","")) else None
    if effective:
        print(f"rough effective speed: ~{effective:.1f}x vs 30min capture (reconciled estimate)")
if dm <= 0:
    print(">>> STALL: no progress in 15s — CPU/memory/IO bottleneck or replay blocked.")
elif dm/dt < 5 and str(s0.get("file","")).endswith(".jsonl") and "reconciled" not in str(s0.get("delivery","")):
    print(">>> Raw replay looks CPU-bound. Prefer reconciled replay for demos.")
PY
}

recent_logs() {
  section "Recent replay logs (last 40 lines)"
  $COMPOSE logs backend --tail 400 2>&1 | grep -E '\[Replay\]|\[MQTT\]|OfflineReconcile|heap|ENOMEM|Killed' | tail -40 || echo "(no matching lines)"
}

flush_memory() {
  section "Stop replay + restart backend (flush Node heap)"
  curl -sf -X POST "${API}/api/replay/stop" >/dev/null 2>&1 || true
  sleep 2
  $COMPOSE restart backend
  echo "Waiting for health..."
  for i in $(seq 1 30); do
    if curl -sf "${API}/api/replay/status" >/dev/null 2>&1; then
      echo "Backend up after ${i}s"
      break
    fi
    sleep 1
  done
  print_status
}

start_raw() {
  local file="${ARG2:-}"
  local speed="${ARG3:-4}"
  [[ -z "$file" ]] && { echo "Usage: $0 start-raw CAPTURE.jsonl [speed]"; exit 1; }
  section "Start raw replay ${file} at ${speed}x"
  curl -sv -X POST "${API}/api/replay/start" \
    -H 'Content-Type: application/json' \
    -d "{\"file\":\"${file}\",\"speed\":${speed},\"rewriteTimestamps\":true,\"startProgress\":0}" 2>&1 | tail -20
  sleep 2
  print_status
  echo
  echo "Now run: ./scripts/diagnose_replay_performance.sh sample"
}

start_reconciled() {
  local job_id="${ARG2:-}"
  local speed="${ARG3:-4}"
  [[ -z "$job_id" ]] && { echo "Usage: $0 start-reconciled JOB_ID [speed]"; exit 1; }
  section "Start reconciled replay job ${job_id} at ${speed}x"
  curl -sv -X POST "${API}/api/replay/start" \
    -H 'Content-Type: application/json' \
    -d "{\"jobId\":\"${job_id}\",\"reconciled\":true,\"speed\":${speed},\"rewriteTimestamps\":true,\"startProgress\":0}" 2>&1 | tail -20
  sleep 2
  print_status
  echo
  echo "Now run: ./scripts/diagnose_replay_performance.sh sample"
}

echo "========== Hyperspace replay performance diagnostic =========="
echo "time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "mode: $MODE"

case "$MODE" in
  sample) sample_speed ;;
  flush) flush_memory ;;
  start-raw) start_raw ;;
  start-reconciled) start_reconciled ;;
  *)
    host_snapshot
    docker_snapshot
    replay_files
    replay_status_block
    recent_logs
    echo
    echo "Commands:"
    echo "  ./scripts/diagnose_replay_performance.sh sample          # while replay running"
    echo "  ./scripts/diagnose_replay_performance.sh flush           # stop + restart backend"
    echo "  ./scripts/diagnose_replay_performance.sh start-reconciled JOB_ID 10"
    ;;
esac
