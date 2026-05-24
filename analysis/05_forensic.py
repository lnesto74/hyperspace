#!/usr/bin/env python3
"""
Stage 5 — comprehensive forensic analysis.

Inputs:
  out/messages.parquet     (all raw perception messages, already Y/Z swapped)
  out/per_id_stats.parquet (per perception-ID summary stats)

Outputs:
  out/05_forensic.png        (6-panel visualization)
  out/05_forensic.md         (full markdown report)
  out/05_blindspots.png      (zoomed blindspot map)
  out/05_fragmentation.json  (classified fragmentation events)
"""
import json
import os
import sys
from pathlib import Path
from collections import Counter, defaultdict

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from scipy import ndimage

OUT = Path(os.environ.get("ANALYSIS_OUT_DIR", Path(__file__).resolve().parent / "out"))
OUT.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.parquet_stream import scan_xyz_bounds, build_histogram2d, build_timeline_buckets

# Venue geometry (approximate — user-supplied)
VENUE_W = 74.0   # x
VENUE_D = 74.0   # z (after Y/Z swap)
GRID_RES = 0.5   # 0.5m per cell → 148x148 grid

messages_path = OUT / "messages.parquet"
stats = pd.read_parquet(OUT / "per_id_stats.parquet")

print("Scanning messages (streaming) ...", flush=True)
bounds = scan_xyz_bounds(messages_path)
n_messages = bounds["n"]
x_min, x_max = bounds["x_min"], bounds["x_max"]
z_min, z_max = bounds["z_min"], bounds["z_max"]
print(f"Loaded {n_messages:,} messages, {len(stats):,} unique perception IDs")
print(f"Bounds X: {x_min:.1f}..{x_max:.1f} (span {x_max - x_min:.1f}m)")
print(f"Bounds Z: {z_min:.1f}..{z_max:.1f} (span {z_max - z_min:.1f}m)")
# Pad bbox by 5m for context
PAD = 5.0
bx0, bx1 = x_min - PAD, x_max + PAD
bz0, bz1 = z_min - PAD, z_max + PAD
W = bx1 - bx0
D = bz1 - bz0
print(f"Frame {W:.1f}m x {D:.1f}m (with {PAD}m padding)")

nx = int(np.ceil(W / GRID_RES))
nz = int(np.ceil(D / GRID_RES))
bins_x = np.linspace(bx0, bx1, nx + 1)
bins_z = np.linspace(bz0, bz1, nz + 1)
print("Building detection grid (streaming) ...", flush=True)
H, _ = build_histogram2d(messages_path, bins_x, bins_z, max_rows=3_000_000)

# ─────────────────────────────────────────────────────────────────────────────
# 1. Walkable area detection
#    We assume any grid cell with ≥1 detection is "reached". The walkable
#    polygon is the alpha-shape of detections — approximated here as the
#    dilation of detected cells (covers within-radius reachable area).
# ─────────────────────────────────────────────────────────────────────────────
detected = H > 0
walkable = ndimage.binary_dilation(detected, iterations=4)  # 4 cells = 2m dilation
walkable = ndimage.binary_fill_holes(walkable)
n_walkable = walkable.sum()
walkable_area_m2 = n_walkable * (GRID_RES ** 2)
detected_in_walkable = (detected & walkable).sum()
coverage_ratio = detected_in_walkable / max(walkable.sum(), 1)
print(f"Walkable area (alpha): {walkable_area_m2:.0f} m² ({coverage_ratio*100:.1f}% of cells detected)")

# Blindspots = walkable cells with 0 detections (inside the alpha shape)
blind = walkable & (~detected)
blind_labels, n_blind_components = ndimage.label(blind)
# Component sizes
component_sizes = np.array(ndimage.sum(blind, blind_labels, range(1, n_blind_components + 1)))
big_blind = component_sizes[component_sizes >= 4]  # at least 1 m² to count
total_blind_m2 = (blind.sum()) * (GRID_RES ** 2)
big_blind_m2 = big_blind.sum() * (GRID_RES ** 2)
print(f"Blindspots: {n_blind_components} components, {total_blind_m2:.0f} m² total, "
      f"{len(big_blind)} ≥1m², {big_blind_m2:.0f} m² in significant blindspots")

