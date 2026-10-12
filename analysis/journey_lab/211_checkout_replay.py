#!/usr/bin/env python3
"""211_checkout_replay.py — CASSE MINUTO PER MINUTO: replay della giornata per il lens Service del Windflow.

Stessa definizione di 210_checkout_trust.py (feed grezzo 10 Hz, classi id, visite WAITING/TRANSIT/FIXED come 150_queue_wait)
ma su TUTTA la giornata di apertura, non solo l'ora di picco. Scrive un file piccolo per il browser:
  frontend/public/flowfield/checkouts/<day>.json
    step_s, t0 (epoch ms apertura), lanes [{key, label, lanes[]}],
    q[lane][k] / s[lane][k]  persone in coda / in pagamento all'istante t0 + k*step_s (conteggio di visite WAITING attive)
    series15 (media persone in coda / pagamento per quarto d'ora), peak (ora di picco), sessions [[laneKey, t0_s, dur_s]],
    hist (durata dei pagamenti), coverage_east_m.
Le casse con zone sovrapposte (2-3, 5-6, 7-8) sono date per coppia, come in 210.
Uso: python3 211_checkout_replay.py 2026-09-14
"""
import sys, json, os, math
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import db, geometry as G, roiraster
import numpy as np, pandas as pd
from datetime import datetime
from zoneinfo import ZoneInfo

day = sys.argv[1] if len(sys.argv) > 1 else "2026-09-14"
D = db.day_dir(day); P = db.parquet_path(day)
W = db.local_window_ms(day); o, c = W["open_ms"], W["close_ms"]; tz = ZoneInfo(db.CFG["timezone"])
CFG = db.CFG; PF = CFG["phantom_filter"]; CKF = CFG["checkout_fixed_object"]
WORK = Path(os.environ.get("JL_WORK", Path.home() / "jl_work")); (WORK / "tmp").mkdir(parents=True, exist_ok=True)
con = db.connect(mem=os.environ.get("JL_MEM", "1800MB"), threads=int(os.environ.get("JL_THREADS", "3")), tmp=str(WORK / "tmp"))
con.execute(f"ATTACH '{WORK / f'ck211_{day}.duckdb'}' AS w")
OUTF = Path(os.environ.get("JL_SITE", Path(__file__).resolve().parents[2] / "frontend/public/flowfield/checkouts")); OUTF.mkdir(parents=True, exist_ok=True)
STEP_S = 15
PAIR = {2: "2-3", 3: "2-3", 5: "5-6", 6: "5-6", 7: "7-8", 8: "7-8"}
def pair_of(l): return PAIR.get(int(l), str(int(l)))
def log(*a): print(datetime.now().strftime("%H:%M:%S"), *a, flush=True)
def has(t): return con.execute(f"SELECT count(*) FROM duckdb_tables() WHERE database_name='w' AND table_name='{t}'").fetchone()[0] > 0

rois = G.load_rois(D); cells, _ = roiraster.build(rois)
con.register("cells_df", cells)
con.register("rois_df", rois[["id", "name", "group", "checkout_no"]].rename(columns={"id": "roi_id", "name": "roi_name", "group": "roi_group"}))

if not has("ids"):
    log("A. per-id classes from", P)
    con.execute(f"""CREATE TABLE w.ids AS
    SELECT id, (max(ts)-min(ts))/1000.0 dur_s, max(vx(x,z))-min(vx(x,z)) dx, max(vz(x,z))-min(vz(x,z)) dz
    FROM read_parquet('{P}') WHERE otype='person' GROUP BY id""")
    con.execute(f"""ALTER TABLE w.ids ADD COLUMN cls VARCHAR; UPDATE w.ids SET cls =
      CASE WHEN dur_s < {PF['min_duration_s']} THEN 'FLICKER_SHORT'
           WHEN greatest(dx,dz) < {PF['min_extent_m']} THEN 'PHANTOM_MICRO'
           WHEN dur_s >= {PF['static_duration_s']} AND greatest(dx,dz) <= {PF['static_extent_m']} THEN 'PHANTOM_STATIC'
           WHEN dur_s >= {PF['suspect_duration_s']} AND greatest(dx,dz) <= {PF['suspect_extent_m']} THEN 'STATIC_SUSPECT'
           ELSE 'VALID' END""")
