#!/usr/bin/env python3
"""
Convert a day of archived raw vendor frames from gzipped JSONL to Parquet.

The recorder writes gzipped JSONL because that is the only format you can
append to safely from a live MQTT pipe — a crash costs you the last few
frames, not the file. Parquet cannot do that: it writes whole row groups and
a footer, so a half-written file is unreadable. Hence two stages, which is
the usual landing-zone pattern: JSONL catches the stream, and this converts
yesterday's finished file once nothing is writing to it.

Two things are gained beyond size. Every analysis script in `analysis/`
already reads `messages.parquet` with these exact column names, so a
converted day is a drop-in for the whole existing toolchain — which the
JSONL is not, because `01_explore.py` expects `mosquitto_sub -v` output with
a topic prefix and the recorder stores bare payloads. And a columnar file
lets a query touch only the columns it needs instead of decompressing every
byte of every frame.

Axis convention, deliberately matching `analysis/01_explore.py`:

    vendor position.x -> x     floor plane
    vendor position.y -> z     floor plane
    vendor position.z -> y     height

This is a relabeling, not a transformation; no value is altered. It is
recorded in the Parquet key-value metadata alongside the source file's
SHA-256 so a converted day can always be tied back to the bytes it came
from, which is the point of keeping an archive at all.

Usage:
  raw-archive-to-parquet.py IN.jsonl.gz [-o OUT.parquet] [--verify] [--rm-source]
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

CONVERTER_VERSION = "1"
BATCH = 250_000

SCHEMA = pa.schema([
    # Arrival order within the source file. Keeping it means the original
    # line order is recoverable even if the file is later sorted or merged.
    ("seq", pa.int64()),
    ("ts", pa.int64()),
    # Dictionary-encoded: a busy day holds tens of thousands of frames per
    # identity, and three of these columns are near-constant.
    ("id", pa.dictionary(pa.int32(), pa.string())),
    ("device", pa.dictionary(pa.int32(), pa.string())),
    ("venue", pa.dictionary(pa.int32(), pa.string())),
    ("otype", pa.dictionary(pa.int32(), pa.string())),
    ("x", pa.float64()),
    ("z", pa.float64()),
    ("y", pa.float64()),
    ("vx", pa.float64()),
    ("vz", pa.float64()),
    ("vy", pa.float64()),
    ("bw", pa.float32()),
    ("bh", pa.float32()),
    ("bd", pa.float32()),
])


def parse_line(raw: str):
    """Accept both a bare JSON payload and `topic {json}` from mosquitto_sub -v."""
    raw = raw.strip()
    if not raw:
        return None
    if not raw.startswith("{"):
        # Topic-prefixed form; split once and hope the remainder is the payload.
        parts = raw.split(" ", 1)
        if len(parts) != 2:
            return None
        raw = parts[1]
    try:
        d = json.loads(raw)
    except Exception:
        return None
    ts = d.get("timestamp")
    if not isinstance(ts, (int, float)) or ts <= 0:
        return None
    pos = d.get("position") or {}
    vel = d.get("velocity") or {}
    bb = d.get("boundingBox") or {}
    return (
        int(ts),
        str(d.get("id", "")),
        str(d.get("deviceId", "")),
        str(d.get("venueId", "")),
        str(d.get("objectType", "")),
        float(pos.get("x", 0.0)),
        float(pos.get("y", 0.0)),   # -> z, floor plane
        float(pos.get("z", 0.0)),   # -> y, height
        float(vel.get("x", 0.0)),
        float(vel.get("y", 0.0)),
        float(vel.get("z", 0.0)),
        float(bb.get("width", 0.0)),
        float(bb.get("height", 0.0)),
        float(bb.get("depth", 0.0)),
    )


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def convert(src: Path, dst: Path) -> dict:
    cols: list[list] = [[] for _ in range(14)]
    writer = None
    rows = skipped = 0
    ts_min = ts_max = None
    ids: set[str] = set()

    def flush():
        nonlocal writer
        if not cols[0]:
            return
        table = pa.table({
            "seq": pa.array(cols[0], pa.int64()),
            "ts": pa.array(cols[1], pa.int64()),
            "id": pa.array(cols[2]).dictionary_encode(),
            "device": pa.array(cols[3]).dictionary_encode(),
            "venue": pa.array(cols[4]).dictionary_encode(),
            "otype": pa.array(cols[5]).dictionary_encode(),
            "x": pa.array(cols[6], pa.float64()),
            "z": pa.array(cols[7], pa.float64()),
            "y": pa.array(cols[8], pa.float64()),
            "vx": pa.array(cols[9], pa.float64()),
            "vz": pa.array(cols[10], pa.float64()),
            "vy": pa.array(cols[11], pa.float64()),
            "bw": pa.array(cols[12], pa.float32()),
            "bh": pa.array(cols[13], pa.float32()),
            "bd": pa.array(cols[14], pa.float32()),
        }, schema=SCHEMA)
        if writer is None:
            writer = pq.ParquetWriter(dst, SCHEMA, compression="zstd", compression_level=9)
        writer.write_table(table)
        for c in cols:
            c.clear()

    # 15 buffers: seq plus the 14 parsed fields.
    cols = [[] for _ in range(15)]

    with gzip.open(src, "rt", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            parsed = parse_line(line)
            if parsed is None:
                skipped += 1
                continue
            cols[0].append(rows)
            for i, v in enumerate(parsed):
                cols[i + 1].append(v)
            ts = parsed[0]
            ts_min = ts if ts_min is None else min(ts_min, ts)
            ts_max = ts if ts_max is None else max(ts_max, ts)
            ids.add(parsed[1])
            rows += 1
            if len(cols[0]) >= BATCH:
                flush()
    flush()

    if writer is None:
        raise SystemExit(f"{src.name}: no parseable frames ({skipped} lines skipped)")

    writer.add_key_value_metadata({
        "hyperspace.source_file": src.name,
        "hyperspace.source_sha256": sha256(src),
        "hyperspace.converter_version": CONVERTER_VERSION,
        "hyperspace.converted_at": datetime.now(timezone.utc).isoformat(),
        "hyperspace.rows": str(rows),
        "hyperspace.skipped_lines": str(skipped),
        "hyperspace.unique_ids": str(len(ids)),
        "hyperspace.axis_mapping": "x=position.x, z=position.y, y=position.z (relabel only)",
    })
    writer.close()

    return {
        "rows": rows,
        "skipped": skipped,
        "unique_ids": len(ids),
        "ts_min": ts_min,
        "ts_max": ts_max,
        "src_bytes": src.stat().st_size,
        "dst_bytes": dst.stat().st_size,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("-o", "--out")
    ap.add_argument("--verify", action="store_true",
                    help="re-read the Parquet and confirm the row count matches")
    ap.add_argument("--rm-source", action="store_true",
                    help="delete the JSONL after a successful verified conversion")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.exists():
        print(f"missing {src}", file=sys.stderr)
        return 1
    dst = Path(args.out) if args.out else src.with_suffix("").with_suffix(".parquet")

    # Write beside the target then rename, so a crash never leaves a partial
    # file that looks like a finished day.
    tmp = dst.with_suffix(".parquet.tmp")
    if tmp.exists():
        tmp.unlink()
    info = convert(src, tmp)

    if args.verify:
        pf = pq.ParquetFile(tmp)
        got = pf.metadata.num_rows
        if got != info["rows"]:
            print(f"FAILED: wrote {info['rows']} rows, file reports {got}", file=sys.stderr)
            tmp.unlink(missing_ok=True)
            return 1
    tmp.rename(dst)

    ratio = info["src_bytes"] / info["dst_bytes"] if info["dst_bytes"] else 0
    span_h = (info["ts_max"] - info["ts_min"]) / 3_600_000 if info["ts_min"] else 0
    print(f"{src.name} -> {dst.name}")
    print(f"  {info['rows']:,} frames, {info['unique_ids']:,} vendor ids, {span_h:.1f} h span")
    print(f"  {info['src_bytes'] / 1e6:.1f} MB gz -> {info['dst_bytes'] / 1e6:.1f} MB parquet ({ratio:.2f}x smaller)")
    if info["skipped"]:
        print(f"  {info['skipped']:,} unparseable lines skipped")

    if args.rm_source:
        if not args.verify:
            print("  refusing --rm-source without --verify", file=sys.stderr)
            return 1
        src.unlink()
        print(f"  removed {src.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