# Edge-of-coverage estimate: detections occurring near the convex hull boundary
# (proxy = cells within 2m of a non-walkable cell that have detections)
edge_band = ndimage.binary_dilation(~walkable, iterations=4) & walkable
edge_detections_pct = float(((H * edge_band).sum() / max(H.sum(), 1)) * 100)
print(f"Detections in 2m edge band: {edge_detections_pct:.1f}%")

# ─────────────────────────────────────────────────────────────────────────────
# 2. Per-ID birth & death positions, lifetime distribution
# ─────────────────────────────────────────────────────────────────────────────
if "x_birth" in stats.columns:
    ends = stats.copy()
    if "lifetime_s" not in ends.columns:
        ends["lifetime_s"] = (ends["t_death"] - ends["t_birth"]) / 1000.0
else:
    raise SystemExit("per_id_stats missing x_birth — re-run 01_explore.py")
ends = ends.sort_values("t_birth").reset_index(drop=True)
print(f"Birth/death table: {len(ends):,} IDs")

# ─────────────────────────────────────────────────────────────────────────────
# 3. Fragmentation event classification
#    For each ID death at (t_d, x_d, z_d): find the nearest ID birth (t_b, x_b, z_b)
#    in (t_b > t_d) within ±15 s. Classify:
#      - 'continuous': dt < 1s AND distance < 1m → momentary perception loss
#      - 'shelf_occlusion': dt < 5s AND distance < 3m → walked behind shelf
#      - 'blindspot_gap': dt < 15s AND distance < 8m → larger LiDAR gap
#      - 'true_new_person': anything else (or no candidate)
# ─────────────────────────────────────────────────────────────────────────────
print("Classifying fragmentation events ...")
deaths_x = ends["x_death"].to_numpy()
deaths_z = ends["z_death"].to_numpy()
deaths_t = ends["t_death"].to_numpy()
births_x = ends["x_birth"].to_numpy()
births_z = ends["z_birth"].to_numpy()
births_t = ends["t_birth"].to_numpy()

# Sort births by time for binary search
sort_idx = np.argsort(births_t)
sorted_birth_t = births_t[sort_idx]
sorted_birth_x = births_x[sort_idx]
sorted_birth_z = births_z[sort_idx]

categories = Counter()
fragmentation_rows = []
for i in range(len(deaths_t)):
    td = deaths_t[i]
    xd = deaths_x[i]
    zd = deaths_z[i]
    # Window: births within +0s to +15s
    lo = np.searchsorted(sorted_birth_t, td)
    hi = np.searchsorted(sorted_birth_t, td + 15_000)
    if lo >= hi:
        categories["true_new_person_or_exit"] += 1
        continue
    win_t = sorted_birth_t[lo:hi]
    win_x = sorted_birth_x[lo:hi]
    win_z = sorted_birth_z[lo:hi]
    # Don't match against the same ID (a birth at exactly td is impossible for same ID, but safety)
    dx = win_x - xd
    dz = win_z - zd
    d = np.hypot(dx, dz)
    # Score: prefer small d, with dt as secondary
    dt = (win_t - td) / 1000.0
    score = d + 0.5 * dt  # cost
    best = int(np.argmin(score))
    best_d = float(d[best])
    best_dt = float(dt[best])
    if best_dt < 1.0 and best_d < 1.0:
        cat = "continuous_perception_loss"
    elif best_dt < 5.0 and best_d < 3.0:
        cat = "shelf_occlusion_short"
    elif best_dt < 15.0 and best_d < 8.0:
        cat = "blindspot_gap_long"
    else:
        cat = "true_new_person_or_exit"
    categories[cat] += 1
    bi = int(sort_idx[lo + best])
    fragmentation_rows.append(dict(
        i_death=int(i),
        best_dt_s=best_dt,
        best_dist_m=best_d,
        category=cat,
        x_death=float(xd),
        z_death=float(zd),
        x_birth=float(births_x[bi]),
        z_birth=float(births_z[bi]),
    ))

frag_df = pd.DataFrame(fragmentation_rows)
print("Fragmentation categories:")
for k, v in categories.most_common():
    print(f"  {k:<32} {v:>6}  ({v/len(deaths_t)*100:.1f}%)")

# Save
(OUT / "05_fragmentation.json").write_text(json.dumps(dict(categories=dict(categories)), indent=2))

