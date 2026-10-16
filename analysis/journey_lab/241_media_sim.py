#!/usr/bin/env python3
"""241_media_sim.py — data for the Media "Simulate" panel: what a totem spot would deliver, by weekday and hour.

Two steps:
  day   <day> <flow_rows.csv.gz>   → <MEDIA_WORK>/sim_<day>.npz      (one day of LiDAR rows, 230_flow_rows.py)
  build                            → <MEDIA_SITE>/sim.json           (all days in MEDIA_WORK)

MEASURED per day and hour, for each candidate spot (the two totems, their CAD spots, the next best spots):
  impressions, qualified impressions (AQS >= 50), attention seconds, where the viewers are when they stop looking.
MEASURED per day and hour, per department: ids passing, shelf stops (>= 4 s under 0.25 m/s).
MEASURED once over all days: a 5-second movement model on 1.5 m cells (where people at a cell are 5 s later).
  LiDAR ids break up (median life ~8 s), so "where do the viewers go next" is not followed person by person:
  it is the probability, from the viewers' positions, of reaching the department within 3 minutes, chained
  through the movement model. A short-horizon check against ids that do survive is written to the output.
DEMO (flagged): baseline sales per department, message-type effect assumptions, base CPM.
Optional MEDIA_TARGETS (scripts/planogram/media_category_targets.py): planogram display categories as targets,
measured the same way on the floor band along their real fronts. Set it for both steps; days must have the
planogram layout. A target the LiDAR does not see is written as measured=false, never as 0 viewers.
"""
import sys, os, json, math, glob
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import numpy as np
import pandas as pd
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely import contains_xy

HERE = Path(__file__).resolve().parent
FF = HERE.parent.parent / "frontend/public/flowfield"
SITE = Path(os.environ.get("MEDIA_SITE", FF / "media"))
WORK = Path(os.environ.get("MEDIA_WORK", os.path.expanduser("~/jl_work/media_sim"))); WORK.mkdir(parents=True, exist_ok=True)
tz = ZoneInfo("Europe/Rome")
H0, H1 = 7, 22
NH = H1 - H0

# ---------- geometry (same frame and rules as 240_media_pack.py) ------------------------------
layout = json.load(open(FF / "layout_prod.json")); bb = layout["bbox"]
obst = unary_union([Polygon(p).buffer(0) for p in layout["polys"] if len(p) >= 3])
R = 0.25
ox, oz = math.floor(bb["minX"]) - 2, math.floor(bb["minZ"]) - 2
nx, nz = int((bb["maxX"] + 2 - ox) / R) + 1, int((bb["maxZ"] + 2 - oz) / R) + 1
gx, gz = np.meshgrid(ox + (np.arange(nx) + .5) * R, oz + (np.arange(nz) + .5) * R, indexing="ij")
BLOCK = contains_xy(obst, gx, gz)
areas = json.load(open(FF / "visitor-areas.json"))
def mpoly(parts): return unary_union([Polygon(a["outer"], a.get("holes") or []).buffer(0) for a in parts])
DEPTS = [d["id"] for d in areas["departments"]]
DEPTR = np.full((nx, nz), -1, np.int16)
for k, d in enumerate(areas["departments"]):
    DEPTR[contains_xy(mpoly(d["area"]), gx, gz)] = k

# planogram category targets (optional, MEDIA_TARGETS = scripts/planogram/media_category_targets.py output):
# the free floor within band_m of the target's real fronts.
TARGETS = json.load(open(os.environ["MEDIA_TARGETS"])) if os.environ.get("MEDIA_TARGETS") else None
def band_raster(fronts, band):
    out = np.zeros((nx, nz), bool)
    for x0, z0, x1, z1 in fronts:
        i0, i1 = int((min(x0, x1) - band - ox) / R), int((max(x0, x1) + band - ox) / R) + 1
        j0, j1 = int((min(z0, z1) - band - oz) / R), int((max(z0, z1) + band - oz) / R) + 1
        i0, j0, i1, j1 = max(i0, 0), max(j0, 0), min(i1, nx), min(j1, nz)
        px, pz = gx[i0:i1, j0:j1], gz[i0:i1, j0:j1]
        dx, dz = x1 - x0, z1 - z0; L2 = max(dx * dx + dz * dz, 1e-9)
        u = np.clip(((px - x0) * dx + (pz - z0) * dz) / L2, 0, 1)
        out[i0:i1, j0:j1] |= np.hypot(px - (x0 + u * dx), pz - (z0 + u * dz)) <= band
    return out & ~BLOCK
