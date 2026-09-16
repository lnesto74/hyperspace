#!/usr/bin/env python3
"""PERCORSO MEDIO DEL CLIENTE — aggregate virtual journey without identity.
minutes per department per customer = measured person-time in the zone / measured entrances (Little's law check);
order of zones from MEASURED within-id transitions + INFERRED high-quality links. Per day and per 2-hour slot."""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import db
import numpy as np, pandas as pd
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt

day = sys.argv[1] if len(sys.argv) > 1 else "2026-09-14"
out = db.OUT / day; W = db.local_window_ms(day); o, c = W["open_ms"], W["close_ms"]; TZ = db.CFG["timezone"]
con = db.connect(); con.execute(f"ATTACH '{out/'jl.duckdb'}' AS jl")
rep = {"day": day}
# department label per ROI: business category, else checkout/entrance, else "Scaffali senza categoria"
con.execute("""CREATE OR REPLACE TABLE jl.roi_dept AS
  SELECT roi_id, roi_name, roi_group, CASE WHEN roi_group='CHECKOUT_QUEUE' THEN 'Coda cassa' WHEN roi_group='CHECKOUT_SERVICE' THEN 'Cassa (servizio)'
       WHEN roi_group='ENTRANCE' THEN 'Ingresso' WHEN department IS NOT NULL THEN department ELSE 'Scaffali senza categoria' END AS dept FROM jl.rois WHERE roi_group <> 'COVERAGE'""")
SLOTS = [(8, 10), (10, 12), (12, 14), (14, 16), (16, 18), (18, 20)]
def slot_expr(col): return f"CASE " + " ".join(f"WHEN hour(to_timestamp({col}/1000) AT TIME ZONE '{TZ}') >= {a} AND hour(to_timestamp({col}/1000) AT TIME ZONE '{TZ}') < {b} THEN '{a:02d}-{b:02d}'" for a, b in SLOTS) + " END"

# 1. entrances (events) per slot: distinct VALID ids crossing the entrance ROI
ent = con.execute(f"""SELECT {slot_expr('t_enter')} slot, count(DISTINCT id) entrances FROM jl.raw_visits v JOIN jl.rois r USING (roi_id)
                      WHERE r.roi_group='ENTRANCE' AND t_enter >= {o} AND t_enter < {c} GROUP BY 1 ORDER BY 1""").fetchdf().set_index("slot").entrances
# 2. person-time in store per slot (VALID ids, frames): sum over frames of people visible / 10 Hz
pt = con.execute(f"""SELECT {slot_expr('r.ts')} slot, count(*)/10.0/60 person_min FROM read_parquet('{db.parquet_path(day)}') r JOIN jl.id_class k USING (id)
                     WHERE k.cls IN ('VALID','STATIC_SUSPECT') AND r.ts >= {o} AND r.ts < {c} GROUP BY 1""").fetchdf().set_index("slot").person_min
# 3. person-time per department per slot (raw visits, MEASURED)
dz = con.execute(f"""SELECT {slot_expr('t_enter')} slot, d.dept, sum(dur_s)/60 person_min, count(*) visits, count(DISTINCT id) ids
                     FROM jl.raw_visits v JOIN jl.roi_dept d USING (roi_id) WHERE t_enter >= {o} AND t_enter < {c} GROUP BY 1,2""").fetchdf()
