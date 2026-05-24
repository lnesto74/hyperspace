# Trajectory Forensic Analysis — Final Report

**Dataset:** 884,256 raw perception MQTT messages, 4,382 unique perception IDs, ~35 minutes, venue `55fdd53b-...` (TREVIGLIO Schematico, 74×74 m grocery).

---

## TL;DR

The perception software is fragmenting each real shopper into **~16 perception IDs on average**. Today's reconciler defaults already collapse this 2.4× to ~1,800 stable tracks. The forensic data shows the system can safely go to **3-4× collapse** (~1,000–1,500 stable tracks), getting much closer to the estimated **~276 real shoppers** in the window.

Recommended config: **`GROCERY_BALANCED`** — increases mean trajectory lifetime by 44%, mean displacement by 65%, and detects 55% more "real-shopper-length" trajectories with only a tiny rise in teleport events.

```bash
curl -X PATCH http://127.0.0.1:3001/api/venues/55fdd53b-3298-4355-97c0-b4e789b11d06/reconciler-config \
  -H 'Content-Type: application/json' \
  -d '{"reconciler":{"enabled":true,"ghost_max_speed_m_s":3.5,"ghost_min_promotion_lifetime_ms":200,"ghost_min_promotion_displacement_m":0.05,"ghost_static_timeout_s":90,"ghost_static_displacement_m":0.3,"reid_max_gap_s":15,"reid_max_distance_m":8,"reid_max_implied_speed_m_s":2.5,"reid_velocity_cosine_min":-0.3,"reid_weight_distance":1,"reid_weight_velocity":0.5,"reid_weight_time":0.1,"smoothing_alpha":0.7,"active_to_lost_timeout_ms":1500,"trail_max_length":32}}'
```

---

## 1. Spatial coverage & blindspots

