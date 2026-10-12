#!/usr/bin/env python3
"""KINETIC STATES — how people move, from the raw 10 Hz LiDAR (not where they are).

Same movement features as the live Profit Radar scorer (backend/services/profit-radar/intentScorer.js:
extractFeatures): mean speed, share of time still (< 0.1 m/s), share of micro-movement (0.02–0.15 m/s),
straightness, U-turns (heading change > 120°), revisits (0.5 m grid). Here they are computed offline on
1-second steps (10 Hz averaged per second, to remove sensor jitter) inside 5-second windows, per vendor id.

Cleaning (as 41/160): ids classed VALID or STATIC_SUSPECT on their whole life (phantom_filter thresholds);
ids parked >= 600 s in one 1 m cell (fixed objects) and their fragments within 1 m (>= 60 s) dropped;
samples inside staff strips dropped. Store hours only.

Six states, first match wins (place from 220_place_05m.csv = the 199 department raster + checkout ROIs):
  wait      in a queue / till ROI below 0.5 m/s (as 150: walk-through excluded), or still-ish >= 60 % at a served counter
  choose    still-ish >= 60 %, within 1 m of a shelf face (the 199 "al banco" band)
  pause     still-ish >= 60 %, anywhere else (standing in the aisle)
  hesitate  at least one U-turn, or path >= 1.5 m over <= half as many 0.5 m cells as steps (circling)
  transit   mean speed >= 0.7 m/s and straightness >= 0.8
  browse    everything else (moving slowly, curving)
still-ish = 1 s displacement < 0.15 m (still + micro-movement).

Outputs out/<day>/220_kinetic_states.json (store / slot / department / lane mixes, validation against 199 and 150)
and out/<day>/220_kinetic_cells.json (per 1.5 m flow cell and slice: seconds per state), same grid as the flow packs.
"""
import json, math, sys, time
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import duckdb

ROOT = Path(__file__).resolve().parent
day = sys.argv[1] if len(sys.argv) > 1 else "2026-09-14"
CFG = json.load(open(ROOT / "config" / "treviglio.json"))
import os
# Server runs (Windflow day job) pass the raw parquet and the lab output folder explicitly.
OUT = Path(os.environ.get("JL_OUT", ROOT / "out")) / day
DATA = Path(os.environ.get("JL_DATA", ROOT / "data")) / day
PARQ = Path(os.environ["JL_PARQUET"]) if os.environ.get("JL_PARQUET") else DATA / f"hyperspace-raw-{day}.parquet"
if not PARQ.exists():
    PARQ = str(DATA / "raw_part*.parquet")
ANCHOR = json.load(open(ROOT.parents[1] / "backend" / "assets" / "flowfield" / "layout_anchor.json"))
STATES = ["transit", "browse", "choose", "pause", "hesitate", "wait"]
SLOTS = ["08-10", "10-12", "12-14", "14-16", "16-18", "18-20"]

tz = ZoneInfo(CFG["timezone"])
h0, h1 = CFG.get("store_hours_local", ["08:00", "20:00"])
OPEN = int(datetime.fromisoformat(f"{day}T{h0}:00").replace(tzinfo=tz).timestamp() * 1000)
CLOSE = int(datetime.fromisoformat(f"{day}T{h1}:00").replace(tzinfo=tz).timestamp() * 1000)
PF = CFG["phantom_filter"]
t = CFG["perception_transform"]
ysign = -1.0 if t["input_frame"] == "ros_rep103" else 1.0
rad = math.radians(t["rotation_deg"]); C, S = math.cos(rad), math.sin(rad)
SC = float(t.get("scale", 1) or 1); OX, OZ = t["origin_m"]["x"], t["origin_m"]["z"]
CELL = float(ANCHOR.get("cell_m", 1.5))
GX0 = math.floor((ANCHOR["bbox"]["minX"] - 2) / CELL) * CELL
GZ0 = math.floor((ANCHOR["bbox"]["minZ"] - 2) / CELL) * CELL
STRIPS = json.load(open(OUT / "160_staff.json"))["staff_strips"]