piv = dz.pivot(index="dept", columns="slot", values="person_min").fillna(0); piv["giorno"] = piv.sum(1)
ent["giorno"] = ent.sum(); pt["giorno"] = pt.sum()
minutes_per_customer = piv / ent   # minutes per entrance
in_roi = piv.sum(0); outside = pt - in_roi
minutes_per_customer.loc["Corsie / fuori zona"] = outside / ent
minutes_per_customer.loc["TOTALE (Little)"] = pt / ent
order = ["Ingresso", "Frutta", "Verdura", "Pane", "Bakery & Breakfast", "Salumi", "Gastronomia", "Carne", "Pesce", "Latticini", "Acqua", "Bar", "Surgelati", "Scaffali senza categoria", "Corsie / fuori zona", "Coda cassa", "Cassa (servizio)", "TOTALE (Little)"]
minutes_per_customer = minutes_per_customer.reindex([r for r in order if r in minutes_per_customer.index])
cols = [f"{a:02d}-{b:02d}" for a, b in SLOTS] + ["giorno"]
minutes_per_customer = minutes_per_customer[cols]
rep["entrances"] = ent.to_dict(); rep["person_minutes_in_store"] = pt.to_dict(); rep["mean_visit_min"] = (pt / ent).to_dict()
rep["minutes_per_customer_by_department"] = minutes_per_customer.round(2).to_dict()
print("entrances per slot:", ent.to_dict()); print("mean visit (min):", (pt / ent).round(1).to_dict())
print("\nMINUTI PER CLIENTE PER REPARTO (misurato / ingressi):\n", minutes_per_customer.round(2).to_string())
# share of customers reaching a department (upper bound: distinct ids / entrances, repeated visits by one person count again)
reach = dz[dz.slot.notna()].groupby("dept").ids.sum() / ent["giorno"]
rep["reach_upper_bound_ids_per_entrance"] = reach.round(2).to_dict()

# 4. transitions between departments: MEASURED (consecutive visits of the same raw id) + INFERRED (accepted links whose ends are in different zones)
con.execute(f"""CREATE OR REPLACE TABLE jl.trans AS
WITH v AS (SELECT v.id, v.t_enter, v.t_exit, d.dept, lead(d.dept) OVER (PARTITION BY v.id ORDER BY v.t_enter) nxt, lead(v.t_enter) OVER (PARTITION BY v.id ORDER BY v.t_enter) t_nxt
           FROM jl.raw_visits v JOIN jl.roi_dept d USING (roi_id) WHERE v.t_enter >= {o} AND v.t_enter < {c})
SELECT dept AS src, nxt AS dst, 'MEASURED' AS source, count(*) n FROM v WHERE nxt IS NOT NULL AND nxt <> dept AND t_nxt - t_exit < 120000 GROUP BY 1,2
UNION ALL
SELECT da.dept, db_.dept, 'INFERRED', count(*) FROM jl.links_vj l JOIN jl.roi_dept da ON da.roi_id = l.a_roi JOIN jl.roi_dept db_ ON db_.roi_id = l.b_roi
WHERE l.reason='LINKED' AND da.dept <> db_.dept AND l.a_t1 >= {o} AND l.a_t1 < {c} GROUP BY 1,2""")
tr = con.execute("SELECT src, dst, sum(n) n, sum(n) FILTER (WHERE source='MEASURED') measured, sum(n) FILTER (WHERE source='INFERRED') inferred FROM jl.trans GROUP BY 1,2").fetchdf()
M = tr.pivot(index="src", columns="dst", values="n").fillna(0)
P = M.div(M.sum(1), axis=0)
rep["transitions_top"] = tr.sort_values("n", ascending=False).head(40).to_dict("records")
rep["transition_share_measured"] = float(tr.measured.sum() / tr.n.sum())
# estimated order of departments (INFERRED): position 0 = Ingresso, 1 = Cassa; each department sits at the flow-weighted
# average of "one step after where people come from" and "one step before where they go" (iterated), then ranked.
depts = sorted(set(M.index) | set(M.columns)); pos = {d: 0.5 for d in depts}; pos["Ingresso"] = 0.0; pos["Cassa (servizio)"] = 1.0; pos["Coda cassa"] = 0.95
for _ in range(200):
    for d in depts:
        if d in ("Ingresso", "Cassa (servizio)", "Coda cassa"): continue
        num = den = 0.0
        for s_ in M.index:
            if s_ != d and d in M.columns and M.loc[s_, d] > 0: num += M.loc[s_, d] * (pos[s_] + 0.05); den += M.loc[s_, d]
        for t_ in M.columns:
            if t_ != d and d in M.index and M.loc[d, t_] > 0: num += M.loc[d, t_] * (pos[t_] - 0.05); den += M.loc[d, t_]
        if den > 0: pos[d] = min(max(num / den, 0.0), 1.0)
