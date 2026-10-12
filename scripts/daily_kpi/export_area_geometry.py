#!/usr/bin/env python3
"""Export the department-area geometry that the Visitor Journey KPIs are measured on.

Same raster as analysis/journey_lab/199_department_areas.py (via scripts/daily_kpi/department_areas.py):
0.25 m cells, nearest department strip owns the floor, 3 m reach from the department fixtures,
1 m "al banco" band, checkout queue/service ROIs + entrance (+1 m) + staff strips excluded.

The windflow map paints these polygons, so the colour on the floor is the area the number was
measured on. Also exports the checkout queue/service ROI polygons per lane and the entrance.

Usage:
  python3 scripts/daily_kpi/export_area_geometry.py --day 2026-09-14 \
      --out frontend/public/flowfield/visitor-areas.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import box, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "daily_kpi"))
sys.path.insert(0, str(ROOT / "analysis" / "journey_lab" / "lib"))
import department_areas as DA  # noqa: E402
import geometry as G  # noqa: E402

SIMPLIFY_M = 0.12


def rings(geom):
    """Exterior rings (and holes) as [[x, z], ...] lists, simplified."""
    if geom.is_empty:
        return []
    geom = geom.simplify(SIMPLIFY_M, preserve_topology=True)
    polys = [geom] if geom.geom_type == "Polygon" else list(getattr(geom, "geoms", []))
    out = []
    for p in polys:
        if p.geom_type != "Polygon" or p.area < 0.2:
            continue
        out.append({
            "outer": [[round(x, 2), round(z, 2)] for x, z in p.exterior.coords[:-1]],
            "holes": [[[round(x, 2), round(z, 2)] for x, z in h.coords[:-1]] for h in p.interiors if len(h.coords) > 3],
        })
    return out


def cells_to_geom(mask, cell):
    ii, jj = np.nonzero(mask)
    if not len(ii):
        return shapely.Polygon()
    boxes = shapely.box(ii * cell, jj * cell, (ii + 1) * cell, (jj + 1) * cell)
    return unary_union(boxes)


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--day", default="2026-09-14")
    p.add_argument("--data", default=str(ROOT / "analysis" / "journey_lab" / "data"))
    p.add_argument("--staff", default=None, help="160_staff.json (defaults to config staff_strips)")
    p.add_argument("--seen", default=None, help="50_grids.npz: keep only cells the sensor observed (as 199 does for m²)")
    p.add_argument("--out", required=True)
    a = p.parse_args(argv)

    day_dir = Path(a.data) / a.day
    rois_df = G.load_rois(day_dir)
    objs_df = G.load_objects(day_dir)
    cfg = json.load(open(ROOT / "analysis" / "journey_lab" / "config" / "treviglio.json"))
    strips = cfg.get("staff_strips") or []
    if a.staff and Path(a.staff).exists():
        strips = json.load(open(a.staff)).get("staff_strips") or strips

    rois = [{"group": r.group, "department": (r.department if isinstance(r.department, str) else None),
             "poly": r.poly, "name": r["name"], "checkout_no": r.checkout_no} for _, r in rois_df.iterrows()]
    objects = [{"type": o.type, "poly": o.poly} for _, o in objs_df.iterrows()] if "type" in objs_df else []
    if not objects and "object_type" in objs_df:
        objects = [{"type": o.object_type, "poly": o.poly} for _, o in objs_df.iterrows()]

    R = DA.build_raster(rois, objects, staff_strips=strips)
    cell = R["cell"]
    nx, nz = R["dept_code"].shape
    seen = np.ones((nx, nz), dtype=bool)
    if a.seen and Path(a.seen).exists():
        g50 = np.load(a.seen)["T"]
        xs = (np.arange(nx) + 0.5) * cell
        zs = (np.arange(nz) + 0.5) * cell
        XX, ZZ = np.meshgrid(xs, zs, indexing="ij")
        seen = g50[np.clip(XX.astype(int), 0, g50.shape[0] - 1), np.clip(ZZ.astype(int), 0, g50.shape[1] - 1)] > 0
    departments = []
    for i, d in enumerate(R["depts"]):
        area = (R["dept_code"] == i) & seen
        banco = area & R["banco"]
        ga, gb = cells_to_geom(area, cell), cells_to_geom(banco, cell)
        c = ga.representative_point() if not ga.is_empty else None
        departments.append({
            "id": d,
            "area_m2": round(float(area.sum() * cell * cell), 2),
            "area": rings(ga),
            "banco": rings(gb),
            "label": [round(c.x, 2), round(c.y, 2)] if c is not None else None,
        })

    lanes = {}
    for r in rois:
        if r["group"] not in ("CHECKOUT_QUEUE", "CHECKOUT_SERVICE") or r["checkout_no"] is None or str(r["checkout_no"]) == "<NA>":
            continue
        n = int(r["checkout_no"])
        rec = lanes.setdefault(n, {"lane": n, "queue": [], "service": []})
        rec["queue" if r["group"] == "CHECKOUT_QUEUE" else "service"] += rings(r["poly"])
    entrance = unary_union([r["poly"] for r in rois if r["group"] == "ENTRANCE"])

    out = {
        "schema": "visitor-areas-v1",
        "venue_id": cfg.get("venue_id"),
        "geometry_day": a.day,
        "frame": "venue metres (x, z) — same frame as layout_prod.json and the flow field",
        "method": "199 department raster: 0.25 m cells, nearest strip owns, 3 m reach, 1 m al banco; "
                  "checkout ROIs, entrance +1 m and staff strips excluded",
        "hash": R.get("hash"),
        "observed_mask": bool(a.seen and Path(a.seen).exists()),
        "cell_m": cell,
        "departments": departments,
        "lanes": [lanes[k] for k in sorted(lanes)],
        "entrance": rings(entrance),
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {a.out}: {len(departments)} departments, {len(lanes)} lanes, hash {R.get('hash')}")
    for d in departments:
        print(f"  {d['id']:26s} {d['area_m2']:7.1f} m²  polys {len(d['area'])}")


if __name__ == "__main__":
    main()
