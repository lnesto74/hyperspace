#!/usr/bin/env python3
"""
Measure live MQTT pipeline health across hops:

  edge (optional) → MQTT broker → DO backend → socket emit API

Replay smooth + live choppy usually means Tailscale/bridge/network, not Chrome.

Usage (on DO server):
  python3 scripts/measure_mqtt_pipeline.py --venue VENUE_ID --seconds 30

With edge comparison (from DO, edge API reachable via Tailscale):
  python3 scripts/measure_mqtt_pipeline.py \\
    --venue 55fdd53b-... \\
    --backend http://127.0.0.1:3001 \\
    --mqtt mqtt://127.0.0.1:1883 \\
    --edge http://100.x.x.x:8080 \\
    --seconds 45

Browser check: localStorage.setItem('hyperspace-diag','1') then watch [DIAG] tracks GAP lines.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    idx = min(len(s) - 1, int(len(s) * p / 100))
    return s[idx]


@dataclass
class MqttTapStats:
    messages: int = 0
    gaps_ms: list[float] = field(default_factory=list)
    bridge_ms: list[float] = field(default_factory=list)
    ingest_ms: list[float] = field(default_factory=list)
    last_at: float | None = None
    devices: set[str] = field(default_factory=set)

    def on_message(self, payload: dict, recv_at_ms: float):
        self.messages += 1
        if self.last_at is not None:
            self.gaps_ms.append(recv_at_ms - self.last_at)
        self.last_at = recv_at_ms

        dev = str(payload.get("deviceId") or "?")
        self.devices.add(dev)

        ts = payload.get("timestamp")
        if isinstance(ts, (int, float)) and ts > 0:
            ingest = recv_at_ms - float(ts)
            if -5000 <= ingest <= 60000:
                self.ingest_ms.append(ingest)

        pub = payload.get("publishedAt")
        if isinstance(pub, (int, float)) and pub > 0:
            bridge = recv_at_ms - float(pub)
            if 0 <= bridge <= 60000:
                self.bridge_ms.append(bridge)


def fetch_json(url: str, timeout: float = 5.0) -> dict | None:
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"  WARN fetch {url}: {e}", file=sys.stderr)
        return None


def summarize_gaps(gaps: list[float]) -> dict:
    if not gaps:
        return {"samples": 0, "p50": None, "p95": None, "max": None}
    return {
        "samples": len(gaps),
        "p50": round(percentile(gaps, 50) or 0, 1),
        "p95": round(percentile(gaps, 95) or 0, 1),
        "max": round(max(gaps), 1),
    }


def run_mqtt_tap(broker: str, topic: str, seconds: int, stats: MqttTapStats):
    try:
        import paho.mqtt.client as mqtt
        use_paho = True
    except ImportError:
        use_paho = False

    if use_paho:
        host_port = broker.replace("mqtt://", "").replace("mqtts://", "")
        if ":" in host_port:
            host, port_s = host_port.rsplit(":", 1)
            port = int(port_s)
        else:
            host, port = host_port, 1883

        def on_message(_c, _u, msg):
            try:
                payload = json.loads(msg.payload.decode())
            except Exception:
                return
            stats.on_message(payload, time.time() * 1000)

        client = mqtt.Client()
        client.on_message = on_message
        client.connect(host, port, keepalive=30)
        client.subscribe(topic)
        client.loop_start()
        try:
            time.sleep(seconds)
        finally:
            client.loop_stop()
            client.disconnect()
        return

    # Fallback: mosquitto_sub (no extra pip install on DO)
    import subprocess
    host_port = broker.replace("mqtt://", "").replace("mqtts://", "")
    if ":" in host_port:
        host, port_s = host_port.rsplit(":", 1)
        port = port_s
    else:
        host, port = host_port, "1883"
    print(f"  (paho-mqtt missing — using mosquitto_sub on {host}:{port})", flush=True)
    proc = subprocess.Popen(
        ["mosquitto_sub", "-h", host, "-p", str(port), "-t", topic],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    end = time.time() + seconds
    try:
        assert proc.stdout is not None
        while time.time() < end:
            line = proc.stdout.readline()
            if not line:
                time.sleep(0.01)
                continue
            # mosquitto_sub -v format: "topic {json}"
            parts = line.strip().split(" ", 1)
            if len(parts) < 2:
                continue
            try:
                payload = json.loads(parts[1])
            except Exception:
                continue
            stats.on_message(payload, time.time() * 1000)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()


def classify(edge_rate: float | None, mqtt_rate: float, backend: dict | None, tap: MqttTapStats) -> list[str]:
    findings: list[str] = []

    if edge_rate is not None and mqtt_rate > 0 and edge_rate > mqtt_rate * 1.1:
        drop = 100 * (1 - mqtt_rate / edge_rate)
        findings.append(
            f"EDGE→DO LOSS: edge ~{edge_rate:.1f} msg/s vs DO tap ~{mqtt_rate:.1f} msg/s "
            f"(~{drop:.0f}% fewer on DO) — suspect mosquitto bridge, Tailscale, or broker drop."
        )
    elif edge_rate is not None and mqtt_rate == 0 and edge_rate > 0:
        findings.append("EDGE TRANSMITTING but DO MQTT tap sees 0 — bridge down or wrong topic/broker.")

    gap_p95 = percentile(tap.gaps_ms, 95)
    if gap_p95 and gap_p95 > 400:
        findings.append(
            f"DO MQTT JITTER: inter-arrival p95={gap_p95:.0f}ms — bursty over Tailscale; edge buffer may help."
        )

    bridge_p95 = percentile(tap.bridge_ms, 95)
    if bridge_p95 and bridge_p95 > 300:
        findings.append(
            f"BRIDGE LATENCY: publishedAt→DO p95={bridge_p95:.0f}ms — set PIPELINE_DIAG=1 on edge for accurate stamps."
        )

    if backend:
        pipe = backend.get("pipeline") or {}
        cur = pipe.get("current") or {}
        emit = cur.get("socketEmit") or {}
        emit_gap = (emit.get("interEmitMs") or {}).get("p95")
        if emit_gap and emit_gap > 250:
            findings.append(
                f"BACKEND EMIT: socket batch gap p95={emit_gap}ms — event loop / CPU (check docker stats)."
            )
        mqtt_api = cur.get("mqtt") or {}
        api_rate = mqtt_api.get("msgPerSec")
        if api_rate and mqtt_rate and abs(api_rate - mqtt_rate) > max(5, mqtt_rate * 0.3):
            findings.append(
                f"BACKEND PARSE: tap {mqtt_rate:.1f}/s vs backend counter {api_rate:.1f}/s — subscriber mismatch or parse drops."
            )

    if not findings:
        findings.append(
            "Layers look aligned in this window. If UI still stutters: enable hyperspace-diag in Chrome "
            "and compare socket gaps. Smooth replay ⇒ not a Three.js cap issue."
        )
    return findings


def main():
    ap = argparse.ArgumentParser(description="End-to-end live MQTT pipeline measurement")
    ap.add_argument("--venue", required=True, help="Venue UUID")
    ap.add_argument("--seconds", type=int, default=30)
    ap.add_argument("--backend", default="http://127.0.0.1:3001")
    ap.add_argument("--mqtt", default="mqtt://127.0.0.1:1883")
    ap.add_argument("--topic", default="hyperspace/trajectories/#")
    ap.add_argument("--edge", help="Edge server base URL e.g. http://100.x.x.x:8080")
    ap.add_argument("--probe-ms", type=int, default=8000, help="Edge probe duration")
    args = ap.parse_args()

    print("=" * 70)
    print("HYPERSPACE LIVE PIPELINE MEASUREMENT")
    print(f"venue={args.venue}  duration={args.seconds}s")
    print("=" * 70)

    edge_rate = None
    edge_probe = None
    if args.edge:
        print(f"\n[1/4] Edge probe ({args.probe_ms}ms) via {args.edge} ...")
        edge_probe = fetch_json(
            f"{args.edge.rstrip('/')}/api/edge/mqtt/record/probe?durationMs={args.probe_ms}&detailed=1",
            timeout=max(30.0, args.probe_ms / 1000 + 15),
        )
        if edge_probe and edge_probe.get("ok"):
            p = edge_probe.get("probe") or {}
            edge_rate = p.get("messagesPerSecond")
            print(f"  edge msg/s: {edge_rate}  count={p.get('messageCount')}  gap_p95={((p.get('interArrivalMs') or {}).get('p95'))}")
        else:
            print("  edge probe failed — skip edge comparison")

    print(f"\n[2/4] DO MQTT tap ({args.mqtt}) ...")
    tap = MqttTapStats()
    run_mqtt_tap(args.mqtt, args.topic, args.seconds, tap)
    mqtt_rate = tap.messages / max(args.seconds, 1)
    print(f"  tap msg/s: {mqtt_rate:.1f}  messages={tap.messages}  devices={len(tap.devices)}")
    print(f"  inter-arrival: {summarize_gaps(tap.gaps_ms)}")
    if tap.bridge_ms:
        print(f"  bridge (publishedAt): {summarize_gaps(tap.bridge_ms)}")
    if tap.ingest_ms:
        print(f"  ingest (payload ts):  {summarize_gaps(tap.ingest_ms)}")

    print(f"\n[3/4] Backend pipeline API ...")
    pipeline = fetch_json(f"{args.backend.rstrip('/')}/api/tracking/venue/{args.venue}/pipeline")
    status = fetch_json(f"{args.backend.rstrip('/')}/api/tracking/venue/{args.venue}/status")
    if pipeline and pipeline.get("success"):
        cur = (pipeline.get("pipeline") or {}).get("current") or {}
        mqtt_s = cur.get("mqtt") or {}
        emit_s = cur.get("socketEmit") or {}
        print(f"  backend mqtt: {mqtt_s.get('msgPerSec')} msg/s  gap_p95={(mqtt_s.get('interArrivalMs') or {}).get('p95')}")
        print(f"  backend emit: {emit_s.get('batchesPerSec')}/s  gap_p95={(emit_s.get('interEmitMs') or {}).get('p95')}")
        for hint in (pipeline.get("diagnosis") or {}).get("hints") or []:
            print(f"  hint: {hint}")
    else:
        print("  pipeline API unavailable (deploy latest backend?)")

    if status and status.get("success"):
        print(f"  connected={status.get('connected')}  frameOcc={status.get('frameOccupancy')}  aggTracks={status.get('aggregatorActiveTracks')}")

    print(f"\n[4/4] Diagnosis")
    print("-" * 70)
    for line in classify(edge_rate, mqtt_rate, pipeline, tap):
        print(f"  • {line}")
    print("-" * 70)
    print("\nNext steps:")
    print("  • Edge:  curl 'http://EDGE:8080/api/edge/mqtt/record/probe?durationMs=10000&detailed=1'")
    print("  • DO:    bash scripts/diagnose_live_pipeline.sh VENUE_ID")
    print("  • Chrome: localStorage.setItem('hyperspace-diag','1') — watch [DIAG] tracks GAP")
    print("  • Edge stamp: PIPELINE_DIAG=1 on perception adapter → publishedAt in payload")
    print("=" * 70)


if __name__ == "__main__":
    main()
