#!/usr/bin/env python3
"""
Split or filter a concatenated MQTT JSONL capture (streaming — safe for multi-GB files).

Examples:
  # Inspect only (no writes)
  python3 analysis/split_capture.py inspect /opt/hyperspace/replay/raw_tracks.jsonl

  # Keep from May 23 ~23:01 (timestamp cut)
  python3 analysis/split_capture.py filter \
    --input /opt/hyperspace/replay/raw_tracks.jsonl \
    --output /opt/hyperspace/replay/raw_tracks_may23_2301_onward.jsonl \
    --after 2026-05-23T23:01:00Z

  # Keep from ~9.9% byte position (matches Replay panel scrub slider)
  python3 analysis/split_capture.py filter \
    --input /opt/hyperspace/replay/raw_tracks.jsonl \
    --output /opt/hyperspace/replay/raw_tracks_from_9p9pct.jsonl \
    --after-progress 9.9

  # Split into before/after a cutoff date
  python3 analysis/split_capture.py split \
    --input /opt/hyperspace/replay/raw_tracks.jsonl \
    --at 2026-05-24T00:00:00Z \
    --before /opt/hyperspace/replay/raw_tracks_before_may24.jsonl \
    --after /opt/hyperspace/replay/raw_tracks_may24_only.jsonl

  # Auto-split on large time gaps (>30 min = new appended session)
  python3 analysis/split_capture.py split-gaps \
    --input /opt/hyperspace/replay/raw_tracks.jsonl \
    --out-dir /opt/hyperspace/replay/split_sessions \
    --gap-minutes 30
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def parse_when(s: str) -> int:
    """Parse ISO-ish datetime → epoch ms."""
    s = s.strip().replace("Z", "+00:00")
    if len(s) == 10:  # YYYY-MM-DD
        s += "T00:00:00+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def ts_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def iter_messages(path: Path):
    """Yield (line_no, raw_line, topic, payload_dict) for valid MQTT lines."""
    with path.open(errors="replace") as f:
        for line_no, line in enumerate(f, 1):
            raw = line.rstrip("\n")
            if not raw:
                continue
            if raw.startswith("nohup:") or raw.startswith("mosquitto_sub"):
                continue
            if " " not in raw:
                continue
            try:
                topic, payload = raw.split(" ", 1)
                d = json.loads(payload)
            except Exception:
                continue
            ts = int(d.get("timestamp") or 0)
            if ts <= 0:
                continue
            yield line_no, raw, topic, d, ts


def cmd_inspect(path: Path) -> int:
    lines = kept = 0
    first_ts = last_ts = None
    prev_ts = None
    gaps = 0
    for line_no, raw, topic, d, ts in iter_messages(path):
        lines += 1
        if first_ts is None:
            first_ts = ts
        if prev_ts is not None and ts < prev_ts:
            gaps += 1
        prev_ts = ts
        last_ts = ts
        kept += 1

    size = path.stat().st_size
    print(f"File: {path}")
    print(f"Size: {size / (1024**3):.2f} GB")
    print(f"Valid messages: {kept:,}")
    if first_ts:
        print(f"First: {ts_iso(first_ts)}")
    if last_ts:
        print(f"Last:  {ts_iso(last_ts)}")
    if first_ts and last_ts:
        print(f"Span:  {(last_ts - first_ts) / 1000 / 3600:.1f} hours")
    print(f"Timestamp backward jumps: {gaps}")
    return 0


def write_line(out, raw: str) -> int:
    out.write(raw + "\n")
    return len(raw) + 1


def byte_offset_for_progress(path: Path, progress_pct: float) -> int:
    """Match ReplayService byte seek — skip to progress % of file, next full line."""
    total = path.stat().st_size
    if total <= 0 or progress_pct <= 0:
        return 0
    if progress_pct >= 100:
        return total
    offset = min(total - 1, int(total * (progress_pct / 100.0)))
    with path.open("rb") as f:
        f.seek(offset)
        chunk = f.read(min(16384, total - offset))
        nl = chunk.find(b"\n")
        if nl >= 0:
            return offset + nl + 1
        back_len = min(16384, offset)
        f.seek(offset - back_len)
        back = f.read(back_len)
        last_nl = back.rfind(b"\n")
        if last_nl >= 0:
            return offset - back_len + last_nl + 1
    return offset


def iter_messages_from(path: Path, start_byte: int = 0):
    """Like iter_messages but optionally skip leading bytes (for progress trim)."""
    with path.open(errors="replace") as f:
        if start_byte > 0:
            f.seek(start_byte)
        for line_no, line in enumerate(f, 1):
            raw = line.rstrip("\n")
            if not raw:
                continue
            if raw.startswith("nohup:") or raw.startswith("mosquitto_sub"):
                continue
            if " " not in raw:
                continue
            try:
                topic, payload = raw.split(" ", 1)
                d = json.loads(payload)
            except Exception:
                continue
            ts = int(d.get("timestamp") or 0)
            if ts <= 0:
                continue
            yield line_no, raw, topic, d, ts


def cmd_filter(args) -> int:
    src = Path(args.input)
    dst = Path(args.output)
    after_ms = parse_when(args.after) if args.after else None
    before_ms = parse_when(args.before) if args.before else None
    start_byte = 0
    if args.after_progress is not None:
        start_byte = byte_offset_for_progress(src, float(args.after_progress))
        total = src.stat().st_size
        print(f"Byte cut at {args.after_progress}% → offset {start_byte:,} / {total:,} ({100*start_byte/total:.1f}%)")

    if not after_ms and not before_ms and start_byte == 0:
        print("Specify --after, --before, and/or --after-progress", file=sys.stderr)
        return 1

    dst.parent.mkdir(parents=True, exist_ok=True)
    written = skipped = bytes_out = 0
    first_kept = last_kept = None

    print(f"Reading:  {src}")
    print(f"Writing:  {dst}")
    if after_ms:
        print(f"Keep after:  {ts_iso(after_ms)}")
    if before_ms:
        print(f"Keep before: {ts_iso(before_ms)}")

    with dst.open("w") as out:
        for line_no, raw, topic, d, ts in iter_messages_from(src, start_byte):
            if after_ms is not None and ts < after_ms:
                skipped += 1
                continue
            if before_ms is not None and ts >= before_ms:
                skipped += 1
                continue
            bytes_out += write_line(out, raw)
            written += 1
            if first_kept is None:
                first_kept = ts
            last_kept = ts
            if written % 500_000 == 0:
                print(f"  … {written:,} messages written ({bytes_out / (1024**3):.2f} GB)")

    print(f"Done. Kept {written:,} messages, skipped {skipped:,}.")
    if first_kept:
        print(f"Output range: {ts_iso(first_kept)} → {ts_iso(last_kept)}")
    print(f"Output size: {dst.stat().st_size / (1024**3):.2f} GB")
    return 0


def cmd_split(args) -> int:
    src = Path(args.input)
    cutoff = parse_when(args.at)
    before_path = Path(args.before)
    after_path = Path(args.after)
    before_path.parent.mkdir(parents=True, exist_ok=True)
    after_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Split at: {ts_iso(cutoff)}")
    print(f"Before → {before_path}")
    print(f"After  → {after_path}")

    n_before = n_after = 0
    first_b = last_b = first_a = last_a = None

    with before_path.open("w") as fb, after_path.open("w") as fa:
        for line_no, raw, topic, d, ts in iter_messages(src):
            if ts < cutoff:
                write_line(fb, raw)
                n_before += 1
                if first_b is None:
                    first_b = ts
                last_b = ts
            else:
                write_line(fa, raw)
                n_after += 1
                if first_a is None:
                    first_a = ts
                last_a = ts
            total = n_before + n_after
            if total % 1_000_000 == 0:
                print(f"  … processed {total:,} messages")

    print(f"Before: {n_before:,} msgs", end="")
    if first_b:
        print(f"  ({ts_iso(first_b)} → {ts_iso(last_b)})")
    else:
        print()
    print(f"After:  {n_after:,} msgs", end="")
    if first_a:
        print(f"  ({ts_iso(first_a)} → {ts_iso(last_a)})")
    else:
        print()
    return 0


def cmd_split_gaps(args) -> int:
    src = Path(args.input)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    gap_ms = args.gap_minutes * 60 * 1000

    session = 0
    out = None
    prev_ts = None
    count = 0
    first_ts = last_ts = None

    def open_session():
        nonlocal out, session, count, first_ts, last_ts
        if out:
            out.close()
        session += 1
        count = 0
        first_ts = last_ts = None
        out_path = out_dir / f"{src.stem}_session{session:02d}.jsonl"
        out = out_path.open("w")
        print(f"Session {session}: {out_path}")
        return out_path

    open_session()

    for line_no, raw, topic, d, ts in iter_messages(src):
        if prev_ts is not None and (ts - prev_ts) > gap_ms:
            if first_ts and last_ts:
                print(f"  closed session {session}: {count:,} msgs, {ts_iso(first_ts)} → {ts_iso(last_ts)}")
            open_session()
        write_line(out, raw)
        count += 1
        if first_ts is None:
            first_ts = ts
        last_ts = ts
        prev_ts = ts

    if out:
        out.close()
        if first_ts and last_ts:
            print(f"  closed session {session}: {count:,} msgs, {ts_iso(first_ts)} → {ts_iso(last_ts)}")

    print(f"Wrote {session} session file(s) under {out_dir}")
    return 0


def main():
    p = argparse.ArgumentParser(description="Split/filter concatenated MQTT JSONL captures")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_ins = sub.add_parser("inspect", help="Show timestamp span and message count")
    p_ins.add_argument("input")

    p_f = sub.add_parser("filter", help="Keep only messages in a time window")
    p_f.add_argument("--input", "-i", required=True)
    p_f.add_argument("--output", "-o", required=True)
    p_f.add_argument("--after", help="Keep messages >= this time (ISO, e.g. 2026-05-23T23:01:00Z)")
    p_f.add_argument("--before", help="Keep messages < this time")
    p_f.add_argument("--after-progress", type=float, dest="after_progress",
                     help="Drop everything before this file position %%, same as Replay scrub slider (e.g. 9.9)")

    p_s = sub.add_parser("split", help="Split into two files at a cutoff time")
    p_s.add_argument("--input", "-i", required=True)
    p_s.add_argument("--at", required=True, help="Cutoff time (before/at/after split)")
    p_s.add_argument("--before", required=True, help="Output path for older half")
    p_s.add_argument("--after", required=True, help="Output path for newer half")

    p_g = sub.add_parser("split-gaps", help="Split whenever gap exceeds N minutes")
    p_g.add_argument("--input", "-i", required=True)
    p_g.add_argument("--out-dir", "-d", required=True)
    p_g.add_argument("--gap-minutes", type=float, default=30)

    args = p.parse_args()
    if args.cmd == "inspect":
        return cmd_inspect(Path(args.input))
    if args.cmd == "filter":
        return cmd_filter(args)
    if args.cmd == "split":
        return cmd_split(args)
    if args.cmd == "split-gaps":
        return cmd_split_gaps(args)
    return 1


if __name__ == "__main__":
    sys.exit(main())
