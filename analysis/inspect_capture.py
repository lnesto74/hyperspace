#!/usr/bin/env python3
"""
Inspect a JSONL MQTT capture for appended sessions / mixed recordings.

Usage:
  python3 analysis/inspect_capture.py /opt/hyperspace/replay/raw_tracks.jsonl
  python3 analysis/inspect_capture.py /opt/hyperspace/replay/grocery_capture_2026-05-23T15-52-44.jsonl
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def ts_iso(ms):
    if not ms:
        return "?"
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def inspect(path: Path):
    if not path.exists():
        print(f"File not found: {path}")
        sys.exit(1)

    size = path.stat().st_size
    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    print(f"File: {path}")
    print(f"Size: {size / (1024**3):.2f} GB ({size:,} bytes)")
    print(f"mtime: {mtime.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print()

    lines = 0
    skipped = 0
    first_ts = last_ts = None
    prev_ts = None
    backward = 0
    big_gaps = []
    junk_prefix = None
    devices = {}
    first_msg = last_msg = None

    with path.open(errors="replace") as f:
        for line in f:
            lines += 1
            raw = line.strip()
            if not raw:
                skipped += 1
                continue
            if raw.startswith("nohup:") or raw.startswith("mosquitto_sub"):
                skipped += 1
                junk_prefix = junk_prefix or raw[:120]
                continue
            if " " not in raw:
                skipped += 1
                continue
            try:
                topic, payload = raw.split(" ", 1)
                d = json.loads(payload)
            except Exception:
                skipped += 1
                continue

            ts = int(d.get("timestamp") or 0)
            dev = str(d.get("deviceId") or "?")
            devices[dev] = devices.get(dev, 0) + 1

            if first_ts is None:
                first_ts = ts
                first_msg = (topic, dev, ts)
            last_ts = ts
            last_msg = (topic, dev, ts)

            if prev_ts is not None:
                gap = (ts - prev_ts) / 1000
                if ts < prev_ts:
                    backward += 1
                elif gap > 300:
                    big_gaps.append((lines, gap, prev_ts, ts))
            prev_ts = ts

    print(f"Lines total: {lines:,}  (skipped/non-json: {skipped:,})")
    if junk_prefix:
        print(f"WARNING Junk at file start (manual shell redirect): {junk_prefix!r}")
        print("   This file was NOT created by the Replay panel recorder.")
    print()
    if first_msg:
        print(f"First message: {first_msg[0]}  device={first_msg[1]}  ts={ts_iso(first_msg[2])}")
    if last_msg:
        print(f"Last message:  {last_msg[0]}  device={last_msg[1]}  ts={ts_iso(last_msg[2])}")
    if first_ts and last_ts:
        span_h = (last_ts - first_ts) / 1000 / 3600
        print(f"Timestamp span: {span_h:.2f} hours")
    print(f"Timestamp backward jumps: {backward} (append/mixed sessions if >0)")
    print(f"Devices: {dict(sorted(devices.items(), key=lambda x: -x[1]))}")
    print()

    if big_gaps:
        print(f"Large gaps (>5 min) — {len(big_gaps)} found (likely appended sessions):")
        for i, (lineno, gap, a, b) in enumerate(big_gaps[:15]):
            print(f"  #{i+1} line ~{lineno:,}: gap {gap/60:.1f} min  {ts_iso(a)} → {ts_iso(b)}")
        if len(big_gaps) > 15:
            print(f"  ... and {len(big_gaps) - 15} more")
    else:
        print("No large gaps — looks like one continuous session.")

    print()
    print("Replay note: playback always starts at line 1 (oldest data first).")
    print("If this file has appended sessions, the beginning will look like the OLD capture.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 inspect_capture.py <capture.jsonl>")
        sys.exit(1)
    inspect(Path(sys.argv[1]))
