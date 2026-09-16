#!/usr/bin/env python3
"""ATTESA IN CASSA — corrected queue / service time per customer, per checkout lane and per time slot.
Logic (all on VALID raw ids, 10 Hz):
  1. frames inside each 'Checkout N - Queue' / 'Checkout N - Service' ROI, with frame speed (m/s) from the previous frame of the same id;
  2. visits = contiguous runs of one id in one ROI (gap > 2 s breaks);
  3. FIXED objects: ids with a visit >= 600 s inside a checkout ROI, plus any visit >= 60 s whose mean position is within 1.2 m of such a spot;
  4. TRANSIT: visits whose mean speed >= 0.5 m/s (people walking across the zone);
  5. WAITING = the rest. KPI = waiting person-minutes / entrances (per slot and per day); per lane: waiting minutes and mean people waiting.
Writes 150_queue_wait.json and patches 110_average_journey.json + 130_dashboard_data.json ('Coda cassa', 'Cassa (servizio)', 'Corsie / fuori zona')."""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import db, roiraster
import numpy as np, pandas as pd

day = sys.argv[1] if len(sys.argv) > 1 else "2026-09-14"
out = db.OUT / day; W = db.local_window_ms(day); o, c = W["open_ms"], W["close_ms"]; TZ = db.CFG["timezone"]
con = db.connect(); con.execute(f"ATTACH '{out/'jl.duckdb'}' AS jl")
SPEED_WALK, FIXED_S, NEAR_M, NEAR_S = 0.5, 600, 1.2, 60
SLOTS = [(8, 10), (10, 12), (12, 14), (14, 16), (16, 18), (18, 20)]
slot_case = "CASE " + " ".join(f"WHEN h >= {a} AND h < {b} THEN '{a:02d}-{b:02d}'" for a, b in SLOTS) + " END"

if not con.execute("SELECT count(*) FROM duckdb_tables() WHERE database_name='jl' AND table_name='ck_frames'").fetchone()[0]:
    con.execute(f"""CREATE TABLE jl.ck_frames AS
    SELECT id, ts, wx, wz, spd, roi_id, cls FROM (
     SELECT r.id, r.ts, vx(x,z) wx, vz(x,z) wz, k.cls,
       sqrt((vx(x,z) - lag(vx(x,z)) OVER w)^2 + (vz(x,z) - lag(vz(x,z)) OVER w)^2) / greatest((ts - lag(ts) OVER w)/1000.0, 0.05) spd
     FROM read_parquet('{db.parquet_path(day)}') r JOIN jl.id_class k USING (id)
     WHERE k.cls IN ('VALID','STATIC_SUSPECT','PHANTOM_STATIC') AND r.ts >= {o} AND r.ts < {c}
     WINDOW w AS (PARTITION BY id ORDER BY ts)) f
    LEFT JOIN jl.roi_cells c ON c.ci = CAST(floor(wx/{roiraster.CELL}) AS INTEGER) AND c.cj = CAST(floor(wz/{roiraster.CELL}) AS INTEGER)
    WHERE wx BETWEEN 48 AND 72 AND wz BETWEEN 12 AND 52""")

con.execute("""CREATE OR REPLACE TABLE jl.ck_visits AS
WITH w AS (SELECT f.*, r.roi_group, TRY_CAST(regexp_extract(r.roi_name,'Checkout (\\d+)',1) AS INT) lane,
   CASE WHEN roi_id IS DISTINCT FROM lag(roi_id) OVER (PARTITION BY id ORDER BY ts) OR ts - lag(ts) OVER (PARTITION BY id ORDER BY ts) > 2000 THEN 1 ELSE 0 END brk
   FROM jl.ck_frames f LEFT JOIN jl.rois r USING(roi_id) WHERE f.cls='VALID'),
s AS (SELECT *, sum(brk) OVER (PARTITION BY id ORDER BY ts ROWS UNBOUNDED PRECEDING) run FROM w)
SELECT id, run, roi_id, roi_group, lane, min(ts) t0, max(ts) t1, count(*)/10.0 dur_s, avg(spd) mean_spd, count(*) FILTER (WHERE spd<0.5)/10.0 slow_s,
  max(wx)-min(wx) dx, max(wz)-min(wz) dz, avg(wx) mx, avg(wz) mz
FROM s WHERE roi_group IN ('CHECKOUT_QUEUE','CHECKOUT_SERVICE') GROUP BY 1,2,3,4,5""")
# fixed spots: long visits (VALID) or static phantoms inside checkout ROIs
con.execute(f"""CREATE OR REPLACE TABLE jl.ck_fixed_spots AS
SELECT id, mx, mz, dur_s, 'long_visit' src FROM jl.ck_visits WHERE dur_s >= {FIXED_S}
UNION ALL
SELECT f.id, avg(wx), avg(wz), count(*)/10.0, 'static_phantom' FROM jl.ck_frames f JOIN jl.rois r USING(roi_id) WHERE f.cls='PHANTOM_STATIC' AND r.roi_group LIKE 'CHECKOUT%' GROUP BY 1 HAVING count(*)/10.0 >= {FIXED_S}""")
spots = con.execute("SELECT * FROM jl.ck_fixed_spots ORDER BY dur_s DESC").fetchdf(); print("fixed spots:\n", spots.round(2).to_string())
con.execute(f"""CREATE OR REPLACE TABLE jl.ck_class AS
SELECT v.*, hour(to_timestamp(t0/1000) AT TIME ZONE '{TZ}') h,
  CASE WHEN v.dur_s >= {FIXED_S} OR (v.dur_s >= {NEAR_S} AND EXISTS (SELECT 1 FROM jl.ck_fixed_spots s WHERE sqrt((s.mx-v.mx)^2+(s.mz-v.mz)^2) < {NEAR_M})) THEN 'FIXED'
       WHEN v.mean_spd >= {SPEED_WALK} THEN 'TRANSIT' ELSE 'WAITING' END cls
FROM jl.ck_visits v""")

