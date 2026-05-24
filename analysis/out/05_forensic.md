# Forensic Trajectory Analysis

Generated from 35 minutes of raw perception MQTT (884,256 messages, 4,382 unique perception IDs).

## 1. Dataset summary

- **Messages**: 884,256
- **Unique perception IDs**: 4,382
- **Time span**: ~35 minutes
- **Publish rate**: 10 Hz (median Δt = 100 ms)
- **Perception X span**: 84.1 m (range -34.8 … 49.4)
- **Perception Z span**: 83.0 m (range -57.7 … 25.3)

## 2. Spatial coverage & blindspots

Walkable area (alpha-shape of all detections, ≥1 sample within 2m): **2119 m²**.
Walkable diameter (square approximation): **65.1 m**.

- **Total blind cells inside walkable**: 1547 m² (73.0%)
- **Significant blindspot components** (≥1 m²): **16** components, total **1529 m²**
- **Detections in 2 m edge band**: 0.0%  (high % = many tracks end at the edge → LiDAR coverage limit)

See `05_blindspots.png` for a labeled map of dead zones.

## 3. Causes of fragmentation

Total perception-ID terminations analysed: **4,382**.

Each death is matched to the spatially-closest birth within +15 s and classified:

| Cause | Definition | Count | Share |
|-------|-----------|------:|------:|
| `continuous_perception_loss` | Δt<1s, Δd<1m — momentary perception loss / same person re-IDed | 213 | 4.9% |
| `shelf_occlusion_short` | Δt<5s, Δd<3m — likely walked behind a shelf | 2,238 | 51.1% |
| `blindspot_gap_long` | Δt<15s, Δd<8m — longer occlusion / blindspot crossing | 1,541 | 35.2% |
| `true_new_person_or_exit` | no plausible match — exit or genuinely new shopper | 390 | 8.9% |

**Interpretation**: 91% of perception-ID deaths have a plausible re-ID candidate within 15 s and 8 m → these are exactly what the reconciler must merge.

## 4. Continuity vs grocery-shopper expectation

Assumption: a real shopper walks at least 50% of the walkable diameter.
- Walkable diameter ≈ 65.1 m → **expected real-shopper path ≥ 32.6 m**
- Actual per-perception-ID median path: **0.9 m**  (P95 = 20.1 m)
- **Only 120/4382 = 3% of perception IDs are long enough to be a real shopper.**
- Estimated unique shoppers in this window: **~276**
- Implied **15.9 perception IDs per real shopper** — that's the fragmentation factor the reconciler must collapse.

## 5. What this means for the reconciler

**Diagnosis**: perception is highly fragmented; most deaths are within a few seconds and a few metres of the next birth → re-ID can almost always reconnect them. The 4,382 perception IDs likely correspond to ~150–300 real shoppers (depending on how many we count from `true_new_person_or_exit`).

**Levers in order of impact**:

1. **`reid_max_gap_s`** — must cover the long-occlusion tail (`blindspot_gap_long`). Recommend **15 s** so any ID-death matched within 15 s gets a chance.
2. **`reid_max_implied_speed_m_s`** — keep ≤ 2.5 m/s so we *don't* over-merge across the store. 2.5 m/s × 15 s = 37.5 m, more than enough for any occlusion path.
3. **`reid_max_distance_m`** — soft gate; ~5 m is the spatial scale of typical shelf-occlusion gaps observed in the histogram.
4. **`ghost_min_promotion_displacement_m`** — keep at 0.05–0.1 m (grocery customers dwell at shelves; over-tight kills real people).
5. **`smoothing_alpha`** — 0.7 is the visual-quality sweet spot from the backtest (longer mean lifetime, fewer teleports).

**Don't touch**:
- `ghost_static_timeout_s` — there are 0 long-static IDs in the data, no fixture problem.
- `ghost_max_speed_m_s` (3.5) — already only rejects 0.6% of frames, well-calibrated to the data.

## 6. Recommended grocery preset

```json
{
  "enabled": true,
  "ghost_max_speed_m_s": 3.5,
  "ghost_min_promotion_lifetime_ms": 200,
  "ghost_min_promotion_displacement_m": 0.05,
  "ghost_static_timeout_s": 90,
  "ghost_static_displacement_m": 0.3,
  "reid_max_gap_s": 15,
  "reid_max_distance_m": 5.0,
  "reid_max_implied_speed_m_s": 2.5,
  "reid_velocity_cosine_min": -0.3,
  "reid_weight_distance": 1.0,
  "reid_weight_velocity": 0.5,
  "reid_weight_time": 0.1,
  "smoothing_alpha": 0.7,
  "active_to_lost_timeout_ms": 1500,
  "trail_max_length": 32
}
```

**Apply on the droplet** (replaces the current config; `enabled: true` means reconciliation is ON):

```bash
curl -X PATCH http://127.0.0.1:3001/api/venues/55fdd53b-3298-4355-97c0-b4e789b11d06/reconciler-config \
  -H 'Content-Type: application/json' \
  -d '{"reconciler": {"enabled": true, "ghost_max_speed_m_s": 3.5, "ghost_min_promotion_lifetime_ms": 200, "ghost_min_promotion_displacement_m": 0.05, "ghost_static_timeout_s": 90, "ghost_static_displacement_m": 0.3, "reid_max_gap_s": 15, "reid_max_distance_m": 5.0, "reid_max_implied_speed_m_s": 2.5, "reid_velocity_cosine_min": -0.3, "reid_weight_distance": 1.0, "reid_weight_velocity": 0.5, "reid_weight_time": 0.1, "smoothing_alpha": 0.7, "active_to_lost_timeout_ms": 1500, "trail_max_length": 32}}'
```

## 7. About 'production defaults'

The reconciler is *always* running unless its `enabled` flag is `false`. By 'production defaults' I mean the `DEFAULT_CONFIG` literal in `backend/services/TrajectoryReconciler.js` — the values the service starts with before any venue-specific override.

In the backtest:
- **BASELINE** = reconciler running with the literal defaults baked into the code
- **BYPASS** = `enabled: false`, i.e. raw perception flows through untouched
- **Recommended** above = a tuned override saved per-venue via the PATCH endpoint (or the Sparkles panel sliders)
