"""Journey Lab association engine — reusable pieces shared by the production run, the validation and the sweeps.

    pool      : tracklet table (id, seg, t0, t1, x0, z0, x1, z1, vx0, vz0, vx1, vz1, head0_deg, head1_deg, roi0, roi1, grp0, grp1, n, dur_s, path_m, med_spd)
    candidates: gated (A -> B) pairs with geodesic distance
    score     : explainable weighted score with all components kept
    assign    : sequential windowed Hungarian, one-to-one, no-match option, margin-based acceptance
"""
from __future__ import annotations
import json, math
from pathlib import Path
import numpy as np, pandas as pd
from scipy import sparse, ndimage
from scipy.sparse.csgraph import dijkstra
from scipy.optimize import linear_sum_assignment


class Walk:
    """Geodesic oracle on the walkability grid produced by 70_topology.py."""
    def __init__(self, out_dir: Path, snap_max_m=1.5):
        z = np.load(out_dir / "70_walk.npz"); self.walk = z["walk"]; self.idx = z["idx"]; self.nodes = z["nodes"]; self.cell = float(z["cell"])
        self.G = sparse.load_npz(out_dir / "70_graph.npz")
        dist, (ii, jj) = ndimage.distance_transform_edt(~self.walk, return_indices=True)
        self.snap_d = dist * self.cell; self.snap_i = ii; self.snap_j = jj; self.snap_max = snap_max_m
        self._cache = {}

    def node_of(self, x, z):
        """Nearest walkable node for venue coords (vectorised). Returns node index (-1 if farther than snap_max) and snap distance."""
        ci = np.clip((np.asarray(x) / self.cell).astype(int), 0, self.walk.shape[0] - 1)
        cj = np.clip((np.asarray(z) / self.cell).astype(int), 0, self.walk.shape[1] - 1)
        sd = self.snap_d[ci, cj]; ni = self.idx[self.snap_i[ci, cj], self.snap_j[ci, cj]]
        ni = np.where(sd <= self.snap_max, ni, -1)
        return ni, sd

    def geodesic(self, src_nodes, dst_nodes, limit):
        """Geodesic distance for arrays of (src, dst) node pairs; inf when no path within limit. Batched per unique source."""
        src_nodes = np.asarray(src_nodes); dst_nodes = np.asarray(dst_nodes)
        outd = np.full(len(src_nodes), np.inf)
        ok = (src_nodes >= 0) & (dst_nodes >= 0)
        order = np.argsort(src_nodes[ok]); pos = np.where(ok)[0][order]; s_sorted = src_nodes[pos]
        starts = np.flatnonzero(np.r_[True, s_sorted[1:] != s_sorted[:-1]]); ends = np.r_[starts[1:], len(s_sorted)]
        for a, b in zip(starts, ends):
            s = s_sorted[a]
            d = dijkstra(self.G, indices=s, limit=limit + 1e-6)
            outd[pos[a:b]] = d[dst_nodes[pos[a:b]]]
        return outd


def load_cfg():
    return json.loads((Path(__file__).resolve().parents[1] / "config" / "treviglio.json").read_text())


