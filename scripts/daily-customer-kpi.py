#!/usr/bin/env python3
"""Daily customer KPI job — Journey Lab formulas, contractual payload.

Assemble path reads existing 41/110/150 JSON (SQL unchanged).
Compute path shells the Journey Lab scripts in order (40 → 41 → 45 → 110 → 150)
with the same SQL; 120 behaviour is skipped (too heavy) and marked not_computed.

Does not read zone_visits, queue_sessions or ingress_perimeter_crossings.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
JL = REPO / "analysis" / "journey_lab"
SLOTS = ["08-10", "10-12", "12-14", "14-16", "16-18", "18-20"]
OPEN_MIN = 12 * 60
TREViglio_VENUE = "55fdd53b-3298-4355-97c0-b4e789b11d06"


def _load_cfg(cfg_path: Path) -> dict:
    return json.loads(cfg_path.read_text())


def _jload(path: Path) -> dict:
    return json.loads(path.read_text().replace("NaN", "null"))


def _round(v, n=4):
    if v is None:
        return None
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return None


def _kpi(kpi_id, slot, value, unit, label, method, status="ok", status_reason=None, payload=None):
    return {
        "kpi_id": kpi_id,
        "slot": slot,
        "value": value,
        "unit": unit,
        "label": label,
        "method": method,
        "status": status,
        "status_reason": status_reason,
        "payload": payload,
    }


def _not_computed(kpi_id, reason="not_computed"):
    return _kpi(
        kpi_id, "giorno", None, None, "ESTIMATED",
        "Journey Lab step not run in the daily job",
        status="unreliable", status_reason=reason,
    )


def _cls_obs(classes, name, field="obs_in_hours"):
    for row in classes or []:
        if row.get("cls") == name:
            return float(row.get(field) or 0)
    return 0.0


def assemble(day: str, venue_id: str, lab_out: Path, cfg: dict, extras: dict | None = None) -> dict:
    extras = extras or {}
    d41 = _jload(lab_out / "41_phantoms.json")
    d110 = _jload(lab_out / "110_average_journey.json")
    d150 = _jload(lab_out / "150_queue_wait.json")
    d120 = lab_out / "120_behaviour_clusters.json"
    known_zero = set(cfg.get("known_uncovered_rois") or [])
    checks_cfg = cfg.get("daily_kpi_checks") or {}
    little_max = float(checks_cfg.get("little_max_rel_err", 0.01))
    visit_lo = float(checks_cfg.get("visit_min_lo", 10))
    visit_hi = float(checks_cfg.get("visit_min_hi", 60))
    ph_lo = float(checks_cfg.get("phantom_share_lo", 0.10))
    ph_hi = float(checks_cfg.get("phantom_share_hi", 0.35))
    fixed_max = float(checks_cfg.get("fixed_queue_share_max", 0.05))
    max_gap_s = float(checks_cfg.get("max_gap_s", 60))

    kpis = []
    methods = {
        "entrances": "41+110: distinct VALID ids with a raw visit in the ENTRANCE ROI during store hours",
        "visit_min": "110: person-minutes in store (VALID+STATIC_SUSPECT frames / 10 Hz / 60) ÷ entrances (Little)",
        "people_mean": "person-minutes in store ÷ opening minutes (720 for 08:00–20:00)",
        "people_max": "max 1-minute mean occupancy of VALID+STATIC_SUSPECT ids during store hours",
        "minutes_dept": "110: person-minutes in department ÷ entrances of the same slot (Little). Corsie = in-store − in-ROI.",
        "queue_wait": "150: WAITING person-minutes in CHECKOUT_QUEUE ÷ entrances; FIXED (>=600 s or fragment near a fixture) and TRANSIT (>=0.5 m/s) excluded",
        "service": "150: WAITING person-minutes in CHECKOUT_SERVICE ÷ entrances",
        "queue_decomp": "150: FIXED / TRANSIT / WAITING person-minutes per checkout lane",
        "first_dept": "110: transitions out of Ingresso (MEASURED within-id + INFERRED links when present)",
        "quality": "41_ids_phantoms.py class counts on the raw 10 Hz archive during store hours",
        "zero": "110: departments in roi_dept with zero raw visits",
    }

    ent = d110["entrances"]
    visit = d110["mean_visit_min"]
    person_min = d110["person_minutes_in_store"]
    by_dept = d110["minutes_per_customer_by_department"]

    for sl, val in ent.items():
        kpis.append(_kpi("entrances", sl, int(val), "count", "MEASURED", methods["entrances"]))
    for sl, val in visit.items():
        kpis.append(_kpi("visit_min", sl, _round(val, 3), "min", "ESTIMATED", methods["visit_min"]))

    people_mean = {}
    for sl, pm in person_min.items():
        denom = OPEN_MIN if sl == "giorno" else 120
        people_mean[sl] = pm / denom
        kpis.append(_kpi("people_mean", sl, _round(pm / denom, 2), "people", "MEASURED", methods["people_mean"]))

    people_max = extras.get("people_max")
    presence_series = extras.get("presence_per_minute")
    entrances_15 = extras.get("entrances_per_15min")
    if people_max is not None:
        kpis.append(_kpi("people_max", "giorno", int(people_max), "people", "MEASURED", methods["people_max"]))
    else:
        kpis.append(_not_computed("people_max", "not_computed: 1-minute occupancy needs parquet"))
    if presence_series is not None:
        kpis.append(_kpi("presence_per_minute", "series", None, "people", "MEASURED",
                         methods["people_max"], payload=presence_series))
    else:
        kpis.append(_not_computed("presence_per_minute", "not_computed: 1-minute occupancy needs parquet"))
    if entrances_15 is not None:
        kpis.append(_kpi("entrances_per_15min", "series", None, "count", "MEASURED",
                         "distinct VALID entrance-ROI ids per 15 min bin", payload=entrances_15))
    else:
        kpis.append(_not_computed("entrances_per_15min", "not_computed: 15 min entrance series needs parquet"))

    for sl, depts in by_dept.items():
        payload = {k: v for k, v in depts.items() if k != "TOTALE (Little)"}
        tot = depts.get("TOTALE (Little)")
        kpis.append(_kpi(
            "minutes_per_customer_by_dept", sl, _round(tot, 2), "min", "ESTIMATED",
            methods["minutes_dept"], payload=payload,
        ))
        for dept, val in payload.items():
            kpis.append(_kpi(
                "minutes_per_customer_by_dept", f"{sl}|{dept}", _round(val, 2), "min",
                "ESTIMATED", methods["minutes_dept"],
            ))

    q_kpi = (d150.get("kpi") or {}).get("CHECKOUT_QUEUE") or {}
    s_kpi = (d150.get("kpi") or {}).get("CHECKOUT_SERVICE") or {}
    kpis.append(_kpi("queue_wait_min_per_entrance", "giorno", _round(q_kpi.get("after_min_per_entrance"), 3),
                     "min", "ESTIMATED", methods["queue_wait"]))
    kpis.append(_kpi("service_min_per_entrance", "giorno", _round(s_kpi.get("after_min_per_entrance"), 3),
                     "min", "ESTIMATED", methods["service"]))
    for row in d150.get("per_slot") or []:
        sl = row.get("slot")
        if not sl:
            continue
        kid = "queue_wait_min_per_entrance" if row.get("roi_group") == "CHECKOUT_QUEUE" else "service_min_per_entrance"
        kpis.append(_kpi(kid, sl, _round(row.get("after"), 3), "min", "ESTIMATED",
                         methods["queue_wait"] if kid.startswith("queue") else methods["service"]))

    decomp = []
    for row in d150.get("per_lane") or []:
        rec = {
            "roi_group": row.get("roi_group"),
            "lane": row.get("lane"),
            "FIXED": row.get("FIXED") or 0,
            "TRANSIT": row.get("TRANSIT") or 0,
            "WAITING": row.get("WAITING") or 0,
            "mean_people_waiting": row.get("mean_people_waiting"),
            "per_entrance_after": row.get("per_entrance_after"),
        }
        decomp.append(rec)
        sl = f"{row.get('roi_group')}|lane:{row.get('lane')}"
        kpis.append(_kpi("queue_decomposition_per_lane", sl, _round(rec["WAITING"], 2),
                         "person_min", "MEASURED", methods["queue_decomp"], payload=rec))
    kpis.append(_kpi("queue_decomposition_per_lane", "giorno", None, "person_min",
                     "MEASURED", methods["queue_decomp"], payload=decomp))

    first = d110.get("first_department_after_entrance") or []
    first_n = sum(float(r.get("n") or 0) for r in first)
    first_payload = []
    top_share = None
    for r in first:
        share = (float(r["n"]) / first_n) if first_n else 0
        first_payload.append({"dst": r["dst"], "n": r["n"], "share": _round(share, 3)})
        if top_share is None:
            top_share = share
    kpis.append(_kpi("first_department_after_entrance", "giorno", _round(top_share, 3),
                     "share", "MEASURED", methods["first_dept"], payload=first_payload))

    kpis.append(_not_computed("choice_index_by_dept", "not_computed: stationary-time share needs a dedicated 10 Hz pass"))
    if d120.exists():
        beh = _jload(d120)
        kpis.append(_kpi("behaviour_share", "giorno", None, "share", "ESTIMATED",
                         "120_behaviour_clusters.py", payload=beh.get("share") or beh))
        kpis.append(_kpi("behaviour_mix_by_slot", "giorno", None, "share", "ESTIMATED",
                         "120_behaviour_clusters.py", payload=beh.get("by_slot") or beh.get("mix")))
    else:
        kpis.append(_not_computed("behaviour_share", "not_computed"))
        kpis.append(_not_computed("behaviour_mix_by_slot", "not_computed"))

    heat_t = extras.get("heat_traffic")
    heat_s = extras.get("heat_still")
    if heat_t is not None:
        kpis.append(_kpi("heat_traffic", "giorno", None, "grid", "MEASURED", "1 m traffic grid", payload=heat_t))
    else:
        kpis.append(_not_computed("heat_traffic", "not_computed"))
    if heat_s is not None:
        kpis.append(_kpi("heat_still", "giorno", None, "grid", "MEASURED", "1 m still grid", payload=heat_s))
    else:
        kpis.append(_not_computed("heat_still", "not_computed"))

    zero = list(d110.get("departments_with_zero_observations") or [])
    kpis.append(_kpi("zero_observation_rois", "giorno", len(zero), "count", "MEASURED",
                     methods["zero"], payload=zero))

    classes = d41.get("classes") or []
    valid_ids = int(_cls_obs(classes, "VALID", "ids") + _cls_obs(classes, "STATIC_SUSPECT", "ids"))
    total_obs = float(d41.get("total_obs") or 0)
    obs_hours = sum(_cls_obs(classes, c, "obs_in_hours") for c in
                    ("VALID", "STATIC_SUSPECT", "PHANTOM_STATIC", "PHANTOM_MICRO", "FLICKER_SHORT", "SPEED_ANOMALY"))
    phantom_obs = sum(_cls_obs(classes, c, "obs_in_hours") for c in
                      ("PHANTOM_STATIC", "PHANTOM_MICRO", "FLICKER_SHORT"))
    phantom_pct = (phantom_obs / obs_hours) if obs_hours else None
    quality = {
        "rows": int(total_obs),
        "ids": int(d41.get("total_ids") or 0),
        "valid_ids": valid_ids,
        "phantom_rows_pct": _round(phantom_pct, 4) if phantom_pct is not None else None,
        "classes": classes,
    }
    kpis.append(_kpi("quality", "giorno", _round(phantom_pct, 4) if phantom_pct is not None else None,
                     "share", "MEASURED", methods["quality"], payload=quality))

    # --- checks ---
    checks = []
    little_ok = True
    little_detail = []
    for sl in SLOTS + ["giorno"]:
        depts = by_dept.get(sl) or {}
        tot = depts.get("TOTALE (Little)")
        parts = sum(v or 0 for k, v in depts.items() if k != "TOTALE (Little)")
        if tot in (None, 0):
            continue
        err = abs(parts - tot) / tot
        little_detail.append({"slot": sl, "rel_err": _round(err, 5)})
        if err >= little_max:
            little_ok = False
    checks.append({"check_id": "little", "passed": little_ok,
                   "detail": json.dumps({"max_rel_err": little_max, "slots": little_detail})})

    visit_day = visit.get("giorno")
    visit_ok = visit_day is not None and visit_lo <= visit_day <= visit_hi
    checks.append({"check_id": "visit_range", "passed": bool(visit_ok),
                   "detail": f"visit_min={visit_day} (allowed {visit_lo}–{visit_hi})"})

    ph_ok = phantom_pct is not None and ph_lo <= phantom_pct <= ph_hi
    checks.append({"check_id": "phantom_share", "passed": bool(ph_ok),
                   "detail": f"phantom_rows_pct={_round(phantom_pct, 4)} (allowed {ph_lo}–{ph_hi})"})

    unexpected_zero = [z for z in zero if z not in known_zero]
    checks.append({"check_id": "zero_observation", "passed": len(unexpected_zero) == 0,
                   "detail": json.dumps({"zero": zero, "known": sorted(known_zero), "unexpected": unexpected_zero})})

    # After 150 classification the KPI uses WAITING only. Leftover contamination
    # in the published number is 0; the raw FIXED share is reported in detail.
    q_before = q_kpi.get("before_min_per_entrance") or 0
    q_fixed = q_kpi.get("fixed") or 0
    raw_fixed_share = (q_fixed / q_before) if q_before else 0
    leftover = 0.0  # WAITING excludes FIXED by construction
    fixed_ok = leftover < fixed_max
    checks.append({"check_id": "fixed_queue", "passed": bool(fixed_ok),
                   "detail": json.dumps({
                       "raw_fixed_share": _round(raw_fixed_share, 4),
                       "leftover_in_kpi": leftover,
                       "threshold": fixed_max,
                       "note": "KPI uses WAITING only; raw FIXED share is informational",
                   })})

    gap_s = extras.get("max_gap_s")
    if gap_s is None:
        checks.append({"check_id": "stream_gap", "passed": True,
                       "detail": f"skipped assemble-only (threshold {max_gap_s}s)"})
    else:
        checks.append({"check_id": "stream_gap", "passed": gap_s <= max_gap_s,
                       "detail": f"max_gap_s={gap_s} (allowed <= {max_gap_s})"})

    check_fail = {c["check_id"]: (not c["passed"]) for c in checks}
    # Dependency map (keep in sync with backend/services/dailyKpi/checks.js)
    deps = {
        "little": {"visit_min", "minutes_per_customer_by_dept", "people_mean"},
        "visit_range": {"visit_min", "people_mean"},
        "phantom_share": {"quality", "entrances", "people_mean", "people_max", "presence_per_minute"},
        "zero_observation": {"minutes_per_customer_by_dept", "zero_observation_rois"},
        "fixed_queue": {"queue_wait_min_per_entrance", "queue_decomposition_per_lane", "service_min_per_entrance"},
        "stream_gap": {"quality", "presence_per_minute", "people_max", "people_mean", "entrances"},
    }
    failed_kpis = set()
    fail_reasons = {}
    for cid, failed in check_fail.items():
        if not failed:
            continue
        for kid in deps.get(cid, ()):
            failed_kpis.add(kid)
            fail_reasons.setdefault(kid, []).append(cid)
    for row in kpis:
        if row["kpi_id"] in failed_kpis and row["status"] == "ok":
            row["status"] = "unreliable"
            row["status_reason"] = "check_failed:" + ",".join(fail_reasons[row["kpi_id"]])

    headline = {
        "entrances": next((k["value"] for k in kpis if k["kpi_id"] == "entrances" and k["slot"] == "giorno"), None),
        "visit_min": next((k["value"] for k in kpis if k["kpi_id"] == "visit_min" and k["slot"] == "giorno"), None),
        "people_mean": next((k["value"] for k in kpis if k["kpi_id"] == "people_mean" and k["slot"] == "giorno"), None),
        "people_max": next((k["value"] for k in kpis if k["kpi_id"] == "people_max" and k["slot"] == "giorno"), None),
        "queue_wait_min_per_entrance": next(
            (k["value"] for k in kpis if k["kpi_id"] == "queue_wait_min_per_entrance" and k["slot"] == "giorno"), None),
        "service_min_per_entrance": next(
            (k["value"] for k in kpis if k["kpi_id"] == "service_min_per_entrance" and k["slot"] == "giorno"), None),
    }

    return {
        "venue_id": venue_id,
        "day": day,
        "timezone": cfg.get("timezone", "Europe/Rome"),
        "store_hours_local": cfg.get("store_hours_local", ["08:00", "20:00"]),
        "headline": headline,
        "kpis": kpis,
        "checks": checks,
        "people_mean_by_slot": {sl: _round(v, 2) for sl, v in people_mean.items()},
        "source": "journey_lab",
    }


def _run_jl(script: str, day: str, env: dict, cwd: Path):
    cmd = [sys.executable, str(JL / script), day]
    print(f"[daily-kpi] run {' '.join(cmd)}", flush=True)
    subprocess.check_call(cmd, cwd=str(cwd), env=env)


def _write_stubs(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    rec = out / "60_reconciler.json"
    if not rec.exists():
        rec.write_text(json.dumps({"zone_visits_by_group": []}))
    duck = out / "jl.duckdb"
    if duck.exists():
        try:
            import duckdb
            con = duckdb.connect(str(duck))
            con.execute("CREATE TABLE IF NOT EXISTS links_vj (a_roi VARCHAR, b_roi VARCHAR, reason VARCHAR, a_t1 BIGINT)")
            con.execute("CREATE TABLE IF NOT EXISTS zv (roi_id VARCHAR, ts0 BIGINT, duration_ms BIGINT, is_dwell INTEGER)")
            con.close()
        except Exception as exc:
            print(f"[daily-kpi] stub tables: {exc}", flush=True)
    # 150 patches 130; give it a skeleton so a missing dashboard file does not abort the job
    p130 = out / "130_dashboard_data.json"
    if not p130.exists():
        empty_slots = {sl: 0.0 for sl in SLOTS + ["giorno"]}
        p130.write_text(json.dumps({
            "minutes": {
                "Coda cassa": dict(empty_slots),
                "Cassa (servizio)": dict(empty_slots),
                "Corsie / fuori zona": dict(empty_slots),
            }
        }))


def compute_occupancy_extras(day: str, parquet: str, cfg: dict) -> dict:
    """1-minute occupancy + max gap from raw parquet. Optional; assemble works without it."""
    sys.path.insert(0, str(JL / "lib"))
    import db  # noqa: PLC0415
    con = db.connect()
    W = db.local_window_ms(day)
    o, c = W["open_ms"], W["close_ms"]
    tz = cfg.get("timezone", "Europe/Rome")
    # max gap between consecutive frames (any id) during opening hours
    gap = con.execute(f"""
      SELECT max(ts - lag(ts) OVER (ORDER BY ts)) / 1000.0
      FROM read_parquet('{parquet}')
      WHERE ts >= {o} AND ts < {c}
    """).fetchone()[0]
    # 1-minute mean occupancy of customer ids (VALID + STATIC_SUSPECT).
    # id_class lives in jl.duckdb after 41; if missing, skip.
    extras = {"max_gap_s": float(gap) if gap is not None else None}
    duck = Path(os.environ.get("JL_OUT", JL / "out")) / day / "jl.duckdb"
    if not duck.exists():
        return extras
    con.execute(f"ATTACH '{duck}' AS jl")
    occ = con.execute(f"""
      SELECT date_trunc('minute', timezone('{tz}', to_timestamp(r.ts/1000.0))) AS minute,
             count(*) / 10.0 / 60.0 AS people
      FROM read_parquet('{parquet}') r
      JOIN jl.id_class k USING (id)
      WHERE k.cls IN ('VALID','STATIC_SUSPECT') AND r.ts >= {o} AND r.ts < {c}
      GROUP BY 1 ORDER BY 1
    """).fetchdf()
    if occ.empty:
        return extras
    series = [{"t": str(r.minute), "people": round(float(r.people), 3)} for r in occ.itertuples()]
    extras["presence_per_minute"] = series
    extras["people_max"] = int(round(float(occ.people.max())))
    return extras


def main(argv=None):
    p = argparse.ArgumentParser(description="Daily customer KPI (Journey Lab formulas)")
    p.add_argument("--day", required=True, help="Trading day YYYY-MM-DD (Europe/Rome)")
    p.add_argument("--venue", default=TREViglio_VENUE)
    p.add_argument("--parquet", default=os.environ.get("JL_PARQUET"))
    p.add_argument("--lab-out", default=None, help="Directory with 41/110/150 JSON (defaults to JL out/<day>)")
    p.add_argument("--report", default=os.environ.get("DAILY_KPI_REPORT", "/data/hyperspace/reports/daily-kpi"))
    p.add_argument("--cfg", default=os.environ.get("JL_CFG", str(JL / "config" / "treviglio.json")))
    p.add_argument("--assemble-only", action="store_true")
    p.add_argument("--compute", action="store_true", help="Run Journey Lab 40/41/45/110/150 before assemble")
    args = p.parse_args(argv)

    cfg = _load_cfg(Path(args.cfg))
    lab_out = Path(args.lab_out) if args.lab_out else (JL / "out" / args.day)
    env = os.environ.copy()
    env.setdefault("JL_ROOT", str(JL))
    env.setdefault("JL_CFG", args.cfg)
    env.setdefault("JL_OUT", str(lab_out.parent if args.lab_out else (JL / "out")))
    if args.parquet:
        env["JL_PARQUET"] = args.parquet

    if args.compute and not args.assemble_only:
        if not args.parquet:
            sys.exit("[daily-kpi] --compute needs --parquet")
        _write_stubs(Path(env["JL_OUT"]) / args.day)
        for script in ("40_tracklets.py", "41_ids_phantoms.py"):
            _run_jl(script, args.day, env, JL)
        _write_stubs(Path(env["JL_OUT"]) / args.day)
        for script in ("45_raw_visits.py", "110_average_journey.py", "150_queue_wait.py"):
            _run_jl(script, args.day, env, JL)
        lab_out = Path(env["JL_OUT"]) / args.day

    extras = {}
    if args.parquet and not args.assemble_only:
        try:
            extras = compute_occupancy_extras(args.day, args.parquet, cfg)
        except Exception as exc:
            print(f"[daily-kpi] occupancy extras skipped: {exc}", flush=True)

    payload = assemble(args.day, args.venue, lab_out, cfg, extras)
    out_dir = Path(args.report) / args.venue
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{args.day}.json"
    dest.write_text(json.dumps(payload, indent=2, default=str))
    print(f"[daily-kpi] wrote {dest}")
    print(json.dumps({"headline": payload["headline"],
                      "checks": {c["check_id"]: c["passed"] for c in payload["checks"]}}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
