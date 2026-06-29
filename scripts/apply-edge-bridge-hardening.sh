#!/usr/bin/env bash
# Harden edge Mosquitto bridge (cleansession false, queues, keepalive) and verify live MQTT on DO.
set -euo pipefail

EDGE_IP="${1:-100.106.23.6}"
EDGE_URL="http://${EDGE_IP}:8080"
DO_BACKEND="${DO_BACKEND:-http://127.0.0.1:3001}"
VENUE_ID="${VENUE_ID:-55fdd53b-3298-4355-97c0-b4e789b11d06}"

echo "==> Harden bridge on edge ${EDGE_URL}"
if curl -sf --max-time 30 -X POST "${EDGE_URL}/api/mqtt-bridge/harden" | python3 -m json.tool 2>/dev/null; then
  echo "    (harden endpoint OK)"
else
  echo "    harden endpoint missing — falling back to production bridge toggle"
  curl -sf --max-time 30 -X POST "${EDGE_URL}/api/mqtt-bridge" \
    -H 'Content-Type: application/json' \
    -d '{"target":"production"}' | python3 -m json.tool || true
  echo "    NOTE: deploy latest edge-server for full hardened bridge config"
fi

echo "==> Wait 15s for mosquitto restart"
sleep 15

echo "==> DO backend bridge harden (if deployed)"
curl -sf --max-time 30 -X POST "${DO_BACKEND}/api/replay/record/harden-bridge" \
  -H 'Content-Type: application/json' \
  -d "{\"venueId\":\"${VENUE_ID}\"}" | python3 -m json.tool 2>/dev/null || echo "    (backend endpoint not deployed yet)"

echo "==> 45s live MQTT gap check on DO"
docker exec hyperspace-mosquitto-1 timeout 45 mosquitto_sub -h 127.0.0.1 -p 1883 \
  -t 'hyperspace/trajectories/lidar-edge-001' 2>/dev/null | python3 - <<'PY'
import sys, json, time
unique_ts, wall = [], []
last_wall = None
for line in sys.stdin:
    try: msg = json.loads(line.strip())
    except: continue
    ts = msg.get("timestamp")
    if not ts: continue
    now = time.time()*1000
    if not unique_ts or ts != unique_ts[-1]:
        if last_wall is not None: wall.append(now-last_wall)
        unique_ts.append(ts); last_wall = now
gaps = [unique_ts[i]-unique_ts[i-1] for i in range(1,len(unique_ts))]
big = sum(1 for g in gaps if g>1500)
wall_big = sum(1 for g in wall if g>1500)
print(f"frames={len(unique_ts)} ts_gaps>1.5s={big} wall_gaps>1.5s={wall_big}")
if big == 0 and len(unique_ts) > 300:
    print("OK: smooth ~10Hz on DO")
elif big > 0:
    print("WARN: still seeing gaps — check Tailscale direct path (not DERP-only)")
PY
