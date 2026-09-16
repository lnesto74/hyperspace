#!/usr/bin/env python3
"""MODI DI STARE IN NEGOZIO — behavioural clustering of reconstructed segments (journeys >= 20 s), then the mix of
behaviours per department and per time slot. Clusters are discovered first (k-means with silhouette, HDBSCAN check),
named only after inspection."""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import db
import numpy as np, pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans, HDBSCAN
from sklearn.metrics import silhouette_score
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt

day = sys.argv[1] if len(sys.argv) > 1 else "2026-09-14"
out = db.OUT / day; W = db.local_window_ms(day); o, c = W["open_ms"], W["close_ms"]; TZ = db.CFG["timezone"]
con = db.connect(); con.execute(f"ATTACH '{out/'jl.duckdb'}' AS jl")
MIN_S = 20
rois = pd.read_csv(out / "20_rois.csv"); banco = set(rois[rois.fixture_type == "banco"].id)
J = con.execute(f"SELECT * FROM jl.journeys_vj WHERE start_time >= {o} AND start_time < {c} AND total_duration_s >= {MIN_S}").fetchdf()
# moving fraction per journey from its tracklets
pool = con.execute("SELECT id||'#'||CAST(seg AS INT) AS k, moving_frac, n, med_spd FROM jl.pool").fetchdf().set_index("k")
keys = J.tracklet_keys.apply(json.loads)
J["moving_frac"] = [float(np.average(pool.loc[k, "moving_frac"], weights=pool.loc[k, "n"])) for k in keys]
# counter (banco) dwell from journey zones
Z = con.execute("SELECT journey_id, roi_id, dwell_s FROM jl.journey_zones_vj").fetchdf()
cnt = Z[Z.roi_id.isin(banco)].groupby("journey_id").dwell_s.sum()
J["counter_dwell_s"] = J.journey_id.map(cnt).fillna(0.0)
J["disp_m"] = np.hypot(J.x1 - J.x0, J.z1 - J.z0)
F = pd.DataFrame({
    "log_duration": np.log1p(J.total_duration_s), "log_path": np.log1p(J.observed_path_m),
    "speed": J.observed_path_m / J.observed_duration_s.clip(lower=1), "moving_frac": J.moving_frac,
    "straightness": (J.disp_m / J.observed_path_m.clip(lower=0.5)).clip(0, 1),
    "share_shelf": (J.shelf_dwell_s / J.observed_duration_s.clip(lower=1)).clip(0, 1), "share_counter": (J.counter_dwell_s / J.observed_duration_s.clip(lower=1)).clip(0, 1),
    "share_queue": (J.queue_dwell_s / J.observed_duration_s.clip(lower=1)).clip(0, 1), "share_service": (J.service_dwell_s / J.observed_duration_s.clip(lower=1)).clip(0, 1),
    "n_departments": J.n_departments.clip(upper=6)})
X = StandardScaler().fit_transform(F.values)
rng = np.random.default_rng(0); samp = rng.choice(len(X), min(12000, len(X)), replace=False)
sil = {}
for k in range(3, 9):
    km = KMeans(k, n_init=5, random_state=0).fit(X[samp]); sil[k] = float(silhouette_score(X[samp], km.labels_, sample_size=6000, random_state=0))
best_k = max(sil, key=sil.get); print("silhouette by k:", {k: round(v, 3) for k, v in sil.items()}, "-> k =", best_k)
km = KMeans(best_k, n_init=10, random_state=0).fit(X); J["cluster"] = km.labels_
hdb = HDBSCAN(min_cluster_size=400, min_samples=20).fit(X[samp]); hl = pd.Series(hdb.labels_)
print("HDBSCAN on sample: clusters", hl[hl >= 0].nunique(), "noise share", round((hl < 0).mean(), 3), "sizes", hl[hl >= 0].value_counts().head(8).tolist())
# profile
prof = J.groupby("cluster").agg(n=("journey_id", "size"), dur_s=("total_duration_s", "median"), path_m=("observed_path_m", "median"), speed=("observed_path_m", lambda s: float((s / J.loc[s.index, "observed_duration_s"].clip(lower=1)).median())),
                                moving=("moving_frac", "median"), straight=("disp_m", lambda s: float((s / J.loc[s.index, "observed_path_m"].clip(lower=0.5)).clip(0, 1).median())),
                                shelf_share=("shelf_dwell_s", lambda s: float((s / J.loc[s.index, "observed_duration_s"].clip(lower=1)).median())), counter_share=("counter_dwell_s", lambda s: float((s / J.loc[s.index, "observed_duration_s"].clip(lower=1)).median())),
                                queue_share=("queue_dwell_s", lambda s: float((s / J.loc[s.index, "observed_duration_s"].clip(lower=1)).median())), service_share=("service_dwell_s", lambda s: float((s / J.loc[s.index, "observed_duration_s"].clip(lower=1)).median())),
                                n_dept=("n_departments", "median"), n_tracklets=("n_tracklets", "mean"), conf=("confidence", "median"))