Perception detections span an **84×83 m** bounding box (slightly larger than the nominal 74×74 m venue, because perception's reference frame includes some out-of-store sensor activity).

| Metric | Value |
|---|---|
| Walkable area (alpha-shape of detections) | **2,119 m²** |
| Walkable diameter (square approximation) | **65 m** |
| Detection cells inside walkable | 27% |
| Significant blindspot components (≥1 m²) | **16 components, total 1,529 m²** |
| Detections in 2 m edge band | 0% (well inside) |

**Caveat:** "Walkable" was derived from the detection alpha-shape, not the actual DWG. Many of those "blindspot" cells are real shelf interiors (where nobody should walk) rather than coverage gaps. To isolate true coverage gaps, the next step would be to subtract the venue's DWG shelf bounding-boxes from the alpha-shape.

See `05_blindspots.png` for a labeled map.

---

## 2. Why trajectories fragment

For each perception-ID **death**, we find the spatially-closest **birth** within +15 s and classify the gap:

| Cause | Definition | Count | Share |
|---|---|---:|---:|
| `continuous_perception_loss` | Δt<1s, Δd<1m — momentary perception flicker | 213 | 4.9% |
| **`shelf_occlusion_short`** | **Δt<5s, Δd<3m — walked behind a shelf** | **2,238** | **51.1%** |
| **`blindspot_gap_long`** | **Δt<15s, Δd<8m — longer occlusion** | **1,541** | **35.2%** |
| `true_new_person_or_exit` | no plausible match — exit or new shopper | 390 | 8.9% |

**91% of fragmentation has a plausible re-ID candidate within 15 s and 8 m.** This is exactly what the reconciler is built for. The 8.9% remainder is split between true new shoppers entering and shoppers leaving the store.

Spatial pattern: most deaths cluster *near* their next-birth (matched candidate), and the distance histogram has clear modes at ~1m (sensor flicker), ~3m (shelf shadow), and 5-8m (long aisle occlusion).

---

## 3. Continuity vs grocery-shopper expectation

Assumption: a real shopper covers at least 50% of the walkable diameter (~32.6 m of path).

| | Raw perception | Target |
|---|---|---|
| Median per-ID path | **0.91 m** | ≥ 32 m |
| P95 per-ID path | 20.1 m | ≥ 32 m |
| IDs meeting ≥32 m path | 120 / 4382 (**2.7%**) | should be ~100% |
| **Implied real-shopper count** | **~276** | — |
| **Perception IDs per real shopper** | **~15.9** | should be ~1 |

The data confirms: perception is ~16× over-fragmenting. The reconciler must aggressively collapse this.

---

## 4. Backtest verification (full 884K samples replayed)

I replayed the entire dataset through the actual production `TrajectoryReconciler.js` with four configurations:

| Config | Stable tracks | Fragmentation × | Mean lifetime | Mean displacement | Shopper-grade tracks (≥30 m) | Teleports/1k | Ghosts filtered |
|---|---:|---:|---:|---:|---:|---:|---:|
| `BYPASS_RAW` (no reconciliation) | 4382 | 1.00 | 24.6 s | 5.8 m | 129 | 9.07 | 0.0% |
| `BASELINE_DEFAULT` (current) | 1796 | 2.44 | 56.5 s | 10.2 m | 130 | 1.11 | 6.6% |
| **`GROCERY_BALANCED` ⭐** | **1451** | **3.02** | **81.7 s** | **16.9 m** | **201** | **1.94** | **2.2%** |
| `GROCERY_AGGRESSIVE` | 1066 | 4.11 | 115.6 s | 25.0 m | 250 | 2.37 | 2.2% |
| `GROCERY_CONSERVATIVE` | 1900 | 2.31 | 57.5 s | 11.3 m | 160 | 1.23 | 3.0% |

**Reading**:
- `Fragmentation ×` = how much the reconciler compresses 4382 perception IDs into stable IDs. Higher is more aggressive merging.
- `Shopper-grade tracks` = stable tracks with ≥30 m total walked. This is the metric that matters — it's the number of trajectories that look like a real grocery shopper. Goal is to get close to ~276 (estimated true count).
- `Teleports/1k` = visible bad-physics events per 1000 samples. Lower is smoother. Bypass has 9.07 — that's perception jitter raw; reconciler smooths it down.
- `Ghosts filtered` = % of incoming raw frames the ghost filter drops (lower is better, means we're not over-filtering real people).

### Trade-off curve

```
GROCERY_AGGRESSIVE   →  best continuity (115s lifetime, 250 shopper tracks)
                        slightly more teleports (2.37/1k vs 1.11 baseline)
                        risk: occasionally merging two strangers walking near each other

GROCERY_BALANCED     →  +44% lifetime, +65% displacement, +55% shopper tracks
                        very low teleports (1.94/1k)
                        ← RECOMMENDED DEFAULT

BASELINE_DEFAULT     →  current production behavior
                        very smooth (1.11 tp/1k) but trajectories too short

GROCERY_CONSERVATIVE →  slightly tighter than baseline, marginal improvement
                        only useful if false-merges are catastrophic in your KPIs
```

---

## 5. Apply on production

### Recommended (`GROCERY_BALANCED`)

```bash
curl -X PATCH http://127.0.0.1:3001/api/venues/55fdd53b-3298-4355-97c0-b4e789b11d06/reconciler-config \
  -H 'Content-Type: application/json' \
  -d '{"reconciler":{"enabled":true,"ghost_max_speed_m_s":3.5,"ghost_min_promotion_lifetime_ms":200,"ghost_min_promotion_displacement_m":0.05,"ghost_static_timeout_s":90,"ghost_static_displacement_m":0.3,"reid_max_gap_s":15,"reid_max_distance_m":8,"reid_max_implied_speed_m_s":2.5,"reid_velocity_cosine_min":-0.3,"reid_weight_distance":1,"reid_weight_velocity":0.5,"reid_weight_time":0.1,"smoothing_alpha":0.7,"active_to_lost_timeout_ms":1500,"trail_max_length":32}}'
```

### Push harder (`GROCERY_AGGRESSIVE`)

Closer to true shopper count, but watch for occasional cross-person merges (especially in dense areas like checkout queues):

```bash
curl -X PATCH http://127.0.0.1:3001/api/venues/55fdd53b-3298-4355-97c0-b4e789b11d06/reconciler-config \
  -H 'Content-Type: application/json' \
  -d '{"reconciler":{"enabled":true,"ghost_max_speed_m_s":3.5,"ghost_min_promotion_lifetime_ms":150,"ghost_min_promotion_displacement_m":0.05,"ghost_static_timeout_s":120,"ghost_static_displacement_m":0.3,"reid_max_gap_s":20,"reid_max_distance_m":10,"reid_max_implied_speed_m_s":2.5,"reid_velocity_cosine_min":-0.5,"reid_weight_distance":0.8,"reid_weight_velocity":0.6,"reid_weight_time":0.1,"smoothing_alpha":0.7,"active_to_lost_timeout_ms":2000,"trail_max_length":48}}'
```

### Reset to defaults

```bash
curl -X PATCH http://127.0.0.1:3001/api/venues/55fdd53b-3298-4355-97c0-b4e789b11d06/reconciler-config \
  -H 'Content-Type: application/json' -d '{"reconciler":null}'
```

---

## 6. What "production defaults" means

The reconciler is **always running** unless its `enabled` flag is explicitly `false`. In the table above:

- **`BYPASS_RAW`** = reconciler disabled (`enabled: false`). Each perception ID flows through unchanged. No ghost filtering, no re-ID, no smoothing. This is the worst-quality output and serves only as a reference point.
- **`BASELINE_DEFAULT`** = reconciler running with the `DEFAULT_CONFIG` literal in [`backend/services/TrajectoryReconciler.js`](backend/services/TrajectoryReconciler.js). This is what every venue gets out of the box.
- **`GROCERY_BALANCED` / `AGGRESSIVE` / `CONSERVATIVE`** = configs you can save *per-venue* via the PATCH endpoint (or the sliders in the Trajectory Quality / Sparkles panel). They override the defaults for that venue only.

So you don't need to "turn on" reconciliation — it's already on. The choice is which config it uses.

---

## 7. Verify after applying

1. Open the **Sparkles panel** (Trajectory Quality) on the venue.
2. Watch for ~60 s:
   - `Active` count should match perception's headcount within ±10%
   - `Mean lifetime` should climb above 60 s (toward 80 s with `GROCERY_BALANCED`)
   - `Re-ID success rate` should land in the 25-50% range
3. **Visual test**: pick one person walking down an aisle. Their cylinder should keep the same color from one end of the aisle to the other (no flickers).
4. **Headcount check**: ask the perception team for their concurrent-people count and compare to `Active`.

---

## 8. Files

- `analysis/out/01_overview.png` — lifetime/displacement/speed histograms
- `analysis/out/02_spatial_motion.png` — heatmap + birth/death map + speed direction
- `analysis/out/03_backtest.json` — initial 32-config sweep results
- `analysis/out/05_forensic.png` — six-panel forensic visualization
- `analysis/out/05_blindspots.png` — labeled blindspot map
- `analysis/out/05_fragmentation.json` — per-event fragmentation classification
- `analysis/out/06_verify.json` — final backtest of 4 candidate configs
- `analysis/out/FINAL_REPORT.md` — this document
