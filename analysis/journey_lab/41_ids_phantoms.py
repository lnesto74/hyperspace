#!/usr/bin/env python3
"""Phase 1 / step 4b — RAW ID table (one row per vendor id, built from tracklets) + MOTION VALIDITY (phantom) FILTER.
Thresholds come from config/treviglio.json -> phantom_filter and are reported with the counts they remove."""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import db
import numpy as np, pandas as pd

day = sys.argv[1] if len(sys.argv) > 1 else "2026-09-14"
out = db.OUT / day; W = db.local_window_ms(day); PF = db.CFG["phantom_filter"]
con = db.connect(); con.execute(f"ATTACH '{out/'jl.duckdb'}' AS jl")

con.execute(f"""
CREATE OR REPLACE TABLE jl.ids AS
WITH t AS (SELECT *, t0 - lag(t1) OVER (PARTITION BY id ORDER BY seg) AS gap_before_ms,
                     sqrt((x0 - lag(x1) OVER (PARTITION BY id ORDER BY seg))^2 + (z0 - lag(z1) OVER (PARTITION BY id ORDER BY seg))^2) AS jump_before_m
           FROM jl.tracklets)
SELECT id, count(*) n_segs, sum(n) n_obs, min(t0) t0, max(t1) t1, (max(t1)-min(t0))/1000.0 dur_s, sum(dur_s) observed_s,
       arg_min(x0, t0) x0, arg_min(z0, t0) z0, arg_max(x1, t1) x1, arg_max(z1, t1) z1,
       sqrt((arg_max(x1, t1)-arg_min(x0, t0))^2 + (arg_max(z1, t1)-arg_min(z0, t0))^2) disp_m,
       sum(path_m) path_m, max(extent_m) extent_seg_m,
       greatest(max(greatest(x0,x1)) - min(least(x0,x1)), max(greatest(z0,z1)) - min(least(z0,z1))) extent_ends_m,
       sum(med_spd * n) / sum(n) med_spd_w, max(max_spd) max_spd, sum(moving_frac * n) / sum(n) moving_frac,
       max(gap_before_ms) max_gap_ms, sum(gap_before_ms) total_gap_ms, max(jump_before_m) max_jump_m,
       sum(n_entr) n_entr, sum(n_queue) n_queue, sum(n_service) n_service, sum(n_shelf) n_shelf,
       avg(mean_bh) mean_bh, avg(mean_h) mean_h,
       max(t1) >= {W['open_ms']} AND min(t0) < {W['close_ms']} AS in_hours,
       min(t0) >= {W['open_ms']} AND max(t1) < {W['close_ms']} AS fully_in_hours
FROM t GROUP BY id""")

# extent per id needs all samples, not only segment ends: recompute from tracklets' bbox is not stored, so use the
# max of (segment extent, extent across segment endpoints) as a lower bound and path as the motion evidence.
con.execute("ALTER TABLE jl.ids ADD COLUMN IF NOT EXISTS extent_m DOUBLE")
con.execute("UPDATE jl.ids SET extent_m = greatest(extent_seg_m, extent_ends_m)")

# ---- motion validity classes (configurable) ----
con.execute(f"""
CREATE OR REPLACE TABLE jl.id_class AS
SELECT id,
  CASE
    WHEN dur_s >= {PF['static_duration_s']} AND extent_m < {PF['static_extent_m']} THEN 'PHANTOM_STATIC'
    WHEN dur_s >= {PF['suspect_duration_s']} AND extent_m < {PF['suspect_extent_m']} THEN 'STATIC_SUSPECT'
    WHEN path_m < {PF['min_path_m']} AND extent_m < {PF['min_extent_m']} THEN 'PHANTOM_MICRO'
    WHEN dur_s < {PF['min_duration_s']} THEN 'FLICKER_SHORT'
    WHEN med_spd_w > {PF['max_median_speed_m_s']} THEN 'SPEED_ANOMALY'
    ELSE 'VALID' END AS cls
FROM jl.ids""")

rep = {"thresholds": PF, "window": W}
cls = con.execute("""SELECT c.cls, count(*) ids, sum(i.n_obs) obs, sum(i.observed_s) observed_s,
                            count(*) FILTER (WHERE i.in_hours) ids_in_hours, sum(i.n_obs) FILTER (WHERE i.in_hours) obs_in_hours
                     FROM jl.id_class c JOIN jl.ids i USING (id) GROUP BY 1 ORDER BY 2 DESC""").fetchdf()
print(cls.to_string()); rep["classes"] = cls.to_dict("records")
tot = con.execute("SELECT count(*), sum(n_obs) FROM jl.ids").fetchone(); rep["total_ids"], rep["total_obs"] = tot
# phantom population by hour (ids alive per frame, by class)
byh = con.execute(f"""
  SELECT hour(to_timestamp(t0/1000) AT TIME ZONE '{db.CFG['timezone']}') h, c.cls, count(*) ids, sum(n_obs) obs
  FROM jl.ids i JOIN jl.id_class c USING (id) GROUP BY 1,2 ORDER BY 1,2""").fetchdf()
rep["by_hour"] = byh.pivot(index="h", columns="cls", values="ids").fillna(0).astype(int).reset_index().to_dict("records")
print(byh.pivot(index="h", columns="cls", values="ids").fillna(0).astype(int).to_string())
# where do static phantoms sit? (cluster their positions on a 1 m grid)
ph = con.execute("""SELECT round(x0) gx, round(z0) gz, count(*) n, sum(dur_s)/3600 id_hours FROM jl.ids i JOIN jl.id_class c USING (id)
                    WHERE cls='PHANTOM_STATIC' GROUP BY 1,2 ORDER BY 4 DESC LIMIT 25""").fetchdf()
print("top static-phantom cells (venue m):\n", ph.to_string()); rep["static_phantom_top_cells"] = ph.to_dict("records")
# sensitivity of the filter: how many VALID ids at alternative thresholds
sens = {}
for mp, me in [(0.5,0.3),(1.0,0.5),(2.0,1.0),(3.0,1.5)]:
    sens[f"path<{mp}&extent<{me}"] = con.execute(f"SELECT count(*) FROM jl.ids WHERE path_m < {mp} AND extent_m < {me}").fetchone()[0]
for sd, se in [(300,0.5),(600,0.5),(900,1.0),(1800,1.0)]:
    sens[f"dur>={sd}&extent<{se}"] = con.execute(f"SELECT count(*) FROM jl.ids WHERE dur_s >= {sd} AND extent_m < {se}").fetchone()[0]
rep["sensitivity_counts"] = sens; print("sensitivity:", sens)
json.dump(rep, open(out/"41_phantoms.json","w"), indent=1, default=str)
print("ids table:", con.execute("SELECT count(*) FROM jl.ids").fetchone())