if not has("ckf"):
    log("B. checkout frames")
    con.execute(f"""CREATE TABLE w.ckf AS
    SELECT id, ts, wx, wz, spd, cc.roi_id, cls FROM (
      SELECT r.id, r.ts, vx(x,z) wx, vz(x,z) wz, k.cls,
        sqrt((vx(x,z) - lag(vx(x,z)) OVER win)^2 + (vz(x,z) - lag(vz(x,z)) OVER win)^2) / greatest((ts - lag(ts) OVER win)/1000.0, 0.05) spd
      FROM read_parquet('{P}') r JOIN w.ids k USING (id)
      WHERE k.cls IN ('VALID','STATIC_SUSPECT','PHANTOM_STATIC') AND r.ts >= {o} AND r.ts < {c}
        AND vx(x,z) BETWEEN 48 AND 72 AND vz(x,z) BETWEEN 12 AND 52
      WINDOW win AS (PARTITION BY id ORDER BY ts)) f
    LEFT JOIN cells_df cc ON cc.ci = CAST(floor(wx/{roiraster.CELL}) AS INTEGER) AND cc.cj = CAST(floor(wz/{roiraster.CELL}) AS INTEGER)""")
log("ckf rows", con.execute("SELECT count(*) FROM w.ckf").fetchone()[0])
if not has("visits"):
    log("C. visits")
    FIXED_S, NEAR_M, NEAR_S, SPEED_WALK = CKF["fixed_s"], CKF["near_m"], CKF["near_s"], CKF["speed_walk_mps"]
    con.execute("""CREATE TABLE w.visits AS
    WITH f AS (SELECT f.*, r.roi_group, r.checkout_no lane,
        CASE WHEN f.roi_id IS DISTINCT FROM lag(f.roi_id) OVER (PARTITION BY id ORDER BY ts) OR ts - lag(ts) OVER (PARTITION BY id ORDER BY ts) > 2000 THEN 1 ELSE 0 END brk
      FROM w.ckf f LEFT JOIN rois_df r USING (roi_id) WHERE f.cls IN ('VALID','STATIC_SUSPECT')),
    s AS (SELECT *, sum(brk) OVER (PARTITION BY id ORDER BY ts ROWS UNBOUNDED PRECEDING) run FROM f)
    SELECT id, run, roi_id, roi_group, lane, min(ts) t0, max(ts) t1, (max(ts)-min(ts))/1000.0 + 0.1 dur_s, avg(spd) mean_spd, avg(wx) mx, avg(wz) mz
    FROM s WHERE roi_group IN ('CHECKOUT_QUEUE','CHECKOUT_SERVICE') GROUP BY 1,2,3,4,5""")
    con.execute(f"""CREATE TABLE w.fixed_spots AS
    SELECT mx, mz FROM w.visits WHERE dur_s >= {FIXED_S}
    UNION ALL
    SELECT avg(wx), avg(wz) FROM w.ckf f JOIN rois_df r USING (roi_id)
    WHERE f.cls='PHANTOM_STATIC' AND r.roi_group LIKE 'CHECKOUT%' GROUP BY f.id HAVING count(*)/10.0 >= {FIXED_S}""")
    con.execute(f"""ALTER TABLE w.visits ADD COLUMN vcls VARCHAR; UPDATE w.visits v SET vcls =
      CASE WHEN v.dur_s >= {FIXED_S} OR (v.dur_s >= {NEAR_S} AND EXISTS (SELECT 1 FROM w.fixed_spots s WHERE sqrt((s.mx-v.mx)^2+(s.mz-v.mz)^2) < {NEAR_M})) THEN 'FIXED'
           WHEN v.mean_spd >= {SPEED_WALK} THEN 'TRANSIT' ELSE 'WAITING' END""")
V = con.execute("SELECT * FROM w.visits WHERE vcls='WAITING' AND lane IS NOT NULL").fetchdf()
V["key"] = V.lane.map(pair_of)
log("waiting visits", len(V), V.groupby("roi_group").size().to_dict())

# ---------------------------------------------------------------- replay grid (instantaneous counts every STEP_S)
ts = np.arange(o, c, STEP_S * 1000)
keys = sorted(set(pair_of(l) for l in rois[rois.group.str.startswith("CHECKOUT")].checkout_no.dropna()), key=lambda k: int(k.split("-")[0]))
def counts(df):
    if len(df) == 0: return [0] * len(ts)
    a = ((df.t0.values[None, :] <= ts[:, None]) & (df.t1.values[None, :] >= ts[:, None])).sum(axis=1)
    return [int(x) for x in a]
