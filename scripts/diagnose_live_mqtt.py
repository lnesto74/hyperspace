#!/usr/bin/env python3
"""
Diagnose live MQTT trajectory quality — teleports, velocity spikes, ID churn.

Usage:
  python3 scripts/diagnose_live_mqtt.py raw_tracks.jsonl
  python3 scripts/diagnose_live_mqtt.py raw_tracks.jsonl --max-lines 500000
  python3 scripts/diagnose_live_mqtt.py --mqtt mqtt://127.0.0.1:1883 --topic 'hyperspace/trajectories/#' --seconds 60
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path


JUMP_WARN_M = 4.0
JUMP_SEVERE_M = 10.0
SPEED_WARN_M_S = 3.5
SPEED_SEVERE_M_S = 8.0


def floor_pos(d: dict) -> tuple[float, float]:
    p = d.get("position") or {}
    x = float(p.get("x") or 0)
    y = float(p.get("y") or 0)
    # legacy perception frame: floor z = perc.y
    return x, y


def floor_vel(d: dict) -> tuple[float, float]:
    v = d.get("velocity") or {}
    vx = float(v.get("x") or 0)
    vy = float(v.get("y") or 0)
    return vx, vy


@dataclass
class TrackState:
    last_x: float = 0.0
    last_z: float = 0.0
    last_ts: int = 0
    samples: int = 0
    jumps_4m: int = 0
    jumps_10m: int = 0
    max_jump: float = 0.0
    max_speed: float = 0.0


@dataclass
class DiagStats:
    messages: int = 0
    skipped: int = 0
    unique_ids: set = field(default_factory=set)
    jumps_4m: int = 0
    jumps_10m: int = 0
    speed_spikes: int = 0
    off_bbox: int = 0
    max_occupancy: int = 0
    occupancy_hist: dict = field(default_factory=lambda: defaultdict(int))
    worst_jumps: list = field(default_factory=list)
    per_device: dict = field(default_factory=lambda: defaultdict(int))
    tracks: dict = field(default_factory=dict)

    def note_jump(self, track_key: str, dist: float, dt_ms: int, ts: int):
        if dist >= JUMP_WARN_M:
            self.jumps_4m += 1
        if dist >= JUMP_SEVERE_M:
            self.jumps_10m += 1
            entry = (dist, track_key, dt_ms, ts)
            if len(self.worst_jumps) < 20:
                self.worst_jumps.append(entry)
            else:
                self.worst_jumps.sort(key=lambda x: -x[0])
                if dist > self.worst_jumps[-1][0]:
                    self.worst_jumps[-1] = entry
                    self.worst_jumps.sort(key=lambda x: -x[0])


def ingest_payload(stats: DiagStats, payload: dict, bbox: tuple[float, float, float, float] | None):
    dev = str(payload.get("deviceId") or "?")
    tid = str(payload.get("id") or "?")
    track_key = f"{dev}:{tid}"
    ts = int(payload.get("timestamp") or 0)
    x, z = floor_pos(payload)
    vx, vz = floor_vel(payload)
    speed = math.hypot(vx, vz)

    stats.messages += 1
    stats.unique_ids.add(track_key)
    stats.per_device[dev] += 1

    if bbox:
        xmin, xmax, zmin, zmax = bbox
        if x < xmin or x > xmax or z < zmin or z > zmax:
            stats.off_bbox += 1

    if speed > SPEED_WARN_M_S:
        stats.speed_spikes += 1

    st = stats.tracks.get(track_key)
    if st is None:
        stats.tracks[track_key] = TrackState(last_x=x, last_z=z, last_ts=ts, samples=1)
        return

    if ts > st.last_ts:
        dt = max(ts - st.last_ts, 1) / 1000.0
        dist = math.hypot(x - st.last_x, z - st.last_z)
        implied = dist / dt
        st.max_jump = max(st.max_jump, dist)
        st.max_speed = max(st.max_speed, implied, speed)
        if dist >= JUMP_WARN_M:
            st.jumps_4m += 1
            stats.note_jump(track_key, dist, ts - st.last_ts, ts)
        if dist >= JUMP_SEVERE_M:
            st.jumps_10m += 1
        st.last_x, st.last_z, st.last_ts = x, z, ts
        st.samples += 1


def parse_jsonl_line(line: str) -> dict | None:
    raw = line.strip()
    if not raw or raw.startswith("nohup:") or raw.startswith("mosquitto_sub"):
        return None
    if " " not in raw:
        return None
    _topic, payload = raw.split(" ", 1)
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return None


def scan_file(path: Path, max_lines: int, bbox: tuple | None, bucket_ms: int = 100):
    stats = DiagStats()
    bucket_counts: dict[int, set[str]] = defaultdict(set)
    t0 = time.time()

    with path.open(errors="replace") as f:
        for i, line in enumerate(f, 1):
            if max_lines and i > max_lines:
                break
            d = parse_jsonl_line(line)
            if not d:
                stats.skipped += 1
                continue
            ingest_payload(stats, d, bbox)
            ts = int(d.get("timestamp") or 0)
            dev = str(d.get("deviceId") or "?")
            tid = str(d.get("id") or "?")
            bucket_counts[ts // bucket_ms].add(f"{dev}:{tid}")

            if i % 250_000 == 0:
                print(f"  ... {i:,} lines  msgs={stats.messages:,}  ids={len(stats.unique_ids):,}", flush=True)

    for _b, keys in bucket_counts.items():
        n = len(keys)
        stats.max_occupancy = max(stats.max_occupancy, n)
        if n >= 100:
            stats.occupancy_hist[n // 10 * 10] += 1

    elapsed = time.time() - t0
    print_report(stats, path=str(path), elapsed=elapsed, lines=i if 'i' in dir() else max_lines)


def print_report(stats: DiagStats, path: str = "", elapsed: float = 0, lines: int = 0):
    print()
    print("=" * 60)
    print("LIVE MQTT TRAJECTORY DIAGNOSTIC")
    if path:
        print(f"Source: {path}")
    if lines:
        print(f"Lines scanned: {lines:,}  ({elapsed:.1f}s)")
    print(f"Messages parsed: {stats.messages:,}  skipped: {stats.skipped:,}")
    print(f"Unique track keys: {len(stats.unique_ids):,}")
    print(f"Devices: {dict(sorted(stats.per_device.items(), key=lambda x: -x[1]))}")
    print()
    print("--- Frame occupancy (100ms buckets) ---")
    print(f"  Peak tracks/frame: {stats.max_occupancy}")
    if stats.max_occupancy > 150:
        print(f"  ⚠ ABOVE CLIENT CAP (150) — interp/render will drop tracks cyclically!")
    hot = sorted(stats.occupancy_hist.items(), reverse=True)[:8]
    if hot:
        print("  High-occupancy buckets (rounded to 10):")
        for occ, count in hot:
            print(f"    ~{occ} tracks: {count} buckets")
    print()
    print("--- Motion anomalies ---")
    print(f"  Position jumps ≥{JUMP_WARN_M}m: {stats.jumps_4m:,}  (spoke trail source)")
    print(f"  Position jumps ≥{JUMP_SEVERE_M}m: {stats.jumps_10m:,}  (off-scene teleports)")
    print(f"  Velocity ≥{SPEED_WARN_M_S} m/s: {stats.speed_spikes:,}")
    if stats.off_bbox:
        print(f"  Positions outside bbox: {stats.off_bbox:,}")
    print()
    if stats.worst_jumps:
        print("  Worst teleports (distance, trackKey, dt_ms, ts):")
        for dist, key, dt_ms, ts in sorted(stats.worst_jumps, reverse=True)[:10]:
            print(f"    {dist:7.1f}m  {key}  dt={dt_ms}ms  ts={ts}")
    print()
    repeat_offenders = sorted(
        ((k, v.jumps_4m, v.jumps_10m, v.max_jump, v.samples) for k, v in stats.tracks.items() if v.jumps_4m),
        key=lambda x: -x[1],
    )[:10]
    if repeat_offenders:
        print("  Repeat teleport IDs (trackKey, jumps≥4m, jumps≥10m, max_jump, samples):")
        for row in repeat_offenders:
            print(f"    {row[0]}  {row[1]}  {row[2]}  max={row[3]:.1f}m  n={row[4]}")
    print()
    churn = len(stats.unique_ids) / max(stats.messages, 1)
    print(f"  ID churn ratio (unique/messages): {churn:.4f}")
    if churn > 0.05:
        print("  ⚠ High ID churn — ghost tracks + cap-swapping likely in UI")
    print("=" * 60)


def run_mqtt(broker: str, topic: str, seconds: int, bbox: tuple | None):
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        print("Install paho-mqtt: pip install paho-mqtt", file=sys.stderr)
        sys.exit(1)

    stats = DiagStats()
    bucket_counts: dict[int, set[str]] = defaultdict(set)
    done = time.time() + seconds

    def on_message(_client, _userdata, msg):
        try:
            d = json.loads(msg.payload.decode())
        except Exception:
            stats.skipped += 1
            return
        ingest_payload(stats, d, bbox)
        ts = int(d.get("timestamp") or 0)
        dev = str(d.get("deviceId") or "?")
        tid = str(d.get("id") or "?")
        bucket_counts[ts // 100].add(f"{dev}:{tid}")

    client = mqtt.Client()
    client.on_message = on_message
    print(f"Connecting {broker}  topic={topic}  duration={seconds}s ...")
    client.connect(broker.replace("mqtt://", "").split(":")[0],
                  int(broker.split(":")[-1]) if ":" in broker.split("//")[-1] else 1883)
    client.subscribe(topic)
    client.loop_start()
    try:
        while time.time() < done:
            time.sleep(1)
            print(f"  live: msgs={stats.messages:,}  ids={len(stats.unique_ids):,}  jumps≥4m={stats.jumps_4m}", flush=True)
    finally:
        client.loop_stop()
        client.disconnect()

    for _b, keys in bucket_counts.items():
        n = len(keys)
        stats.max_occupancy = max(stats.max_occupancy, n)
    print_report(stats, path=f"{broker} {topic}", elapsed=seconds)


def main():
    ap = argparse.ArgumentParser(description="Diagnose MQTT trajectory teleports and churn")
    ap.add_argument("file", nargs="?", help="JSONL capture (topic payload per line)")
    ap.add_argument("--max-lines", type=int, default=800_000, help="Max lines from file (0=all)")
    ap.add_argument("--mqtt", help="Live broker URL e.g. mqtt://127.0.0.1:1883")
    ap.add_argument("--topic", default="hyperspace/trajectories/#")
    ap.add_argument("--seconds", type=int, default=120)
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("XMIN", "XMAX", "ZMIN", "ZMAX"),
                      help="Venue floor bounds for off-scene count")
    args = ap.parse_args()

    bbox = tuple(args.bbox) if args.bbox else None

    if args.mqtt:
        run_mqtt(args.mqtt, args.topic, args.seconds, bbox)
    elif args.file:
        p = Path(args.file)
        if not p.exists():
            print(f"Not found: {p}", file=sys.stderr)
            sys.exit(1)
        scan_file(p, args.max_lines, bbox)
    else:
        ap.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
