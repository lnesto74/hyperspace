"""Streaming helpers for large messages.parquet files (multi-GB safe)."""
from __future__ import annotations

from pathlib import Path

import numpy as np

try:
    import pyarrow.parquet as pq
except ImportError:
    pq = None


def iter_parquet_batches(path: Path, columns=None, batch_size: int = 250_000):
    if pq is None:
        raise RuntimeError("pyarrow required")
    pf = pq.ParquetFile(path)
    for batch in pf.iter_batches(columns=columns, batch_size=batch_size):
        yield batch.to_pandas()


def scan_xyz_bounds(path: Path):
    x_min = z_min = None
    x_max = z_max = None
    ts_min = ts_max = None
    n = 0
    for chunk in iter_parquet_batches(path, columns=["x", "z", "ts"]):
        n += len(chunk)
        cx0, cx1 = float(chunk["x"].min()), float(chunk["x"].max())
        cz0, cz1 = float(chunk["z"].min()), float(chunk["z"].max())
        ct0, ct1 = int(chunk["ts"].min()), int(chunk["ts"].max())
        x_min = cx0 if x_min is None else min(x_min, cx0)
        x_max = cx1 if x_max is None else max(x_max, cx1)
        z_min = cz0 if z_min is None else min(z_min, cz0)
        z_max = cz1 if z_max is None else max(z_max, cz1)
        ts_min = ct0 if ts_min is None else min(ts_min, ct0)
        ts_max = ct1 if ts_max is None else max(ts_max, ct1)
    return dict(x_min=x_min, x_max=x_max, z_min=z_min, z_max=z_max, ts_min=ts_min, ts_max=ts_max, n=n)


def build_histogram2d(path: Path, bins_x, bins_z, max_rows: int | None = None):
    H = np.zeros((len(bins_x) - 1, len(bins_z) - 1), dtype=np.int64)
    seen = 0
    stride = 1
    if max_rows:
        bounds = scan_xyz_bounds(path)
        if bounds["n"] > max_rows:
            stride = max(1, bounds["n"] // max_rows)
    for chunk in iter_parquet_batches(path, columns=["x", "z"]):
        xs = chunk["x"].to_numpy()[::stride]
        zs = chunk["z"].to_numpy()[::stride]
        h, _, _ = np.histogram2d(xs, zs, bins=[bins_x, bins_z])
        H += h.astype(np.int64)
        seen += len(xs)
    return H, seen


def sample_speeds(path: Path, max_samples: int = 400_000):
    """Subsample per-frame implied speeds without loading full file."""
    speeds = []
    bounds = scan_xyz_bounds(path)
    stride = max(1, bounds["n"] // max(max_samples, 1))
    prev_by_id: dict = {}
    for chunk in iter_parquet_batches(path, columns=["id", "ts", "x", "z"]):
        for row in chunk.itertuples(index=False):
            pid = row.id
            ts = row.ts / 1000.0
            x, z = row.x, row.z
            prev = prev_by_id.get(pid)
            if prev is not None:
                dt = ts - prev[0]
                if dt > 0.001:
                    sp = float(np.hypot(x - prev[1], z - prev[2]) / dt)
                    if len(speeds) < max_samples and (len(speeds) % stride == 0 or stride == 1):
                        speeds.append(sp)
            prev_by_id[pid] = (ts, x, z)
            if len(prev_by_id) > 500_000:
                prev_by_id.clear()
    return np.array(speeds, dtype=np.float64)


def build_timeline_buckets(path: Path, bucket_ms: int = 60_000, max_pts_per_bucket: int = 400):
    bounds = scan_xyz_bounds(path)
    if bounds["ts_min"] is None:
        return []
    buckets: dict[int, list] = {}
    for chunk in iter_parquet_batches(path, columns=["ts", "x", "z"]):
        for row in chunk.itertuples(index=False):
            t0 = (int(row.ts) // bucket_ms) * bucket_ms
            lst = buckets.setdefault(t0, [])
            if len(lst) < max_pts_per_bucket * 3:
                lst.append((row.x, row.z))
    timeline = []
    for t0 in sorted(buckets):
        pts_raw = buckets[t0]
        stride = max(1, len(pts_raw) // max_pts_per_bucket)
        pts = [{"x": float(x), "z": float(z)} for x, z in pts_raw[::stride]]
        timeline.append({"t0": t0, "t1": t0 + bucket_ms, "points": pts})
    return timeline
