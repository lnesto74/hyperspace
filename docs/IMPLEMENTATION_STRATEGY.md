# Implementation strategy — retention, reconciliation, raw archive

**Status:** proposal, nothing implemented yet
**Basis:** `docs/DATA_RETENTION_PLAN.md` (storage), `docs/PERCEPTION_VENDOR_SUMMARY.md` (value evidence)
**Prepared:** 2026-08-05

---

## Which reconciliation algorithm to use

Short answer: **the one that is already in the database.**

The Treviglio venue config still holds the full `luca` preset — every parameter
matches `LUCA_LIVE_RECONCILER_RAW` exactly (`reid_max_gap_s: 12`,
`reid_max_distance_m: 12.7`, `smoothing_alpha: 0.12`,
`active_to_lost_timeout_ms: 6000`, `ghost_static_timeout_s: 90`). The only
difference is `enabled: false`.

**So there is nothing to re-tune. There is one flag to flip.** That matters,
because this is the same configuration that produced the only good week in three
months: identities per day down ~10×, mean dwell 3.75 s → 15.03 s, usable dwell
visits 3.7% → 21.6%.

### Why not one of the newer engines

| Engine | Live-capable | Verdict |
|---|---|---|
| **v1 streaming** (`TrajectoryReconciler`) | **yes** | **use this live** — it is the only engine wired to MQTT ingest |
| v1 batch (`BatchTrajectoryReconciler`) | no | offline post-process only |
| **v2** (map-aware geodesic) | **no** | better on paper — routes around shelves instead of teleporting through them — but has no live code path |
| **v3** (v2 + concurrent-duplicate fusion) | **no** | best fragmentation offline (−4.1% chains vs v2), same limitation |

v2/v3 are genuinely better algorithms: v2 uses a walkability grid so a re-ID
cannot cut through a shelf, which is the main structural weakness of v1's
Euclidean gate. But `docs/RECONCILIATION_V2_DESIGN.md` scopes them to offline
first and live second, and the live integration was never built. **Using them
live is a project, not a config change.**

Recommendation: run `luca` live now, and use `GROCERY_V3_MAP` (or the safer
`GROCERY_V2_TIGHT`) for offline reprocessing of captures. Treat live v2 as a
separate, later decision.

### Presets to avoid live

`GROCERY_BALANCED` and `GROCERY_AGGRESSIVE` look better on aggregate metrics
(longer lifetimes, more "shopper-grade" tracks) but produce shelf-crossing
artifacts on Treviglio and roughly double the teleport rate. The UI already
labels Balanced "Do NOT use live". They inflate dwell on paper by merging people
who were never the same person — exactly the accusation we are making against the
vendor, so we should not do it ourselves.

---

## Implementation list

Ordered by dependency. Effort is rough.

### Phase 0 — Reclaim disk *(blocking; the droplet is 82% full)*

| # | Action | Effect | Effort | Risk |
|---|---|---|---|---|
| 0.1 | `docker builder prune -af` | +45.7 GB | 5 min | none |
| 0.2 | `VACUUM` `hyperspace.db` | +13.5 GB, faster queries | 10–30 min | needs a quiet window; DB locked while it runs |
| 0.3 | Diagnose the 4.1 GB WAL — checkpointing is behind | +~4 GB, lower crash-recovery time | 1 h | none (investigation) |
| 0.4 | Verify the nightly backup cron — `/data/hyperspace/backups` does not exist | restores a safety net | 30 min | none |

### Phase 1 — Restore reconciliation *(highest value, lowest effort)*

| # | Action | Effect | Effort | Risk |
|---|---|---|---|---|
| 1.1 | Set `reconciler.enabled = true` for Treviglio (preset `luca`, unchanged) | dwell becomes measurable again | 5 min | **customer-visible KPI shift — see below** |
| 1.2 | Verify recovery over 24 h: identities/day, median track span, censoring %, mean dwell | confirms it took effect | 1 h next day | none |
| 1.3 | Health check + alert when the reconciler is disabled on a venue that expects it | stops silent regressions | 2 h | none |
| 1.4 | Add the flag to the edge-recovery checklist in the runbook | survives the next outage | 15 min | none |

