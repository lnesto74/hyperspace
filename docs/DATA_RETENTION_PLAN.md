# Data retention and storage plan

**Prepared:** 2026-08-05 · **Venue:** Treviglio · **Host:** DigitalOcean droplet (155 GB)
All figures below are measured, not estimated. Sources at the end.

---

## 1. Where things actually run

| Stage | Runs on | What it does |
|---|---|---|
| LiDAR + perception (`fast3dis`) | **edge slave**, natively on the host | produces raw object frames on `fast3dis/objects` |
| `PerceptionAdapter` | **edge slave** | axis mapping, adds device/venue IDs, republishes to `hyperspace/trajectories/{deviceId}` |
| MQTT bridge | edge → cloud | forwards trajectories |
| **`TrajectoryReconciler`** (ghost filter, re-ID, smoothing) | **DigitalOcean backend** | consolidates fragments into stable IDs |
| `TrajectoryStorageService` | DigitalOcean backend | samples and writes to SQLite |

**The reconciliation runs on DO, not on the slave.** It sits inside
`MqttTrajectoryService` (`backend/services/MqttTrajectoryService.js:41`), which
means it only ever sees what survived the edge → cloud bridge. If the bridge
drops messages, the reconciler cannot recover them.

---

## 2. What is stored today, and what is not

| Data | Stored? | Granularity | Retention |
|---|---|---|---|
| Vendor raw frames (`fast3dis/objects`) | **no** | — | broker has persistence off |
| Trajectory messages (post-adapter) | **only on manual capture** | every frame (~10 Hz) | `/data/replay`, 36 GB, no policy |
| `track_positions` | yes | **reconciled** ID, 1 row per track per **3 s** | **7 days**, hardcoded |
| `zone_occupancy` | yes | per zone snapshot | 7 days |
| `zone_visits` | yes | 1 row per zone entry | **forever** — no purge |
| `ingress_perimeter_crossings` | yes | 1 row per crossing | forever |
| `zone_kpi_hourly` / `_daily` | yes | hourly / daily rollup | forever, by design |

**Yes, reconciled trajectories are saved** — `track_positions.track_key` is the
stable reconciled ID (`{deviceId}:{stableId}`), written every 3 seconds.

**But the raw perception ID is not.** The reconciler carries
`originalPerceptionId` in memory (`TrajectoryReconciler.js:617`) and then throws
it away. There is no column for it. That is why the whole vendor analysis had to
be done on a separate JSONL capture: **production data cannot be joined back to
the vendor's own IDs.** Fixing this is one column and it changes what we can
prove later.

---

## 3. Disk situation right now

```
/dev/vda1   155G total   126G used   30G free   82%
```

Where it has gone, and what is safely recoverable:

| Item | Size | Recoverable | How |
|---|---:|---:|---|
| Docker **build cache** | 48.1 GB | **45.7 GB** | `docker builder prune -af` |
| `hyperspace.db` free pages | 17.7 GB file | **13.5 GB** | `VACUUM` — only ~4.2 GB is live data |
| `hyperspace.db-wal` | 4.1 GB | ~4 GB | checkpoint; WAL is not being truncated |
| Docker images | 44.3 GB | some | prune untagged layers |
| `/data/replay` captures | 36 GB | selective | keep the forensic ones, archive the rest |
| `replay_insight.db` | 0.4 GB | — | |

**About 60 GB is recoverable today without deleting a single piece of evidence**,
which takes free space from 30 GB to roughly 90 GB. Two of these are worth
noticing on their own: the database is **76% empty pages** because seven-day
purges delete rows but never reclaim space, and a 4.1 GB WAL means checkpointing
is not keeping up with write volume.

---

## 4. Measured storage costs

Per-row costs measured by rebuilding the exact schema **and its indexes** locally
and inserting 300,000 realistic rows (`analysis/10b_row_size_bench.cjs`):

| Table | Bytes per row | Note |
|---|---:|---|
| `track_positions` | **482.7** | carries **four** indexes |
| `track_positions`, 1 index | **310.6** | 36% smaller |
| `zone_occupancy` | 166.4 | |
| `zone_visits` | 806.1 | six indexes, UUID primary key |
| narrow raw-frame table | 115.9 | proposed schema |

Production write rates, from row counts and date spans:

| Table | Rows/day (avg) | Rows/day (peak) |
|---|---:|---:|
| `track_positions` | 267,792 | **412,663** |
| `zone_occupancy` | 339,056 | **476,219** |
| `zone_visits` | ~80,000 recent | **113,351** |
| `ingress_perimeter_crossings` | 1,681 | 3,669 |

Raw feed rate, measured from the 34.6-minute forensic capture: **426 messages/s**
during trading at **342 bytes/message**. Because phantom tracks keep publishing
overnight, the closed-hours rate only falls to about 74% of that, giving a
blended **≈370 msg/s → 32 million messages/day**.

Compression, measured on that same file rather than assumed:

| Format | Bytes/message | Ratio |
|---|---:|---:|
| JSONL, as captured today | 342 | 1× |
| JSONL + gzip -6 | 21.2 | 16.1× |
| **Parquet (all fields, incl. bounding boxes)** | **9.73** | **35.1×** |

---

## 5. Answer: what 30-day retention costs

### 5a. Database tables (7 → 30 days), sized on peak days

| Table | Today (7 d) | At 30 d | At 30 d, indexes trimmed |
|---|---:|---:|---:|
| `track_positions` | 1.39 GB | 5.98 GB | **3.85 GB** |
| `zone_occupancy` | 0.55 GB | 2.38 GB | 2.38 GB |
| **Total** | **1.94 GB** | **8.36 GB** | **6.23 GB** |