t0 = time.time()
import os
TMP = Path(os.environ.get("KIN_TMP", Path.home() / "duckdb_tmp")); TMP.mkdir(parents=True, exist_ok=True)
DB = Path(os.environ.get("KIN_DB", Path.home() / f"kin_{day}.duckdb"))
con = duckdb.connect(str(DB))  # persistent: the job is resumable stage by stage (each stage is skipped when its table exists)
con.execute("SET threads TO 4")
con.execute(f"SET temp_directory = '{TMP}'")
con.execute("SET preserve_insertion_order = false")
con.execute(f"CREATE OR REPLACE MACRO vx(px, pz) AS ((px*{SC})*{C} - (({ysign})*pz*{SC})*{S}) + {OX}")
con.execute(f"CREATE OR REPLACE MACRO vz(px, pz) AS ((px*{SC})*{S} + (({ysign})*pz*{SC})*{C}) + {OZ}")
def stage(name, sql):
    if con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = ?", [name]).fetchone()[0]:
        return
    t1 = time.time()
    con.execute(f"CREATE TABLE {name}_tmp AS {sql}")
    con.execute(f"ALTER TABLE {name}_tmp RENAME TO {name}")
    con.execute("CHECKPOINT")
    print(f"  stage {name}: {time.time()-t1:.0f}s", flush=True)

for leftover in [r[0] for r in con.execute("SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%_tmp'").fetchall()]:
    con.execute(f"DROP TABLE {leftover}")
strip_sql = " OR ".join(f"(x BETWEEN {s['x0']} AND {s['x1']} AND z BETWEEN {s['z0']} AND {s['z1']})" for s in STRIPS) or "FALSE"

# 1. store-hours samples in venue metres
stage("p", f"""SELECT id, ts, vx(x,z) x, vz(x,z) z FROM read_parquet('{PARQ}')
  WHERE ts >= {OPEN} AND ts < {CLOSE} AND otype = 'person'""")
# 2. id classes on the whole life (41)
# whole-life id stats, in 8 id buckets so each stage stays short on a small machine
for k in range(8):
    stage(f"idc{k}", f"""WITH s AS (
   SELECT id, ts, x, z, sqrt((x-lag(x) OVER w)^2 + (z-lag(z) OVER w)^2) d, (ts-lag(ts) OVER w)/1000.0 dt
   FROM p WHERE hash(id) % 8 = {k} WINDOW w AS (PARTITION BY id ORDER BY ts))
 SELECT id, (max(ts)-min(ts))/1000.0 dur_s, greatest(max(x)-min(x), max(z)-min(z)) extent_m, coalesce(sum(d),0) path_m,
        median(CASE WHEN dt > 0 THEN d/dt END) med_spd FROM s GROUP BY id""")
stage("idc", " UNION ALL ".join(f"SELECT * FROM idc{k}" for k in range(8)))
stage("keep", f"""SELECT id FROM idc WHERE NOT (
   (dur_s >= {PF['static_duration_s']} AND extent_m < {PF['static_extent_m']})
   OR (path_m < {PF['min_path_m']} AND extent_m < {PF['min_extent_m']})
   OR dur_s < {PF['min_duration_s']} OR coalesce(med_spd,0) > {PF['max_median_speed_m_s']})""")
# 3. fixed objects (160): >= 600 s in a 1 m cell, and fragments >= 60 s within 1 m of such cells
stage("fixed", """SELECT id, ci, cj FROM (SELECT id, floor(x)::INT ci, floor(z)::INT cj, count(*) n FROM p JOIN keep USING(id) GROUP BY 1,2,3) WHERE n >= 6000""")
stage("fixnb", """SELECT DISTINCT f.ci + a ci, f.cj + b cj FROM fixed f, range(-1, 2) r1(a), range(-1, 2) r2(b)""")
stage("frag", """SELECT p.id FROM p JOIN keep USING(id) JOIN fixnb nb ON nb.ci = floor(p.x)::INT AND nb.cj = floor(p.z)::INT
  GROUP BY p.id HAVING count(*) >= 600""")
stage("q", f"""SELECT p.* FROM p JOIN keep USING(id)
  WHERE id NOT IN (SELECT id FROM fixed) AND id NOT IN (SELECT id FROM frag) AND NOT ({strip_sql})""")
kept = con.execute("SELECT count(DISTINCT id), count(*) FROM q").fetchone()
print(f"kept ids {kept[0]:,}, samples {kept[1]:,}  ({time.time()-t0:.0f}s)", flush=True)

# 4. 1-second steps
stage("sec", """SELECT id, (ts // 1000) s, avg(x) x, avg(z) z FROM q GROUP BY 1,2""")
stage("st", """SELECT id, s, x, z, (s // 5) w,
   x - lag(x) OVER v dx, z - lag(z) OVER v dz, s - lag(s) OVER v ds
  FROM sec WINDOW v AS (PARTITION BY id ORDER BY s)""")
stage("st2", """SELECT *, sqrt(dx*dx+dz*dz) d,
   CASE WHEN sqrt(dx*dx+dz*dz) >= 0.2 THEN atan2(dz, dx) END hd FROM st WHERE ds = 1""")
