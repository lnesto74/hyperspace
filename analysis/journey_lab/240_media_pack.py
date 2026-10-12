#!/usr/bin/env python3
"""240_media_pack.py — Media lens pack: digital totems, audience, placement, ON/OFF test, CPM.

REAL (from LiDAR per-second rows, 230_flow_rows.py):
  * audience per totem face per 15' (impressions >= 2 s in view, qualified AQS >= 50, premium >= 70)
  * placement search: every free floor spot scored by the people walking TOWARD a face (two-sided totem)
    with line of sight, times closeness to the product's department; current spots are kept when they
    reach 70% of the best spot, otherwise moved (auto-reposition)
  * department traffic and shelf stops per 15' (people slowing below 0.25 m/s for >= 4 s in the department)
  * near-screen behaviour of each impression (dwell, slowdown) — an A/A check while the spot is simulated
DEMO (clearly flagged, deterministic seeds):
  * playlists with one planogram product per totem, ON/OFF flighting per 15' (one ON + one OFF every 30')
  * proof-of-play log (60 s loop: product spot 15 s + house spot 45 s when ON)
  * Esselunga sales per 15' for the advertised SKU and a control SKU of the same shelf (planted lift)
Outputs <MEDIA_SITE>/<day>.json and <MEDIA_SITE>/index.json.

Uso: python3 240_media_pack.py <day> [flow_rows.csv.gz]
"""
import sys, os, json, math, gzip
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import numpy as np
import pandas as pd
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union
from shapely import contains_xy

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
FF = REPO / "frontend/public/flowfield"
day = sys.argv[1] if len(sys.argv) > 1 else "2026-09-14"
rows_path = Path(sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser(f"~/jl_work/flow_rows_{day}.csv.gz"))
SITE = Path(os.environ.get("MEDIA_SITE", FF / "media")); SITE.mkdir(parents=True, exist_ok=True)
tz = ZoneInfo("Europe/Rome")
day0 = int(datetime.fromisoformat(f"{day}T00:00:00").replace(tzinfo=tz).timestamp())
T0, T1, SLOT = 7 * 3600, 22 * 3600, 900
NS = (T1 - T0) // SLOT  # 60 slots of 15'

# ---------- geometry -------------------------------------------------------------------------
layout = json.load(open(FF / "layout_prod.json"))
bb = layout["bbox"]
obst = unary_union([Polygon(p).buffer(0) for p in layout["polys"] if len(p) >= 3])
R = 0.25
ox, oz = math.floor(bb["minX"]) - 2, math.floor(bb["minZ"]) - 2
nx, nz = int((bb["maxX"] + 2 - ox) / R) + 1, int((bb["maxZ"] + 2 - oz) / R) + 1
gx, gz = np.meshgrid(ox + (np.arange(nx) + .5) * R, oz + (np.arange(nz) + .5) * R, indexing="ij")
BLOCK = contains_xy(obst, gx, gz)                      # fine obstacle raster (shelves block sight)

areas = json.load(open(FF / "visitor-areas.json"))
def mpoly(parts): return unary_union([Polygon(a["outer"], a.get("holes") or []).buffer(0) for a in parts])
DEPT = {d["id"]: mpoly(d["area"]) for d in areas["departments"]}
LANES = unary_union([mpoly(l["queue"] + l["service"]) for l in areas["lanes"]]).buffer(2.5)

pack = json.load(open(FF / "layers_pack.json"))
SCREENS = pack["screens"]

