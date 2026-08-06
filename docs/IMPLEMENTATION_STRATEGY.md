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

#### What was actually built, and a correction (2026-08-06)

3.1 shipped in two stages rather than one, and for a while only the first
stage existed — worth recording, because the gap was not visible from any
dashboard.

The recorder writes **gzipped JSONL**, not Parquet, and that part is not a
compromise: Parquet writes whole row groups and a footer, so it cannot be
appended to from a live MQTT pipe without risking an unreadable file on every
crash. Gzipped JSONL is the landing zone. A nightly job at 04:00 UTC then
converts each finished day to Parquet, verifies the row count by re-opening
the file, and only then deletes the JSONL.

**The conversion stage was missed on the first pass.** For a day the archive
was recording correctly but accumulating in a format that
`analysis/01_explore.py` cannot read at all — it expects `mosquitto_sub -v`
output where every line is `topic {json}`, and skips any line without a space,
while the recorder stores bare compact payloads containing none. An archive no
tool can open is not evidence, and nothing would have reported it, which is
why `hyperspace-health-check.sh` now alarms on any JSONL day older than
yesterday.

The size argument turned out to be much weaker than the plan assumed, and the
plan should not be trusted on this point. Measured on the live feed:

| | per day | 30 days |
|---|---|---|
| planned: gzip JSONL | 0.68 GB | 20 GB |
| planned: Parquet | 0.31 GB | 9.3 GB |
| **actual: gzip JSONL** | **0.27 GB** | **8 GB** |
| **actual: Parquet** | ~0.21 GB | ~6 GB |

Parquet is only about **1.26× smaller than gzip** here, not the 2.2× the plan
projected, because the estimate was extrapolated from the much denser 19 May
capture. The real justification is that a converted day is a drop-in for the
entire `analysis/` toolchain and can be queried a column at a time, not that
it saves disk. Disk was never the binding constraint: 8 GB per 30 days already
fit the budget written for Parquet.

Provenance is carried in the Parquet key–value metadata — the source file's
SHA-256, its row count, the converter version, and the axis relabeling
(`x=position.x, z=position.y, y=position.z`) that matches `01_explore.py`. A
`seq` column preserves the original arrival order. That chain is what lets a
converted day be tied back to the exact bytes the vendor sent, verified end to
end on the 5 August file.

Retention differs by format, deliberately. Parquet is kept **90 days rolling
plus the oldest file of each month indefinitely**; JSONL is deleted as soon as
its Parquet verifies, with the pre-existing 30-day JSONL retention left in
place purely as a backstop for days that fail to convert.

| Piece | Where |
|---|---|
| Converter | `scripts/raw-archive-to-parquet.py`, image `hyperspace-parquet:1` |
| Nightly job | `scripts/hyperspace-parquet-archive.sh`, cron 04:00 UTC |
| Failure alarm | `scripts/hyperspace-health-check.sh`, unconverted day older than yesterday |
| Verification | `scripts/verify-pipeline.sh` §6 |

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

## Decisions taken, with the evidence

**`persist_perception_bindings` stays off.** It was listed below as a real
trade-off. Measured on the 19 May capture with the exact production gates, it is
not one — the flag moves nothing:

| | stable ids | frag× | median lifetime | mean lifetime | teleports/1k |
|---|---|---|---|---|---|
| raw (control) | 4,382 | 1.00 | 4.2 s | 24.6 s | 9.07 |
| LUCA `persist=false` | 3,300 | 1.33 | 9.0 s | 42.9 s | 4.49 |
| LUCA `persist=true` | 3,306 | 1.33 | 9.1 s | 43.3 s | 4.48 |

The difference between on and off is 0.2% on identity count and about 1% on
lifetime — noise. The reason is that the `luca` gates already re-ID across a
12-second, 12.7-metre window, so the binding almost never has anything left to
resurrect; the ordinary re-ID path has already caught it. The benchmark
invariant (`stable <= raw`) holds either way, which was the original reason for
turning it on offline.

So there is no benefit to weigh against the cost, and the cost is real: with the
flag on, ids are never freed, and live occupancy counts what is currently
tracked. Leave it off. Reproduce with
`node analysis/11_persist_bindings_ab.mjs --file raw_tracks.jsonl`.

**The deployed reconciler engine stays. Do not ship the committed one.**

First, what production actually runs, because a file timestamp misled me here.
The engine on the droplet is byte-for-byte commit **`adde0d7`, 30 June 14:10
CEST, "Fix Treviglio live reconciler trails and restore Luca tuning preset"** —
verified by hashing the deployed file and finding the matching blob in history.
Its 12:07 UTC mtime is when the file was last edited on the laptop, not when it
shipped: the deploy used rsync, which preserves source timestamps. This is a
deliberate, owner-validated build, not something left behind by accident.

