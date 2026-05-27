#!/usr/bin/env bash
# Systematic live pipeline diagnostics on DigitalOcean / prod host.
#
# Usage:
#   bash scripts/diagnose_live_pipeline.sh <venue-id> [edge-tailscale-ip]
#
# Example:
#   bash scripts/diagnose_live_pipeline.sh 55fdd53b-3298-4355-97c0-b4e789b11d06 100.x.x.x
set -euo pipefail

VENUE_ID="${1:-}"
EDGE_IP="${2:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3001}"
MQTT_BROKER="${MQTT_BROKER:-mqtt://127.0.0.1:1883}"
PROBE_SEC="${PROBE_SEC:-12}"

if [[ -z "$VENUE_ID" ]]; then
  echo "Usage: $0 <venue-id> [edge-tailscale-ip]" >&2
  exit 1
fi

hr() { printf '\n%s\n' "────────────────────────────────────────────────────────────"; }
section() { hr; echo "▶ $1"; hr; }

section "Host / Docker"
date -u +"%Y-%m-%dT%H:%M:%SZ"
uptime || true
free -h 2>/dev/null || vm_stat 2>/dev/null | head -5 || true

if command -v docker >/dev/null 2>&1; then
  docker compose -f "$COMPOSE_FILE" ps 2>/dev/null || docker-compose -f "$COMPOSE_FILE" ps 2>/dev/null || true
  echo ""
  docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}' 2>/dev/null | head -10 || true
fi

section "Tailscale (DO ↔ edge)"
if command -v tailscale >/dev/null 2>&1; then
  tailscale status 2>/dev/null | head -20 || true
  if [[ -n "$EDGE_IP" ]]; then
    echo ""
    echo "Ping edge $EDGE_IP:"
    tailscale ping -c 5 "$EDGE_IP" 2>/dev/null || ping -c 5 "$EDGE_IP" 2>/dev/null || true
  fi
else
  echo "tailscale CLI not installed on this host"
fi

section "MQTT broker tap (${PROBE_SEC}s)"
MQTT_HOSTPORT="${MQTT_BROKER#mqtt://}"
MQTT_HOST="${MQTT_HOSTPORT%%:*}"
MQTT_PORT="${MQTT_HOSTPORT##*:}"
[[ "$MQTT_PORT" == "$MQTT_HOST" ]] && MQTT_PORT=1883

if command -v mosquitto_sub >/dev/null 2>&1; then
  TOPIC='hyperspace/trajectories/#'
  echo "Subscribing ${MQTT_HOST}:${MQTT_PORT} topic=$TOPIC for ${PROBE_SEC}s ..."
  COUNT=$(timeout "$((PROBE_SEC + 2))" mosquitto_sub -h "$MQTT_HOST" -p "$MQTT_PORT" -t "$TOPIC" -v 2>/dev/null | wc -l | tr -d ' ')
  RATE=$(python3 - <<PY
sec = $PROBE_SEC
count = int("$COUNT" or 0)
print(f"{count/sec:.2f}" if sec else "0")
PY
)
  echo "Lines received: $COUNT  (~${RATE} msg/s)"
  if [[ "${COUNT:-0}" -eq 0 ]]; then
    echo "⚠ NO MQTT on DO broker — edge bridge down, wrong topic, or perception stopped."
  fi
elif docker compose -f "$COMPOSE_FILE" ps mosquitto >/dev/null 2>&1; then
  echo "mosquitto_sub not on host — trying inside mosquitto container ..."
  COUNT=$(docker compose -f "$COMPOSE_FILE" exec -T mosquitto \
    timeout "$((PROBE_SEC + 2))" mosquitto_sub -h localhost -t 'hyperspace/trajectories/#' -v 2>/dev/null | wc -l | tr -d ' ')
  echo "Lines received: $COUNT"
else
  echo "Skip MQTT tap (no mosquitto_sub)"
fi

section "Backend tracking status"
curl -sf "${BACKEND_URL}/api/tracking/venue/${VENUE_ID}/status" | python3 -m json.tool 2>/dev/null || \
  echo "⚠ status API failed"

section "Backend pipeline metrics (10s window)"
curl -sf "${BACKEND_URL}/api/tracking/venue/${VENUE_ID}/pipeline" | python3 -m json.tool 2>/dev/null || \
  echo "⚠ pipeline API failed — deploy backend with PipelineMetrics"

section "Backend logs (MQTT / emit / DIAG)"
if command -v docker >/dev/null 2>&1; then
  docker compose -f "$COMPOSE_FILE" logs backend --tail 80 2>/dev/null | grep -E '\[MQTT\]|\[DIAG\]|Pipeline|emit tracks' | tail -30 || true
fi

if [[ -n "$EDGE_IP" ]]; then
  section "Edge probe (via Tailscale :8080)"
  EDGE_URL="http://${EDGE_IP}:8080"
  # Probe blocks for durationMs — allow extra time over Tailscale DERP (~160ms RTT).
  if curl -sf --max-time 25 "${EDGE_URL}/api/edge/mqtt/record/probe?durationMs=8000&detailed=1" | python3 -m json.tool 2>/dev/null; then
    true
  elif curl -sf --max-time 25 "${EDGE_URL}/api/edge/mqtt/record/probe?durationMs=5000" | python3 -m json.tool 2>/dev/null; then
    echo "(detailed probe unavailable — edge may need git pull + restart)"
  else
    echo "⚠ edge probe failed at $EDGE_URL (deploy latest edge-server or check :8080)"
    curl -sS --max-time 5 -o /dev/null -w "  HTTP status: %{http_code}\n" "${EDGE_URL}/api/status" 2>/dev/null || true
  fi
  echo ""
  curl -sf "${EDGE_URL}/api/mqtt-bridge" | python3 -m json.tool 2>/dev/null || true
fi

section "Interpretation"
cat <<'EOF'
Compare rates:
  • Edge probe msg/s  vs  DO mosquitto_sub msg/s
      Large drop → mosquitto bridge / Tailscale / network (NOT Chrome)
  • DO mqtt tap  vs  backend pipeline mqtt.msgPerSec
      Mismatch → backend subscriber or JSON parse/filter drops
  • backend emit ~10/s (100ms cadence) with emit gap p95 >250ms
      → Node event loop / CPU saturation in docker
  • All DO layers healthy but UI choppy
      → Browser: localStorage.setItem('hyperspace-diag','1'), watch [DIAG] tracks GAP

Replay smooth + live choppy ⇒ bottleneck is BEFORE backend socket emit (bridge/network),
not Three.js rendering. Edge buffer helps when DO mqtt gaps are bursty but edge is steady.

Full measurement:
  python3 scripts/measure_mqtt_pipeline.py --venue VENUE_ID --edge http://EDGE:8080 --seconds 30
EOF
