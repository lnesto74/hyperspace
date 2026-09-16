"""Rasterise ROI polygons (venue metres) to a grid so 54M points can be zone-tagged with a hash join."""
import numpy as np, pandas as pd, shapely
CELL = 0.2
def build(rois: pd.DataFrame, xmin=0, xmax=80, zmin=0, zmax=75):
    xs = np.arange(xmin, xmax, CELL) + CELL/2; zs = np.arange(zmin, zmax, CELL) + CELL/2
    X, Z = np.meshgrid(xs, zs, indexing="ij")
    ci = np.floor(X / CELL).astype(int).ravel(); cj = np.floor(Z / CELL).astype(int).ravel()
    rows = []
    for _, r in rois.iterrows():
        if r["group"] == "COVERAGE": continue
        m = shapely.contains_xy(r["poly"], X.ravel(), Z.ravel())
        if m.any():
            rows.append(pd.DataFrame({"ci": ci[m], "cj": cj[m], "roi_id": r["id"], "roi_name": r["name"], "roi_group": r["group"], "department": r["department"]}))
    t = pd.concat(rows, ignore_index=True)
    # priority: checkout service > queue > entrance > shelf (so overlaps resolve deterministically)
    pr = {"CHECKOUT_SERVICE": 0, "CHECKOUT_QUEUE": 1, "ENTRANCE": 2, "SHELF_ENGAGEMENT": 3, "OTHER": 4}
    t["pr"] = t["roi_group"].map(pr)
    t = t.sort_values(["ci", "cj", "pr", "roi_name"])
    overl = t.duplicated(["ci", "cj"], keep=False).sum()
    t = t.drop_duplicates(["ci", "cj"], keep="first").drop(columns="pr")
    return t, int(overl)
