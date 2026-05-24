#!/usr/bin/env python3
"""
Stage 2 — spatial coverage + human-motion plausibility.

Spatial:
  - 2D occupancy heatmap (where people are detected)
  - Low-density mask (potential blind spots / edge-of-coverage)
  - Edge-effect: histogram of where perception IDs terminate ("death" map)

Motion:
  - Distribution of consecutive-frame speed (from positions, not the v field)
  - Distribution of consecutive-frame acceleration
  - "Direction-change" distribution (cosine between consecutive velocity vectors)
  - Dwell vs walking split (slow vs fast points)
"""
import json
import os
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors

OUT = Path(os.environ.get("ANALYSIS_OUT_DIR", Path(__file__).resolve().parent / "out"))
OUT.mkdir(parents=True, exist_ok=True)
df = pd.read_parquet(OUT / "messages.parquet")
stats = pd.read_parquet(OUT / "per_id_stats.parquet")

# ─── Spatial: heatmap of all (x, z) positions ────────────────────────────
print("Building spatial heatmap ...", flush=True)
x = df["x"].to_numpy()
z = df["z"].to_numpy()
# Use venue-sized bounding box (perception coords are roughly -34..50 x -56..22)
bins_x = np.linspace(x.min() - 1, x.max() + 1, 120)
bins_z = np.linspace(z.min() - 1, z.max() + 1, 120)
H, ex, ez = np.histogram2d(x, z, bins=[bins_x, bins_z])

# Mask for blind spots: cells inside the convex hull of detections but with 0 hits.
# Cheap proxy — inside the bounding box, low density = candidate blind spot.
inside_box = (H >= 0)  # everywhere
zero_cells = (H == 0) & inside_box
low_cells = (H > 0) & (H < np.percentile(H[H > 0], 5))

# ─── "Death map": where perception IDs end ────────────────────────────────
end_pos = df.groupby("id").tail(1)[["x", "z"]].to_numpy()
start_pos = df.groupby("id").head(1)[["x", "z"]].to_numpy()
print(f"  {len(end_pos):,} per-ID terminations")

# Per-frame speeds & accelerations within each ID (consecutive samples)
print("Computing per-frame speed & acceleration ...", flush=True)
all_speeds, all_accels, all_cos = [], [], []
for pid, g in df.groupby("id", sort=False):
    if len(g) < 3:
        continue
    ts = g["ts"].to_numpy() / 1000.0
    xs = g["x"].to_numpy()
    zs = g["z"].to_numpy()
    dt = np.diff(ts)
    dx = np.diff(xs)
    dz = np.diff(zs)
    sp = np.where(dt > 0.001, np.hypot(dx, dz) / dt, 0)
    accel = np.diff(sp) / np.maximum(dt[1:], 0.001)
    # Cosine between consecutive velocity vectors (steady walking ≈ 1, U-turn ≈ −1)
    vx = dx
    vz = dz
    if len(vx) >= 2:
        a1 = np.stack([vx[:-1], vz[:-1]], axis=1)
        a2 = np.stack([vx[1:],  vz[1:]],  axis=1)
        n1 = np.linalg.norm(a1, axis=1) + 1e-6
        n2 = np.linalg.norm(a2, axis=1) + 1e-6
        cos = (a1[:, 0] * a2[:, 0] + a1[:, 1] * a2[:, 1]) / (n1 * n2)
        all_cos.append(cos)
    all_speeds.append(sp)
    all_accels.append(accel)
speeds = np.concatenate(all_speeds) if all_speeds else np.array([])
accels = np.concatenate(all_accels) if all_accels else np.array([])
cos = np.concatenate(all_cos) if all_cos else np.array([])