ent = json.load(open(out / "110_average_journey.json"))["entrances"]; ENT = ent["giorno"]
lane = con.execute("""SELECT roi_group, lane, cls, round(sum(dur_s)/60,2) pm, count(*) visits FROM jl.ck_class GROUP BY 1,2,3 ORDER BY 1,2,3""").fetchdf()
L = lane.pivot_table(index=["roi_group", "lane"], columns="cls", values="pm", fill_value=0).reset_index()
for k in ["FIXED", "TRANSIT", "WAITING"]:
    if k not in L: L[k] = 0.0
L["TOTAL"] = L.FIXED + L.TRANSIT + L.WAITING; L["per_entrance_before"] = (L.TOTAL / ENT).round(3); L["per_entrance_after"] = (L.WAITING / ENT).round(3)
L["mean_people_waiting"] = (L.WAITING / 720).round(2)  # over the 12 opening hours
print(L.round(2).to_string())
slot = con.execute(f"""SELECT roi_group, {slot_case} slot, cls, sum(dur_s)/60 pm FROM jl.ck_class GROUP BY 1,2,3""").fetchdf()
S = slot.pivot_table(index=["roi_group", "slot"], columns="cls", values="pm", fill_value=0).reset_index()
for k in ["FIXED", "TRANSIT", "WAITING"]:
    if k not in S: S[k] = 0.0
S["entrances"] = S.slot.map(ent); S["before"] = ((S.FIXED + S.TRANSIT + S.WAITING) / S.entrances).round(2); S["after"] = (S.WAITING / S.entrances).round(2)
print(S.round(2).to_string())
# waiting-visit duration distribution (a raw id piece, so a lower bound of the real wait)
qd = con.execute("SELECT roi_group, quantile_cont(dur_s,[0.5,0.75,0.9,0.95]) q FROM jl.ck_class WHERE cls='WAITING' GROUP BY 1").fetchdf()
rep = {"day": day, "params": {"speed_walk_mps": SPEED_WALK, "fixed_s": FIXED_S, "near_m": NEAR_M, "near_s": NEAR_S}, "entrances": ent,
       "fixed_spots": spots.round(2).to_dict("records"), "per_lane": L.round(3).to_dict("records"), "per_slot": S.round(3).to_dict("records"),
       "waiting_visit_duration_quantiles": {r.roi_group: list(r.q) for r in qd.itertuples()}}
def tot(group, col): return float(L[L.roi_group == group][col].sum())
rep["kpi"] = {g: {"before_min_per_entrance": round(tot(g, "TOTAL") / ENT, 3), "fixed": round(tot(g, "FIXED") / ENT, 3), "transit": round(tot(g, "TRANSIT") / ENT, 3), "after_min_per_entrance": round(tot(g, "WAITING") / ENT, 3)} for g in ["CHECKOUT_QUEUE", "CHECKOUT_SERVICE"]}
print(json.dumps(rep["kpi"], indent=1))
json.dump(rep, open(out / "150_queue_wait.json", "w"), indent=1, default=float)

# patch the two downstream JSONs: queue/service become WAITING only; the removed minutes go back to 'Corsie / fuori zona' (total unchanged)
def patch(path, key):
    d = json.loads(open(path).read().replace("NaN", "null")); m = d[key]
    dept_major = "Coda cassa" in m   # 130 json: {dept: {slot: v}}; 110 json: {slot: {dept: v}}
    def get(name, sl): return m[name][sl] if dept_major else m[sl][name]
    def put(name, sl, v):
        if dept_major: m[name][sl] = round(v, 2)
        else: m[sl][name] = round(v, 2)
    for g, name in [("CHECKOUT_QUEUE", "Coda cassa"), ("CHECKOUT_SERVICE", "Cassa (servizio)")]:
        for sl in [f"{a:02d}-{b:02d}" for a, b in SLOTS] + ["giorno"]:
            if sl == "giorno": new = tot(g, "WAITING") / ENT
            else:
                row = S[(S.roi_group == g) & (S.slot == sl)]; new = float(row.WAITING.iloc[0] / ent[sl]) if len(row) else 0.0
            old = get(name, sl); put(name, sl, new); put("Corsie / fuori zona", sl, get("Corsie / fuori zona", sl) + old - new)
    d["queue_wait_method"] = "150_queue_wait.py: waiting = visits with mean speed < 0.5 m/s, excluding fixed objects (>= 600 s) and their fragments"
    json.dump(d, open(path, "w"), indent=1, default=float); print("patched", path.name, {k: get(k, "giorno") for k in ["Coda cassa", "Cassa (servizio)", "Corsie / fuori zona"]})
patch(out / "110_average_journey.json", "minutes_per_customer_by_department")
patch(out / "130_dashboard_data.json", "minutes")