Q, S = {}, {}
for k in keys:
    Q[k] = counts(V[(V.key == k) & (V.roi_group == "CHECKOUT_QUEUE")])
    S[k] = counts(V[(V.key == k) & (V.roi_group == "CHECKOUT_SERVICE")])

# ---------------------------------------------------------------- 15-min series + peak (same as 210)
BIN = 15 * 60 * 1000; bins = np.arange(o, c, BIN)
def occ(vv, b0, b1):
    ov = np.minimum(vv.t1.values, b1) - np.maximum(vv.t0.values, b0); return float(ov[ov > 0].sum() / 1000.0)
qv, sv = V[V.roi_group == "CHECKOUT_QUEUE"], V[V.roi_group == "CHECKOUT_SERVICE"]
series = [[int((b - o) / 1000), round(occ(qv, b, b + BIN) / 900, 2), round(occ(sv, b, b + BIN) / 900, 2)] for b in bins]
ppl = pd.Series([a + b for _, a, b in series]); roll = ppl.rolling(4).sum().shift(-3); pk = int(roll.idxmax())

# ---------------------------------------------------------------- payment sessions (210 E: WAITING service, runs < 15 s apart merged, >= 10 s)
s2 = sv.sort_values(["id", "roi_id", "t0"]).copy()
s2["new"] = ((s2.id != s2.id.shift()) | (s2.roi_id != s2.roi_id.shift()) | (s2.t0 - s2.t1.shift() > 15000)).astype(int); s2["sid"] = s2.new.cumsum()
SES = s2.groupby("sid").agg(key=("key", "first"), id=("id", "first"), roi_id=("roi_id", "first"), t0=("t0", "min"), t1=("t1", "max")).reset_index()
SES["dur"] = (SES.t1 - SES.t0) / 1000.0 + 0.1; SES = SES[SES.dur >= 10].copy()

# ---------------------------------------------------------------- who paid? (same rule as 210 E, on the whole day)
# Simulated Fidaty instant = when the person is furthest along the lane (max x in the service zone: lanes run west->east).
con.register("ses_df", SES[["sid", "id", "roi_id", "t0", "t1"]])
tp = con.execute("""SELECT s.sid, arg_max(f.ts, f.wx) t_pay, max(f.wx) x_pay FROM ses_df s
  JOIN w.ckf f ON f.id = s.id AND f.roi_id = s.roi_id AND f.ts BETWEEN s.t0 AND s.t1 GROUP BY 1""").fetchdf().set_index("sid")