prof["share"] = prof.n / prof.n.sum()
print(prof.round(2).to_string())
# naming rules, applied after inspection (thresholds are on the profile medians, reported)
def name(r):
    if r.service_share >= 0.3: return "In cassa (servizio)"
    if r.queue_share >= 0.3: return "In coda"
    if r.counter_share >= 0.3: return "Al banco servito"
    if r.shelf_share >= 0.4 and r.moving < 0.35: return "Fermo a scaffale (sceglie)"
    if r.moving >= 0.5 and r.straight >= 0.5: return "Passaggio dritto"
    if r.dur_s >= 60: return "Giro lungo in corsia"
    if r.moving < 0.3: return "Fermo in corsia (fuori zona)"
    return "Movimento con soste brevi"
prof["name"] = [name(r) for r in prof.itertuples()]
J["behaviour"] = J.cluster.map(prof.name)
print(prof[["n", "share", "name"]].to_string())
# mix per department (time share) and per slot (count share)
Zd = Z.merge(J[["journey_id", "behaviour"]], on="journey_id").merge(con.execute("SELECT roi_id, dept FROM jl.roi_dept").fetchdf(), on="roi_id")
dept_mix = Zd.groupby(["dept", "behaviour"]).dwell_s.sum().unstack().fillna(0); dept_mix = dept_mix.div(dept_mix.sum(1), axis=0)
J["slot"] = pd.cut(pd.to_datetime(J.start_time, unit="ms", utc=True).dt.tz_convert(TZ).dt.hour, [8, 10, 12, 14, 16, 18, 20], right=False, labels=["08-10", "10-12", "12-14", "14-16", "16-18", "18-20"])
slot_mix = J.groupby(["slot", "behaviour"], observed=True).size().unstack().fillna(0); slot_mix = slot_mix.div(slot_mix.sum(1), axis=0)
print("\nMIX PER REPARTO (quota del tempo misurato):\n", dept_mix.round(2).to_string()); print("\nMIX PER FASCIA (quota dei segmenti):\n", slot_mix.round(2).to_string())
rep = {"segments": len(J), "min_duration_s": MIN_S, "silhouette_by_k": sil, "k": best_k, "hdbscan_sample": {"clusters": int(hl[hl >= 0].nunique()), "noise_share": float((hl < 0).mean())},
       "cluster_profiles": prof.round(3).reset_index().to_dict("records"), "naming_rules": "service>=.3 | queue>=.3 | counter>=.3 | shelf>=.4 & moving<.35 | moving>=.5 & straight>=.5 | dur>=60 | moving<.3 | else",
       "dept_mix_time_share": dept_mix.round(3).to_dict(), "slot_mix_segment_share": slot_mix.round(3).to_dict(), "features": list(F.columns)}
json.dump(rep, open(out / "120_behaviour_clusters.json", "w"), indent=1, default=float)
J[["journey_id", "cluster", "behaviour", "total_duration_s", "observed_path_m", "moving_frac", "n_departments", "confidence"]].to_parquet(out / "120_segments_behaviour.parquet", index=False)
fig, ax = plt.subplots(1, 3, figsize=(24, 8))
pp = prof.set_index("name")[["speed", "moving", "straight", "shelf_share", "counter_share", "queue_share", "service_share"]]
im = ax[0].imshow(pp.values, cmap="YlGnBu", vmin=0, vmax=1, aspect="auto"); ax[0].set_xticks(range(pp.shape[1])); ax[0].set_xticklabels(pp.columns, rotation=45, ha="right"); ax[0].set_yticks(range(len(pp))); ax[0].set_yticklabels([f"{n} (n={int(prof.n[i])})" for i, n in zip(prof.index, prof.name)])
ax[0].set_title("Profilo dei modi di stare in negozio (mediane)"); plt.colorbar(im, ax=ax[0], fraction=0.04)
dm = dept_mix.reindex(["Frutta", "Verdura", "Bakery & Breakfast", "Carne", "Pesce", "Latticini", "Acqua", "Bar", "Surgelati", "Scaffali senza categoria", "Coda cassa", "Cassa (servizio)"]).dropna(how="all")
dm.plot.barh(stacked=True, ax=ax[1], colormap="tab10"); ax[1].set_title("Mix di comportamenti per reparto (quota del tempo misurato)"); ax[1].set_xlim(0, 1); ax[1].legend(fontsize=7)
slot_mix.plot.bar(stacked=True, ax=ax[2], colormap="tab10"); ax[2].set_title("Mix di comportamenti per fascia oraria (quota dei segmenti)"); ax[2].set_ylim(0, 1); ax[2].legend(fontsize=7)
fig.tight_layout(); fig.savefig(out / "120_behaviour_clusters.png", dpi=100); print("wrote 120_behaviour_clusters.png")