def candidates(con, pool_tbl: str, A: dict, walk: Walk, hot: dict | None = None, extra_where="TRUE"):
    """Gated (death A -> birth B) pairs from DuckDB, then geodesic filter. Returns a DataFrame with geometry + raw features."""
    tmin, tmax, dmax = A["min_time_gap_s"], A["max_time_gap_s"], A["max_path_distance_m"]
    df = con.execute(f"""
      SELECT a.id a_id, a.seg a_seg, b.id b_id, b.seg b_seg,
             (b.t0 - a.t1)/1000.0 dt_s, sqrt((b.x0-a.x1)^2 + (b.z0-a.z1)^2) d_euclid,
             a.x1 ax, a.z1 az, b.x0 bx, b.z0 bz, a.t1 a_t1, b.t0 b_t0,
             a.vx1 a_vx, a.vz1 a_vz, b.vx0 b_vx, b.vz0 b_vz, a.head1_deg a_head, b.head0_deg b_head,
             a.roi1 a_roi, b.roi0 b_roi, a.grp1 a_grp, b.grp0 b_grp, a.med_spd a_spd, b.med_spd b_spd, a.n a_n, b.n b_n,
             a.mean_h a_h, b.mean_h b_h, a.mean_bh a_bh, b.mean_bh b_bh, a.p95_spd a_p95, b.p95_spd b_p95
      FROM {pool_tbl} a JOIN {pool_tbl} b
        ON b.t0 >= a.t1 + {int(tmin*1000)} AND b.t0 <= a.t1 + {int(tmax*1000)} AND b.id <> a.id AND b.t0 > a.t0 AND b.t1 > a.t1
       AND abs(b.x0 - a.x1) <= {dmax} AND abs(b.z0 - a.z1) <= {dmax}
      WHERE sqrt((b.x0-a.x1)^2 + (b.z0-a.z1)^2) <= {dmax} AND {extra_where}""").fetchdf()
    # geodesic
    sa, sda = walk.node_of(df.ax.values, df.az.values); sb, sdb = walk.node_of(df.bx.values, df.bz.values)
    geo = walk.geodesic(sa, sb, dmax * 1.5)
    df["d_geo"] = np.where(np.isfinite(geo), geo + sda + sdb, np.inf)
    # cells outside the walkable map (snap failed): fall back to euclid * 1.25 and flag
    nosnap = (sa < 0) | (sb < 0)
    df["d_walk"] = np.where(nosnap, df.d_euclid * 1.25, df.d_geo)
    df["topo_ok"] = np.isfinite(df.d_walk) & ~nosnap
    df["no_path"] = ~np.isfinite(df.d_geo) & ~nosnap
    df = df[np.isfinite(df.d_walk) & (df.d_walk <= dmax)].copy()
    df["v_req"] = df.d_walk / np.maximum(df.dt_s, 0.5)
    df = df[df.v_req <= A["max_required_speed_mps"]].copy()
    if hot is not None:
        df["occ_a"] = hot["death"][np.clip((df.ax / hot["cell"]).astype(int), 0, hot["death"].shape[0]-1), np.clip((df.az / hot["cell"]).astype(int), 0, hot["death"].shape[1]-1)]
        df["occ_b"] = hot["birth"][np.clip((df.bx / hot["cell"]).astype(int), 0, hot["birth"].shape[0]-1), np.clip((df.bz / hot["cell"]).astype(int), 0, hot["birth"].shape[1]-1)]
    else:
        df["occ_a"] = 0.5; df["occ_b"] = 0.5
    return df.reset_index(drop=True)


def _ang(a, b): return np.abs((a - b + 180) % 360 - 180)