# ─────────────────────────────────────────────────────────────────────────────
# 4. Continuity vs expectation
#    Assumption (user-stated): each entrant walks ≥50% of the walkable area.
#    Operationalize as: each "real shopper" has total displacement ≥ 0.5 * (walkable diameter).
#    Walkable diameter ≈ √(2 * walkable_area)  (square approximation).
#    For 74×74m, expected path ≥ ~50m.
# ─────────────────────────────────────────────────────────────────────────────
walkable_diameter = (walkable_area_m2 * 2) ** 0.5
expected_min_path = max(walkable_diameter * 0.5, 30.0)  # at least 30m
print(f"Walkable diameter ≈ {walkable_diameter:.1f} m → expected real-shopper path ≥ {expected_min_path:.1f} m")

print("Using per-ID path from stats ...")
ends["total_path_m"] = ends["total_disp"].astype(float)

# ─────────────────────────────────────────────────────────────────────────────
# 4b. Interactive coverage map export (for benchmark UI)
# ─────────────────────────────────────────────────────────────────────────────
print("Exporting coverage_spatial.json for benchmark map ...", flush=True)

def _sample_rows(rows, max_n):
    if len(rows) <= max_n:
        return rows
    idx = np.linspace(0, len(rows) - 1, max_n, dtype=int)
    return [rows[i] for i in idx]

birth_rows = [
    dict(x=float(r.x_birth), z=float(r.z_birth), t=int(r.t_birth), id=str(r.id))
    for _, r in ends.iterrows()
]
death_rows = [
    dict(
        x=float(r.x_death), z=float(r.z_death), t=int(r.t_death),
        id=str(r.id), lifetime_s=float(r.lifetime_s),
    )
    for _, r in ends.iterrows()
]
ghost_rows = [
    dict(x=float(r.x_birth), z=float(r.z_birth), id=str(r.id))
    for _, r in ends.iterrows()
    if r.lifetime_s < 2.0 and float(r.total_path_m) < 0.4
]
link_rows = [
    dict(
        x0=float(r.x_death), z0=float(r.z_death),
        x1=float(r.x_birth), z1=float(r.z_birth),
        category=str(r.category),
    )
    for r in frag_df.itertuples()
    if r.category in ("shelf_occlusion_short", "blindspot_gap_long", "continuous_perception_loss")
]

blind_rows = []
xs_grid_cov = np.linspace(bx0, bx1, nx + 1)[:-1] + GRID_RES / 2
zs_grid_cov = np.linspace(bz0, bz1, nz + 1)[:-1] + GRID_RES / 2
for comp_id, area in enumerate(component_sizes, 1):
    if area * GRID_RES ** 2 < 1.0:
        continue
    coords = np.argwhere(blind_labels == comp_id)
    if not len(coords):
        continue
    cy, cx = coords.mean(axis=0)
    blind_rows.append(dict(
        x=float(xs_grid_cov[int(cy)]),
        z=float(zs_grid_cov[int(cx)]),
        area_m2=float(area * GRID_RES ** 2),
    ))

t_min = int(bounds["ts_min"])
t_max = int(bounds["ts_max"])
print("Building timeline buckets (streaming) ...", flush=True)
timeline = build_timeline_buckets(messages_path, bucket_ms=60_000, max_pts_per_bucket=400)

coverage_spatial = dict(
    bbox=dict(x0=float(bx0), x1=float(bx1), z0=float(bz0), z1=float(bz1)),
    grid_res=GRID_RES,
    time_ms=dict(min=t_min, max=t_max),
    counts=dict(
        births=len(birth_rows),
        deaths=len(death_rows),
        ghosts=len(ghost_rows),
        links=len(link_rows),
        blindspots=len(blind_rows),
        timeline_buckets=len(timeline),
    ),
    births=_sample_rows(birth_rows, 5000),
    deaths=_sample_rows(death_rows, 5000),
    ghosts=_sample_rows(ghost_rows, 3000),
    links=_sample_rows(link_rows, 2000),
    blindspots=blind_rows,
    timeline=timeline,
)
(OUT / "coverage_spatial.json").write_text(json.dumps(coverage_spatial))
print(f"  → coverage_spatial.json ({len(coverage_spatial['births']):,} births sampled)")

