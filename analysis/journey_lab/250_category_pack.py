#!/usr/bin/env python3
"""250_category_pack.py — data for the Windflow "Categories" lens (Esselunga planogram on the twin).

Writes to <CAT_SITE> (default frontend/public/flowfield/categories):
  sections.json   planogram geometry: one entry per section (module of ~1.3 m) on the venue floor, with its
                  display category, macro-category, category source, fit quality, facing side and shelf levels.
  <day>.json      the day's category KPIs exactly as daily_kpi stored them (category_kpi_macro /
                  category_kpi_categoria, 199c), by slot, plus stops along each aisle per 1.3 m step.
  index.json      days available.

KPIs are not recomputed here: they are copied from the daily_kpi payload (JSON report or SQLite).
The only new measure is the per-module stop count along aisles 1–12, from the per-second LiDAR rows
(230_flow_rows.py): a stop = under 0.4 m/s for at least 20 s (same thresholds as the category layer),
counted in the aisle corridor between the two fronts. It is ESTIMATED: the LiDAR ↔ layout offset
(~0.5 m in X, docs/TREVIGLIO_ALLINEAMENTO_LIDAR_LAYOUT.md) is not corrected, so both fronts are pooled.

Uso:
  python3 250_category_pack.py sections
  python3 250_category_pack.py day <day> [--report daily_kpi.json | --db hyperspace.db] [--rows flow_rows.csv.gz]
"""
import sys, os, json, math, argparse
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import numpy as np
import pandas as pd
from shapely.geometry import Polygon, Point
from shapely.strtree import STRtree

REPO = Path(__file__).resolve().parents[2]
FF = REPO / "frontend/public/flowfield"
SITE = Path(os.environ.get("CAT_SITE", FF / "categories")); SITE.mkdir(parents=True, exist_ok=True)
PLANO = Path(os.environ.get("CAT_PLANO", REPO / "data/planogram/TEV/2026-10-13"))
VENUE = "55fdd53b-3298-4355-97c0-b4e789b11d06"
SLOTS = ["giorno", "08-10", "10-12", "12-14", "14-16", "16-18", "18-20"]
STOP_V, STOP_S, STEP_M = 0.4, 20, 1.3

# same palette and order as planogram-overlay.js (TEV_macro_categorie_venue.png)
MACRO_COLORS = {
    "Cura persona": "#1f77b4", "Colazione e dolci": "#aec7e8", "Pasta, riso e dispensa": "#ff7f0e",
    "Bazar e non alimentare": "#ffbb78", "Latticini e freschi": "#2ca02c", "Bevande alcoliche": "#98df8a",
    "Pulizia casa": "#d62728", "Surgelati": "#ff9896", "Petcare": "#9467bd", "Salute e benessere": "#c5b0d5",
    "Infanzia": "#8c564b", "Carta e casalinghi": "#c49c94", "Bevande analcoliche": "#e377c2",
    "Pane confezionato": "#f7b6d2", "Salumi": "#7f7f7f", "Snack salati": "#c7c7c7",
    "Impulso avancassa (non classificato)": "#bcbd22", "Shopper e borse": "#dbdb8d",
    "Servizi e carte prepagate": "#17becf",
}

def quality(q):
    q = str(q)
    return "ok" if q.startswith("ok") else ("verify" if q.startswith("da verificare") else "out")