def score(df: pd.DataFrame, A: dict, existing_same_key: pd.Series | None = None) -> pd.DataFrame:
    """Explainable score S = Σ w_k * s_k, all s_k in [0,1]. Components are kept as columns s_*."""
    w = A["weights"]; wsum = sum(w.values())
    dt = df.dt_s.values; d = df.d_walk.values; v = df.v_req.values
    s_time = np.exp(-np.maximum(dt, 0) / A["tau_time_s"])
    if A.get("path_mode", "residual") == "residual":
        # distance not explained by walking at A's own recent speed during the gap (capped at a brisk walk)
        va_end = np.minimum(np.hypot(df.a_vx, df.a_vz).values, A.get("max_walk_mps", 1.5))
        resid = np.maximum(d - va_end * np.maximum(dt, 0), 0)
        s_path = np.exp(-resid / A["lambda_path_m"])
    else:
        s_path = np.exp(-d / A["lambda_path_m"])
    # stature: centroid height and bbox height consistency (vendor sensor frame); neutral when missing
    dh = np.abs(df.a_h.values - df.b_h.values); dbh = np.abs(df.a_bh.values - df.b_bh.values)
    s_stat = np.exp(-dh / A.get("sigma_h_m", 0.12)) * 0.7 + np.exp(-dbh / A.get("sigma_bh_m", 0.30)) * 0.3
    s_stat = np.where(np.isnan(s_stat), 0.5, s_stat)
    s_speed = np.clip((A["max_required_speed_mps"] - v) / (A["max_required_speed_mps"] - A["speed_soft_mps"]), 0, 1)
    # velocity: cosine between A terminal and B initial vendor velocity, only when both are moving; else neutral
    va = np.hypot(df.a_vx, df.a_vz); vb = np.hypot(df.b_vx, df.b_vz); mv = A["moving_speed_mps"]
    cos_v = (df.a_vx * df.b_vx + df.a_vz * df.b_vz) / np.maximum(va * vb, 1e-9)
    s_vel = np.where((va > mv) & (vb > mv), (1 + cos_v) / 2, 0.5)
    # heading: A exit heading vs bearing A->B, only when A was moving and B is not on top of A
    bearing = np.degrees(np.arctan2(df.bz - df.az, df.bx - df.ax))
    hd = _ang(df.a_head.values, bearing)
    s_head = np.where((va > mv) & (d > 0.5), (1 + np.cos(np.radians(hd))) / 2, 0.5)
    # zone: same roi 1.0, same group 0.8, one side no zone 0.6, queue->service 0.8, service->queue 0.2, otherwise 0.4
    ag, bg = df.a_grp.fillna("none").values, df.b_grp.fillna("none").values
    s_zone = np.where(df.a_roi.values == df.b_roi.values, 1.0,
             np.where(ag == bg, 0.8, np.where((ag == "none") | (bg == "none"), 0.6,
             np.where((ag == "CHECKOUT_QUEUE") & (bg == "CHECKOUT_SERVICE"), 0.8,
             np.where((ag == "CHECKOUT_SERVICE") & (bg == "CHECKOUT_QUEUE"), 0.2, 0.4)))))
    s_occ = np.clip(0.5 * (df.occ_a.values + df.occ_b.values), 0, 1)
    s_exist = existing_same_key.values.astype(float) if existing_same_key is not None else np.full(len(df), 0.5)
    ratio = df.d_walk.values / np.maximum(df.d_euclid.values, 0.3)
    s_topo = np.where(~df.topo_ok.values, 0.3, np.where(ratio <= 1.3, 1.0, np.where(ratio <= 2.0, 0.7, 0.4)))
    # overlap (dt < 0): only plausible if B is born right where A still is
    s_time = np.where(dt < 0, np.where(d <= 1.0, 1.0, 0.2), s_time)
    S = (w["time"]*s_time + w["path"]*s_path + w["speed"]*s_speed + w["velocity"]*s_vel + w["heading"]*s_head + w["zone"]*s_zone + w["occlusion"]*s_occ + w["existing"]*s_exist + w["topology"]*s_topo + w.get("stature", 0.0)*s_stat) / wsum
    out = df.copy()
    for k, v_ in dict(s_time=s_time, s_path=s_path, s_speed=s_speed, s_velocity=s_vel, s_heading=s_head, s_zone=s_zone, s_occlusion=s_occ, s_existing=s_exist, s_topology=s_topo, s_stature=s_stat).items(): out[k] = v_
    out["dh_m"] = dh; out["dbh_m"] = dbh
    out["heading_diff_deg"] = hd; out["velocity_diff_mps"] = np.hypot(df.a_vx - df.b_vx, df.a_vz - df.b_vz); out["score"] = S
    return out