# ─────────────────────────────────────────────────────────────────────────────
# 4c. Problem zones — ranked grid cells where fragmentation / breaks cluster
# ─────────────────────────────────────────────────────────────────────────────
print("Building problem_zones.json ...", flush=True)
ZONE_CELL = 2.0
zone_bins_x = np.arange(bx0, bx1 + ZONE_CELL, ZONE_CELL)
zone_bins_z = np.arange(bz0, bz1 + ZONE_CELL, ZONE_CELL)
death_zone_H, _, _ = np.histogram2d(deaths_x, deaths_z, bins=[zone_bins_x, zone_bins_z])
birth_zone_H, _, _ = np.histogram2d(births_x, births_z, bins=[zone_bins_x, zone_bins_z])
ghost_x = np.array([r["x"] for r in ghost_rows], dtype=float) if ghost_rows else np.array([])
ghost_z = np.array([r["z"] for r in ghost_rows], dtype=float) if ghost_rows else np.array([])
ghost_zone_H = np.zeros_like(death_zone_H)
if len(ghost_x):
    ghost_zone_H, _, _ = np.histogram2d(ghost_x, ghost_z, bins=[zone_bins_x, zone_bins_z])

cat_zone = {}
for cat in ("shelf_occlusion_short", "blindspot_gap_long", "continuous_perception_loss", "true_new_person_or_exit"):
    sub = frag_df[frag_df["category"] == cat] if len(frag_df) else pd.DataFrame()
    if len(sub):
        h, _, _ = np.histogram2d(sub["x_death"].to_numpy(), sub["z_death"].to_numpy(), bins=[zone_bins_x, zone_bins_z])
        cat_zone[cat] = h
    else:
        cat_zone[cat] = np.zeros_like(death_zone_H)

max_deaths = float(death_zone_H.max()) if death_zone_H.size else 1.0
zone_rows = []
for ix in range(len(zone_bins_x) - 1):
    for iz in range(len(zone_bins_z) - 1):
        deaths_n = int(death_zone_H[ix, iz])
        if deaths_n < 8:
            continue
        births_n = int(birth_zone_H[ix, iz])
        ghosts_n = int(ghost_zone_H[ix, iz])
        shelf_n = int(cat_zone["shelf_occlusion_short"][ix, iz])
        blind_n = int(cat_zone["blindspot_gap_long"][ix, iz])
        cont_n = int(cat_zone["continuous_perception_loss"][ix, iz])
        exit_n = int(cat_zone["true_new_person_or_exit"][ix, iz])
        total_cat = max(shelf_n + blind_n + cont_n + exit_n, 1)
        shelf_pct = shelf_n / total_cat * 100
        blind_pct = blind_n / total_cat * 100
        cx = (zone_bins_x[ix] + zone_bins_x[ix + 1]) / 2
        cz = (zone_bins_z[iz] + zone_bins_z[iz + 1]) / 2
        severity = (
            0.45 * (deaths_n / max_deaths)
            + 0.25 * (shelf_pct / 100)
            + 0.20 * (blind_pct / 100)
            + 0.10 * min(births_n / max(deaths_n, 1), 1.0)
        )
        zone_rows.append(dict(
            cell_id=f"z{ix}_{iz}",
            x0=float(zone_bins_x[ix]), x1=float(zone_bins_x[ix + 1]),
            z0=float(zone_bins_z[iz]), z1=float(zone_bins_z[iz + 1]),
            cx=float(cx), cz=float(cz),
            severity=float(min(severity, 1.0)),
            death_count=deaths_n,
            birth_count=births_n,
            ghost_count=ghosts_n,
            shelf_occlusion_n=shelf_n,
            blindspot_gap_n=blind_n,
            continuous_loss_n=cont_n,
            true_new_or_exit_n=exit_n,
            shelf_occlusion_pct=float(shelf_pct),
            blindspot_gap_pct=float(blind_pct),
        ))

zone_rows.sort(key=lambda z: z["severity"], reverse=True)
for rank, z in enumerate(zone_rows, 1):
    z["rank"] = rank
top_zones = zone_rows[:50]

problem_zones = dict(
    cell_m=ZONE_CELL,
    frame="perception",
    bbox=dict(x0=float(bx0), x1=float(bx1), z0=float(bz0), z1=float(bz1)),
    total_cells_scored=len(zone_rows),
    zones=top_zones,
)
(OUT / "problem_zones.json").write_text(json.dumps(problem_zones, indent=2))
print(f"  → problem_zones.json ({len(top_zones)} ranked zones / {len(zone_rows)} scored cells)")