> **This changes what Esselunga sees.** Mean zone dwell should move from ~3.3 s to
> ~15 s, and zone visit counts should fall by roughly 10× as fragments merge.
> Both are corrections toward reality, but they are large and visible, and they
> will change month-over-month comparisons. This needs a decision on timing and
> on what to tell the customer — it should not be flipped silently.

### Phase 2 — Schema and retention

| # | Action | Effect | Effort | Risk |
|---|---|---|---|---|
| 2.1 | Add `original_perception_id` to `track_positions` | makes production data joinable to vendor IDs | 2 h | +40 B/row |
| 2.2 | Drop 3 redundant `track_positions` indexes, keep `(venue_id, track_key, timestamp)` | −36% table size | 1 h | verify query plans first |
| 2.3 | `DATA_RETENTION_MS` → env var, set 30 days | 30-day detail history | 1 h | +4.3 GB |
| 2.4 | Add a `zone_visits` purge (currently unbounded) | caps ~23–33 GB/year growth | 2 h | **choose the horizon carefully — this is the dispute evidence base** |
| 2.5 | Confirm hourly/daily rollups always run before any purge | no history loss | 1 h | none |

### Phase 3 — Raw archive *(this is the real insurance)*

| # | Action | Effect | Effort | Risk |
|---|---|---|---|---|
| 3.1 | Nightly job: record the feed and write one Parquet file per day | ~0.31 GB/day, 9.3 GB per 30 days | 1 day | none |
| 3.2 | Rolling retention on the archive | bounded growth | 2 h | none |
| 3.3 | Prune/archive the existing 36 GB of `/data/replay` JSONL, keeping the forensic captures | +~25 GB | 2 h | **do not delete the 19 May capture** |

Today there is no scheduled capture at all. Every claim in the vendor dossier
rests on one 34.6-minute file from 19 May that happened to be recorded. If the
dispute needs June or July evidence, it does not exist.

### Phase 4 — Monitoring

| # | Action | Effect | Effort |
|---|---|---|---|
| 4.1 | Weekly continuity report (reuse `analysis/09_scope_and_timeline.mjs`) | regressions visible in days, not months | 3 h |
| 4.2 | Alerts: reconciler disabled, disk >80%, identities/day outside band, censoring % spike | catches all four failures seen this quarter | 4 h |
| 4.3 | Periodic `live_reid_audit.mjs` miss-reason breakdown | shows *why* re-ID fails, feeds tuning | 2 h |

---

## What I deliberately left out

- **Live v2/v3 integration.** Real benefit, but a project with its own design and
  validation. Not mixed into a retention change.
- **Re-tuning `luca`.** No evidence it needs it, and the auto-optimise path
  already overwrote production config once on 30 June.
- **`reid_nn_enabled`.** Off in `luca`; the session log ties bad merges to
  turning it on. Leave it off.

---

## Open decisions — I need your answers before implementing

1. **Timing of the reconciler re-enable**, given it visibly changes Esselunga's
   numbers mid-dispute.
2. **`persist_perception_bindings`** — `false` today, `true` in every tuned
   preset. `true` guarantees one raw ID never fragments into several stable IDs
   (better dwell); `false` frees IDs faster (better live occupancy). A real
   trade-off, and it should be an explicit choice.
3. **What the raw archive records** — the post-adapter trajectory topic we can
   capture today, or the vendor's own `fast3dis/objects` frames, which is
   stronger evidence but needs an edge-side change.
4. **Where the archive lives** — the droplet, or object storage.
5. **`zone_visits` horizon** — this is the dispute evidence base, so the storage
   argument and the legal argument point in different directions.
6. **Deployment mechanism and change window** — how changes reach production, and
   whether there is a maintenance window.