SES = SES.join(tp, on="sid"); SES["t_pay"] = SES.t_pay.fillna((SES.t0 + SES.t1) // 2).astype("int64")
# Anyone else standing in the same lane (or overlapping pair) at that instant, and how far along they are.
pool = sv[sv.dur_s >= 2][["id", "key", "t0", "t1"]].copy()
con.register("pool_df", pool); con.register("ses_pay", SES[["sid", "id", "key", "t_pay"]])
oth = con.execute("""SELECT s.sid, p.id oid, avg(f.wx) ox FROM ses_pay s
   JOIN pool_df p ON p.key = s.key AND p.id <> s.id AND p.t0 <= s.t_pay AND p.t1 >= s.t_pay
   JOIN w.ckf f ON f.id = p.id AND f.ts BETWEEN s.t_pay - 700 AND s.t_pay + 700 GROUP BY 1, 2""").fetchdf()
SES["others"] = SES.sid.map(oth.groupby("sid").oid.nunique()).fillna(0).astype(int)
SES["margin"] = SES.x_pay - SES.sid.map(oth.groupby("sid").ox.max())
MARGIN = 0.8
# 0 = certain (alone, or clearly nearest the terminal), 2 = risky (someone else clearly nearer), 1 = uncertain
SES["match"] = np.where(SES.margin.isna() | (SES.margin >= MARGIN), 0, np.where(SES.margin <= -MARGIN, 2, 1))
# Queue just before, same id and same lane (or pair), ending within 3 minutes of reaching the till.
qq = qv[["id", "key", "t0", "t1"]].rename(columns={"t0": "t0_q", "t1": "t1_q"})
qm = SES[["sid", "id", "key", "t0"]].merge(qq, on=["id", "key"])
qm = qm[(qm.t1_q <= qm.t0 + 2000) & (qm.t1_q >= qm.t0 - 180000)]
SES["q_from"] = SES.sid.map(qm.groupby("sid").t0_q.min())
# How long this LiDAR id had been seen before the till (trajectories break up: usually seconds).
con.register("ids_need", pd.DataFrame({"id": SES.id.unique()}))
born = con.execute(f"SELECT r.id, min(r.ts) b FROM read_parquet('{P}') r SEMI JOIN ids_need USING (id) GROUP BY 1").fetchdf().set_index("id").b
SES["before_s"] = ((SES.t0 - SES.id.map(born)) / 1000).clip(lower=0).fillna(0)
# Route on the floor for that id: from the start of its queue (or 60 s before the till) to leaving the till, every 2 s.
SES["p0"] = SES.q_from.fillna(SES.t0 - 60000).astype("int64")
con.register("ses_path", SES[["sid", "id", "p0", "t1"]])
pts = con.execute("""SELECT s.sid, (f.ts // 2000) b, round(avg(f.wx), 1) x, round(avg(f.wz), 1) z FROM ses_path s
  JOIN w.ckf f ON f.id = s.id AND f.ts BETWEEN s.p0 AND s.t1 GROUP BY 1, 2 ORDER BY 1, 2""").fetchdf()
paths = {sid: [v for xz in zip(g.x, g.z) for v in xz] for sid, g in pts.groupby("sid")}
log("payments", len(SES), "match certain/uncertain/risky", SES.match.value_counts().sort_index().to_dict())
edges = [10, 20, 30, 45, 60, 90, 120, 180, 240, 1e9]
hist = np.histogram(SES.dur.clip(upper=1e8), bins=edges)[0].tolist()
lanes_meta = []
for k in keys:
    nums = sorted(int(n) for n in rois[rois.checkout_no.notna()].checkout_no.unique() if pair_of(n) == k)
    ss = SES[SES.key == k]
    lanes_meta.append({"key": k, "label": ("Lanes " if "-" in k else "Lane ") + k.replace("-", "–"), "lanes": nums,
                       "sessions": int(len(ss)), "median_s": round(float(ss.dur.median()), 1) if len(ss) else None})
res = {"day": day, "source": "raw 10 Hz LiDAR (vendor parquet), 211_checkout_replay.py", "t0": int(o), "t1": int(c), "step_s": STEP_S,
       "tz": db.CFG["timezone"], "lanes": lanes_meta, "q": Q, "s": S, "series15": series,
       "peak": {"from_s": int((bins[pk] - o) / 1000), "to_s": int((bins[pk] - o) / 1000) + 3600, "mean_people": round(float(roll.iloc[pk] / 4), 2)},
       "sessions": [[r.key, int((r.t0 - o) / 1000), round(float(r.dur), 1)] for r in SES.sort_values("t0").itertuples()],
       "hist": {"edges_s": edges[:-1], "counts": hist},
       # One row per payment: [laneKey, t0_s, dur_s, t_pay_s, match(0 certain|1 uncertain|2 risky), queue_from_s|null,
       #   seen_before_till_s, others_at_till, lidar_id, path [x,z,x,z… every 2 s from queue start to leaving the till]]
       "payments": [[r.key, int((r.t0 - o) / 1000), round(float(r.dur), 1), int((r.t_pay - o) / 1000), int(r.match),
                     (int((r.q_from - o) / 1000) if pd.notna(r.q_from) else None), int(r.before_s), int(r.others), str(r.id), paths.get(r.sid, [])]
                    for r in SES.sort_values("t0").itertuples()],
       "match_rule": "Simulated Fidaty instant = when the person is furthest along the lane. Certain: nobody else in that lane (or overlapping pair), or this person is at least 0.8 m nearer the terminal. Risky: someone else is at least 0.8 m nearer. Uncertain: in between.", "median_s": round(float(SES.dur.median()), 1), "n_sessions": int(len(SES)),
       "pairs_note": "Lanes 2-3, 5-6 and 7-8 have overlapping zones in the twin and are reported as pairs.",
       "coverage_east_m": 67.0,
       "definition": "Queuing / paying = a WAITING visit (mean speed < 0.5 m/s, not a fixed object) in a checkout queue / service zone. Payment session = WAITING service visit >= 10 s."}
(OUTF / f"{day}.json").write_text(json.dumps(res, separators=(",", ":")))
idx = OUTF / "index.json"; ix = json.loads(idx.read_text()) if idx.exists() else {"days": []}
ix["days"] = sorted(set(ix["days"]) | {day}); idx.write_text(json.dumps(ix))
log("wrote", OUTF / f"{day}.json", "sessions", len(SES), "median", res["median_s"], "peak", res["peak"])