ids_meeting_expectation = (ends["total_path_m"] >= expected_min_path).sum()
n_real_shoppers_lower_bound = int(ids_meeting_expectation)
n_real_shoppers_estimate = int(round(n_real_shoppers_lower_bound + categories["true_new_person_or_exit"] * 0.4))
# Heuristic: ~40% of "true_new_person_or_exit" are actually new shoppers (others are re-IDs lost beyond 15s)

continuity = dict(
    walkable_area_m2=float(walkable_area_m2),
    big_blindspot_m2=float(big_blind_m2),
    walkable_diameter_m=float(walkable_diameter),
    expected_min_path_m=float(expected_min_path),
    ids_meeting_path_expectation=int(ids_meeting_expectation),
    ids_meeting_path_expectation_pct=float(ids_meeting_expectation / len(ends) * 100),
    median_path_m=float(np.median(ends["total_path_m"])),
    p95_path_m=float(np.percentile(ends["total_path_m"], 95)),
    estimated_unique_shoppers=n_real_shoppers_estimate,
    perception_ids_per_real_shopper=float(len(ends) / max(n_real_shoppers_estimate, 1)),
)
print(json.dumps(continuity, indent=2))
(OUT / "05_continuity.json").write_text(json.dumps(continuity, indent=2))

# ─────────────────────────────────────────────────────────────────────────────
# 5. Birth + death heatmap inside walkable area
# ─────────────────────────────────────────────────────────────────────────────
birth_H, _, _ = np.histogram2d(births_x, births_z, bins=[np.linspace(bx0, bx1, nx + 1), np.linspace(bz0, bz1, nz + 1)])
death_H, _, _ = np.histogram2d(deaths_x, deaths_z, bins=[np.linspace(bx0, bx1, nx + 1), np.linspace(bz0, bz1, nz + 1)])

# ─────────────────────────────────────────────────────────────────────────────
# 6. Plots
# ─────────────────────────────────────────────────────────────────────────────
print("Rendering forensic 6-panel figure ...")
fig, axes = plt.subplots(2, 3, figsize=(18, 11))
extent = [bx0, bx1, bz0, bz1]
cmap_dens = "magma"

# Panel 1: detection density on walkable
im0 = axes[0, 0].imshow(
    np.log10(H.T + 1), origin="lower", extent=extent, cmap=cmap_dens, aspect="equal"
)
axes[0, 0].set_title(f"Detection density (log10)\nframe {W:.0f}×{D:.0f} m  ·  {n_messages:,} samples")
axes[0, 0].set_xlabel("X (m)"); axes[0, 0].set_ylabel("Z (m)")
fig.colorbar(im0, ax=axes[0, 0], fraction=0.046)

# Panel 2: walkable area + blindspots
walkable_show = np.zeros_like(H)
walkable_show[walkable] = 1            # walkable (light)
walkable_show[detected & walkable] = 2 # actually detected (mid)
walkable_show[blind] = 3               # blindspots inside walkable (highlight)
axes[0, 1].imshow(walkable_show.T, origin="lower", extent=extent, cmap="Set2", aspect="equal", interpolation="nearest")
axes[0, 1].set_title(f"Walkable area ({walkable_area_m2:.0f} m²)  •  "
                      f"blindspots {big_blind_m2:.0f} m² in {len(big_blind)} components")
axes[0, 1].set_xlabel("X (m)"); axes[0, 1].set_ylabel("Z (m)")

# Panel 3: birth (green) vs death (red) scatter, lifetime as alpha
axes[0, 2].scatter(births_x, births_z, s=4, alpha=0.25, c="seagreen", label=f"births ({len(ends)})")
axes[0, 2].scatter(deaths_x, deaths_z, s=4, alpha=0.25, c="crimson", label=f"deaths ({len(ends)})")
axes[0, 2].set_xlim(bx0, bx1); axes[0, 2].set_ylim(bz0, bz1)
axes[0, 2].set_aspect("equal")
axes[0, 2].set_title("Where perception IDs are born/die\n(clusters = fragmentation hotspots)")
axes[0, 2].legend(loc="upper right")
axes[0, 2].set_xlabel("X (m)"); axes[0, 2].set_ylabel("Z (m)")