rep["estimated_order"] = sorted(((d, round(p_, 3)) for d, p_ in pos.items()), key=lambda x: x[1])
net = {}
for a in M.index:
    for b in M.columns:
        if a < b and (M.loc[a, b] + (M.loc[b, a] if b in M.index and a in M.columns else 0)) > 50:
            ab = M.loc[a, b]; ba = M.loc[b, a] if (b in M.index and a in M.columns) else 0
            net[f"{a} -> {b}"] = {"a_to_b": int(ab), "b_to_a": int(ba), "net_share_forward": round(ab / (ab + ba), 2)}
rep["pairwise_net_flow"] = net
internal = {("Cassa (servizio)", "Coda cassa"), ("Coda cassa", "Cassa (servizio)")}
first = tr[tr.src == "Ingresso"].sort_values("n", ascending=False).head(6)[["dst", "n"]].to_dict("records")
last = tr[(tr.dst == "Coda cassa") & (tr.src != "Cassa (servizio)")].sort_values("n", ascending=False).head(6)[["src", "n"]].to_dict("records")
rep["first_department_after_entrance"] = first; rep["last_department_before_queue(excluding cashier-internal)"] = last
rep["cashier_internal_transitions_service_to_queue"] = int(tr[(tr.src == "Cassa (servizio)") & (tr.dst == "Coda cassa")].n.sum())
zero = [d for d in con.execute("SELECT DISTINCT dept FROM jl.roi_dept").fetchdf().dept if d not in set(dz.dept)]
rep["departments_with_zero_observations"] = zero
print("\nestimated order:", rep["estimated_order"]); print("first after entrance:", first); print("last before queue:", last); print("ZERO-observation departments:", zero)
print(f"transitions: {int(tr.n.sum())} ({rep['transition_share_measured']*100:.0f}% measured within one id, rest inferred links)")
json.dump(rep, open(out / "110_average_journey.json", "w"), indent=1, default=float)
minutes_per_customer.round(2).to_csv(out / "110_minutes_per_customer.csv"); M.to_csv(out / "110_transitions.csv")

fig, ax = plt.subplots(1, 2, figsize=(20, 9))
mp = minutes_per_customer.drop(index=["TOTALE (Little)"])[[f"{a:02d}-{b:02d}" for a, b in SLOTS]]
bottom = np.zeros(len(mp.columns)); cmap = plt.get_cmap("tab20")
for i, (dept, row) in enumerate(mp.iterrows()):
    ax[0].bar(mp.columns, row.values, bottom=bottom, label=dept, color=cmap(i % 20)); bottom += row.values
tot = (pt / ent)[[f"{a:02d}-{b:02d}" for a, b in SLOTS]]
for j, v in enumerate(tot.values): ax[0].text(j, v + 0.3, f"{v:.0f} min\n{int(ent.iloc[j])} ingressi", ha="center", fontsize=9)
ax[0].set_ylabel("minuti per cliente (tempo misurato ÷ ingressi)"); ax[0].set_title(f"Percorso medio del cliente per fascia oraria — {day}"); ax[0].legend(fontsize=7, ncol=2)
Pp = P.reindex(index=[r for r in order if r in P.index], columns=[r for r in order if r in P.columns]).fillna(0)
im = ax[1].imshow(Pp.values, cmap="Blues", vmin=0, vmax=0.5); ax[1].set_xticks(range(len(Pp.columns))); ax[1].set_xticklabels(Pp.columns, rotation=60, ha="right", fontsize=8); ax[1].set_yticks(range(len(Pp.index))); ax[1].set_yticklabels(Pp.index, fontsize=8)
ax[1].set_title("Da dove si va dove: quota delle uscite da ogni reparto (righe) verso il successivo (colonne)"); plt.colorbar(im, ax=ax[1], fraction=0.03)
fig.tight_layout(); fig.savefig(out / "110_average_journey.png", dpi=100); print("wrote 110_average_journey.png")