stage("st3", """SELECT *, hd - lag(hd) OVER v dh FROM st2 WINDOW v AS (PARTITION BY id, w ORDER BY s)""")
# 5. windows (>= 3 one-second steps)
stage("win", """SELECT id, w, count(*) n, min(s) s0, avg(x) mx, avg(z) mz, sum(d) path,
   sum(d)/count(*) spd,
   avg(CASE WHEN d < 0.15 THEN 1.0 ELSE 0.0 END) still,
   sum(CASE WHEN dh IS NOT NULL AND abs(atan2(sin(dh), cos(dh))) > 2.0944 THEN 1 ELSE 0 END) uturns,
   count(DISTINCT (floor(x/0.5)::INT * 1000 + floor(z/0.5)::INT)) cells05,
   sqrt((arg_max(x, s) - arg_min(x, s))^2 + (arg_max(z, s) - arg_min(z, s))^2) disp
  FROM st3 GROUP BY id, w HAVING count(*) >= 3""")
# 0.5 m place raster (199 department areas + shelf band + served counters). The store layout is the same
# every day, so a day without its own copy uses the reference raster kept with the config.
PLACE = OUT / "220_place_05m.csv"
if not PLACE.exists():
    PLACE = ROOT / "config" / "treviglio_place_05m.csv"
stage("place", f"SELECT * FROM read_csv('{PLACE}', header=true)")
# checkout ROIs exactly as 150 (same polygons, same 0.2 m raster, same lane numbers)
if not con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = 'ckc'").fetchone()[0]:
    sys.path.insert(0, str(ROOT / "lib"))
    import db as jldb, geometry as G, roiraster
    rc, _ = roiraster.build(G.load_rois(jldb.day_dir(day)))
    rc = rc[rc.roi_group.isin(["CHECKOUT_QUEUE", "CHECKOUT_SERVICE"])].copy()
    rc["lane"] = rc.roi_name.str.extract(r"Checkout (\d+)")[0].astype("Int64")
    rc = rc[["ci", "cj", "roi_group", "lane"]]
    con.register("rc_df", rc); con.execute("CREATE TABLE ckc AS SELECT * FROM rc_df")

stage("ws", f"""SELECT * EXCLUDE (place0, lane0, ck_group, ck_lane),
   CASE WHEN ck_group = 'CHECKOUT_QUEUE' THEN 2 WHEN ck_group = 'CHECKOUT_SERVICE' THEN 3 WHEN place0 IN (2, 3) THEN 0 ELSE place0 END place,
   coalesce(ck_lane, CASE WHEN place0 IN (2, 3) THEN NULL ELSE lane0 END) lane FROM (SELECT win.*, pl.place place0, pl.lane lane0, pl.dept, ck.roi_group ck_group, ck.lane ck_lane,
   CASE
     WHEN ck.roi_group IS NOT NULL AND spd < 0.5 THEN 'wait'          -- queue / till: as 150, everything but walk-through (>= 0.5 m/s)
     WHEN still >= 0.6 AND pl.place = 4 THEN 'wait'
     WHEN still >= 0.6 AND pl.place = 1 THEN 'choose'
     WHEN still >= 0.6 THEN 'pause'
     WHEN uturns >= 1 OR (path >= 1.5 AND cells05 <= n / 2.0) THEN 'hesitate'
     WHEN spd >= 0.7 AND disp / greatest(path, 0.01) >= 0.8 THEN 'transit'
     ELSE 'browse' END state,
   floor((mx - {GX0}) / {CELL})::INT i, floor((mz - {GZ0}) / {CELL})::INT j,
   ((s0 * 1000 - {OPEN}) // 7200000)::INT slot_ix
  FROM win LEFT JOIN place pl ON pl.ci = floor(mx / 0.5)::INT AND pl.cj = floor(mz / 0.5)::INT
  LEFT JOIN ckc ck ON ck.ci = floor(mx / 0.2)::INT AND ck.cj = floor(mz / 0.2)::INT)""")
nwin = con.execute("SELECT count(*), sum(n) FROM ws").fetchone()
print(f"windows {nwin[0]:,} ({nwin[1]/3600:.0f} person-hours)  ({time.time()-t0:.0f}s)", flush=True)

def mix(where="TRUE", by=None):
    cols = f"{by}, " if by else ""
    rows = con.execute(f"SELECT {cols}state, sum(n) sec FROM ws WHERE {where} GROUP BY {cols}state").fetchall()
    out = {}
    for r in rows:
        key = r[0] if by else "all"
        out.setdefault(key, {s: 0 for s in STATES})[r[-2]] = int(r[-1])
    return out

