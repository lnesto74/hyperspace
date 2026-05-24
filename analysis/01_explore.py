#!/usr/bin/env python3
"""
Stage 1 — explore raw perception MQTT capture (streaming, multi-GB safe).

Writes messages.parquet in batches + per_id_stats.parquet + 01_summary.json.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
except ImportError:
    pa = None
    pq = None

BATCH = 100_000


@dataclass
class IdState:
    samples: int = 0
    first_ts: int = 0
    last_ts: int = 0
    last_x: float = 0.0
    last_z: float = 0.0
    total_disp: float = 0.0
    net_x0: float = 0.0
    net_z0: float = 0.0
    net_x1: float = 0.0
    net_z1: float = 0.0
    speed_sum: float = 0.0
    speed_max: float = 0.0
    implied_sum: float = 0.0
    implied_max: float = 0.0
    implied_steps: int = 0
    dt_ms_values: list = field(default_factory=list)
    teleports: int = 0


def parse_args():
    p = argparse.ArgumentParser(description="Stage 1 — raw perception explore")
    p.add_argument("--file", "-f", required=True, help="Input .jsonl capture")
    p.add_argument("--out-dir", "-o", required=True, help="Output directory")
    p.add_argument("--venue-id", help="Keep only this venue")
    p.add_argument("--after", help="ISO timestamp lower bound (inclusive)")
    p.add_argument("--before", help="ISO timestamp upper bound (exclusive)")
    return p.parse_args()


def parse_when(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    from datetime import datetime, timezone
    s = s.strip().replace("Z", "+00:00")
    if len(s) == 10:
        s += "T00:00:00+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def parse_line(line: str):
    raw = line.strip()
    if not raw or raw.startswith("nohup:") or raw.startswith("mosquitto_sub"):
        return None
    if " " not in raw:
        return None
    try:
        _, payload = raw.split(" ", 1)
        d = json.loads(payload)
    except Exception:
        return None
    pos = d.get("position") or {}
    vel = d.get("velocity") or {}
    ts = int(d.get("timestamp") or 0)
    if ts <= 0:
        return None
    x = float(pos.get("x", 0.0))
    y_perc = float(pos.get("y", 0.0))
    z_perc = float(pos.get("z", 0.0))
    vx = float(vel.get("x", 0.0))
    vy_perc = float(vel.get("y", 0.0))
    vz_perc = float(vel.get("z", 0.0))
    return {
        "ts": ts,
        "id": str(d.get("id", "")),
        "device": str(d.get("deviceId", "")),
        "venue": str(d.get("venueId", "")),
        "x": x,
        "z": y_perc,
        "y": z_perc,
        "vx": vx,
        "vz": vy_perc,
        "vy": vz_perc,
    }


def update_id(st: IdState, row: dict):
    if st.samples == 0:
        st.first_ts = row["ts"]
        st.last_ts = row["ts"]
        st.last_x = row["x"]
        st.last_z = row["z"]
        st.net_x0 = row["x"]
        st.net_z0 = row["z"]
        st.net_x1 = row["x"]
        st.net_z1 = row["z"]
        st.samples = 1
        sp = float(np.hypot(row["vx"], row["vz"]))
        st.speed_sum += sp
        st.speed_max = max(st.speed_max, sp)
        return

    dt_s = (row["ts"] - st.last_ts) / 1000.0
    dx = row["x"] - st.last_x
    dz = row["z"] - st.last_z
    step = float(np.hypot(dx, dz))
    st.total_disp += step
    st.samples += 1
    st.last_ts = row["ts"]
    st.last_x = row["x"]
    st.last_z = row["z"]
    st.net_x1 = row["x"]
    st.net_z1 = row["z"]
    sp = float(np.hypot(row["vx"], row["vz"]))
    st.speed_sum += sp
    st.speed_max = max(st.speed_max, sp)
    if dt_s > 0.001:
        implied = step / dt_s
        st.implied_sum += implied
        st.implied_max = max(st.implied_max, implied)
        st.implied_steps += 1
        st.dt_ms_values.append(dt_s * 1000.0)
        if implied > 3.0:
            st.teleports += 1


def states_to_stats(states: dict) -> pd.DataFrame:
    rows = []
    for pid, st in states.items():
        life = (st.last_ts - st.first_ts) / 1000.0 if st.samples > 1 else 0.0
        mean_speed = st.speed_sum / max(st.samples, 1)
        mean_implied = st.implied_sum / max(st.implied_steps, 1)
        mean_dt = float(np.median(st.dt_ms_values)) if st.dt_ms_values else 0.0
        rows.append({
            "id": pid,
            "samples": st.samples,
            "lifetime_s": life,
            "total_disp": st.total_disp,
            "net_disp": float(np.hypot(st.net_x1 - st.net_x0, st.net_z1 - st.net_z0)),
            "t_birth": st.first_ts,
            "t_death": st.last_ts,
            "x_birth": st.net_x0,
            "z_birth": st.net_z0,
            "x_death": st.net_x1,
            "z_death": st.net_z1,
            "mean_speed": mean_speed,
            "p95_speed": mean_speed,
            "max_speed": st.speed_max,
            "mean_implied_speed": mean_implied,
            "max_implied_speed": st.implied_max,
            "mean_dt_ms": mean_dt,
            "teleports": st.teleports,
        })
    return pd.DataFrame(rows)


def main():
    args = parse_args()
    src = Path(args.file)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    parquet_path = out / "messages.parquet"

    if not src.exists():
        sys.exit(f"missing {src}")
    if pq is None:
        sys.exit("pyarrow required: pip install pyarrow")

    after_ms = parse_when(args.after)
    before_ms = parse_when(args.before)

    states: dict[str, IdState] = {}
    batch: list = []
    writer = None
    n = 0
    ts_min = ts_max = None

    print(f"Streaming {src} ...", flush=True)
    with src.open(errors="replace") as f:
        for line in f:
            row = parse_line(line)
            if row is None:
                continue
            if args.venue_id and row["venue"] != args.venue_id:
                continue
            if after_ms is not None and row["ts"] < after_ms:
                continue
            if before_ms is not None and row["ts"] >= before_ms:
                continue

            n += 1
            ts_min = row["ts"] if ts_min is None else min(ts_min, row["ts"])
            ts_max = row["ts"] if ts_max is None else max(ts_max, row["ts"])

            st = states.get(row["id"])
            if st is None:
                st = IdState()
                states[row["id"]] = st
            update_id(st, row)

            batch.append(row)
            if len(batch) >= BATCH:
                table = pa.Table.from_pandas(pd.DataFrame(batch), preserve_index=False)
                if writer is None:
                    writer = pq.ParquetWriter(parquet_path, table.schema, compression="snappy")
                writer.write_table(table)
                batch.clear()
                if n % 1_000_000 == 0:
                    print(f"  … {n:,} messages", flush=True)

    if batch:
        table = pa.Table.from_pandas(pd.DataFrame(batch), preserve_index=False)
        if writer is None:
            writer = pq.ParquetWriter(parquet_path, table.schema, compression="snappy")
        writer.write_table(table)
        batch.clear()
    if writer:
        writer.close()

    print(f"  → {n:,} messages, {len(states):,} unique perception IDs", flush=True)

    stats = states_to_stats(states)
    stats.to_parquet(out / "per_id_stats.parquet")

    teleports = sum(st.teleports for st in states.values())
    shopper_grade = int((stats["total_disp"] >= 30).sum())
    ids_under_2s = int((stats["lifetime_s"] < 2.0).sum())
    est_shoppers = max(shopper_grade, 1)

    summary = {
        "messages": int(n),
        "unique_perception_ids": int(len(states)),
        "time_span_h": float((ts_max - ts_min) / 1000 / 3600) if ts_min and ts_max else 0,
        "median_dt_ms": float(stats["mean_dt_ms"].median()) if len(stats) else 0,
        "median_lifetime_s": float(stats["lifetime_s"].median()) if len(stats) else 0,
        "mean_lifetime_s": float(stats["lifetime_s"].mean()) if len(stats) else 0,
        "p95_lifetime_s": float(stats["lifetime_s"].quantile(0.95)) if len(stats) else 0,
        "median_total_disp": float(stats["total_disp"].median()) if len(stats) else 0,
        "mean_displacement_m": float(stats["total_disp"].mean()) if len(stats) else 0,
        "p95_total_disp": float(stats["total_disp"].quantile(0.95)) if len(stats) else 0,
        "p99_implied_speed": float(stats["max_implied_speed"].quantile(0.99)) if len(stats) else 0,
        "teleports_per_1k": float(teleports / max(n, 1) * 1000),
        "pct_ids_under_2s": float(ids_under_2s / max(len(stats), 1) * 100),
        "shopper_grade_ge_30m": shopper_grade,
        "estimated_real_shoppers": est_shoppers,
        "fragmentation_factor": float(len(states) / est_shoppers),
        "ids_under_2s": ids_under_2s,
    }
    (out / "01_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))

    if len(stats):
        fig, axes = plt.subplots(2, 2, figsize=(12, 9))
        axes[0, 0].hist(np.log10(stats["lifetime_s"].clip(0.05, None)), bins=60, color="steelblue")
        axes[0, 0].set_title("Perception-ID lifetime (log10 seconds)")
        axes[0, 1].hist(stats["total_disp"].clip(0, 50), bins=60, color="seagreen")
        axes[0, 1].set_title("Per-ID total displacement (m, capped 50)")
        axes[1, 0].scatter(
            stats["lifetime_s"].clip(0.05, 600),
            stats["total_disp"].clip(0.001, 200),
            s=2, alpha=0.3,
        )
        axes[1, 0].set_xscale("log")
        axes[1, 0].set_yscale("log")
        axes[1, 0].set_title("Lifetime vs displacement")
        speeds = stats["mean_speed"].clip(0, 4)
        axes[1, 1].hist(speeds, bins=60, color="orange")
        axes[1, 1].axvline(2.0, color="red", linestyle="--", label="2 m/s")
        axes[1, 1].legend()
        fig.tight_layout()
        fig.savefig(out / "01_overview.png", dpi=120)
        plt.close(fig)
        print(f"Wrote {out / '01_overview.png'}")


if __name__ == "__main__":
    main()