motion_summary = dict(
    speed_p50=float(np.percentile(speeds, 50)),
    speed_p95=float(np.percentile(speeds, 95)),
    speed_p99=float(np.percentile(speeds, 99)),
    speed_p99_5=float(np.percentile(speeds, 99.5)),
    speed_max=float(speeds.max() if len(speeds) else 0),
    accel_p50=float(np.percentile(np.abs(accels), 50)),
    accel_p95=float(np.percentile(np.abs(accels), 95)),
    accel_p99=float(np.percentile(np.abs(accels), 99)),
    cos_p25=float(np.percentile(cos, 25)) if len(cos) else 0,
    cos_p50=float(np.percentile(cos, 50)) if len(cos) else 0,
    pct_implausible_speed_3p5=float((speeds > 3.5).mean() * 100),
    pct_implausible_speed_6=float((speeds > 6).mean() * 100),
    pct_dwell_speed_0p1=float((speeds < 0.1).mean() * 100),
    pct_walking_speed_0p5_2=float(((speeds > 0.5) & (speeds < 2)).mean() * 100),
)
print(json.dumps(motion_summary, indent=2))
(OUT / "02_motion_summary.json").write_text(json.dumps(motion_summary, indent=2))

# Spatial blind-spot estimate: ratio of zero-density cells inside the bbox
blind_pct = float(zero_cells.sum() / zero_cells.size * 100)
spatial_summary = dict(
    bbox_x=[float(x.min()), float(x.max())],
    bbox_z=[float(z.min()), float(z.max())],
    bins=120,
    zero_cells_pct=blind_pct,
    low_density_cells_pct=float(low_cells.sum() / low_cells.size * 100),
)
print(json.dumps(spatial_summary, indent=2))
(OUT / "02_spatial_summary.json").write_text(json.dumps(spatial_summary, indent=2))

# ─── Plots ─────────────────────────────────────────────────────────────────
fig, axes = plt.subplots(2, 2, figsize=(13, 10))
# Heatmap
im = axes[0, 0].imshow(np.log10(H.T + 1), origin="lower",
                      extent=[bins_x[0], bins_x[-1], bins_z[0], bins_z[-1]],
                      cmap="magma", aspect="auto")
axes[0, 0].set_title("Detection density (log10) — perception X,Z floor coords")
axes[0, 0].set_xlabel("X (m)")
axes[0, 0].set_ylabel("Z (m)")
fig.colorbar(im, ax=axes[0, 0])

# Termination "death map"
axes[0, 1].scatter(end_pos[:, 0], end_pos[:, 1], s=2, alpha=0.4, color="red", label="ID end")
axes[0, 1].scatter(start_pos[:, 0], start_pos[:, 1], s=2, alpha=0.4, color="green", label="ID start")
axes[0, 1].set_xlim(bins_x[0], bins_x[-1])
axes[0, 1].set_ylim(bins_z[0], bins_z[-1])
axes[0, 1].set_aspect("equal")
axes[0, 1].set_title("ID start (green) vs end (red)")
axes[0, 1].legend()

# Speed distribution
axes[1, 0].hist(speeds.clip(0, 6), bins=120, color="steelblue", log=True)
axes[1, 0].axvline(2.0, color="red", linestyle="--", label="2 m/s (walking)")
axes[1, 0].axvline(3.5, color="orange", linestyle="--", label="3.5 m/s (current gate)")
axes[1, 0].set_title("Per-frame implied speed (m/s, log Y)")
axes[1, 0].set_xlabel("m/s")
axes[1, 0].legend()

# Direction cosine
axes[1, 1].hist(cos, bins=60, color="seagreen")
axes[1, 1].axvline(0, color="red", linestyle="--", label="90° turn")
axes[1, 1].set_title("Direction continuity (cos between consecutive velocity vectors)")
axes[1, 1].set_xlabel("cosine (1 = straight, −1 = U-turn)")
axes[1, 1].legend()

fig.tight_layout()
fig.savefig(OUT / "02_spatial_motion.png", dpi=130)
print(f"Wrote {OUT/'02_spatial_motion.png'}")