TMASK = [band_raster(t["fronts"], TARGETS["band_m"]) for t in TARGETS["targets"]] if TARGETS else []
TIDS = [t["id"] for t in TARGETS["targets"]] if TARGETS else []

C = 0.5                                     # audience grid
cx_n, cz_n = int(nx * R / C) + 1, int(nz * R / C) + 1
M = 1.5                                     # movement-model grid
mx_n, mz_n = int(nx * R / M) + 1, int(nz * R / M) + 1
NCELL = mx_n * mz_n
STEP = 5                                    # seconds per movement step
HORIZON = 180                               # reach the department within 3 minutes

def fine(x, z):
    return (np.clip(((np.asarray(x) - ox) / R).astype(int), 0, nx - 1), np.clip(((np.asarray(z) - oz) / R).astype(int), 0, nz - 1))
def mcell(x, z):
    return np.clip(((np.asarray(x) - ox) / M).astype(int), 0, mx_n - 1) * mz_n + np.clip(((np.asarray(z) - oz) / M).astype(int), 0, mz_n - 1)

def los(px, pz, qx, qz):
    qx, qz = np.asarray(qx, float), np.asarray(qz, float)
    d = np.hypot(qx - px, qz - pz); n = np.maximum(2, (d / 0.2).astype(int)); ok = np.ones(len(qx), bool)
    for k in range(1, int(n.max()) if len(n) else 1):
        f = np.minimum(k / n, 1.0); live = k < n
        i, j = fine(px + (qx - px) * f, pz + (qz - pz) * f)
        ok &= ~(BLOCK[i, j] & live & (f > 0.06))
    return ok

FACE_R0, FACE_R1, FACE_HALF = 0.8, 6.0, math.radians(55)
def normal(yaw): a = math.radians(yaw); return np.array([math.sin(a), math.cos(a)])

def vis_grid(px, pz):
    """0.5 m cells around the spot that can see it (line of sight, free floor)."""
    r = int(FACE_R1 / C) + 1
    i0, j0 = int((px - ox) / C), int((pz - oz) / C)
    ii, jj = np.meshgrid(np.arange(i0 - r, i0 + r + 1), np.arange(j0 - r, j0 + r + 1), indexing="ij")
    ii, jj = ii.ravel(), jj.ravel()
    qx, qz = ox + (ii + .5) * C, oz + (jj + .5) * C
    fi, fj = fine(qx, qz)
    ok = ~BLOCK[fi, fj] & los(px, pz, qx, qz)
    return {(a, b) for a, b, o in zip(ii, jj, ok) if o}

# ---------- spots ----------------------------------------------------------------------------
pack = json.load(open(SITE / "2026-09-14.json"))
def spots_from_pack():
    out = []
    for k, t in enumerate(pack["totems"]):
        out.append({"id": f"T{k + 1}", "label": f"Totem {k + 1} · new spot", "x": t["placed"]["x"], "z": t["placed"]["z"], "yaw": t["placed"]["yaw"], "totem": k, "kind": "placed"})
        if t["moved"]:
            out.append({"id": f"T{k + 1}-cad", "label": f"Totem {k + 1} · CAD spot", "x": t["original"]["x"], "z": t["original"]["z"], "yaw": t["original"]["yaw"], "totem": k, "kind": "cad"})
        n = 0
        for x, z, y, s in t["candidates"][1:]:
            if all(math.hypot(x - o["x"], z - o["z"]) >= 4 for o in out):
                n += 1
                out.append({"id": f"T{k + 1}-o{n}", "label": f"Option {k + 1}.{n}", "x": x, "z": z, "yaw": y, "totem": k, "kind": "option"})
            if n >= 4: break
    return out
SPOTS = spots_from_pack()