# Two planogram products (Esselunga-Treviglio planogram, sku_items catalogue) + same-shelf controls.
PRODUCTS = [
    {"sku": "ESS-100031", "brand": "Esselunga Equilibrio", "name": "Biscotti", "size": "800 g",
     "category": "Bakery & Breakfast", "dept": "Bakery & Breakfast",
     "control": {"sku": "ESS-100029", "brand": "Esselunga", "name": "Biscotti", "size": "500 g"},
     "spot": "Equilibrio · la colazione leggera", "price": 2.49, "units_day": 95, "viewer_lift": 0.12},
    {"sku": "ESS-100271", "brand": "Esselunga", "name": "Yogurt", "size": "2 x 125 g",
     "category": "Dairy & Eggs", "dept": "Latticini",
     "control": {"sku": "ESS-100272", "brand": "Esselunga", "name": "Yogurt", "size": "300 g"},
     "spot": "Yogurt Esselunga · fresco ogni giorno", "price": 1.19, "units_day": 150, "viewer_lift": 0.08},
]
HOUSE = {"id": "house", "name": "Esselunga nutre un sogno · Milano Cortina 2026", "duration_s": 45, "existing": True}

# ---------- rows ------------------------------------------------------------------------------
df = pd.read_csv(rows_path)
df.columns = ["id", "ts", "x", "z"]
df["t"] = (df.ts // 1000 - day0).astype(np.int32)
df = df[(df.t >= T0) & (df.t < T1)].sort_values(["id", "t"]).reset_index(drop=True)
same = df.id.values[1:] == df.id.values[:-1]
dt = np.diff(df.t.values).astype(float)
vx = np.where(same & (dt <= 2), np.diff(df.x.values) / np.maximum(dt, 1), np.nan)
vz = np.where(same & (dt <= 2), np.diff(df.z.values) / np.maximum(dt, 1), np.nan)
df["vx"] = np.append(vx, np.nan); df["vz"] = np.append(vz, np.nan)
# carry the previous velocity onto the last row of each id
prev_ok = np.insert(same, 0, False)
df.loc[df.vx.isna() & prev_ok, "vx"] = df.vx.shift(1); df.loc[df.vz.isna() & prev_ok, "vz"] = df.vz.shift(1)
df = df.dropna(subset=["vx"]).reset_index(drop=True)
df["sp"] = np.hypot(df.vx, df.vz)
df["slot"] = ((df.t - T0) // SLOT).astype(int)
print(f"240 {day}: {len(df)} rows, {df.id.nunique()} ids")

# coarse 0.5 m grid with heading bins for the placement search
C = 0.5
cx_n, cz_n = int((nx * R) / C) + 1, int((nz * R) / C) + 1
ci = ((df.x.values - ox) / C).astype(int).clip(0, cx_n - 1)
cj = ((df.z.values - oz) / C).astype(int).clip(0, cz_n - 1)
moving = df.sp.values > 0.15
hb = np.where(moving, ((np.arctan2(df.vz.values, df.vx.values) + np.pi) / (2 * np.pi) * 8).astype(int) % 8, 8)
H = np.zeros((cx_n, cz_n, 9), np.float32)
np.add.at(H, (ci, cj, hb), 1.0)
HB_ANG = -np.pi + (np.arange(8) + .5) * 2 * np.pi / 8
HB_VEC = np.stack([np.cos(HB_ANG), np.sin(HB_ANG)], 1)
DENS = H.sum(2)

def fine(x, z):
    i = np.clip(((np.asarray(x) - ox) / R).astype(int), 0, nx - 1); j = np.clip(((np.asarray(z) - oz) / R).astype(int), 0, nz - 1)
    return i, j

def los(px, pz, qx, qz):
    """line of sight from points q to (px,pz) at eye level: no shelf cell on the segment (ends excluded)."""
    qx, qz = np.asarray(qx, float), np.asarray(qz, float)
    d = np.hypot(qx - px, qz - pz); n = np.maximum(2, (d / 0.2).astype(int))
    ok = np.ones(len(qx), bool)
    for k in range(1, int(n.max())):
        f = np.minimum(k / n, 1.0)
        live = k < n
        i, j = fine(px + (qx - px) * f, pz + (qz - pz) * f)
        ok &= ~(BLOCK[i, j] & live & (f > 0.06))
    return ok

FACE_R0, FACE_R1, FACE_HALF = 0.8, 6.0, math.radians(55)
def normal(yaw_deg): a = math.radians(yaw_deg); return np.array([math.sin(a), math.cos(a)])

# cone cells (coarse) around a point, with LOS — reused for scoring and drawing
ring = np.array([(a, b) for a in range(-13, 14) for b in range(-13, 14) if FACE_R0 <= math.hypot(a * C, b * C) <= FACE_R1])
_BASE = {}
def _base(px, pz):
    key = (round(px, 2), round(pz, 2))
    if key not in _BASE:
        i0, j0 = int((px - ox) / C), int((pz - oz) / C)
        ii, jj = i0 + ring[:, 0], j0 + ring[:, 1]
        m = (ii >= 0) & (ii < cx_n) & (jj >= 0) & (jj < cz_n)
        ii, jj = ii[m], jj[m]
        qx, qz = ox + (ii + .5) * C, oz + (jj + .5) * C
        rel = np.stack([qx - px, qz - pz], 1); dist = np.hypot(rel[:, 0], rel[:, 1])
        fi, fj = fine(qx, qz)
        vis = ~BLOCK[fi, fj] & los(px, pz, qx, qz)
        _BASE[key] = (ii, jj, qx, qz, rel, dist, vis)
    return _BASE[key]

def cone_cells(px, pz, yaw):
    ii, jj, qx, qz, rel, dist, vis = _base(px, pz)
    out = []
    for s in (1, -1):
        n = normal(yaw) * s
        cosang = (rel @ n) / dist
        f = vis & (cosang >= math.cos(FACE_HALF))
        out.append((ii[f], jj[f], qx[f], qz[f], rel[f] / dist[f, None], dist[f]))
    return out

def ots(px, pz, yaw):
    """person-seconds walking toward a face (or standing) inside the visible cones, distance weighted."""
    tot = 0.0
    for ii, jj, qx, qz, u, d in cone_cells(px, pz, yaw):
        if not len(ii): continue
        toward = (-u) @ HB_VEC.T                                  # heading bins pointing to the screen
        w = np.clip((toward - math.cos(math.radians(70))) / (1 - math.cos(math.radians(70))), 0, 1)
        h = H[ii, jj, :8]
        dw = np.where(d <= 3, 1.0, 1.0 - (d - 3) / 6)
        tot += float(((h * w).sum(1) + 0.4 * H[ii, jj, 8]) @ dw)
    return tot

def fits(px, pz):
    """free footprint (0.8 x 0.5 m base + 0.3 m margin), near a fixture, not in the checkout zone, open aisle."""
    i, j = fine(px, pz)
    k = int(0.55 / R)
    if BLOCK[max(0, i - k):i + k + 1, max(0, j - k):j + k + 1].any(): return False
    if LANES.contains(Point(px, pz)): return False
    k2 = int(1.75 / R)
    win = BLOCK[max(0, i - k2):i + k2 + 1, max(0, j - k2):j + k2 + 1]
    if win.mean() > 0.42: return False                         # would choke a narrow aisle
    k3 = int(1.5 / R)
    if not BLOCK[max(0, i - k3):i + k3 + 1, max(0, j - k3):j + k3 + 1].any(): return False  # stands by a fixture
    ci_, cj_ = int((px - ox) / C), int((pz - oz) / C)
    return DENS[max(0, ci_ - 2):ci_ + 3, max(0, cj_ - 2):cj_ + 3].sum() > 60  # observed walking space

def near(dept, px, pz):
    d = DEPT[dept].distance(Point(px, pz))
    return d, (1.0 if d <= 4 else max(0.25, math.exp(-(d - 4) / 10)))

# ---------- placement -------------------------------------------------------------------------
cands = []
for x in np.arange(bb["minX"] + 1, bb["maxX"] - 1, 1.0):
    for z in np.arange(bb["minZ"] + 1, bb["maxZ"] - 1, 1.0):
        if fits(x, z): cands.append((float(x), float(z)))
print(f"  {len(cands)} candidate spots")
scored = []
for x, z in cands:
    best = max(((ots(x, z, y), y) for y in (0, 45, 90, 135)))
    scored.append((x, z, best[1], best[0]))
scored.sort(key=lambda r: -r[3])

placed, totems = [], []
for k, scr in enumerate(SCREENS):
    prod = PRODUCTS[k % len(PRODUCTS)]
    cur_ots = ots(scr["x"], scr["z"], scr["yawDeg"])
    cur_d, cur_f = near(prod["dept"], scr["x"], scr["z"])
    pool = [(x, z, y, o, *near(prod["dept"], x, z)) for x, z, y, o in scored[:900]
            if all(math.hypot(x - a, z - b) >= 10 for a, b in placed)]
    pool = [(x, z, y, o, d, f, o * f) for x, z, y, o, d, f in pool]
    pool.sort(key=lambda r: -r[6])
    bx, bz, by, bo, bd, bf, bs = pool[0]
    cur_s = cur_ots * cur_f
    move = cur_s < 0.7 * bs
    px, pz, pyaw = (bx, bz, by) if move else (scr["x"], scr["z"], scr["yawDeg"])
    placed.append((px, pz))
    reason = (f"moved: the current spot reaches {cur_s / bs:.0%} of the best spot for {prod['dept']} "
              f"({cur_ots:,.0f} vs {bo:,.0f} person-seconds facing a screen, {cur_d:.0f} m vs {bd:.0f} m from the shelf)"
              if move else f"kept: the current spot reaches {cur_s / bs:.0%} of the best spot")
    totems.append({"id": scr["id"], "name": scr["name"], "product": k % len(PRODUCTS),
                   "original": {"x": scr["x"], "z": scr["z"], "yaw": scr["yawDeg"], "ots": round(cur_ots), "deptDist": round(cur_d, 1)},
                   "placed": {"x": round(px, 2), "z": round(pz, 2), "yaw": pyaw, "ots": round(bo if move else cur_ots),
                              "deptDist": round(bd if move else cur_d, 1)},
                   "moved": bool(move), "reason": reason,
                   "candidates": [[round(x, 1), round(z, 1), y, round(s)] for x, z, y, o, d, f, s in pool[:40]]})
    print(" ", scr["name"], "->", reason)

# ---------- audience (real) -------------------------------------------------------------------
def audience(tt):
    px, pz, yaw = tt["placed"]["x"], tt["placed"]["z"], tt["placed"]["yaw"]
    near_rows = df[(np.abs(df.x - px) < FACE_R1 + .5) & (np.abs(df.z - pz) < FACE_R1 + .5)].copy()
    rel = np.stack([near_rows.x.values - px, near_rows.z.values - pz], 1)
    dist = np.hypot(rel[:, 0], rel[:, 1])
    u = rel / np.maximum(dist, 1e-6)[:, None]
    face = np.zeros(len(near_rows), int); cosb = np.zeros(len(near_rows))
    for s, fid in ((1, 1), (-1, 2)):
        c = u @ (normal(yaw) * s)
        m = (c >= math.cos(FACE_HALF)) & (c > cosb)
        face[m] = fid; cosb[m] = c[m]
    ok = (dist >= FACE_R0) & (dist <= FACE_R1) & (face > 0)
    fi, fj = fine(near_rows.x.values, near_rows.z.values)
    ok &= ~BLOCK[fi, fj]
    idx = np.where(ok)[0]
    ok[idx] = los(px, pz, near_rows.x.values[idx], near_rows.z.values[idx])
    vel = near_rows[["vx", "vz"]].values
    toward = -(np.sum(vel * u, 1)) / np.maximum(near_rows.sp.values, 1e-6)
    ok &= (near_rows.sp.values <= 0.15) | (toward >= math.cos(math.radians(80)))
    v = near_rows[ok].assign(dist=dist[ok], face=face[ok], cosb=cosb[ok])
    ev = []
    for tid, g in v.groupby("id", sort=False):
        t = g.t.values; brk = np.where(np.diff(t) > 3)[0] + 1
        for seg in np.split(np.arange(len(g)), brk):
            if len(seg) < 2: continue
            s = g.iloc[seg]
            dwell = float(s.t.iloc[-1] - s.t.iloc[0] + 1)
            entry = float(s.sp.iloc[:2].mean()); vmin = float(s.sp.min()); vmean = float(s.sp.mean())
            # attention quality: time in view beyond a plain pass-by, closeness, slowing down, facing the screen
            dw = float(np.clip((dwell - 2) / 10, 0, 1)); pr = float(np.clip((4.5 - s.dist.min()) / 3.5, 0, 1))
            sl = float(np.clip(0.5 * (1 - vmean / 1.0) + 0.5 * (entry - vmin) / 0.6, 0, 1))
            orn = float(np.clip((s.cosb.mean() - 0.57) / 0.43, 0, 1))
            aqs = 100 * (0.35 * dw + 0.25 * pr + 0.2 * sl + 0.2 * orn)
            ev.append((int(s.t.iloc[0]), dwell, round(float(s.dist.min()), 2), round(vmean, 2),
                       round(max(0.0, entry - vmin), 2), round(aqs, 1), int(s.face.mode().iloc[0]), tid))
    E = pd.DataFrame(ev, columns=["t", "dwell", "dmin", "vmean", "slow", "aqs", "face", "id"])
    E["slot"] = (E.t - T0) // SLOT
    return E

def per_slot(E):
    out = []
    for s in range(NS):
        e = E[E.slot == s]
        q = e[e.aqs >= 50]
        out.append([len(e), len(q), int((e.aqs >= 70).sum()), int(e.id.nunique()),
                    round(float(e.aqs.mean()), 1) if len(e) else 0, round(float(e.dwell.sum()))])
    return out

# ---------- department traffic + shelf stops (real) -------------------------------------------
def dept_series(dept):
    P = DEPT[dept]
    m = contains_xy(P, df.x.values, df.z.values)
    d = df[m]
    traffic = d.groupby("slot").id.nunique().reindex(range(NS), fill_value=0).values
    slow = d[d.sp < 0.25]
    stops = np.zeros(NS, int)
    for tid, g in slow.groupby("id", sort=False):
        t = g.t.values; brk = np.where(np.diff(t) > 2)[0] + 1
        for seg in np.split(np.arange(len(g)), brk):
            if len(seg) >= 4: stops[int(g.slot.values[seg[0]])] += 1
    return traffic.astype(int), stops

# ---------- DEMO: flighting, playlist, proof of play, sales ------------------------------------
def flighting(seed):
    rng = np.random.default_rng(seed); on = np.zeros(NS, int)
    for p in range(NS // 2): on[2 * p + int(rng.integers(0, 2))] = 1
    return on

def proof_of_play(on, seed, prod_name):
    rng = np.random.default_rng(seed); log = []
    for s in range(NS):
        t = T0 + s * SLOT
        while t < T0 + (s + 1) * SLOT:
            seq = [(1, 15), (0, 45)] if on[s] else [(0, 45), (2, 15)]
            for vid, dur in seq:
                st = "completed" if rng.random() > 0.008 else "interrupted"
                real = dur if st == "completed" else int(rng.integers(3, dur))
                log.append([t, real, vid, 0 if st == "completed" else 1]); t += dur
    return log

def sales(base_series, units_day, lift, on, seed):
    rng = np.random.default_rng(seed)
    w = base_series / max(1, base_series.sum())
    lam = units_day * w * (1 + lift * on)
    return rng.poisson(lam).astype(int)

FLIGHT_DAYS = 28
DOW = [1.0, 0.95, 0.97, 1.02, 1.15, 1.35, 0.62]  # Mon..Sun demand factors (DEMO)

def flight_sales(traffic, prod, k):
    """DEMO 4-week flight: the analysed day's traffic shape, daily re-randomised ON/OFF, planted lift."""
    dow0 = datetime.fromisoformat(day).weekday()
    ON, U, CT, TR = [], [], [], []
    for d in range(FLIGHT_DAYS):
        on = flighting(1000 + 97 * k + d)
        f = DOW[(dow0 + d) % 7]
        tr = (traffic + 0.5) * f
        ON.append(on); TR.append(tr)
        U.append(sales(tr, prod["units_day"] * f, prod["planted_lift"], on, 3000 + 97 * k + d))
        CT.append(sales(tr, int(prod["units_day"] * 0.8 * f), 0.0, on, 4000 + 97 * k + d))
    return np.array(ON), np.array(U), np.array(CT), np.array(TR)

def lift_test(units, ctrl, traffic, on, seed, boots_n=3000):
    """traffic-normalised ON/OFF ratio (control-adjusted as a check); bootstrap over ON/OFF pairs.
    Arrays are (days, slots) or (slots,)."""
    units, ctrl, traffic, on = (np.atleast_2d(a) for a in (units, ctrl, traffic, on))
    D = units.shape[0]; P = NS // 2
    # per pair sums for ON and OFF halves -> (D*P, 6)
    pu = units.reshape(D, P, 2); pc = ctrl.reshape(D, P, 2); pt = traffic.reshape(D, P, 2); po = on.reshape(D, P, 2)
    sel = lambda a: np.stack([(a * po).sum(2), (a * (1 - po)).sum(2)], -1).reshape(D * P, 2)
    U2, C2, T2 = sel(pu), sel(pc), sel(pt)
    def est(ix):
        u, c, t = U2[ix].sum(0), C2[ix].sum(0), T2[ix].sum(0)
        raw = (u[0] / t[0]) / max(1e-9, u[1] / t[1]) - 1
        cr = (c[0] / t[0]) / max(1e-9, c[1] / t[1])
        return raw, (1 + raw) / max(1e-9, cr) - 1
    allp = np.arange(D * P)
    raw, adj = est(allp)
    rng = np.random.default_rng(seed)
    bs = np.array([est(rng.integers(0, D * P, D * P))[0] for _ in range(boots_n)])
    lo, hi = np.percentile(bs, [5, 95]); se = float(bs.std())
    days = int(math.ceil(D * ((1.645 + 0.842) * se / 0.10) ** 2))
    return {"lift": round(float(raw), 4), "controlAdjusted": round(float(adj), 4), "lo90": round(float(lo), 4),
            "hi90": round(float(hi), 4), "se": round(se, 4), "confidence": round(float((bs > 0).mean()), 3),
            "days": D, "daysFor10pct": max(1, days)}

def aa_check(E, on):
    """real near-screen behaviour ON vs OFF — the spot is simulated, so the honest expectation is ~0."""
    o, f = E[on[E.slot.clip(0, NS - 1)] == 1], E[on[E.slot.clip(0, NS - 1)] == 0]
    m = lambda e, c: round(float(e[c].mean()), 2) if len(e) else 0
    return {"on": {"n": len(o), "dwell": m(o, "dwell"), "slow": m(o, "slow"), "aqs": m(o, "aqs"), "q": round(float((o.aqs >= 50).mean()), 3) if len(o) else 0},
            "off": {"n": len(f), "dwell": m(f, "dwell"), "slow": m(f, "slow"), "aqs": m(f, "aqs"), "q": round(float((f.aqs >= 50).mean()), 3) if len(f) else 0}}

def spot_overlap(E, log):
    """impressions whose time in view overlaps a played product spot (proof of play x audience)."""
    spots = np.array([(t, t + d) for t, d, v, s in log if v == 1])
    if not len(spots): return 0, 0.0
    st = spots[:, 0]; seen, secs = 0, 0.0
    for t, dw in zip(E.t.values, E.dwell.values):
        k = np.searchsorted(st, t + dw) - 1
        if k >= 0 and spots[k, 1] > t:
            seen += 1; secs += min(t + dw, spots[k, 1]) - max(t, spots[k, 0])
    return seen, secs

BASE_CPM = 6.0  # € — standard in-store DOOH reference, editable assumption
out_totems = []
for k, tt in enumerate(totems):
    prod = PRODUCTS[tt["product"]]
    E = audience(tt)
    ser = per_slot(E)
    E0 = audience({"placed": tt["original"]}) if tt["moved"] else E
    traffic, stops = dept_series(prod["dept"])
    # DEMO effect, consistent with the simulator (241 / media-sim.js): the message moves only the viewers who see the
    # spot and reach the shelf, so on the SKU's total sales it is diluted by their share of department traffic.
    p_see = min(1.0, (float(E.dwell.mean()) + 15) / 60) if len(E) else 0.0
    share = float((E.aqs >= 50).sum()) * p_see * 0.35 / max(1, traffic.sum())
    prod = {**prod, "planted_lift": prod["viewer_lift"] * share, "in_target_share": share}
    FON, FU, FC, FT = flight_sales(traffic, prod, k)
    on = FON[0]; log = proof_of_play(on, 2000 + k, prod["spot"])
    units, ctrl = FU[0], FC[0]
    curve = []
    for d in (1, 2, 3, 5, 7, 10, 14, 21, 28):
        r = lift_test(FU[:d], FC[:d], FT[:d], FON[:d], 5000 + k, 1500)
        curve.append({"day": d, "lift": r["lift"], "lo90": r["lo90"], "hi90": r["hi90"], "confidence": r["confidence"]})
    test = lift_test(FU, FC, FT, FON, 5000 + k)
    test["day1"] = lift_test(FU[:1], FC[:1], FT[:1], FON[:1], 5000 + k)
    stop_test = lift_test(stops, np.maximum(traffic, 1), traffic, on, 6000 + k)
    aa = aa_check(E, on)
    seen, secs = spot_overlap(E, log)
    q = E[E.aqs >= 50]
    qi = float(np.clip((q.aqs.mean() if len(q) else 50) / 60, 0.7, 1.5))
    lm = 1 + min(0.3, max(0.0, test["lo90"])) * 1.5 if test["confidence"] >= 0.9 else 1.0
    cpm = BASE_CPM * qi * lm
    # schedule: qualified audience per hour x path affinity (exit heading toward the product department)
    hours = []
    for i, h in enumerate(range(7, 22)):
        sl = ser[4 * i:4 * i + 4]
        qual = sum(r[1] for r in sl); imp = sum(r[0] for r in sl)
        hours.append({"h": h, "imp": imp, "qual": qual, "traffic": int(traffic[4 * i:4 * i + 4].sum()),
                      "stops": int(stops[4 * i:4 * i + 4].sum()), "units": int(units[4 * i:4 * i + 4].sum())})
    qs = sorted(h["qual"] for h in hours)
    for h in hours:
        h["tier"] = "prime" if h["qual"] >= qs[int(len(qs) * .7)] else ("value" if h["qual"] <= qs[int(len(qs) * .3)] else "standard")
        h["price"] = round(h["imp"] / 1000 * cpm * {"prime": 1.25, "standard": 1.0, "value": 0.8}[h["tier"]], 2)  # €/hour at 100% share of voice
    # visible floor cells for drawing the two faces
    def face_cells(px, pz, yaw):
        out = []
        for ii, jj, qx, qz, u, d in cone_cells(px, pz, yaw):
            toward = (-u) @ HB_VEC.T
            w = np.clip((toward - math.cos(math.radians(70))) / (1 - math.cos(math.radians(70))), 0, 1)
            v = (H[ii, jj, :8] * w).sum(1) + 0.4 * H[ii, jj, 8] if len(ii) else np.zeros(0)
            out.append([[round(float(a), 2), round(float(b), 2), int(c)] for a, b, c in zip(qx, qz, v)])
        return out
    faces = face_cells(tt["placed"]["x"], tt["placed"]["z"], tt["placed"]["yaw"])
    orig_faces = face_cells(tt["original"]["x"], tt["original"]["z"], tt["original"]["yaw"])
    out_totems.append({**tt, "faces": faces, "originalFaces": orig_faces,
        "audience": {"slots": ser, "events": len(E), "qualified": int((E.aqs >= 50).sum()), "premium": int((E.aqs >= 70).sum()),
                     "unique": int(E.id.nunique()), "avgAqs": round(float(E.aqs.mean()), 1) if len(E) else 0,
                     "avgDwell": round(float(E.dwell.mean()), 1) if len(E) else 0,
                     "byFace": [int((E.face == 1).sum()), int((E.face == 2).sum())],
                     "spotSeen": seen, "spotSeconds": round(secs),
                     "original": {"events": len(E0), "qualified": int((E0.aqs >= 50).sum()), "unique": int(E0.id.nunique()),
                                  "avgAqs": round(float(E0.aqs.mean()), 1) if len(E0) else 0}},
        "dept": {"traffic": traffic.tolist(), "stops": stops.tolist()},
        "flight": on.tolist(),
        "playlist": [{"id": "spot", "name": prod["spot"], "duration_s": 15, "sku": prod["sku"], "demo": True},
                     {**HOUSE},
                     {"id": "fidaty", "name": "Fidaty · promo istituzionale", "duration_s": 15, "demo": True}],
        "pop": {"rows": log, "plays": len(log), "spotPlays": sum(1 for r in log if r[2] == 1),
                "interrupted": sum(1 for r in log if r[3] == 1)},
        "sales": {"viewerLift": prod["viewer_lift"], "inTargetShare": round(prod["in_target_share"], 4), "plantedLift": round(prod["planted_lift"], 4),
                  "units": units.tolist(), "control": ctrl.tolist(), "test": test, "curve": curve,
                  "flight": {"days": FLIGHT_DAYS, "units": int(FU.sum()), "control": int(FC.sum()),
                             "daily": FU.sum(1).astype(int).tolist(), "revenue": round(float(FU.sum()) * prod["price"], 2)}},
        "shelfStops": stop_test, "aa": aa,
        "cpm": {"base": BASE_CPM, "qi": round(qi, 2), "liftMult": round(lm, 3), "value": round(cpm, 2)},
        "hours": hours})
    print(f"  {tt['name']}: {len(E)} impressions, q {int((E.aqs >= 50).sum())} (orig {len(E0)}/{int((E0.aqs >= 50).sum())}), aqs {E.aqs.mean():.0f}, lift {test}, CPM {cpm:.2f}")

res = {"schema": "media-pack-v1", "day": day, "venue_id": pack.get("venue_id"),
       "slot0": T0, "slotS": SLOT, "nSlots": NS,
       "demo": ["playlists", "proof of play", "sales", "flighting"],
       "real": ["audience", "placement", "department traffic", "shelf stops", "near-screen behaviour"],
       "products": PRODUCTS, "videos": ["house", "spot", "fidaty"],
       "params": {"faceRange": [FACE_R0, FACE_R1], "faceHalfDeg": 55, "aqsQualified": 50, "aqsPremium": 70,
                  "moveIfBelow": 0.7, "minSpacing": 10},
       "totems": out_totems}
dest = SITE / f"{day}.json"
json.dump(res, open(dest, "w"), separators=(",", ":"))
idx_p = SITE / "index.json"
idx = json.load(open(idx_p)) if idx_p.exists() else {"days": []}
idx["days"] = sorted(set(idx["days"]) | {day})
json.dump(idx, open(idx_p, "w"))
print(f"240 {day}: -> {dest} ({dest.stat().st_size // 1024} KB)")