**Going from 7 to 30 days costs about 6.4 GB** — or 4.3 GB if the three
redundant `track_positions` indexes go. That is a small number against 30 GB
free, and trivial against 90 GB after the cleanup in §3.

`zone_visits` needs a policy too. It has no purge today, holds 3.1 M rows
(≈2.5 GB) and grows at **1.9 GB/month at the current average rate, 2.7 GB/month
at peak** — so somewhere around **23–33 GB/year** if left alone. A 90-day cap
costs 8.2 GB and stays flat; the hourly and daily rollups already preserve the
long-term reporting history.

### 5b. Raw data for 30 days — the forecast you asked for

At 32 M messages/day:

| How it is stored | Per day | **30 days** | Verdict |
|---|---:|---:|---|
| JSONL, exactly as captured today | 10.9 GB | **328 GB** | impossible — 2× the whole disk |
| JSONL + gzip | 0.68 GB | **20 GB** | works, but slow to query |
| SQLite narrow table | 3.71 GB | **111 GB** | impractical |
| **Parquet, daily files** | **0.31 GB** | **9.3 GB** | **recommended** |

**Thirty days of the complete raw vendor feed costs about 9 GB in Parquet.**
That is the answer: it is entirely affordable, provided it is not stored as raw
JSONL. Storing it the way `/data/replay` does today would need 328 GB.

Worth noting for the vendor conversation: roughly **74% of that volume is
phantom tracks**. If they fix static-object suppression, the raw archive drops to
about 2.4 GB per 30 days.

### 5c. Total steady state

| Component | Size |
|---|---:|
| `track_positions` + `zone_occupancy`, 30 days | 6.2 GB |
| `zone_visits`, 90 days | 8.2 GB |
| KPI rollups, indefinite | < 0.5 GB |
| Raw Parquet archive, 30 days | 9.3 GB |
| **Total** | **≈24 GB** |

Fits in today's 30 GB free, and comfortably in the ~90 GB available after the
build cache and VACUUM. **No droplet resize is needed.**

---

## 6. Recommendations

### Do first — costs nothing, buys 60 GB

1. `docker builder prune -af` → ~45.7 GB.
2. `VACUUM` the database during a quiet window → ~13.5 GB, and it will speed up
   queries. Note it needs free space equal to the live data (~4.2 GB) while it runs.
3. Investigate the 4.1 GB WAL — checkpointing is falling behind write volume.
4. Check the backup cron: `/data/hyperspace/backups` does not exist, so the
   nightly backup described in `DEPLOYMENT.md` is probably not running.

### Then — re-enable reconciliation

Yes, enable it. The evidence is unusually clean: during the nine days it was
working correctly, identities per day fell ~10×, mean dwell rose from 3.75 s to
15.03 s, and the share of zone visits usable for dwell reporting went from 3.7%
to 21.6%. Right now `enabled: false`, so Esselunga is being served raw vendor
output.

Two things to decide alongside it:

- **`persist_perception_bindings` is `false` in production** but `true` in every
  tuned preset. It guarantees one raw ID never fragments into several stable IDs
  — the comment at `TrajectoryReconciler.js:105-108` calls it "what fixed
  reconciled > raw". It is off live because freeing IDs matters for occupancy
  counts. This is a real trade-off between dwell accuracy and occupancy accuracy,
  and it should be an explicit decision rather than a default.
- Add the enabled flag to the post-outage recovery checklist. The regression
  after 29 July suggests it does not survive an edge rebuild.

### Store raw *and* reconciled — they answer different questions

**Reconciled, in the database** — this is what reporting needs. Raise retention
to 30 days and drop the three redundant `track_positions` indexes; the composite
`(venue_id, track_key, timestamp)` covers the query patterns.

**Raw, as daily Parquet** — this is what protects you. Every argument in the
vendor dossier rests on one 34.6-minute capture from 19 May that happened to be
recorded. Nothing schedules a capture, so if the dispute needs June evidence,
there is none. A nightly job writing one Parquet file per day costs 9 GB per
month and removes that exposure permanently.

**Add `original_perception_id` to `track_positions`.** One TEXT column, roughly
40 bytes per row. It makes production data joinable to the vendor's own IDs,
which today is impossible — every claim about their tracker has to be
re-established from a side capture rather than from the live system.

### Sequence

1. Reclaim disk (§3) — before anything else, 82% is uncomfortably full.
2. Re-enable the reconciler and confirm the tuning preset survived.
3. Add `original_perception_id`; drop redundant indexes.
4. Raise `DATA_RETENTION_MS` to 30 days and make it an environment variable
   rather than a constant (`TrajectoryStorageService.js:54`).
5. Add a `zone_visits` purge at 90 days.
6. Add the nightly raw Parquet job.

---

### Sources

| Measurement | Where |
|---|---|
| Disk, DB file, table row counts and spans | `analysis/10_storage_forecast.cjs` → `analysis/out/10_storage_prod.json` |
| Bytes per row, per table, incl. indexes | `analysis/10b_row_size_bench.cjs` → `analysis/out/10b_row_sizes.json` |
| Raw feed rate and compression ratios | `raw_tracks.jsonl`, `analysis/out/messages_full.parquet` |
| Reconciler location and behaviour | `backend/services/MqttTrajectoryService.js`, `backend/services/TrajectoryReconciler.js` |
| Retention implementation | `backend/services/TrajectoryStorageService.js:46-54,1053-1096` |
| Value of reconciliation | `docs/PERCEPTION_VENDOR_SUMMARY.md` §4 |
