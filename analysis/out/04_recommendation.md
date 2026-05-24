# Trajectory Reconciliation — Backtest Report

**Dataset:** 884,256 raw MQTT messages, venue `55fdd53b-3298-4355-97c0-b4e789b11d06`.

**Bypass baseline (no reconciliation, raw perception):** 4382 unique perception IDs, mean lifetime 24.6 s, mean total displacement 5.8 m.

**Production defaults:** 1796 stable tracks, mean lifetime 56.5 s, mean displacement 10.2 m, fragmentation reduction NaN%.

## Findings (raw data)

- Perception publishes at **10 Hz** (median dt 100 ms).
- **32% of perception IDs lived less than 2 s** — strong fragmentation. Real shoppers stay much longer.
- **26% are short-lived AND barely moved** — clear ghost signature (jitter, reflections).
- p99 implied speed = 2.91 m/s, p99.5 = 3.68 m/s — best speed gate is around **3.0–3.5 m/s**.
- 50% of frames are dwell (<0.1 m/s), 9% are walking (0.5–2 m/s) — perfectly human grocery behavior.
- 0 long-static IDs — no fixture/mannequin problem to filter aggressively.

## Top 5 reconciler configs (grocery-tuned ranking)

Score blends continuity (lifetime, displacement, merging) and human-likeness (low teleports, plausible speed).

| # | name | score | stable | lt_mean (s) | disp (m) | merge % | teleports/1k | ghost % |
|---|------|-------|--------|-------------|----------|---------|--------------|---------|
| 1 | `smoothing_alpha=0.7` | 0.612 | 1806 | 61.7 | 12.0 | 59 | 1.19 | 3.6 |
| 2 | `ghost_min_promotion_lifetime_ms=100` | 0.600 | 1750 | 62.3 | 10.4 | 60 | 1.42 | 5.0 |
| 3 | `ghost_max_speed_m_s=3` | 0.598 | 1793 | 62.3 | 10.1 | 59 | 1.41 | 3.9 |
| 4 | `BASELINE_DEFAULT` | 0.598 | 1796 | 56.5 | 10.2 | 59 | 1.11 | 6.6 |
| 5 | `smoothing_alpha=0.3` | 0.591 | 1807 | 61.7 | 7.8 | 59 | 1.48 | 3.6 |
| 6 | `PRESET_smooth_human` | 0.590 | 1827 | 60.3 | 7.4 | 58 | 1.49 | 3.3 |
| 7 | `reid_max_distance_m=3` | 0.587 | 1954 | 56.7 | 9.2 | 55 | 1.21 | 3.6 |
| 8 | `ghost_min_promotion_displacement_m=0.05` | 0.578 | 1964 | 58.4 | 9.5 | 55 | 1.52 | 2.2 |

## Recommended config — `smoothing_alpha=0.7`

```json
{
  "enabled": true,
  "ghost_max_speed_m_s": 3.5,
  "ghost_min_promotion_lifetime_ms": 200,
  "ghost_min_promotion_displacement_m": 0.1,
  "ghost_static_timeout_s": 60,
  "ghost_static_displacement_m": 0.3,
  "ghost_bounds_min": null,
  "ghost_bounds_max": null,
  "reid_max_gap_s": 12,
  "reid_max_distance_m": 4,
  "reid_max_implied_speed_m_s": 2.5,
  "reid_velocity_cosine_min": -0.3,
  "reid_weight_distance": 1,
  "reid_weight_velocity": 0.5,
  "reid_weight_time": 0.1,
  "smoothing_alpha": 0.7,
  "active_to_lost_timeout_ms": 1500,
  "trail_max_length": 32
}
```

### Apply on production (run on the droplet):

```bash
curl -X PATCH http://127.0.0.1:3001/api/venues/55fdd53b-3298-4355-97c0-b4e789b11d06/reconciler-config \
  -H 'Content-Type: application/json' \
  -d '{"reconciler":{"enabled":true,"ghost_max_speed_m_s":3.5,"ghost_min_promotion_lifetime_ms":200,"ghost_min_promotion_displacement_m":0.1,"ghost_static_timeout_s":60,"ghost_static_displacement_m":0.3,"ghost_bounds_min":null,"ghost_bounds_max":null,"reid_max_gap_s":12,"reid_max_distance_m":4,"reid_max_implied_speed_m_s":2.5,"reid_velocity_cosine_min":-0.3,"reid_weight_distance":1,"reid_weight_velocity":0.5,"reid_weight_time":0.1,"smoothing_alpha":0.7,"active_to_lost_timeout_ms":1500,"trail_max_length":32}}'
```

## Alternative presets to A/B against

### `ghost_min_promotion_lifetime_ms=100` (score 0.600)

```bash
curl -X PATCH http://127.0.0.1:3001/api/venues/55fdd53b-3298-4355-97c0-b4e789b11d06/reconciler-config \
  -H 'Content-Type: application/json' \
  -d '{"reconciler":{"enabled":true,"ghost_max_speed_m_s":3.5,"ghost_min_promotion_lifetime_ms":100,"ghost_min_promotion_displacement_m":0.1,"ghost_static_timeout_s":60,"ghost_static_displacement_m":0.3,"ghost_bounds_min":null,"ghost_bounds_max":null,"reid_max_gap_s":12,"reid_max_distance_m":4,"reid_max_implied_speed_m_s":2.5,"reid_velocity_cosine_min":-0.3,"reid_weight_distance":1,"reid_weight_velocity":0.5,"reid_weight_time":0.1,"smoothing_alpha":0.5,"active_to_lost_timeout_ms":1500,"trail_max_length":32}}'
```

### `ghost_max_speed_m_s=3` (score 0.598)

```bash
curl -X PATCH http://127.0.0.1:3001/api/venues/55fdd53b-3298-4355-97c0-b4e789b11d06/reconciler-config \
  -H 'Content-Type: application/json' \
  -d '{"reconciler":{"enabled":true,"ghost_max_speed_m_s":3,"ghost_min_promotion_lifetime_ms":200,"ghost_min_promotion_displacement_m":0.1,"ghost_static_timeout_s":60,"ghost_static_displacement_m":0.3,"ghost_bounds_min":null,"ghost_bounds_max":null,"reid_max_gap_s":12,"reid_max_distance_m":4,"reid_max_implied_speed_m_s":2.5,"reid_velocity_cosine_min":-0.3,"reid_weight_distance":1,"reid_weight_velocity":0.5,"reid_weight_time":0.1,"smoothing_alpha":0.5,"active_to_lost_timeout_ms":1500,"trail_max_length":32}}'
```

## Reset to baseline

```bash
curl -X PATCH http://127.0.0.1:3001/api/venues/55fdd53b-3298-4355-97c0-b4e789b11d06/reconciler-config \
  -H 'Content-Type: application/json' -d '{"reconciler":null}'
```

## How to verify after applying
1. Open the **Sparkles panel** (Trajectory Quality) on the venue.
2. Watch `Active`, `Mean lifetime`, `Re-ID success rate` for ~60 s.
3. Visually: cylinders should not jump, color should remain stable as people walk past shelves.
4. The 3D venue's live count should match the perception team's headcount within ±10%.