#!/usr/bin/env python3
"""
Stage 2 — spatial coverage + human-motion (streaming, multi-GB safe).
"""
import json
import os
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.parquet_stream import build_histogram2d, sample_speeds, scan_xyz_bounds

OUT = Path(os.environ.get("ANALYSIS_OUT_DIR", Path(__file__).resolve().parent / "out"))
OUT.mkdir(parents=True, exist_ok=True)

messages_path = OUT / "messages.parquet"
stats_path = OUT / "per_id_stats.parquet"
if not messages_path.exists():
    sys.exit(f"missing {messages_path} — run 01_explore.py first")

print("Loading per-ID stats ...", flush=True)
stats = pd.read_parquet(stats_path)

print("Scanning parquet bounds (streaming) ...", flush=True)
bounds = scan_xyz_bounds(messages_path)
x_min, x_max = bounds["x_min"], bounds["x_max"]
z_min, z_max = bounds["z_min"], bounds["z_max"]
print(f"  {bounds['n']:,} messages, X {x_min:.1f}..{x_max:.1f}, Z {z_min:.1f}..{z_max:.1f}")

bins_x = np.linspace(x_min - 1, x_max + 1, 120)
bins_z = np.linspace(z_min - 1, z_max + 1, 120)

print("Building spatial heatmap (streaming) ...", flush=True)
H, _ = build_histogram2d(messages_path, bins_x, bins_z, max_rows=2_000_000)

inside_box = H >= 0
zero_cells = (H == 0) & inside_box
low_cells = (H > 0) & (H < np.percentile(H[H > 0], 5))

if "x_birth" in stats.columns:
    start_pos = stats[["x_birth", "z_birth"]].to_numpy()
    end_pos = stats[["x_death", "z_death"]].to_numpy()
else:
    start_pos = end_pos = np.zeros((0, 2))
print(f"  {len(end_pos):,} per-ID terminations")

print("Computing motion metrics from per-ID stats ...", flush=True)
if "mean_implied_speed" in stats.columns:
    weights = stats["samples"].clip(1, 20).astype(int).to_numpy()
    speeds = np.repeat(stats["mean_implied_speed"].clip(0, 8).to_numpy(), weights)
else:
    print("  (fallback: streaming speed sample)", flush=True)
    speeds = sample_speeds(messages_path, max_samples=400_000)
accels = np.array([])
cos = np.array([])

motion_summary = dict(
    speed_p50=float(np.percentile(speeds, 50)) if len(speeds) else 0,
    speed_p95=float(np.percentile(speeds, 95)) if len(speeds) else 0,
    speed_p99=float(np.percentile(speeds, 99)) if len(speeds) else 0,
    speed_p99_5=float(np.percentile(speeds, 99.5)) if len(speeds) else 0,
    speed_max=float(speeds.max()) if len(speeds) else 0,
    accel_p50=0.0,
    accel_p95=0.0,
    accel_p99=0.0,
    cos_p25=0.0,
    cos_p50=0.0,
    pct_implausible_speed_3p5=float((speeds > 3.5).mean() * 100) if len(speeds) else 0,
    pct_implausible_speed_6=float((speeds > 6).mean() * 100) if len(speeds) else 0,
    pct_dwell_speed_0p1=float((speeds < 0.1).mean() * 100) if len(speeds) else 0,
    pct_walking_speed_0p5_2=float(((speeds > 0.5) & (speeds < 2)).mean() * 100) if len(speeds) else 0,
)
print(json.dumps(motion_summary, indent=2))
(OUT / "02_motion_summary.json").write_text(json.dumps(motion_summary, indent=2))

blind_pct = float(zero_cells.sum() / zero_cells.size * 100)
spatial_summary = dict(
    bbox_x=[float(x_min), float(x_max)],
    bbox_z=[float(z_min), float(z_max)],
    bins=120,
    zero_cells_pct=blind_pct,
    low_density_cells_pct=float(low_cells.sum() / low_cells.size * 100),
)
print(json.dumps(spatial_summary, indent=2))
(OUT / "02_spatial_summary.json").write_text(json.dumps(spatial_summary, indent=2))

fig, axes = plt.subplots(2, 2, figsize=(13, 10))
im = axes[0, 0].imshow(
    np.log10(H.T + 1), origin="lower",
    extent=[bins_x[0], bins_x[-1], bins_z[0], bins_z[-1]],
    cmap="magma", aspect="auto",
)
axes[0, 0].set_title("Detection density (log10) — perception X,Z floor coords")
axes[0, 0].set_xlabel("X (m)")
axes[0, 0].set_ylabel("Z (m)")
fig.colorbar(im, ax=axes[0, 0])

if len(end_pos):
    axes[0, 1].scatter(end_pos[:, 0], end_pos[:, 1], s=2, alpha=0.4, color="red", label="ID end")
    axes[0, 1].scatter(start_pos[:, 0], start_pos[:, 1], s=2, alpha=0.4, color="green", label="ID start")
axes[0, 1].set_xlim(bins_x[0], bins_x[-1])
axes[0, 1].set_ylim(bins_z[0], bins_z[-1])
axes[0, 1].set_aspect("equal")
axes[0, 1].set_title("ID start (green) vs end (red)")
axes[0, 1].legend()

if len(speeds):
    axes[1, 0].hist(speeds.clip(0, 6), bins=120, color="steelblue", log=True)
axes[1, 0].axvline(2.0, color="red", linestyle="--", label="2 m/s (walking)")
axes[1, 0].axvline(3.5, color="orange", linestyle="--", label="3.5 m/s (current gate)")
axes[1, 0].set_title("Per-frame implied speed (m/s, log Y)")
axes[1, 0].set_xlabel("m/s")
axes[1, 0].legend()

axes[1, 1].text(0.5, 0.5, "Direction cos skipped\n(large-file streaming mode)", ha="center", va="center", transform=axes[1, 1].transAxes)

fig.tight_layout()
fig.savefig(OUT / "02_spatial_motion.png", dpi=130)
print(f"Wrote {OUT / '02_spatial_motion.png'}")
