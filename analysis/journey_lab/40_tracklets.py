#!/usr/bin/env python3
"""Phase 1 / step 4a — RAW TRACKLETS: split each vendor id on silences > split_gap, one row per tracklet with geometry,
timing, speed, headings and zone touches. Persists to out/<day>/jl.duckdb (table tracklets, roi_cells)."""
import sys, json, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import db, geometry as G, roiraster
import duckdb

day = sys.argv[1] if len(sys.argv) > 1 else "2026-09-14"
D = db.day_dir(day); P = db.parquet_path(day); out = db.OUT / day; W = db.local_window_ms(day)
SPLIT = db.CFG["tracklet_split_gap_ms"]; MOVE = 0.3  # m/s: step speed above which a sample counts as 'moving'
t0 = time.time()
con = db.connect(); con.execute(f"ATTACH '{out/'jl.duckdb'}' AS jl")
rois = G.load_rois(D); cells, overl = roiraster.build(rois)
print("roi raster cells:", len(cells), "overlapping cells resolved:", overl)
con.register("cells_df", cells); con.execute("CREATE OR REPLACE TABLE jl.roi_cells AS SELECT * FROM cells_df")
con.execute("CREATE OR REPLACE TABLE jl.rois AS SELECT id roi_id, name roi_name, \"group\" roi_group, department, checkout_no, area_m2, cx, cz FROM rois_df", ) if False else None
con.register("rois_df", rois[["id","name","group","department","checkout_no","area_m2","cx","cz"]].rename(columns={"id":"roi_id","name":"roi_name","group":"roi_group"}))
con.execute("CREATE OR REPLACE TABLE jl.rois AS SELECT * FROM rois_df")

con.execute(f"""
CREATE OR REPLACE TABLE jl.tracklets AS
WITH r AS (
  SELECT id, ts, vx(x,z) AS wx, vz(x,z) AS wz, y AS h, bh, vvx(vx,vz) AS wvx, vvz(vx,vz) AS wvz,
         CAST(floor(vx(x,z)/{roiraster.CELL}) AS INTEGER) ci, CAST(floor(vz(x,z)/{roiraster.CELL}) AS INTEGER) cj
  FROM read_parquet('{P}')),
w AS (
  SELECT r.*, c.roi_id, c.roi_group,
         ts - lag(ts) OVER win AS dt,
         sqrt((wx - lag(wx) OVER win)^2 + (wz - lag(wz) OVER win)^2) AS step,
         lead(wx, 10) OVER win AS wx_l10, lead(wz, 10) OVER win AS wz_l10,
         lag(wx, 10) OVER win AS wx_g10, lag(wz, 10) OVER win AS wz_g10
  FROM r LEFT JOIN jl.roi_cells c USING (ci, cj)
  WINDOW win AS (PARTITION BY id ORDER BY ts)),
s AS (
  SELECT *, sum(CASE WHEN dt IS NULL OR dt > {SPLIT} THEN 1 ELSE 0 END) OVER (PARTITION BY id ORDER BY ts ROWS UNBOUNDED PRECEDING) AS seg,
         CASE WHEN dt IS NOT NULL AND dt <= {SPLIT} AND dt > 0 THEN step / (dt/1000.0) END AS spd
  FROM w)
SELECT id, seg, count(*) n, min(ts) t0, max(ts) t1, (max(ts)-min(ts))/1000.0 dur_s,
       arg_min(wx, ts) x0, arg_min(wz, ts) z0, arg_max(wx, ts) x1, arg_max(wz, ts) z1,
       sqrt((arg_max(wx, ts)-arg_min(wx, ts))^2 + (arg_max(wz, ts)-arg_min(wz, ts))^2) disp_m,
       sum(CASE WHEN dt <= {SPLIT} THEN step END) path_m,
       greatest(max(wx)-min(wx), max(wz)-min(wz)) extent_m,
       sqrt(var_pop(wx) + var_pop(wz)) spatial_sd_m,
       quantile_cont(spd, 0.5) med_spd, quantile_cont(spd, 0.95) p95_spd, max(spd) max_spd,
       avg(CASE WHEN spd > {MOVE} THEN 1.0 ELSE 0.0 END) moving_frac,
       quantile_cont(dt, 0.5) FILTER (WHERE dt <= {SPLIT}) med_dt, max(dt) FILTER (WHERE dt <= {SPLIT}) max_dt_in,
       count(*) FILTER (WHERE dt > 200 AND dt <= {SPLIT}) n_microgaps,
       degrees(atan2(arg_min(wz_l10, ts) - arg_min(wz, ts), arg_min(wx_l10, ts) - arg_min(wx, ts))) head0_deg,
       degrees(atan2(arg_max(wz, ts) - arg_max(wz_g10, ts), arg_max(wx, ts) - arg_max(wx_g10, ts))) head1_deg,
       arg_min(wvx, ts) vx0, arg_min(wvz, ts) vz0, arg_max(wvx, ts) vx1, arg_max(wvz, ts) vz1,
       avg(h) mean_h, avg(bh) mean_bh, stddev_pop(bh) sd_bh,
       arg_min(roi_id, ts) roi0, arg_max(roi_id, ts) roi1, arg_min(roi_group, ts) grp0, arg_max(roi_group, ts) grp1,
       count(DISTINCT roi_id) n_rois,
       count(*) FILTER (WHERE roi_group = 'ENTRANCE') n_entr, count(*) FILTER (WHERE roi_group = 'CHECKOUT_QUEUE') n_queue,
       count(*) FILTER (WHERE roi_group = 'CHECKOUT_SERVICE') n_service, count(*) FILTER (WHERE roi_group = 'SHELF_ENGAGEMENT') n_shelf,
       list(DISTINCT roi_id) FILTER (WHERE roi_id IS NOT NULL) rois_visited
FROM s GROUP BY id, seg""")
n = con.execute("SELECT count(*), count(DISTINCT id) FROM jl.tracklets").fetchone()
print("tracklets:", n, "elapsed", round(time.time()-t0,1), "s")