The database agrees, to the day. Per-day KPIs step change exactly on 30 June —
identities fall from 43,660 to 4,276, mean dwell rises from 3.7 s to 11.0 s, and
complete tracks from 1.7% to 19.3%, with 30 June itself reading as a part-day
blend before settling at 13–17 s from 1 July until the edge died on 9 July.

What is *not* deployed is **`2d6e2a1`, 90 minutes later at 15:41 CEST: "Merge
origin/main: resolve TrajectoryReconciler conflict keeping remote re-ID fixes."**
That merge resolved a conflict in this exact file by keeping the remote re-ID
work over the tuning that had just been validated against the live track view.
It never reached production, and on this evidence that was fortunate.

Both builds were run over two captures under identical `luca` gates
(`analysis/12_engine_ab.mjs`).

Two of the four differences cancel out: `reid_stale_active_ms` and
`reid_churn_active_ms` are supplied explicitly by the preset and normalise to
the same values in both builds. What is actually under test is the candidate
de-duplication in `_reidTargets` and the sub-250 ms exemption on the
implied-speed teleport gate.

| | identities | journeys ≥30 m | median displacement | p95 displacement | metres/sec per track |
|---|---|---|---|---|---|
| raw (control) | 4,382 | 129 | 0.9 m | 20.1 m | 0.234 |
| deployed (30 Jun) | 3,339 | 152 | 1.4 m | 29.4 m | 0.133 |
| committed | 3,289 | **213** | **1.8 m** | **37.2 m** | 0.217 |

On this capture the committed build looks better: 213 complete shopper journeys
against 152, fewer identities, longer median and tail displacement, and — the
part that matters — **teleports unchanged at 4.49 against 4.46 per 1,000**.

Then the same test on the 27 May capture (vendor build Raj 1.0.3) inverted it:

| 27 May | identities | mean displacement | **teleports/1k** |
|---|---|---|---|
| raw (control) | 9,490 | 4.6 m | 5.94 |
| deployed (`adde0d7`) | 5,297 | 10.5 m | **3.39** |
| committed (post-merge) | 5,008 | 28.3 m | **15.86** |

The committed build produces **4.7× more teleports than production, and 2.7×
more than the raw vendor feed it is supposed to be cleaning up**. Its 28.3 m
mean displacement is not longer journeys, it is the distance accumulated by
impossible jumps — the sub-250 ms exemption on the implied-speed gate letting it
stitch tracks that are metres apart. A reconciler that teleports more than its
own input is worse than no reconciler.

So the 19 May result was not wrong, it was not general. One capture justified
the attempt; the second one settled it the other way. **Production keeps
`adde0d7`.**

**`main` has been reverted to match production, and that trap is now closed.**
Until 6 August, `backend/services/TrajectoryReconciler.js` on `main` held the
post-merge build while production ran `adde0d7`. Any deploy by `git pull` or
full rsync would have silently regressed the live reconciler — no error, no
warning, just dwell degrading again, which is the same failure mode as the
reconciler flag being left off in July. The file on `main` is now byte-identical
to the running container (`md5 ac530863014ea16e1e47a01b40647d6c`), so a normal
deploy is safe by default.

Nothing is lost: the merge remains in history at `2d6e2a1`, and both builds are
archived under `analysis/engines/` so the comparison stays reproducible
regardless of what is checked out. Re-run it with:

```bash
node analysis/12_engine_ab.mjs --file raw_tracks.jsonl \
  --engine-committed analysis/engines/TrajectoryReconciler.postmerge-2d6e2a1.mjs
```

The remote re-ID work discarded by this revert may still contain something
worth having — `5edbdb2` was fixing a real defect, `reid_count` never leaving
zero. Recovering it means redoing the merge deliberately, keeping the validated
Luca tuning underneath, and benchmarking across several captures before it goes
anywhere near Treviglio. That is its own task, not a deploy.

**Index pruning is dropped.** The plan assumed three of the four
`track_positions` indexes were redundant. They are not: `(venue_id, timestamp)`,
`(venue_id, track_key, timestamp)`, `(roi_id, timestamp)` and
`(track_key, timestamp)` are each the only usable index for a different live
caller — live occupancy, DOOH attribution, the neural and KPI zone queries, and
the shelf-analytics suffix match respectively. Dropping them would risk the
executive dashboard timeouts that were only just fixed, to save space that
compaction already reclaimed.

**Compressing `/data/replay` is deferred.** `ReplayService` lists `.jsonl.gz`
but has no gunzip anywhere in its read path, so compressing the 36 GB of
captures would break replay silently. Worth doing — 19:1 compression measured,
so roughly 34 GB back — but it needs the read path fixed and a replay tested
first.

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