# ---------- one day ---------------------------------------------------------------------------
def run_day(day, rows_path):
    day0 = int(datetime.fromisoformat(f"{day}T00:00:00").replace(tzinfo=tz).timestamp())
    df = pd.read_csv(rows_path); df.columns = ["id", "ts", "x", "z"]
    t = (df.ts.values // 1000 - day0).astype(np.int32)
    keep = (t >= H0 * 3600) & (t < H1 * 3600)
    df = df[keep]; t = t[keep]
    idc, codes = np.unique(df.id.values, return_inverse=True)
    order = np.lexsort((t, codes)); codes, t = codes[order], t[order]
    x, z = df.x.values[order], df.z.values[order]
    same = np.r_[codes[1:] == codes[:-1], False]
    dtn = np.r_[np.diff(t), 0]
    okv = same & (dtn > 0) & (dtn <= 2)
    vx = np.where(okv, np.r_[np.diff(x), 0] / np.maximum(dtn, 1), np.nan)
    vz = np.where(okv, np.r_[np.diff(z), 0] / np.maximum(dtn, 1), np.nan)
    prev = np.r_[False, okv[:-1]]
    fill = np.isnan(vx) & prev
    vx[fill] = np.r_[np.nan, vx[:-1]][fill]; vz[fill] = np.r_[np.nan, vz[:-1]][fill]
    good = ~np.isnan(vx)
    codes, t, x, z, vx, vz = codes[good], t[good], x[good], z[good], vx[good], vz[good]
    sp = np.hypot(vx, vz); hr = (t // 3600 - H0).clip(0, NH - 1)
    fi, fj = fine(x, z); dep = DEPTR[fi, fj]
    out = {"day": day, "weekday": datetime.fromisoformat(day).weekday(), "rows": int(len(t)), "ids": int(len(idc))}

    # departments: ids passing per hour, shelf stops per hour
    nd = len(DEPTS)
    m = dep >= 0
    key = np.unique((codes[m].astype(np.int64) * nd + dep[m]) * NH + hr[m])
    traffic = np.bincount((key % (nd * NH)).astype(int), minlength=nd * NH).reshape(nd, NH)  # dep*NH+hr
    slow = sp < 0.25
    s_idx = np.where(slow)[0]
    brk = np.r_[True, (codes[s_idx][1:] != codes[s_idx][:-1]) | (np.diff(t[s_idx]) > 2)]
    seg = np.cumsum(brk) - 1
    seg_len = np.bincount(seg)
    first = s_idx[brk]
    sel = (seg_len >= 4) & (dep[first] >= 0)
    stops = np.zeros((nd, NH), int)
    np.add.at(stops, (dep[first][sel], hr[first][sel]), 1)
    store = np.bincount(np.unique(codes.astype(np.int64) * NH + hr) % NH, minlength=NH)
    out["traffic"], out["stops"], out["store"] = traffic, stops, store
    if TARGETS:   # ids passing each target band per hour
        anyt = np.zeros((nx, nz), bool)
        for mk in TMASK: anyt |= mk
        sub = np.where(anyt[fi, fj])[0]
        tt = np.zeros((len(TMASK), NH), int)
        for q, mk in enumerate(TMASK):
            w = sub[mk[fi[sub], fj[sub]]]
            if len(w): tt[q] = np.bincount(np.unique(codes[w].astype(np.int64) * NH + hr[w]) % NH, minlength=NH)
        out["ttraffic"], out["tids"] = tt, np.array(TIDS)

    # movement model: cell now -> cell 5 s later (same id)
    j = np.arange(len(t) - STEP)
    pair = (codes[j + STEP] == codes[j]) & (t[j + STEP] - t[j] == STEP)
    a, b = mcell(x[j[pair]], z[j[pair]]), mcell(x[j[pair] + STEP], z[j[pair] + STEP])
    k2, cnt = np.unique(a.astype(np.int64) * NCELL + b, return_counts=True)
    out["trans_k"], out["trans_c"] = k2, cnt
    out["occ"] = np.bincount(mcell(x, z), minlength=NCELL)   # person-seconds per cell (store-average start)
    # short-horizon check: from each cell, does the same id stand in each department 30 s later?
    S30 = 30
    j = np.arange(len(t) - S30)
    p30 = (codes[j + S30] == codes[j]) & (t[j + S30] - t[j] == S30)
    c0 = mcell(x[j[p30]], z[j[p30]]); d30 = dep[j[p30] + S30]
    out["chk_c0"], out["chk_d"] = c0.astype(np.int32), d30.astype(np.int16)

    # audience per spot per hour
    aud = np.zeros((len(SPOTS), NH, 4))            # impressions, qualified, aqs sum, dwell sum
    endc = np.zeros((len(SPOTS), NCELL))           # where viewers stop looking
    for si, s in enumerate(SPOTS):
        px, pz, yaw = s["x"], s["z"], s["yaw"]
        near = np.where((np.abs(x - px) < FACE_R1 + .5) & (np.abs(z - pz) < FACE_R1 + .5))[0]
        rel = np.stack([x[near] - px, z[near] - pz], 1); dist = np.hypot(rel[:, 0], rel[:, 1])
        u = rel / np.maximum(dist, 1e-6)[:, None]
        cosb = np.maximum(u @ normal(yaw), u @ -normal(yaw))
        V = vis_grid(px, pz)
        ci_, cj_ = ((x[near] - ox) / C).astype(int), ((z[near] - oz) / C).astype(int)
        inv = np.fromiter(((a_, b_) in V for a_, b_ in zip(ci_, cj_)), bool, len(near))
        toward = -(vx[near] * u[:, 0] + vz[near] * u[:, 1]) / np.maximum(sp[near], 1e-6)
        ok = (dist >= FACE_R0) & (dist <= FACE_R1) & (cosb >= math.cos(FACE_HALF)) & inv & ((sp[near] <= 0.15) | (toward >= math.cos(math.radians(80))))
        r = near[ok]; dd, cb = dist[ok], cosb[ok]
        if len(r) < 2: continue
        brk = np.r_[True, (codes[r][1:] != codes[r][:-1]) | (np.diff(t[r]) > 3)]
        seg = np.cumsum(brk) - 1; ns = seg[-1] + 1
        n = np.bincount(seg, minlength=ns)
        st = np.where(brk)[0]; en = np.r_[st[1:], len(r)] - 1
        dwell = (t[r][en] - t[r][st] + 1).astype(float)
        dmin = np.minimum.reduceat(dd, st)
        vmean = np.bincount(seg, sp[r], ns) / n
        vmin = np.minimum.reduceat(sp[r], st)
        entry = sp[r][st]
        orn = np.bincount(seg, cb, ns) / n
        dw = np.clip((dwell - 2) / 10, 0, 1); pr = np.clip((4.5 - dmin) / 3.5, 0, 1)
        sl = np.clip(0.5 * (1 - vmean / 1.0) + 0.5 * (entry - vmin) / 0.6, 0, 1)
        on_ = np.clip((orn - 0.57) / 0.43, 0, 1)
        aqs = 100 * (0.35 * dw + 0.25 * pr + 0.2 * sl + 0.2 * on_)
        valid = n >= 2
        h_ = hr[r][st][valid]
        np.add.at(aud[si], (h_, 0), 1)
        np.add.at(aud[si], (h_, 1), (aqs[valid] >= 50).astype(float))
        np.add.at(aud[si], (h_, 2), aqs[valid])
        np.add.at(aud[si], (h_, 3), dwell[valid])
        np.add.at(endc[si], mcell(x[r][en][valid], z[r][en][valid]), 1)
    out["aud"], out["endc"] = aud, endc
    np.savez_compressed(WORK / f"sim_{day}.npz", **{k: (v if isinstance(v, np.ndarray) else np.array(v)) for k, v in out.items()})
    print(f"241 day {day}: {out['rows']} rows, spots {len(SPOTS)}, impressions {aud[:, :, 0].sum(1).astype(int).tolist()}")

# ---------- build -----------------------------------------------------------------------------
CATALOG = [  # one planogram SKU per department (Esselunga-Treviglio planogram, sku_items); DEMO prices and daily units
    {"sku": "ESS-100031", "name": "Biscotti Equilibrio 800 g", "category": "Bakery & Breakfast", "dept": "Bakery & Breakfast", "price": 2.49, "units_day": 95},
    {"sku": "ESS-100211", "name": "Piadina 225 g", "category": "Bakery & Breakfast", "dept": "Bakery & Breakfast", "price": 1.89, "units_day": 70},
    {"sku": "ESS-100271", "name": "Yogurt 2 x 125 g", "category": "Dairy & Eggs", "dept": "Latticini", "price": 1.19, "units_day": 150},
    {"sku": "ESS-100093", "name": "Latte Equilibrio 1 l", "category": "Dairy & Eggs", "dept": "Latticini", "price": 1.35, "units_day": 220},
    {"sku": "ESS-100003", "name": "Burger surgelati 2 x 100 g", "category": "Frozen & Ready Meals", "dept": "Surgelati", "price": 3.29, "units_day": 55},
    {"sku": "ESS-100132", "name": "Gelato", "category": "Frozen & Ready Meals", "dept": "Surgelati", "price": 3.99, "units_day": 40},
    {"sku": "ESS-100007", "name": "Acqua 1,5 l", "category": "Beverages", "dept": "Acqua", "price": 0.35, "units_day": 600},
    {"sku": "ESS-100001", "name": "Succo Bio 750 ml", "category": "Beverages", "dept": "Acqua", "price": 2.19, "units_day": 45},
    {"sku": "ESS-100138", "name": "Insalata 400 g", "category": "Fresh Produce", "dept": "Verdura", "price": 1.59, "units_day": 120},
    {"sku": "ESS-100121", "name": "Fragole Naturama", "category": "Fresh Produce", "dept": "Frutta", "price": 3.49, "units_day": 80},
]
MESSAGES = [  # starting assumptions for the sales effect on people who saw the spot; replaced by ON/OFF test results
    {"id": "brand", "label": "Brand", "lift": 0.03, "lo": 0.0, "hi": 0.06},
    {"id": "promo", "label": "Price promo", "lift": 0.12, "lo": 0.05, "hi": 0.20},
    {"id": "new", "label": "New product", "lift": 0.08, "lo": 0.02, "hi": 0.15},
]

def build():
    files = sorted(glob.glob(str(WORK / "sim_*.npz")))
    if not files: sys.exit("no day files")
    D = [dict(np.load(f, allow_pickle=True)) for f in files]
    days = [str(d["day"]) for d in D]
    # movement model (all days)
    tk = np.concatenate([d["trans_k"] for d in D]); tc = np.concatenate([d["trans_c"] for d in D])
    k, inv = np.unique(tk, return_inverse=True); cnt = np.bincount(inv, tc)
    a, b = (k // NCELL).astype(int), (k % NCELL).astype(int)
    out_n = np.bincount(a, cnt, NCELL)
    live = np.where(out_n >= 20)[0]; li = -np.ones(NCELL, int); li[live] = np.arange(len(live))
    m = (li[a] >= 0) & (li[b] >= 0)
    P = np.zeros((len(live), len(live)))
    np.add.at(P, (li[a[m]], li[b[m]]), cnt[m])
    P /= np.maximum(P.sum(1, keepdims=True), 1)      # rows leaking to unmodelled cells lose mass (conservative)
    cxs, czs = ox + ((live // mz_n) + .5) * M, oz + ((live % mz_n) + .5) * M
    fi, fj = fine(cxs, czs)
    # department of a 1.5 m cell: majority of its fine cells
    nd = len(DEPTS)
    cell_dep = -np.ones(len(live), int)
    for q, c in enumerate(live):
        i0, j0 = int((c // mz_n) * M / R), int((c % mz_n) * M / R)
        blk = DEPTR[i0:i0 + 6, j0:j0 + 6].ravel(); blk = blk[blk >= 0]
        if len(blk) >= 12: cell_dep[q] = np.bincount(blk).argmax()
    A = np.stack([(cell_dep == d).astype(float) for d in range(nd)], 1)   # (cells, depts)
    def reach(steps):
        r = A.copy()
        for _ in range(steps): r = A + (1 - A) * (P @ r)
        return r
    R180 = reach(HORIZON // STEP)
    AT30 = A.copy()
    for _ in range(30 // STEP): AT30 = P @ AT30          # model: in the department exactly 30 s later
    # short-horizon check: model 30 s vs ids that survive 30 s
    c0 = np.concatenate([d["chk_c0"] for d in D]); d30 = np.concatenate([d["chk_d"] for d in D])
    q = li[c0]; okq = q >= 0
    check = []
    for d in range(nd):
        inside = A[q[okq], d] > 0
        obs = (d30[okq][~inside] == d).mean() if (~inside).any() else 0
        mod = AT30[q[okq][~inside], d].mean() if (~inside).any() else 0
        check.append([DEPTS[d], round(float(obs), 4), round(float(mod), 4)])
    cal = min(1.0, sum(c[1] for c in check) / max(1e-9, sum(c[2] for c in check)))  # model -> surviving ids, pooled
    occ = sum(d["occ"] for d in D)[live]; occ = occ / occ.sum()
    base = occ @ R180                                   # store average (random position, random second)
    # spots
    spots = []
    for si, s in enumerate(SPOTS):
        e = sum(d["endc"][si] for d in D)[live]; e = e / max(1, e.sum())
        r = e @ R180
        spots.append({**s, "reach": [round(float(v), 4) for v in r], "index": [round(float(v / max(1e-6, bv)), 2) for v, bv in zip(r, base)]})
    prof = {"aud": [d["aud"].round(1).tolist() for d in D], "traffic": [d["traffic"].tolist() for d in D],
            "stops": [d["stops"].tolist() for d in D], "store": [d["store"].tolist() for d in D]}
    targets = None
    if TARGETS and all("tids" in d and list(d["tids"]) == TIDS for d in D):
        # a 1.5 m cell belongs to a target when >= 1/6 of its fine cells are in the target band (bands are ~1 m wide)
        AT = np.zeros((len(live), len(TIDS)))
        for q, c in enumerate(live):
            i0, j0 = int((c // mz_n) * M / R), int((c % mz_n) * M / R)
            for t, mk in enumerate(TMASK): AT[q, t] = float(mk[i0:i0 + 6, j0:j0 + 6].sum() >= 6)
        RT = AT.copy()
        for _ in range(HORIZON // STEP): RT = AT + (1 - AT) * (P @ RT)
        tbase = occ @ RT
        for si, s in enumerate(spots):
            e = sum(d["endc"][si] for d in D)[live]; e = e / max(1, e.sum())
            r = e @ RT
            s["treach"] = [round(float(v), 4) for v in r]
            s["tindex"] = [round(float(v / bv), 2) if bv > 1e-6 else None for v, bv in zip(r, tbase)]
        prof["ttraffic"] = [d["ttraffic"].tolist() for d in D]
        targets = []
        for t, T in enumerate(TARGETS["targets"]):
            per = [T["days"].get(dd) for dd in days]
            blind = [dd for dd, v in zip(days, per) if not v or not v["measured"]]
            reason = next((v["reason"] for v in per if v and v.get("reason")), None) or ("no category-layer row" if blind else None)
            if not blind and AT[:, t].sum() == 0: reason, blind = "no movement-model cell on these fronts", days
            targets.append({k: T[k] for k in ("id", "label", "kind", "categorie", "macro", "corsie", "fonti", "default_for_spot", "fronts")}
                           | {"measured": not blind, "reason": reason, "cells": int(AT[:, t].sum()), "base": round(float(tbase[t]), 4)})
    elif TARGETS:
        print("241 build: MEDIA_TARGETS set but some day files were made without it (or with other targets) -> no targets")
    field = {DEPTS[d]: [[round(float(cxs[i]), 2), round(float(czs[i]), 2), round(float(R180[i, d]), 3)] for i in range(len(live)) if R180[i, d] >= 0.03 and A[i, d] == 0] for d in range(nd)}
    faces = {}
    for s in SPOTS:
        V = vis_grid(s["x"], s["z"]); fl = [[], []]
        for (a_, b_) in V:
            qx, qz = ox + (a_ + .5) * C, oz + (b_ + .5) * C
            rel = np.array([qx - s["x"], qz - s["z"]]); dd = np.hypot(*rel)
            if not (FACE_R0 <= dd <= FACE_R1): continue
            c1 = rel @ normal(s["yaw"]) / dd
            if c1 >= math.cos(FACE_HALF): fl[0].append([round(qx, 2), round(qz, 2)])
            elif -c1 >= math.cos(FACE_HALF): fl[1].append([round(qx, 2), round(qz, 2)])
        faces[s["id"]] = fl
    res = {"schema": "media-sim-v1", "days": days, "weekdays": [int(d["weekday"]) for d in D], "h0": H0, "h1": H1,
           "depts": DEPTS, "spots": spots, "faces": faces, "base": [round(float(v), 4) for v in base],
           "profiles": prof, "field": field, "check": check, "catalog": CATALOG, "messages": MESSAGES,
           "params": {"calibration": round(cal, 3), "horizon_s": HORIZON, "step_s": STEP, "cell_m": M, "baseCpm": 6.0, "loop_s": 60},
           "demo": ["baseline sales", "message effects", "base CPM"]}
    if targets is not None:
        res["targets"] = targets
        res["targets_meta"] = {"planogram": TARGETS["planogram"], "band_m": TARGETS["band_m"], "days": TARGETS["days"]}
    dest = SITE / "sim.json"
    json.dump(res, open(dest, "w"), separators=(",", ":"))
    print(f"241 build: {len(days)} days -> {dest} ({dest.stat().st_size // 1024} KB)")
    print("  30 s check (observed vs model):", [c for c in check if c[1] > 0.005])
    for s in spots: print("  ", s["id"], {DEPTS[d]: (s["reach"][d], s["index"][d]) for d in range(nd) if s["reach"][d] > 0.05})
    print("  base", dict(zip(DEPTS, res["base"])))

if __name__ == "__main__":
    if sys.argv[1] == "day": run_day(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else os.path.expanduser(f"~/jl_work/flow_rows_{sys.argv[2]}.csv.gz"))
    else: build()
