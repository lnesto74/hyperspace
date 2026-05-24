# Benchmark Protocol v1

Repeatable three-layer scorecard: **perception → reconciler → structural**.

## Quick start (DO server)

```bash
cd /opt/hyperspace
git pull

# Dependencies (once)
pip3 install pandas pyarrow matplotlib scipy numpy

# Full-file benchmark (Scope A — expect several hours on 7 GB)
node analysis/run_benchmark.mjs \
  --file /opt/hyperspace/replay/raw_tracks_trimmed.jsonl \
  --capture-id baseline_v0_overnight_2026-05-23 \
  --meta analysis/runs/baseline_v0_overnight_2026-05-23/meta.json
```

## Outputs

```
analysis/runs/baseline_v0_overnight_2026-05-23/
  meta.json           # capture metadata (edit before run)
  scorecard.json      # machine-readable ledger
  REPORT.md           # human summary
  artifacts/          # PNGs, parquet, verify JSON
```

## Layers

| Stage | Script | Layer |
|-------|--------|-------|
| 1 | `01_explore.py` | Raw perception (reconciler OFF metrics) |
| 2 | `02_spatial_motion.py` | Spatial heatmap, motion |
| 3 | `05_forensic.py` | Blindspots, fragmentation causes |
| 4 | `06_verify.mjs` | Reconciler sweep (5 configs, streaming) |

## Meta file

Copy `analysis/templates/capture.meta.json` for each new capture. Track perception version, reconciler config at record time, and notes.

## Flags

| Flag | Purpose |
|------|---------|
| `--skip-spatial` | Skip stages 2+3 (faster, reconciler only) |
| `--skip-verify` | Skip reconciler sweep (perception only) |
| `--after ISO` | Time window start |
| `--before ISO` | Time window end |

## Compare runs

Diff `scorecard.json` files under `analysis/runs/` after each experiment.

## Frontend dashboard

After deploy, open the main Hyperspace UI → floating toolbar (bottom-right) → **flask icon** (Trajectory Benchmark).

The page reads `GET /api/benchmark/runs` and shows:
- Three-layer protocol guide
- Run list (sidebar) from `analysis/runs/`
- Layer 1/2/3 metrics + reconciler comparison table
- Spatial maps & artifact PNGs
- Compare mode vs a baseline run

Production requires the benchmark volume mount in `docker-compose.prod.yml`:
`/opt/hyperspace/analysis/runs` → `/data/benchmark/runs`