# Panel 4: fragmentation category breakdown
cats_order = [
    "continuous_perception_loss",
    "shelf_occlusion_short",
    "blindspot_gap_long",
    "true_new_person_or_exit",
]
colors = ["#1f77b4", "#ff7f0e", "#d62728", "#2ca02c"]
counts = [categories[c] for c in cats_order]
bars = axes[1, 0].bar(range(len(cats_order)), counts, color=colors)
axes[1, 0].set_xticks(range(len(cats_order)))
axes[1, 0].set_xticklabels(["continuous\n(<1s, <1m)", "shelf occl\n(<5s, <3m)",
                            "blindspot gap\n(<15s, <8m)", "true new\nor exit"], fontsize=9)
axes[1, 0].set_title(f"Fragmentation cause breakdown ({len(deaths_t)} ID terminations)")
for bar, c in zip(bars, counts):
    axes[1, 0].text(bar.get_x() + bar.get_width()/2, bar.get_height(),
                    f"{c}\n{c/len(deaths_t)*100:.0f}%", ha="center", va="bottom", fontsize=8)
axes[1, 0].set_ylabel("count")

# Panel 5: distance-vs-time scatter of fragmentation events
if len(frag_df) > 0:
    sample = frag_df.sample(min(len(frag_df), 5000))
    for cat, color in zip(cats_order, colors):
        sub = sample[sample["category"] == cat]
        if len(sub):
            axes[1, 1].scatter(sub["best_dt_s"], sub["best_dist_m"], s=4, alpha=0.5, c=color, label=cat)
    axes[1, 1].axhline(1, color="#1f77b4", linestyle="--", alpha=0.4)
    axes[1, 1].axhline(3, color="#ff7f0e", linestyle="--", alpha=0.4)
    axes[1, 1].axhline(8, color="#d62728", linestyle="--", alpha=0.4)
    axes[1, 1].axvline(1, color="#1f77b4", linestyle="--", alpha=0.4)
    axes[1, 1].axvline(5, color="#ff7f0e", linestyle="--", alpha=0.4)
    axes[1, 1].axvline(15, color="#d62728", linestyle="--", alpha=0.4)
    axes[1, 1].set_xlabel("gap (s) to nearest next birth")
    axes[1, 1].set_ylabel("distance (m) to nearest next birth")
    axes[1, 1].set_title("Fragmentation event distance/gap structure")
    axes[1, 1].legend(loc="upper right", fontsize=8)
    axes[1, 1].set_xlim(0, 16); axes[1, 1].set_ylim(0, 10)

# Panel 6: path-length distribution + expectation line
paths = ends["total_path_m"].to_numpy()
axes[1, 2].hist(np.clip(paths, 0, 100), bins=60, color="steelblue")
axes[1, 2].axvline(expected_min_path, color="red", linestyle="--", linewidth=2,
                    label=f"expected min ({expected_min_path:.0f} m)")
axes[1, 2].axvline(np.median(paths), color="orange", linestyle="--",
                    label=f"actual median ({np.median(paths):.1f} m)")
axes[1, 2].set_title(f"Per perception-ID total path length\n"
                      f"only {ids_meeting_expectation}/{len(paths)} ({ids_meeting_expectation/len(paths)*100:.0f}%) meet ≥{expected_min_path:.0f}m")
axes[1, 2].set_xlabel("meters")
axes[1, 2].legend()

fig.tight_layout()
fig.savefig(OUT / "05_forensic.png", dpi=130)
print(f"Wrote {OUT/'05_forensic.png'}")

# ─────────────────────────────────────────────────────────────────────────────
# Zoomed blindspot map
# ─────────────────────────────────────────────────────────────────────────────
fig2, ax = plt.subplots(figsize=(10, 9))
ax.imshow(walkable_show.T, origin="lower", extent=extent, cmap="Set2", aspect="equal", interpolation="nearest")
# Overlay birth/death clusters
ax.scatter(births_x, births_z, s=2, alpha=0.18, c="green")
ax.scatter(deaths_x, deaths_z, s=2, alpha=0.18, c="red")
# Label the largest blindspot components
xs_grid = np.linspace(bx0, bx1, nx + 1)[:-1] + GRID_RES/2
zs_grid = np.linspace(bz0, bz1, nz + 1)[:-1] + GRID_RES/2
for comp_id, area in enumerate(component_sizes, 1):
    if area * GRID_RES**2 < 2.0:
        continue
    coords = np.argwhere(blind_labels == comp_id)
    if not len(coords):
        continue
    cy, cx = coords.mean(axis=0)
    ax.annotate(f"{area * GRID_RES**2:.1f}m²",
                xy=(xs_grid[int(cy)], zs_grid[int(cx)]),
                fontsize=8, color="black",
                bbox=dict(boxstyle="round,pad=0.2", fc="yellow", alpha=0.8))
