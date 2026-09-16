#!/usr/bin/env python3
"""Phase 1 / step 4c — RAW ZONE VISITS (layer A): contiguous runs of a vendor id inside one ROI, from the 10 Hz feed
after transform + point-in-polygon (raster). Compared with zone_visits (layer B, Hyperspace) by ROI group."""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import db, roiraster
import numpy as np, pandas as pd

day = sys.argv[1] if len(sys.argv) > 1 else "2026-09-14"
out = db.OUT / day; W = db.local_window_ms(day); DW = db.CFG["dwell_threshold_s"]; EN = db.CFG["engagement_threshold_s"]
con = db.connect(); con.execute(f"ATTACH '{out/'jl.duckdb'}' AS jl")
con.execute(f"""
CREATE OR REPLACE TABLE jl.raw_visits AS
WITH r AS (
  SELECT r.id, r.ts, c.roi_id
  FROM read_parquet('{db.parquet_path(day)}') r
  JOIN jl.id_class k USING (id)
  LEFT JOIN jl.roi_cells c ON c.ci = CAST(floor(vx(r.x,r.z)/{roiraster.CELL}) AS INTEGER) AND c.cj = CAST(floor(vz(r.x,r.z)/{roiraster.CELL}) AS INTEGER)
  WHERE k.cls = 'VALID' AND r.ts >= {W['open_ms']} - 600000 AND r.ts < {W['close_ms']} + 600000),
w AS (SELECT *, CASE WHEN roi_id IS DISTINCT FROM lag(roi_id) OVER (PARTITION BY id ORDER BY ts) OR ts - lag(ts) OVER (PARTITION BY id ORDER BY ts) > {db.CFG['tracklet_split_gap_ms']} THEN 1 ELSE 0 END AS brk FROM r),
s AS (SELECT *, sum(brk) OVER (PARTITION BY id ORDER BY ts ROWS UNBOUNDED PRECEDING) run FROM w)
SELECT id, run, roi_id, min(ts) t_enter, max(ts) t_exit, (max(ts) - min(ts))/1000.0 + 0.1 dur_s, count(*) n
FROM s WHERE roi_id IS NOT NULL GROUP BY id, run, roi_id""")

rep = {}
a = con.execute(f"""SELECT r.roi_group, count(*) visits, count(DISTINCT v.id) raw_ids, count(*) FILTER (WHERE dur_s >= {DW}) dwells, count(*) FILTER (WHERE dur_s >= {EN}) engagements,
                       quantile_cont(dur_s, 0.5) med_dur_s, quantile_cont(dur_s, 0.9) p90_dur_s, sum(dur_s)/3600 total_hours,
                       count(*) FILTER (WHERE dur_s < 1) visits_lt_1s
                    FROM jl.raw_visits v JOIN jl.rois r USING (roi_id) WHERE t_enter >= {W['open_ms']} AND t_enter < {W['close_ms']} GROUP BY 1 ORDER BY 2 DESC""").fetchdf()
print("RAW (layer A) visits by group:\n", a.to_string()); rep["raw_visits_by_group"] = a.to_dict("records")
b = pd.DataFrame(json.load(open(out/"60_reconciler.json"))["zone_visits_by_group"]); print("HYPERSPACE (layer B) zone_visits by group:\n", b.to_string())
# per-ROI comparison (visits, dwells, hours) for checkout + entrance + top shelves
cmp = con.execute(f"""
  WITH ra AS (SELECT roi_id, count(*) raw_visits, count(*) FILTER (WHERE dur_s >= {DW}) raw_dwells, sum(dur_s)/3600 raw_hours, quantile_cont(dur_s,0.5) raw_med_s FROM jl.raw_visits WHERE t_enter >= {W['open_ms']} AND t_enter < {W['close_ms']} GROUP BY 1),
       hb AS (SELECT roi_id, count(*) hs_visits, count(*) FILTER (WHERE is_dwell=1) hs_dwells, sum(duration_ms)/3.6e6 hs_hours, quantile_cont(duration_ms/1000.0,0.5) hs_med_s FROM jl.zv WHERE ts0 >= {W['open_ms']} AND ts0 < {W['close_ms']} GROUP BY 1)
  SELECT r.roi_name, r.roi_group, ra.raw_visits, hb.hs_visits, ra.raw_dwells, hb.hs_dwells, round(ra.raw_hours,1) raw_hours, round(hb.hs_hours,1) hs_hours, round(ra.raw_med_s,1) raw_med_s, round(hb.hs_med_s,1) hs_med_s
  FROM jl.rois r LEFT JOIN ra USING (roi_id) LEFT JOIN hb USING (roi_id) WHERE r.roi_group <> 'COVERAGE' ORDER BY ra.raw_hours DESC NULLS LAST""").fetchdf()
cmp.to_csv(out/"45_roi_compare.csv", index=False); print(cmp.head(30).to_string())
rep["roi_compare_top"] = cmp.head(40).to_dict("records")
# queue: how long does a raw id stay in a queue zone vs how long a stable key does (fragmentation of the queue wait)
rep["queue_raw_dur_q"] = con.execute(f"SELECT quantile_cont(dur_s,[0.5,0.75,0.9,0.95,0.99]) FROM jl.raw_visits v JOIN jl.rois r USING (roi_id) WHERE r.roi_group='CHECKOUT_QUEUE' AND t_enter >= {W['open_ms']} AND t_enter < {W['close_ms']}").fetchone()[0]
rep["entrance_raw_visits"] = con.execute(f"SELECT count(*), count(DISTINCT id), quantile_cont(dur_s,0.5) FROM jl.raw_visits v JOIN jl.rois r USING (roi_id) WHERE r.roi_group='ENTRANCE' AND t_enter >= {W['open_ms']} AND t_enter < {W['close_ms']}").fetchone()
print("queue raw dur quantiles:", rep["queue_raw_dur_q"], "entrance raw visits:", rep["entrance_raw_visits"])
json.dump(rep, open(out/"45_raw_visits.json","w"), indent=1, default=float)
