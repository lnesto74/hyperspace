"""Department AREAS — port of analysis/journey_lab/199_department_areas.py §1–4.

Do not change radii or the staff-removal order without recording them in
config/treviglio.json. Walkability grid of 70_topology is NOT used.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from shapely.geometry import box
from shapely.ops import unary_union

R_AREA = 3.0
R_BANCO = 1.0
V_SLOW = 0.4
CELL = 0.25
FIXTURE_STRIP_TOL_M = 0.35
ENTRANCE_BUFFER_M = 1.0
MAP_X, MAP_Z = 80.0, 75.0

FIXTURE_TYPES = ("shelf", "fridge", "isola", "banco", "promo", "tavolo")
DEPT_ORDER = [
    "Frutta", "Verdura", "Surgelati", "Bakery & Breakfast", "Latticini",
    "Carne", "Pesce", "Bar", "Pane", "Salumi", "Gastronomia", "Acqua",
    "Scaffali senza categoria",
]
CORSIE = "Corsie / fuori zona"
INGRESSO = "Ingresso, casse, retro banchi"
SCAFFALI = "Scaffali senza categoria"
CODE_CORSIE = -1
CODE_EXCL = -2

CHOICE_TRAVERSE = 0.25
CHOICE_WORKED = 0.4


def geometry_hash(rois, objects, staff_strips=None) -> str:
    """Stable hash of the twin tables that own the raster."""
    def roi_rec(r):
        verts = r.get("vertices") or r.get("poly")
        if hasattr(verts, "exterior"):
            verts = list(verts.exterior.coords)
        return {
            "id": str(r.get("id", "")),
            "name": r.get("name"),
            "group": r.get("group"),
            "department": r.get("department"),
            "vertices": verts,
        }

    def obj_rec(o):
        poly = o.get("poly")
        coords = list(poly.exterior.coords) if poly is not None and hasattr(poly, "exterior") else o.get("footprint")
        return {
            "id": str(o.get("id", "")),
            "type": o.get("type"),
            "name": o.get("name"),
            "coords": coords,
        }

    payload = {
        "rois": [roi_rec(r) for r in rois],
        "objects": [obj_rec(o) for o in objects],
        "staff_strips": staff_strips or [],
        "r_area": R_AREA,
        "r_banco": R_BANCO,
        "cell": CELL,
        "tol": FIXTURE_STRIP_TOL_M,
    }
    raw = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()[:16]


def fixtures_by_department(rois, objects, depts=None):
    """199 §1: fixtures whose polygon is within 0.35 m of that department's strips."""
    depts = list(depts or DEPT_ORDER)
    strips = {}
    for r in rois:
        if r.get("group") != "SHELF_ENGAGEMENT":
            continue
        d = r.get("department") or SCAFFALI
        strips.setdefault(d, []).append(r["poly"])
    fx = [o for o in objects if o.get("type") in FIXTURE_TYPES and o.get("poly") is not None]
    out = {}
    for d in depts:
        polys = strips.get(d) or []
        if not polys:
            continue
        u = unary_union(polys)
        near = [o["poly"] for o in fx if o["poly"].distance(u) < FIXTURE_STRIP_TOL_M]
        if near:
            out[d] = unary_union(near)
    return out, {d: unary_union(strips[d]) for d in out if strips.get(d)}


def exclusion_union(rois, staff_strips):
    parts = []
    for r in rois:
        if r.get("group") in ("CHECKOUT_QUEUE", "CHECKOUT_SERVICE"):
            parts.append(r["poly"])
        elif r.get("group") == "ENTRANCE":
            parts.append(r["poly"].buffer(ENTRANCE_BUFFER_M))
        elif r.get("group") == "STAFF_ONLY":
            parts.append(r["poly"])
    for s in staff_strips or []:
        parts.append(box(s["x0"], s["z0"], s["x1"], s["z1"]))
    return unary_union(parts) if parts else box(0, 0, 0, 0)