def build_sections():
    d = pd.read_csv(PLANO / "TEV_planogramma_posizioni_categorie.csv")
    d["W"] = d.LARG_ART.fillna(0) * d.NUMERO_FILE.fillna(1)
    layout = json.load(open(FF / "layout_prod.json"))
    polys = [Polygon(p).buffer(0) for p in layout["polys"] if len(p) >= 3]
    polys = [p for p in polys if p.area > 0.05]
    tree = STRtree(polys)
    def blocked(x, z):
        return any(polys[i].contains(Point(x, z)) for i in tree.query(Point(x, z)))
    key = ["NUMERO_CORSIA", "POSIZIONE_CORSIA", "SPEZZATURA_CORR", "POSIZIONE", "X_SEZIONE", "Y_SEZIONE"]
    cats, out = [], []
    cat_ix = {}
    def ci(name):
        if name not in cat_ix: cat_ix[name] = len(cats); cats.append(name)
        return cat_ix[name]
    for k, g in d.groupby(key, sort=False):
        sx, sz = float(g.SEZ_VENUE_X_m.iloc[0]), float(g.SEZ_VENUE_Z_m.iloc[0])
        # run axis from the nearest fixture's long side; facing = the free side
        p = Point(sx, sz)
        near = min(tree.query(p.buffer(1.5)), key=lambda i: polys[i].distance(p), default=None)
        axis = np.array([0.0, 1.0])
        if near is not None:
            rr = list(polys[near].minimum_rotated_rectangle.exterior.coords)[:4]
            e1, e2 = np.subtract(rr[1], rr[0]), np.subtract(rr[2], rr[1])
            long_ = e1 if np.hypot(*e1) >= np.hypot(*e2) else e2
            axis = long_ / max(1e-9, np.hypot(*long_))
            if abs(axis[1]) >= abs(axis[0]) and axis[1] < 0: axis = -axis
            if abs(axis[0]) > abs(axis[1]) and axis[0] < 0: axis = -axis
        nrm = np.array([axis[1], -axis[0]])
        if blocked(sx + nrm[0] * 0.45, sz + nrm[1] * 0.45) and not blocked(sx - nrm[0] * 0.45, sz - nrm[1] * 0.45): nrm = -nrm
        # extent along the run from the products themselves
        ax = g.ART_VENUE_X_m.values * axis[0] + g.ART_VENUE_Z_m.values * axis[1]
        s0 = sx * axis[0] + sz * axis[1]
        lo, hi = min(s0, float(ax.min())), max(float(ax.max()), s0 + 0.4)
        if hi - lo > 2.6: hi = lo + 1.3
        a = (sx + axis[0] * (lo - s0), sz + axis[1] * (lo - s0))
        b = (sx + axis[0] * (hi - s0), sz + axis[1] * (hi - s0))
        w = g.groupby("DESC_CATEGORIA_ESPOSITIVA").W.sum().sort_values(ascending=False)
        cat = w.index[0]
        macro = g[g.DESC_CATEGORIA_ESPOSITIVA == cat].MACRO_CATEGORIA.mode().iloc[0]
        lv = []
        for r, gl in g.groupby("ID_RIPIANO"):
            lv.append(ci(gl.groupby("DESC_CATEGORIA_ESPOSITIVA").W.sum().idxmax()))
        inferred = bool((g.FONTE_CATEGORIA == "inferita dal nome prodotto").mean() > 0.5)
        out.append({"k": f"{int(k[0])}|{int(k[1])}|{int(k[2])}|{k[3]}|{k[4]}", "corsia": int(k[0]),
                    "cat": ci(cat), "macro": macro, "inf": inferred, "q": quality(g.AFFIDABILITA_POSIZIONE.iloc[0]),
                    "a": [round(a[0], 2), round(a[1], 2)], "b": [round(b[0], 2), round(b[1], 2)],
                    "n": [round(float(nrm[0]), 3), round(float(nrm[1]), 3)], "lv": lv,
                    "items": int(g.COD_ARTICOLO.nunique()), "fm": round(float(g.W.sum()) / 100, 2), "prod": [[str(n)[:34], round(float(v) / 100, 2)] for n, v in g.groupby("DESC_ARTICOLO").W.sum().sort_values(ascending=False).head(6).items()], "h": round(float(min(2.6, max(0.6, ((g.Y_ART.fillna(0) + g.ALT_ART.fillna(0)).max()) / 100))), 2), "mix": [[ci(c), round(float(v / w.sum()), 2)] for c, v in w.head(3).items()]})
    # aisles 1–12: corridor between the two fronts
    aisles = []
    for c in range(1, 13):
        ss = [s for s in out if s["corsia"] == c]
        if not ss: continue
        zs = np.array([[s["a"][1], s["b"][1]] for s in ss if abs(s["n"][0]) > 0.7]).ravel()
        east = [s["a"][0] for s in ss if s["n"][0] > 0.7]    # front looking east = west side of the corridor
        west = [s["a"][0] for s in ss if s["n"][0] < -0.7]
        if not east or not west or not len(zs): continue
        lo_x, hi_x = float(np.median(east)), float(np.median(west))
        if hi_x - lo_x < 1.0: continue
        aisles.append({"corsia": c, "x0": round(lo_x, 2), "x1": round(hi_x, 2),
                       "z0": round(float(zs.min()), 2), "z1": round(float(zs.max()), 2)})
    macros = sorted({s["macro"] for s in out}, key=lambda m: list(MACRO_COLORS).index(m) if m in MACRO_COLORS else 99)
    res = {"schema": "planogram-sections-v1", "planogram": "Esselunga TEV 2026-10-13", "venue_id": VENUE,
           "precision_m": 1.3, "cats": cats, "macros": [{"name": m, "color": MACRO_COLORS.get(m)} for m in macros],
           "sections": out, "aisles": aisles,
           "catSpace": {c: round(float(v) / 100, 1) for c, v in d.groupby("DESC_CATEGORIA_ESPOSITIVA").W.sum().items()},
           "quality": {q: sum(1 for s in out if s["q"] == q) for q in ("ok", "verify", "out")}}
    json.dump(res, open(SITE / "sections.json", "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"250 sections: {len(out)} sections, {len(cats)} categories, {len(aisles)} aisles -> {SITE / 'sections.json'}")

def kpi_rows(args, day):
    if args.report:
        rows = json.load(open(args.report))["kpis"]
        checks = json.load(open(args.report)).get("checks", [])
    else:
        import sqlite3
        c = sqlite3.connect(args.db)
        cols = [r[1] for r in c.execute("PRAGMA table_info(daily_kpi)")]
        pj = "payload_json" if "payload_json" in cols else "payload"
        rows = [{"kpi_id": a, "slot": b, "value": v, "label": l, "status": s, "status_reason": sr, "payload": json.loads(p) if p else None}
                for a, b, v, l, s, sr, p in c.execute(f"SELECT kpi_id, slot, value, label, status, status_reason, {pj} FROM daily_kpi WHERE venue_id=? AND day=? AND kpi_id IN ('category_kpi_macro','category_kpi_categoria')", (VENUE, day))]
        # checks live only in the day bundle (the row with the full payload)
        b = c.execute(f"SELECT {pj} FROM daily_kpi WHERE venue_id=? AND day=? AND kpi_id='_bundle' AND slot='giorno'", (VENUE, day)).fetchone()
        checks = (json.loads(b[0]).get("checks") or []) if b and b[0] else []
    return rows, checks

def module_stops(day, rows_path, sec):
    tz = ZoneInfo("Europe/Rome")
    day0 = int(datetime.fromisoformat(f"{day}T00:00:00").replace(tzinfo=tz).timestamp())
    df = pd.read_csv(rows_path); df.columns = ["id", "ts", "x", "z"]
    t = (df.ts.values // 1000 - day0).astype(np.int64)
    m = (t >= 8 * 3600) & (t < 20 * 3600)
    df, t = df[m], t[m]
    _, codes = np.unique(df.id.values, return_inverse=True)
    o = np.lexsort((t, codes)); codes, t = codes[o], t[o]; x, z = df.x.values[o], df.z.values[o]
    same = np.r_[codes[1:] == codes[:-1], False]; dt = np.r_[np.diff(t), 0]
    v = np.where(same & (dt > 0) & (dt <= 2), np.hypot(np.r_[np.diff(x), 0], np.r_[np.diff(z), 0]) / np.maximum(dt, 1), np.inf)
    slow = np.where(v < STOP_V)[0]
    brk = np.r_[True, (codes[slow][1:] != codes[slow][:-1]) | (np.diff(t[slow]) > 2)]
    seg = np.cumsum(brk) - 1
    st = np.where(brk)[0]; en = np.r_[st[1:], len(slow)] - 1
    dur = t[slow][en] - t[slow][st] + 1
    keep = dur >= STOP_S
    mid = slow[(st[keep] + en[keep]) // 2]
    sx, sz, sh = x[mid], z[mid], ((t[mid] // 3600 - 8) // 2).clip(0, 5)
    out = {}
    for a in sec["aisles"]:
        inside = (sx > a["x0"] + 0.25) & (sx < a["x1"] - 0.25) & (sz >= a["z0"]) & (sz <= a["z1"])
        nb = max(1, int(math.ceil((a["z1"] - a["z0"]) / STEP_M)))
        b = ((sz[inside] - a["z0"]) // STEP_M).astype(int).clip(0, nb - 1)
        day_ = np.bincount(b, minlength=nb)
        per = {"giorno": day_.tolist()}
        for k, sl in enumerate(SLOTS[1:]):
            per[sl] = np.bincount(b[sh[inside] == k], minlength=nb).tolist()
        out[str(a["corsia"])] = {"z0": a["z0"], "step": STEP_M, "stops": per}
    return out

def build_day(args):
    day = args.day
    sec = json.load(open(SITE / "sections.json"))
    rows, checks = kpi_rows(args, day)
    slots = {s: {"macro": {}, "cat": {}} for s in SLOTS}
    for r in rows:
        if r["kpi_id"] not in ("category_kpi_macro", "category_kpi_categoria"): continue
        sl, name = r["slot"].split("|", 1)
        if sl not in slots: continue
        p = r.get("payload") or {}
        slots[sl]["macro" if r["kpi_id"] == "category_kpi_macro" else "cat"][name] = {
            "st": r["status"], "why": r.get("status_reason"), "lb": r["label"],
            "min": p.get("minutes_per_customer"), "shelf": p.get("minutes_at_counter"), "ch": p.get("choice_index"),
            "ppl": p.get("people_mean"), "vis": p.get("visits"), "stops": p.get("stops"), "rate": p.get("stop_share"),
            "cov": p.get("coverage_share"), "kind": (p.get("kinds") or [None])[0], "macro": p.get("macro"),
            "src": p.get("fonte_categoria") or []}
    chk = next((c for c in checks if c.get("check_id") == "category_areas_sum_equals_little"), None)
    res = {"schema": "category-day-v1", "day": day, "venue_id": VENUE, "slots": slots,
           "check": {"passed": chk.get("passed"), "detail": chk.get("detail")} if chk else None,
           "thresholds": {"stop_v_mps": STOP_V, "stop_min_s": STOP_S, "step_m": STEP_M}}
    if args.rows and Path(args.rows).exists():
        res["modules"] = module_stops(day, args.rows, sec)
    json.dump(res, open(SITE / f"{day}.json", "w"), separators=(",", ":"), ensure_ascii=False)
    idx_p = SITE / "index.json"
    idx = json.load(open(idx_p)) if idx_p.exists() else {"days": []}
    idx["days"] = sorted(set(idx["days"]) | {day})
    json.dump(idx, open(idx_p, "w"))
    n = sum(len(v["cat"]) for v in slots.values())
    print(f"250 day {day}: {n} category rows, modules {'yes' if 'modules' in res else 'no'} -> {SITE / (day + '.json')}")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["sections", "day"])
    ap.add_argument("day", nargs="?")
    ap.add_argument("--report"); ap.add_argument("--db"); ap.add_argument("--rows")
    a = ap.parse_args()
    if a.cmd == "sections": build_sections()
    else: build_day(a)