def assign(sc: pd.DataFrame, A: dict) -> pd.DataFrame:
    """Sequential windowed Hungarian. Each death picks at most one birth and each birth at most one death.
    Returns per-death decision rows: chosen candidate (or none), best/second scores, margins, reason."""
    min_s, min_m, win = A["min_score"], A["min_margin"], A["window_s"] * 1000
    sc = sc.sort_values("a_t1").reset_index(drop=True)
    sc["a_key"] = sc.a_id.astype(str) + "#" + sc.a_seg.astype(int).astype(str); sc["b_key"] = sc.b_id.astype(str) + "#" + sc.b_seg.astype(int).astype(str)
    # per-death and per-birth best / second-best over ALL candidates (ambiguity, before exclusivity)
    def top2(key):
        s = sc.sort_values([key, "score"], ascending=[True, False]); r = s.groupby(key).cumcount()
        return s[r == 0].set_index(key).score, s[r == 1].set_index(key).score
    a1, a2 = top2("a_key"); b1, b2 = top2("b_key")
    sc["a_best"] = sc.a_key.map(a1).values; sc["a_second"] = sc.a_key.map(a2).fillna(0.0).values
    sc["b_best"] = sc.b_key.map(b1).values; sc["b_second"] = sc.b_key.map(b2).fillna(0.0).values
    a_codes, a_uni = pd.factorize(sc.a_key); b_codes, b_uni = pd.factorize(sc.b_key)
    score = sc.score.values; win_id = ((sc.a_t1.values - sc.a_t1.min()) // win).astype(int)
    a_best = sc.a_best.values; a_second = sc.a_second.values; b_best = sc.b_best.values; b_second = sc.b_second.values
    claimed = np.zeros(len(b_uni), bool)
    reason = {}; chosen_row = {}
    order = np.argsort(win_id, kind="stable"); bounds = np.flatnonzero(np.r_[True, np.diff(win_id[order]) != 0, True])
    for s0, s1 in zip(bounds[:-1], bounds[1:]):
        rows = order[s0:s1]; rows = rows[~claimed[b_codes[rows]]]
        if len(rows) == 0: continue
        da, di = np.unique(a_codes[rows], return_inverse=True); db_, bi = np.unique(b_codes[rows], return_inverse=True)
        nD, nB = len(da), len(db_)
        cost = np.full((nD, nB + nD), 2.0); cost[np.arange(nD), nB + np.arange(nD)] = 1.0 - min_s
        # keep the best row per (death, birth) pair
        ordr = np.argsort(-score[rows]); best = {}
        for k in ordr:
            key = (di[k], bi[k])
            if key not in best: best[key] = rows[k]
        for (i, j), r in best.items(): cost[i, j] = 1.0 - score[r]
        ri, ci = linear_sum_assignment(cost)
        for i, j in zip(ri, ci):
            dk = da[i]
            if j >= nB: reason[dk] = "UNRESOLVED_NO_MATCH"; continue
            r = best[(i, j)]
            if score[r] < min_s: reason[dk] = "UNRESOLVED_LOW_SCORE"; continue
            if (a_best[r] - a_second[r]) < min_m: reason[dk] = "UNRESOLVED_AMBIGUOUS_DEATH"; continue
            if (b_best[r] - b_second[r]) < min_m: reason[dk] = "UNRESOLVED_AMBIGUOUS_BIRTH"; continue
            reason[dk] = "LINKED"; chosen_row[dk] = r; claimed[db_[j]] = True
    cols = ["dt_s", "d_euclid", "d_walk", "v_req", "heading_diff_deg", "velocity_diff_mps", "a_grp", "b_grp", "a_roi", "b_roi", "occ_a", "occ_b",
            "s_time", "s_path", "s_speed", "s_velocity", "s_heading", "s_zone", "s_occlusion", "s_existing", "s_topology", "s_stature", "dh_m", "dbh_m", "ax", "az", "bx", "bz", "a_t1", "b_t0", "score"]
    dks = np.array(list(reason.keys())); linked = np.array([reason[d] == "LINKED" for d in dks])
    dec = pd.DataFrame({"a_key": a_uni[dks], "reason": [reason[d] for d in dks]})
    dec["b_key"] = None
    if linked.any():
        rows_l = np.array([chosen_row[d] for d in dks[linked]])
        sub = sc.iloc[rows_l]
        dec.loc[linked, "b_key"] = sub.b_key.values
        for c in cols: dec.loc[linked, c] = sub[c].values
        md = (sub.a_best - sub.a_second).values; mb = (sub.b_best - sub.b_second).values
        dec.loc[linked, "margin_death"] = md; dec.loc[linked, "margin_birth"] = mb
        dec.loc[linked, "second_best_death"] = sub.a_second.values; dec.loc[linked, "second_best_birth"] = sub.b_second.values
        dec.loc[linked, "confidence"] = np.minimum(1.0, sub.score.values * np.minimum(1.0, 0.5 + 2.5 * np.minimum(md, mb)))
    return dec