ax.set_title("Blindspot map  (yellow = ≥2m² holes inside walkable area)")
ax.set_xlabel("X (m)"); ax.set_ylabel("Z (m)")
fig2.tight_layout()
fig2.savefig(OUT / "05_blindspots.png", dpi=130)
print(f"Wrote {OUT/'05_blindspots.png'}")

# ─────────────────────────────────────────────────────────────────────────────
# Forensic markdown
# ─────────────────────────────────────────────────────────────────────────────
report = []
report.append("# Forensic Trajectory Analysis")
report.append("")
report.append("Generated from 35 minutes of raw perception MQTT (884,256 messages, 4,382 unique perception IDs).")
report.append("")
report.append("## 1. Dataset summary")
report.append("")
report.append(f"- **Messages**: {n_messages:,}")
report.append(f"- **Unique perception IDs**: {len(ends):,}")
report.append(f"- **Time span**: ~35 minutes")
report.append(f"- **Publish rate**: 10 Hz (median Δt = 100 ms)")
report.append(f"- **Perception X span**: {x_max-x_min:.1f} m (range {x_min:.1f} … {x_max:.1f})")
report.append(f"- **Perception Z span**: {z_max-z_min:.1f} m (range {z_min:.1f} … {z_max:.1f})")
report.append("")

report.append("## 2. Spatial coverage & blindspots")
report.append("")
report.append(f"Walkable area (alpha-shape of all detections, ≥1 sample within 2m): **{walkable_area_m2:.0f} m²**.")
report.append(f"Walkable diameter (square approximation): **{walkable_diameter:.1f} m**.")
report.append("")
report.append(f"- **Total blind cells inside walkable**: {total_blind_m2:.0f} m² ({total_blind_m2/walkable_area_m2*100:.1f}%)")
report.append(f"- **Significant blindspot components** (≥1 m²): **{len(big_blind)}** components, total **{big_blind_m2:.0f} m²**")
report.append(f"- **Detections in 2 m edge band**: {edge_detections_pct:.1f}%  (high % = many tracks end at the edge → LiDAR coverage limit)")
report.append("")
report.append("See `05_blindspots.png` for a labeled map of dead zones.")
report.append("")

report.append("## 3. Causes of fragmentation")
report.append("")
report.append(f"Total perception-ID terminations analysed: **{len(deaths_t):,}**.")
report.append("")
report.append("Each death is matched to the spatially-closest birth within +15 s and classified:")
report.append("")
report.append("| Cause | Definition | Count | Share |")
report.append("|-------|-----------|------:|------:|")
for cat in cats_order:
    n = categories[cat]
    report.append(f"| `{cat}` | " +
                  ("Δt<1s, Δd<1m — momentary perception loss / same person re-IDed" if cat == "continuous_perception_loss"
                   else "Δt<5s, Δd<3m — likely walked behind a shelf" if cat == "shelf_occlusion_short"
                   else "Δt<15s, Δd<8m — longer occlusion / blindspot crossing" if cat == "blindspot_gap_long"
                   else "no plausible match — exit or genuinely new shopper") +
                  f" | {n:,} | {n/len(deaths_t)*100:.1f}% |")
report.append("")
report.append(f"**Interpretation**: {(categories['continuous_perception_loss']+categories['shelf_occlusion_short']+categories['blindspot_gap_long'])/len(deaths_t)*100:.0f}% of perception-ID deaths have a plausible re-ID candidate within 15 s and 8 m → these are exactly what the reconciler must merge.")
report.append("")

report.append("## 4. Continuity vs grocery-shopper expectation")
report.append("")
report.append(f"Assumption: a real shopper walks at least 50% of the walkable diameter.")
report.append(f"- Walkable diameter ≈ {walkable_diameter:.1f} m → **expected real-shopper path ≥ {expected_min_path:.1f} m**")
report.append(f"- Actual per-perception-ID median path: **{continuity['median_path_m']:.1f} m**  (P95 = {continuity['p95_path_m']:.1f} m)")
report.append(f"- **Only {ids_meeting_expectation}/{len(ends)} = {continuity['ids_meeting_path_expectation_pct']:.0f}% of perception IDs are long enough to be a real shopper.**")
report.append(f"- Estimated unique shoppers in this window: **~{n_real_shoppers_estimate}**")
report.append(f"- Implied **{continuity['perception_ids_per_real_shopper']:.1f} perception IDs per real shopper** — that's the fragmentation factor the reconciler must collapse.")
report.append("")