store = mix()["all"]
by_slot = {SLOTS[k]: v for k, v in mix("slot_ix BETWEEN 0 AND 5", "slot_ix").items()}
by_dept = mix("dept IS NOT NULL", "dept")
by_dept_slot = {}
for (dept, k, state, sec) in con.execute("SELECT dept, slot_ix, state, sum(n) FROM ws WHERE slot_ix BETWEEN 0 AND 5 GROUP BY 1,2,3").fetchall():
    by_dept_slot.setdefault(dept, {}).setdefault(SLOTS[k], {s: 0 for s in STATES})[state] = int(sec)
by_lane = {int(k): v for k, v in mix("lane > 0 AND place = 2", "lane").items()}
uturn_rate = {d: round(r, 3) for d, r in con.execute("SELECT dept, sum(uturns) / (sum(n)/60.0) FROM ws WHERE dept IS NOT NULL GROUP BY dept").fetchall()}
speed = {d: round(v, 3) for d, v in con.execute("SELECT dept, sum(path)/sum(n) FROM ws WHERE dept IS NOT NULL GROUP BY dept").fetchall()}

# validation against audited KPIs
val = {}
d199 = json.load(open(OUT / "199_department_areas.json"))
ent = d199["entrances"]["giorno"]
banco_pm = {d: v["al_banco"] * ent for d, v in d199["kpi"]["giorno"].items() if isinstance(v, dict)}
choose_pm = {d: (by_dept.get(d, {}).get("choose", 0) + by_dept.get(d, {}).get("wait", 0)) / 60 for d in banco_pm}
import statistics
xs = [banco_pm[d] for d in banco_pm if d in by_dept]; ys = [choose_pm[d] for d in banco_pm if d in by_dept]
def pearson(a, b):
    ma, mb = statistics.mean(a), statistics.mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b)); den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return num / den if den else None
val["choose_vs_al_banco_r"] = round(pearson(xs, ys), 3) if len(xs) > 2 else None
val["choose_vs_al_banco"] = {d: {"al_banco_pm": round(banco_pm[d], 1), "choose_wait_pm": round(choose_pm[d], 1)} for d in banco_pm if d in by_dept}
d150 = json.load(open(OUT / "150_queue_wait.json"))
lane_wait = {int(l["lane"]): l["WAITING"] for l in d150["per_lane"] if l["roi_group"] == "CHECKOUT_QUEUE"}
wait_lane = {l: by_lane.get(l, {}).get("wait", 0) / 60 for l in lane_wait}
val["wait_vs_queue_waiting_r"] = round(pearson([lane_wait[l] for l in lane_wait], [wait_lane[l] for l in lane_wait]), 3)
val["wait_vs_queue_waiting"] = {l: {"waiting_pm_150": round(lane_wait[l], 1), "wait_pm_220": round(wait_lane[l], 1)} for l in lane_wait}

summary = {"day": day, "method": __doc__.strip().split("\n\n")[1].replace("\n", " "), "states": STATES,
           "windows": nwin[0], "person_hours": round(nwin[1] / 3600, 1), "kept_ids": kept[0],
           "store": store, "by_slot": by_slot, "by_dept": by_dept, "by_dept_slot": by_dept_slot, "by_lane": by_lane,
           "uturns_per_min_by_dept": uturn_rate, "speed_m_s_by_dept": speed, "validation": val}
json.dump(summary, open(OUT / "220_kinetic_states.json", "w"), indent=1)

# per flow cell, per slice (trading + 2-hour slots)
cells = {}
for (k, i, j, state, sec) in con.execute("SELECT slot_ix, i, j, state, sum(n) FROM ws WHERE slot_ix BETWEEN 0 AND 5 GROUP BY 1,2,3,4").fetchall():
    for sl in ("trading", f"h{SLOTS[k].replace('-', '_')}"):
        c = cells.setdefault(sl, {}).setdefault(f"{i},{j}", [0] * len(STATES))
        c[STATES.index(state)] += int(sec)
packs = {sl: {"meta": {"day": day, "slice": sl, "cell_m": CELL, "origin_m": {"x": GX0, "y": GZ0}, "states": STATES, "unit": "person-seconds"},
              "cells": [{"i": int(k.split(",")[0]), "j": int(k.split(",")[1]), "s": v} for k, v in c.items()]} for sl, c in cells.items()}
json.dump(packs, open(OUT / "220_kinetic_cells.json", "w"))
print(json.dumps({"store_share": {s: round(store[s] / sum(store.values()), 3) for s in STATES}, "validation_r": {k: v for k, v in val.items() if k.endswith("_r")}}, indent=1))
print(f"done in {time.time()-t0:.0f}s")