def build_raster(rois, objects, staff_strips=None, cell=CELL, map_x=MAP_X, map_z=MAP_Z, seen=None):
    """199 §2 without the 70_walk grid. Owner = nearest STRIP; reach = fixture distance."""
    FIX, STRIP = fixtures_by_department(rois, objects)
    depts = [d for d in DEPT_ORDER if d in FIX]
    nx, nz = int(map_x / cell), int(map_z / cell)
    xs = (np.arange(nx) + 0.5) * cell
    zs = (np.arange(nz) + 0.5) * cell
    XX, ZZ = np.meshgrid(xs, zs, indexing="ij")
    import shapely
    pts = shapely.points(XX.ravel(), ZZ.ravel())
    EX = exclusion_union(rois, staff_strips)
    excluded = shapely.contains(EX, pts) if not EX.is_empty else np.zeros(pts.shape, dtype=bool)
    if not depts:
        dept_code = np.where(excluded, CODE_EXCL, CODE_CORSIE).reshape(nx, nz)
        banco = np.zeros((nx, nz), dtype=bool)
        return {"dept_code": dept_code, "banco": banco, "depts": depts, "cell": cell,
                "areas_m2": {CORSIE: float((~excluded.reshape(nx, nz)).sum() * cell * cell)}}

    dist = np.full((len(depts), nx * nz), np.inf)
    dstrip = np.full((len(depts), nx * nz), np.inf)
    for i, d in enumerate(depts):
        dist[i] = shapely.distance(pts, FIX[d])
        dstrip[i] = shapely.distance(pts, STRIP[d])
    nearest = dstrip.argmin(0)
    dmin = dist[nearest, np.arange(nx * nz)]
    dept_code = np.where(~excluded & (dmin <= R_AREA), nearest, np.where(excluded, CODE_EXCL, CODE_CORSIE)).reshape(nx, nz)
    banco = (~excluded & (dmin <= R_BANCO)).reshape(nx, nz)
    seen2 = seen.reshape(nx, nz) if seen is not None else np.ones((nx, nz), dtype=bool)
    areas_m2 = {d: float(((dept_code == i) & seen2).sum() * cell * cell) for i, d in enumerate(depts)}
    areas_m2[CORSIE] = float(((dept_code == CODE_CORSIE) & seen2).sum() * cell * cell)
    return {
        "dept_code": dept_code,
        "banco": banco,
        "depts": depts,
        "cell": cell,
        "areas_m2": areas_m2,
        "hash": geometry_hash(rois, objects, staff_strips),
    }


def classify_points(x, z, speed, raster):
    """Map frames to department code + al_banco (banco cell AND speed < 0.4)."""
    cell = float(raster["cell"])
    code = raster["dept_code"]
    ban = raster["banco"]
    nx, nz = code.shape
    ci = np.clip((np.asarray(x) / cell).astype(int), 0, nx - 1)
    cj = np.clip((np.asarray(z) / cell).astype(int), 0, nz - 1)
    dept = code[ci, cj]
    al_banco = ban[ci, cj] & (np.asarray(speed) < V_SLOW) & (dept >= 0)
    return dept, al_banco


def apply_staff_removal(area_pm, banco_pm, staff_pm, entrances):
    """199 §4: subtract staff from Corsie first, remainder from Scaffali (area+banco scaled)."""
    e = max(float(entrances), 1e-9)
    res = {"Personale (tolto)": round(staff_pm / e, 2)}
    corr = float(area_pm.get(CORSIE, 0))
    take_corr = min(staff_pm, corr)
    rest = staff_pm - take_corr
    sc_area = float(area_pm.get(SCAFFALI, 0))
    sc_banco = float(banco_pm.get(SCAFFALI, 0))
    f_sc = max(sc_area - rest, 0) / max(sc_area, 1e-9)
    depts = [k for k in area_pm if k not in (CORSIE, INGRESSO, "Personale (tolto)", "TOTALE")]
    for d in depts:
        a_, b_ = float(area_pm.get(d, 0)), float(banco_pm.get(d, 0))
        if d == SCAFFALI:
            a_, b_ = a_ * f_sc, b_ * f_sc
        res[d] = {"area": round(a_ / e, 2), "al_banco": round(b_ / e, 2)}
    res[CORSIE] = round((corr - take_corr) / e, 2)
    res[INGRESSO] = round(float(area_pm.get(INGRESSO, 0)) / e, 2)
    total_pm = sum(float(area_pm.get(k, 0)) for k in area_pm) - staff_pm
    res["TOTALE"] = round(total_pm / e, 2)
    return res, f_sc


def choice_index(al_banco, area):
    if not area or area <= 0:
        return 0.0
    return round(float(al_banco) / float(area), 3)


def choice_label(idx):
    if idx < CHOICE_TRAVERSE:
        return "reparto attraversato"
    if idx >= CHOICE_WORKED:
        return "lavorato"
    return "intermedio"


def name_for_code(code, depts):
    if code >= 0:
        return depts[int(code)]
    if code == CODE_CORSIE:
        return CORSIE
    return INGRESSO


def save_raster(raster, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        dest,
        dept_code=raster["dept_code"],
        banco=raster["banco"],
        cell=np.array(raster["cell"]),
        depts=np.array(raster["depts"]),
        hash=np.array(raster.get("hash", "")),
    )
    return dest


def load_raster(path: Path):
    z = np.load(path, allow_pickle=True)
    return {
        "dept_code": z["dept_code"],
        "banco": z["banco"].astype(bool),
        "cell": float(z["cell"]),
        "depts": [str(x) for x in z["depts"]],
        "hash": str(z["hash"]) if "hash" in z else None,
    }
