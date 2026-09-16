"""Store geometry for Treviglio: ROI polygons (semantic groups) + fixture footprints from venue_objects (DWG)."""
from __future__ import annotations
import json, re
from pathlib import Path
import numpy as np, pandas as pd
from shapely.geometry import Polygon, Point, box
from shapely import affinity

def load_rois(day_dir: Path) -> pd.DataFrame:
    r = pd.read_csv(day_dir / "regions_of_interest.csv")
    r["meta"] = r["metadata_json"].fillna("{}").apply(json.loads)
    r["poly"] = r["vertices"].apply(lambda s: Polygon([(p["x"], p["z"]) if isinstance(p, dict) else tuple(p[:2]) for p in json.loads(s)]))
    r["area_m2"] = r["poly"].apply(lambda p: p.area)
    r["cx"] = r["poly"].apply(lambda p: p.centroid.x); r["cz"] = r["poly"].apply(lambda p: p.centroid.y)
    def group(row):
        n, m = row["name"], row["meta"]
        t, zt = m.get("template"), m.get("zoneType")
        if t == "entrance" or n.lower().startswith("entrance"): return "ENTRANCE"
        if t == "cashier-queue" or n.lower().startswith("checkout"):
            if zt == "service" or n.lower().endswith("service"): return "CHECKOUT_SERVICE"
            if zt == "queue" or n.lower().endswith("queue"): return "CHECKOUT_QUEUE"
            return "CHECKOUT_OTHER"
        if "coverage" in n.lower(): return "COVERAGE"
        if t == "shelf-engagement" or "engagement" in n.lower(): return "SHELF_ENGAGEMENT"
        return "OTHER"
    r["group"] = r.apply(group, axis=1)
    r["department"] = r["meta"].apply(lambda m: m.get("business_category_label") or m.get("business_category"))
    r["fixture_type"] = r["meta"].apply(lambda m: m.get("fixtureType"))
    r["checkout_no"] = r["name"].str.extract(r"Checkout (\d+)")[0].astype("Int64")
    return r

def load_objects(day_dir: Path) -> pd.DataFrame:
    o = pd.read_csv(day_dir / "venue_objects.csv")
    o["meta"] = o["metadata_json"].fillna("{}").apply(json.loads)
    polys = []
    for _, row in o.iterrows():
        fp = row["meta"].get("dwg_footprint_points")
        p = None
        if fp and len(fp) >= 3:
            try:
                p = Polygon([(q["x"], q["z"]) if isinstance(q, dict) else tuple(q[:2]) for q in fp])
                if not p.is_valid: p = p.buffer(0)
            except Exception: p = None
        if p is None or p.is_empty:
            # fallback: unit box scaled + rotated about Y, translated (Three.js convention)
            b = box(-0.5, -0.5, 0.5, 0.5)
            b = affinity.scale(b, xfact=row["scale_x"], yfact=row["scale_z"], origin=(0, 0))
            b = affinity.rotate(b, -np.degrees(row["rotation_y"]), origin=(0, 0))
            p = affinity.translate(b, row["position_x"], row["position_z"])
        polys.append(p)
    o["poly"] = polys
    o["area_m2"] = o["poly"].apply(lambda p: p.area)
    return o
