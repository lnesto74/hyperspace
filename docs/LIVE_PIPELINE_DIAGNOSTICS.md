# Live Pipeline Diagnostics

Systematically locate bottlenecks in the live perception → MQTT → DO → browser path.

**Key insight:** raw JSONL **replay is smooth** because it skips the edge mosquitto bridge and Tailscale. If replay is fine but live stutters, the problem is almost never Chrome/Three.js — it is upstream (bridge, network jitter, or backend overload).

## Pipeline hops

```text
Perception (fast3dis/objects)
    → Edge Mosquitto (local)
    → PerceptionAdapter → hyperspace/trajectories/{deviceId}
    → Mosquitto bridge over Tailscale
    → DO Mosquitto :1883
    → Backend MqttTrajectoryService
    → TrackAggregator (100ms batches)
    → Socket.IO /tracking
    → Chrome canvas
```

## 1. Quick check on DO (5 min)

```bash
cd /opt/hyperspace
bash scripts/diagnose_live_pipeline.sh <venue-id> <edge-tailscale-ip>
```

Reads: docker CPU/RAM, Tailscale ping, MQTT message rate on DO broker, backend `/api/tracking/venue/.../pipeline`, recent logs.

## 2. Full comparison (edge vs DO)

```bash
python3 scripts/measure_mqtt_pipeline.py \
  --venue 55fdd53b-3298-4355-97c0-b4e789b11d06 \
  --backend http://127.0.0.1:3001 \
  --mqtt mqtt://127.0.0.1:1883 \
  --edge http://100.x.x.x:8080 \
  --seconds 45
```

| Compare | If… | Likely cause |
|---------|-----|--------------|
| Edge probe msg/s vs DO mosquitto_sub | Edge higher by >10% | Bridge / Tailscale / packet loss |
| DO mqtt tap vs backend pipeline API | Mismatch | Backend parse/filter/subscriber |
| Backend emit batches ~10/s, gap p95 >250ms | Irregular | Node event loop / docker CPU |
| All DO healthy, UI still bad | Chrome socket gaps | Browser/network to app.hyspace.app |

## 3. Edge-side probe

```bash
curl -s 'http://EDGE:8080/api/edge/mqtt/record/probe?durationMs=10000&detailed=1' | jq .
```

`interArrivalMs.p95` on edge vs DO tells you if jitter is introduced in transit.

## 4. Bridge latency stamp (optional)

On edge, enable before restarting edge backend:

```bash
export PIPELINE_DIAG=1
```

Adds `publishedAt` to each trajectory message. DO backend reports `bridgeLatencyMs` in `/api/tracking/venue/:id/pipeline`.

On DO backend, periodic logs:

```bash
MQTT_PIPELINE_DIAG=1   # in docker-compose.prod.yml backend env
```

## 5. Browser (last hop only)

In Chrome devtools console on app.hyspace.app:

```javascript
localStorage.setItem('hyperspace-diag', '1')
// reload, watch for [DIAG] tracks GAP ... ms since last emission
```

Only run this **after** DO layers look healthy. Large socket gaps with smooth DO mqtt ⇒ CDN/proxy/WebSocket path to browser.

## 6. When to add an edge buffer

Add a JSONL/spool buffer on the slave **only if**:

- Edge probe shows steady msg/s and low gap p95, **but**
- DO mqtt tap shows drops or high gap p95, **and**
- Tailscale ping is acceptable

The buffer decouples perception from bridge stalls; it does not fix backend CPU or frontend issues.

## API reference

| Endpoint | Purpose |
|----------|---------|
| `GET /api/tracking/venue/:id/status` | Connection, frame occupancy, last track ts |
| `GET /api/tracking/venue/:id/pipeline` | 10s rolling mqtt/emit metrics + diagnosis hints |
| `GET http://EDGE:8080/api/edge/mqtt/record/probe?detailed=1` | Edge local broker rate + gaps |
