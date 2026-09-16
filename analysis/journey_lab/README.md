# Journey Lab — Treviglio customer-journey reconstruction (Phase 1: forensics)

Report: `docs/TREVIGLIO_JOURNEY_LAB_PHASE1_FORENSICS.md`. Outputs: `out/<day>/`.

Pipeline (one clean day, streamed with DuckDB, bounded memory):

    bash pull_day.sh 2026-09-14          # from a Mac terminal (needs Tailscale + SSH key) -> data/<day>/
    python3 10_audit.py <day>            # data audit, cadence, hourly volume
    python3 20_rois.py <day>             # 86 ROIs -> semantic groups + layout figure
    python3 30_transform_check.py <day>  # raw->venue transform vs track_positions, clock offset (PASS gate)
    python3 40_tracklets.py <day>        # per-tracklet geometry/timing/zones  -> out/<day>/jl.duckdb
    python3 41_ids_phantoms.py <day>     # per-id table + motion validity classes (config/treviglio.json)
    python3 42_forensics.py <day>        # distributions, churn, death->birth competition
    python3 43_excess_over_chance.py <day>  # true re-appearance signal vs chance (gate table)
    python3 45_raw_visits.py <day>       # independent raw zone visits (layer A) vs zone_visits (layer B)
    python3 50_fragmentation_map.py <day>   # birth/death heatmaps, hotspots, coverage edge
    python3 60_reconciler.py <day>       # existing TrajectoryReconciler benchmark

Memory/threads: `JL_MEM` (default 4500MB) and `JL_THREADS` (default 2) env vars; on a 3 GB box use JL_MEM=1600MB.
The parquet can be the original file or `raw_part*.parquet` splits (identical rows).
Store-specific settings live in `config/treviglio.json` (venue id, transform, hours, thresholds).