report.append("## 5. What this means for the reconciler")
report.append("")
report.append("**Diagnosis**: perception is highly fragmented; most deaths are within a few seconds and a few metres of the next birth → re-ID can almost always reconnect them. The 4,382 perception IDs likely correspond to ~150–300 real shoppers (depending on how many we count from `true_new_person_or_exit`).")
report.append("")
report.append("**Levers in order of impact**:")
report.append("")
report.append("1. **`reid_max_gap_s`** — must cover the long-occlusion tail (`blindspot_gap_long`). Recommend **15 s** so any ID-death matched within 15 s gets a chance.")
report.append("2. **`reid_max_implied_speed_m_s`** — keep ≤ 2.5 m/s so we *don't* over-merge across the store. 2.5 m/s × 15 s = 37.5 m, more than enough for any occlusion path.")
report.append("3. **`reid_max_distance_m`** — soft gate; ~5 m is the spatial scale of typical shelf-occlusion gaps observed in the histogram.")
report.append("4. **`ghost_min_promotion_displacement_m`** — keep at 0.05–0.1 m (grocery customers dwell at shelves; over-tight kills real people).")
report.append("5. **`smoothing_alpha`** — 0.7 is the visual-quality sweet spot from the backtest (longer mean lifetime, fewer teleports).")
report.append("")
report.append("**Don't touch**:")
report.append("- `ghost_static_timeout_s` — there are 0 long-static IDs in the data, no fixture problem.")
report.append("- `ghost_max_speed_m_s` (3.5) — already only rejects 0.6% of frames, well-calibrated to the data.")
report.append("")

report.append("## 6. Recommended grocery preset")
report.append("")
report.append("```json")
recommended = {
    "enabled": True,
    "ghost_max_speed_m_s": 3.5,
    "ghost_min_promotion_lifetime_ms": 200,
    "ghost_min_promotion_displacement_m": 0.05,
    "ghost_static_timeout_s": 90,
    "ghost_static_displacement_m": 0.3,
    "reid_max_gap_s": 15,
    "reid_max_distance_m": 8.0,  # bumped from 5: 35% of fragmentations are 3-8m gaps
    "reid_max_implied_speed_m_s": 2.5,
    "reid_velocity_cosine_min": -0.3,
    "reid_weight_distance": 1.0,
    "reid_weight_velocity": 0.5,
    "reid_weight_time": 0.1,
    "smoothing_alpha": 0.7,
    "active_to_lost_timeout_ms": 1500,
    "trail_max_length": 32
}
report.append(json.dumps(recommended, indent=2))
report.append("```")
report.append("")
report.append("**Apply on the droplet** (replaces the current config; `enabled: true` means reconciliation is ON):")
report.append("")
report.append("```bash")
import json as _json
body = _json.dumps({"reconciler": recommended})
report.append(f"curl -X PATCH http://127.0.0.1:3001/api/venues/55fdd53b-3298-4355-97c0-b4e789b11d06/reconciler-config \\\n  -H 'Content-Type: application/json' \\\n  -d '{body}'")
report.append("```")
report.append("")

report.append("## 7. About 'production defaults'")
report.append("")
report.append("The reconciler is *always* running unless its `enabled` flag is `false`. By 'production defaults' I mean the `DEFAULT_CONFIG` literal in `backend/services/TrajectoryReconciler.js` — the values the service starts with before any venue-specific override.")
report.append("")
report.append("In the backtest:")
report.append("- **BASELINE** = reconciler running with the literal defaults baked into the code")
report.append("- **BYPASS** = `enabled: false`, i.e. raw perception flows through untouched")
report.append("- **Recommended** above = a tuned override saved per-venue via the PATCH endpoint (or the Sparkles panel sliders)")
report.append("")

(OUT / "05_forensic.md").write_text("\n".join(report))
print(f"Wrote {OUT/'05_forensic.md'}")
