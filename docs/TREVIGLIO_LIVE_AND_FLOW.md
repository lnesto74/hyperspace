# Hyperspace at Esselunga Treviglio

**Live tracks, the people-flow field, the KPIs, and the floor UX to rebuild.**

Venue: **Treviglio Schematico** `55fdd53b-3298-4355-97c0-b4e789b11d06`.
Store frame: about 78 m × 79 m, origin near (20, 24) m, rotation −39°. Trading window used by the field: 07:00–22:00 Europe/Rome. Contractual daily KPIs: 08:00–20:00.

This is the document that did not exist. The repo already has a platform dossier, a KPI catalog, a live-canvas pipeline note, a look-ahead design that was never shipped, and the Journey Lab forensics. None of them describe the two floor experiences a person actually switches between, or the algorithms those pictures are allowed to claim. This file is that description, written so the flow UX can be rebuilt without losing the physics.

Companions, and what they are for:

| Document | Use it for |
|---|---|
| `docs/LIVE_3D_CANVAS_TRACK_VISUALIZATION.md` | Frame-by-frame path from vendor MQTT to a cylinder |
| `docs/LIVE_TRACKS_SMOOTH_METHOD.md` | A look-ahead design. It is not what the canvas runs today |
| `docs/ESSELUNGA_EXECUTIVE_METRICHE.md` §0 | The contractual daily KPIs and their gates |
| `docs/TREVIGLIO_STRATEGIA_KPI_AFFIDABILI.md` | Why the old per-track headlines were retired |
| `docs/HYPERSPACE_TECHNICAL_DOSSIER.md` | Platform-wide architecture |
| `analysis/journey_lab/README.md` | Offline reconstruction used by the daily job |

---

## 1. Two pictures of one store

Hyperspace at Treviglio has two floor experiences, switched by **Flow field / Live tracks** in the top bar after Enter Workspace (`FloorVizToggle`, state `floorViz` in `App.tsx`).

| | **Live tracks** | **People-flow field** |
|---|---|---|
| Question it can answer | Who is on the floor right now, and where did this body just walk? | How does the crowd move through this store, in this window? |
| Time | Now, causal. The picture is the latest MQTT frame after the live reconciler | A trading day, or a slice of it, aggregated. Today’s pack refreshes; yesterday’s is frozen |
| Unit on screen | One anonymous person: a cylinder and a short trail | A cell of the floor: dwell, footfall, a direction rose, and particles that sample that rose |
| Identity | A `trackKey` that the live reconciler tries to keep stable for seconds | No person. Cells forget who walked them |
| Where it lives | `MainViewport` (Three.js in the React app) | `frontend/public/flowfield/` inside an iframe (`FlowFieldEmbed`) |

They share the venue, the CAD, and the transformed metre frame. They do not share a selected day, a selected zone, a camera, or a number. Flipping the toggle changes the entire product. The flow iframe stays mounted when you flip back to Live tracks so the splash does not restart; that is a loading trick, not a shared session.

A third surface sits beside them and is easy to confuse with the field: **Esselunga Executive / Cliente medio**, fed by `daily_kpi`. That is the contractual report (ingressi, visit length, minutes per department, queue). The flow field is not that report drawn in 3D. Section 4 says which number belongs on which surface.

---

## 2. What every picture is built from

```
RoboSense → fast3dis perception
    → MQTT hyperspace/trajectories/{deviceId}  (~10 Hz, one JSON per person)
    → cloud: perception frame → floor frame → venue metres
         (Treviglio affine: rotation, origin, scale)
              │
              ├─ Live tracks
              │     TrajectoryReconciler (if the venue is not in Bypass)
              │     → TrackAggregator snapshot every 100 ms
              │     → Socket.IO → cylinder + client-built trail
              │
              ├─ People-flow
              │     track_positions rows
              │     → 1.5 m cells, 8-bin heading rose, per slice
              │     → GET /api/flowfield/field
              │     → particles, dwell relief, insight layers
              │
              └─ Daily KPIs
                    raw 10 Hz parquet
                    → Journey Lab cleaning + person-minutes
                    → daily_kpi
                    → Executive / Cliente medio / evening PDF
```

The invariant is the venue-metre frame. ROI tests, the walkability grid, the flow cells, and the live cylinders must all use it. Most wrong pictures in this store have been a frame problem or an identity problem, not a colour problem.

Perception publishes anonymous kinematics only: `id`, `position`, `velocity`, `boundingBox`, `objectType`. There is no face and no receipt. A vendor `id` dies often. On the 14 September 2026 capture the median raw id lived about 9 seconds. Any count of “people” that is really a count of ids measures the tracker.

---

## 3. Trajectory analysis — three treatments

The same walk is analysed three different ways. The refactor has to keep them apart in the UI, because they answer different questions and fail in different ways.

### 3.1 Live identity — what Live tracks draws

`TrajectoryReconciler.process()` runs on every MQTT message before the browser sees it, unless the venue is in Bypass.

1. **Ghost filter.** A new id stays in probation until it has lived and moved. Speeds above about 3.5 m/s are rejected. An object that never moves is treated as furniture. Points outside the venue are clipped.
2. **Motion re-ID.** When a stable id vanishes and a new one appears nearby, they can be stitched on gap distance, velocity cosine, time gap, and a position predicted from velocity. A slow-occlusion mode covers someone standing still while others pass. An isolation radius refuses a stitch in a crowd. An implied-speed gate near 2.5 m/s refuses a teleport.
3. **Smoothing.** Exponential moving average on position, α around 0.6. The browser then lerps (0.32 when the reconciler is on, 1.0 in Bypass).

The trail on screen is not the vendor polyline and not the server trail. `TrackingContext` appends `venuePosition` into a short array (50 or 100 points). `MainViewport` draws that array as a `THREE.Line` about 2 cm above the floor. There is no ribbon and no age fade. The Tracking settings slider `trailSeconds` is not what that line uses.

What this picture is honest about: a body that the sensor can see right now, after a best-effort stitch.

What it is not: a finished journey. The vendor already waits on the order of 3 seconds before a new id is published. Breaks of 2–4 seconds are common. The canvas decides each frame without the next frames, so cylinders freeze, pop, and change number. `docs/LIVE_TRACKS_SMOOTH_METHOD.md` describes a 5-second look-ahead that would fix most of that. `LookaheadLiveService` is not in the tree. Live tracks today is the causal reconciler.

Bypass (`reconciler enabled: false`) draws raw vendor ids. Use it to debug perception. Do not demo it as the store.

### 3.2 Offline journeys — what the daily KPIs use

Journey Lab (`analysis/journey_lab/`) reads the raw 10 Hz parquet for one day and does the work the live path cannot do, because it can see the whole day.

The cleaning that every contractual count depends on (`41_ids_phantoms.py`, thresholds in `config/treviglio.json`):

| Class | Rule of thumb | Fate |
|---|---|---|
| `VALID` | A plausible moving body | Kept |
| `STATIC_SUSPECT` | Long and almost still, but not furniture | Kept as a customer |
| `PHANTOM_STATIC` | ≥ 600 s inside a 3 m box | Dropped |
| `PHANTOM_MICRO` / `FLICKER_SHORT` | Too small or too brief | Dropped |
| Checkout fixed object | ≥ 600 s in a till ROI, plus fragments ≥ 60 s within 1.2 m | Dropped from every KPI |

Association (`lib/assoc.py`) then links tracklet ends with a score over time gap, walkable distance, implied speed, heading, and stature, solved one-to-one in a time window. Acceptance on the 14 September blind test was about 0.89 precision and 0.68 of vendor pairs linked. KPIs that need a continuous person (department-to-department transitions, behaviour clusters) are gated on that quality (`recon_gate`: vendor pairs ≥ 0.50 and blind precision ≥ 0.85). If the gate fails, those tiles show “—”.

Person-minutes are the unit that survives fragmentation: sum of samples in a place, divided by the sample rate, divided by ingressi when the sentence is “per customer” (Little’s law). Summing department minutes must come back to visit length within 1 %. That check is `little` / `areas_sum_equals_little`.

### 3.3 The flow field — crowd kinematics, not people

`FlowFieldDailyService.aggregatePositions` (`backend/services/FlowFieldDailyService.js`) is the algorithm the wind picture is allowed to claim. It is the same geometry as `analysis/flowfield_prod_slices.py`.

Input: `track_positions` for the venue, ordered by `track_key`, timestamp. A rebuild pulls **seven days** ending at the end of the chosen local date, then each slice keeps what it needs. Cache: `backend/data/flowfield/{venueId}/{date}/field_{slice}.json`. Today’s pack is stale after 60 minutes. A nightly rebuild runs at 22:45 local. Endpoint: `GET /api/flowfield/field?venue=&date=&slice=`.

Grid: **1.5 m** cells (`layout_anchor.json`, overridable). This is not the 1 m `heat_traffic` / `heat_still` grid in `daily_kpi`, and not the 2 m `flow_field` vector stored for the executive report. Three grids. Do not overlay their numbers as if they were one layer.

For each consecutive pair of positions on the same `track_key`, inside 07:00–22:00:

- If the gap is between 0 and **15 s**, the segment is walked in steps of half a cell. Each visited cell receives a share of the seconds (`presence`). If implied speed is under **0.25 m/s**, those seconds also count as `dwell`.
- When the body has moved at least **0.4 m** since the last step-sample, and implied speed is at most **3.0 m/s**, the heading is dropped into one of **8 rose bins** (45° each) and the speed is accumulated. Super-human jumps are not given a direction.
- `traffic` (`t` in the JSON) is the count of distinct `track_key`s that touched the cell. It is not a count of shoppers.

A cell is emitted only if it has at least 1 second of presence or 0.5 steps. Per cell the payload is:

| Field | Meaning |
|---|---|
| `t` | Distinct track keys |
| `d` | Dwell seconds (moving slower than 0.25 m/s) |
| `e` | Presence seconds |
| `k` | Step weight |
| `s` | Mean implied speed on accepted steps, m/s |
| `p` | Directional purity, 0–1, computed before the browser blur |
| `r` | 8-bin rose, each bin as an integer percent of the cell’s steps |

Slices:

| Slice | What it keeps | Window |
|---|---|---|
| `all` | 07:00–22:00 | The chosen calendar day |
| `morning` | 07–11 | That day |
| `midday` | 11–15 | That day |
| `afternoon` | 15–19 | That day |
| `evening` | 19–22 | That day |
| `weekday` | Mon–Fri, all open hours | **Rolling 7 days**, not “this Monday” |
| `weekend` | Sat–Sun | **Rolling 7 days** |

The hour chips and the weekday chip do not mean the same kind of time. The current chrome says “Time window” for both. That has to become visible in the refactor (section 7).

### 3.4 What the browser does to the field before it draws

`frontend/public/flowfield/field.js` — `loadField`.

**The rose is the product.** Median directional purity on this store is about 0.28, and the busiest cells sit near 0.01. A mean vector cancels exactly where the shop is busiest: a two-way aisle becomes “no wind”. The rose keeps both directions. Mean arrows exist as a layer and default to off. They are a lie on the gondola floor and a fair picture only on a one-way spine (purity heading toward 1: entrance, a till lane).

Then:

1. **Gaussian blur, σ = 1.5 cells**, separable. The rose is weighted by step count before the blur so a busy cell dominates its quiet neighbours.
2. **Coverage from the unblurred counts**, dilated one cell. Blur may estimate a value. It may not claim that a square metre was measured. An earlier bug painted 3,881 m² of carpet from 1,071 m² of evidence.
3. **Support** = steps + 0.5 × traffic, on covered cells only. Thresholds use the 95th percentile of support, not the maximum, so a till queue does not define “measured” for the whole shop.
4. **Purity** = |Σ rose-weighted unit vectors| / Σ weights. This is an order parameter: near 1 the cell is laminar, near 0 it is two-way or milling.
5. **Divergence** of the mean flow. Negative means streams converge (a sink: tills, fresco, a promo end). The scalar is labelled Convergence and uses a diverging ramp: cyan into the sink, red where flow splits, neutral where nothing happens.
6. **Colour scales** use a high percentile (default p98), not the max. One trolley parked in view would otherwise flatten the shop to black.

**Behaviour regime**, one class per cell, first match wins:

| Class | Colour | Rule |
|---|---|---|
| Dwell node | amber | Dwell ≥ p95 of dwell on supported cells |
| Through-route | sky | Steps ≥ 20 and dwell ≤ p30 |
| One-way spine | violet | Steps ≥ 10 and purity ≥ 0.55 |
| Two-way aisle | green | Steps ≥ 10 and purity ≤ 0.25 |
| Mixed / quiet | slate | everything else |

**Outlier** = dwell / traffic, only on cells with traffic ≥ 50, scaled by the p95 of that ratio. It is “they stayed long relative to how many tracks passed”, not a euro amount. If the morning and evening packs are both loaded, a cell whose purity jumps by ≥ 0.35 between them is lifted toward the top of this scale (a one-way aisle that becomes two-way, or the reverse).

**Day shift.** `attachShiftScalar` compares two packs on the same absolute cell index. Footfall is turned into each pack’s share of store footfall first, then

```
delta = (share_to − share_from) / (share_to + share_from + ε)
```

A quieter evening is not painted as “the store died”. Colour is share of traffic, not euros. The same form is used for morning→evening (`shift_me`) and weekday→weekend (`shift_ww`).

### 3.5 How a streamline is born

`stepParticles` in `main.js`. Default **2,400** particles. Birth probability follows support (exponent 1.1), so particles appear where people were, not on empty carpet.

Each step:

1. Sample the rose bilinearly.
2. Pick a heading with a von Mises-style weight: bin weight × `exp(κ · cos(bin − current heading))`. Default **κ = 2.8**. High κ keeps a particle in the stream it already joined, which is how a two-way aisle draws as two counter-flows instead of a brown fog.
3. Blend toward that heading with inertia **0.82**.
4. Speed is the local mean, clamped to 0.08–1.8 m/s. **Dwell drag** multiplies it by `1 − 0.72 · (dwell/dwellMax)^0.7`, so particles pool where people lingered. The hill and the crawl are the same fact, shown twice.
5. Advance by `(speed / 1.5 m) · dt · timeScale`. Default time scale **12×**, so a 0.6 m/s walker reads as about 7 m/s on screen. Without compression the trails are too short to see.
6. Kill the particle when it leaves measured support, exceeds its life (60–170 time units), or (if heat mode is on) enters a blocked cell. Respawn.

Trails are line segments, additive blending, sampled every 3 frames, default length 18 samples. They are a Monte Carlo drawing of the rose. They are not shoppers and they are not in the daily KPI.

---

## 4. KPIs — which number, which surface

### 4.1 Contractual daily KPIs

Source of truth: `daily_kpi`, job `scripts/daily-customer-kpi.py` at 04:30 UTC, from the raw parquet. Surfaces: Esselunga Executive, Store Director v2, evening PDF. Formulas and gates: `ESSELUNGA_EXECUTIVE_METRICHE.md` §0. The 14 September 2026 acceptance set, after staff removal: **1,948 ingressi**, visit **17.6 min**, **48** people present on average, queue **0.64 min per entrant** (1.01 in the 18:00–20:00 band).

The headlines a store director can be shown, and the sentence each one is:

| KPI | Sentence | Kind |
|---|---|---|
| Ingressi | Valid ids that cross the entrance ROI, one per id, 08:00–20:00 | Measured |
| Durata media della visita | Person-minutes in the store ÷ ingressi | Estimated (Little) |
| Persone presenti, media e massimo | Valid bodies per minute, and the busiest minute | Measured |
| Minuti per cliente per reparto | Person-minutes on the department floor (within 3 m of the counter, nearest strip owns the cell) ÷ ingressi | Measured as time, “per customer” via ingressi |
| Minuti al banco | Inside that area, within 1 m, speed < 0.4 m/s | Measured |
| Indice di scelta | Time at the counter ÷ time in the area. Under 0.25 the department is being crossed. At or above 0.40 it is being worked | Measured |
| Attesa in coda per cliente | Waiting person-minutes in the queue band (speed < 0.3 m/s), fixed objects and transit removed, ÷ ingressi | Estimated |
| Servizio in cassa per cliente | The same on the service band | Estimated |
| Decomposizione per cassa | Fixed / transit / waiting person-minutes, per lane | Measured |
| Primo reparto dopo l’ingresso | First department transition out of Ingresso | Measured |
| Rhythm | Ingressi per 15 min, presence per minute | Measured |
| Transizioni tra reparti | Adjacent jumps of at least 3 s on reconstructed paths | Measured only if `recon_gate` passes |
| Modi di visita | Cluster shares from `120_behaviour_clusters.py` | Estimated; may be `not_computed` |
| Heat traffico / soste | 1 m grid | Measured |
| Spot promo | Counter-minutes on island / promo / table / display | Measured |
| Qualità | Rows, ids, valid ids, phantom share, stream gaps | Measured, and it gates the others |

A failed check does not get a softer number. The tile is “—” and the tooltip says why. The checks that matter for a refactor that wants to quote these figures: phantom share between 10 % and 35 % during open hours; visit length between 10 and 60 minutes; department minutes summing back to visit length within 1 %; residual fixed-object contamination in the queue KPI under 5 %; no raw gap longer than 60 seconds; reconstructed-path KPIs only when the blind test clears the gate.

### 4.2 Numbers the flow field is allowed to say

These are computed in the iframe from the cell pack and the zone you clicked. They are **not** `daily_kpi` and must not be labelled as ingressi, visit length, or queue minutes.

| On the card | Definition in this UI | Honest reading |
|---|---|---|
| Dwell | Seconds of slow presence on the patch, or the mean in the zone | Linger or a queue. Not a sale |
| Footfall | Distinct track keys in the cell | A busy aisle can be cold |
| Directional purity | 0–1 order parameter | Near 1 = a commute. Near 0 = milling or two-way |
| Stop-rate | Share of tracks on the patch that slowed enough to count as a stop | A shelf aid. The copy treats ~45 % as a healthy facing. **Off at the tills**, where wait time is the number |
| This vs nearby | The same metric on the patch versus the aisle around it | Tells you whether a hill is special |
| Tracks | Distinct keys in the zone for the selected window | Not receipts |

The 45 % line is a design threshold inside the prototype (`gap = max(0, 0.45 − engagement)` and the Explain copy). It is not an Esselunga contractual KPI. If the refactor keeps it, it stays labelled as a reference mark, not as a measured target.

### 4.3 Numbers Live tracks is allowed to say

Occupancy now: unique ids in the current frame (`FrameOccupancyTracker`), not a time-to-live window. Zone overlays can show the live KPI engine on an ROI. Those live tables still include the fragmentation the daily job removes. A live “entrants today” taken from `zone_visits` is the number section 4.4 retired.

### 4.4 Numbers that must not return in the refactor

Retired on 16 September 2026 because they count tracker fragments (`TREVIGLIO_STRATEGIA_KPI_AFFIDABILI.md`):

- Entrants as `COUNT(*)` of entrance crossings (the 14 September report said 5,068; valid ingressi were about 1,948).
- Shopping dwell as the median sum of `zone_visits` per `track_key` (that was fragment life, about 1 minute, against a real visit near 18–23 minutes).
- Checkout wait as the mean of completed `queue_sessions` (a 60-second wait split into three ids becomes three short waits; a chair becomes a lane).
- Penetration and bypass (an id at the door and a different id in the aisle).
- Engagement ≥ 15 s as a headline rate.
- Any week-on-week arrow until both weeks were built by the same parquet job.

Stopping power at 5 seconds survives only as a **relative** shelf ranking, and only if the copy says it is a crossing statistic. The stable replacement is the choice index: share of time spent slow.

### 4.5 The euro chimney is a sketch

`layers.js` `rebuildEuro`. For a product-facing ROI:

- If a live commercial figure is attached to that ROI, the chimney uses it and the basis is `LIVE`.
- Otherwise the basis is `HEURISTIC`:

```
engagement = mean over supported cells of min(1, dwell/dwellMax × 0.85)
gap        = max(0, 0.45 − engagement)
exposed    = max(20, traffic × 0.35)
euroDay    = exposed × gap × 0.12 × CATEGORY_MARGIN[category]
```

`CATEGORY_MARGIN` is a hardcoded table (Pesce 2.8, Carne 2.4, Acqua 0.4, …). Checkout, entrance, and LiDAR ROIs contribute 0. The gold particles are that scalar leaving the facing. Story Mode calls the result “recoverable €/day”. The Explain copy already warns that colour is not money unless the basis is LIVE. The refactor should obey the copy: a heuristic chimney never shares the visual weight of a measured dwell hill, and Story Mode does not speak in euros while the basis is `HEURISTIC`.

The margin drill-down (`drilldown.js`) is a three-step theatre: Why (12-axis fingerprint versus a hardcoded store average, four levers), Who (ids), One ID (a trajectory microscope). The two moments shipped in the file — “Lost in the aisle” and “Stop–look–leave” — are **fixed demo trails** for `person-51813` and `person-59538`, not a query of Treviglio’s reconciled journeys. Treat that overlay as a prototype of the interaction, not as evidence about the store.

Screen FOV, speaker reach (58 dBA rings, occluded by shelf boxes), and Media → shelf are insight layers in the same file. Story Mode labels the exposure-to-action beat `SIMULATED`. Keep that word on anything that is not a measured path from cone to facing.

---

## 5. Live tracks — the UX as it is

### 5.1 Chrome

After Enter Workspace the shell is `AppShell`:

- **Top bar** (`ModeBar`): venue name, Setup / Edit / Live, and the Flow field | Live tracks switch. “Live” in the mode bar is an app mode. “Live tracks” is the floor picture. They are different controls and they read as the same word.
- **Left rail**: floor plan, DWG, venue, objects, LiDARs, regions, planogram. This is commissioning. It is the right rail for Edit. It is the wrong rail for watching the store, and it stays available on Live tracks.
- **Viewport**: the CAD in Three.js, cylinders (or a point-cloud mode) for each accepted track, a polyline trail, optional ROI KPI chips, optional intent-field overlay.
- **Right panel**: selection (object, LiDAR, region) and the panels opened from the footer: trajectory quality presets, re-ID calibration, replay, annotation.
- **Footer**: camera (perspective, top, iso, front), lighting, tracking settings, story mode for the guided demo, pulse, team dispatch.

Tracking settings that affect the picture: cylinder opacity (default 0.5), display mode cylinder vs point cloud. Trail length in seconds is in the settings object and is not wired to the line.

### 5.2 What a good live session feels like

The useful live session is short and spatial:

1. See how many bodies are on the floor, and whether the tills or the fresco are the dense place.
2. Follow one cylinder for a few seconds to judge whether the stitch is lying (teleport, frozen body, number change).
3. Click a region and read the live zone chip.
4. If the picture is wrong, open Trajectory quality — the Treviglio presets live there (`TrajectoryQualityPanel`): Luca Live, Dwell v1, Occlusion re-ID. Grocery Balanced is called out in that panel as the preset that must not be used on this store (it inflates dwell and draws shelf-crossing artifacts).

Replay and annotation are a lab on the same canvas. They are how a trajectory gets a human label. They are not the store director’s first screen.

### 5.3 What the live UX cannot do, and should stop implying

- It cannot show yesterday. Yesterday is the flow field or the executive day picker.
- It cannot show “the average customer”. That is Cliente medio, built from reconstructed journeys.
- It cannot prove a layout change. A layout change is two flow packs, or two `daily_kpi` days.
- It cannot be smoother than the vendor without a look-ahead. Shipping the look-ahead is a pipeline change (`LIVE_TRACKS_SMOOTH_METHOD.md`), not a styling change. Until then the UI should not promise “smooth journeys”.

---

## 6. People-flow — the UX as it is

The field is a full-viewport Three.js app (`index.html` + `main.js` + `field.js` + `layers.js` + `drilldown.js`), embedded with `?embed=1`. Full screen opens a second iframe without `embed`. Phone layout collapses the rails into sheets. The loader is a particle silhouette and, in the dashboard, gives up after 10 seconds so a hung rebuild cannot hide the floor forever.

### 6.1 The screen, region by region

```
┌─────────────────────────────────────────────────────────────┐
│ Ask: [Moved] [Stopped] [Queues] [Hot/cold] [Change] Tour Explain │
├──────────┬──────────────────────────────────────┬───────────┤
│ Layers   │                                      │ This patch│
│  day     │           the floor                  │  vs nearby│
│  window  │     streamlines + dwell relief       │           │
│  Advanced│                                      │ Zone card │
│          │                                      │           │
│          │   legend          how-to-read        │ Explain   │
│          │   story dock (bottom)                │           │
└──────────┴──────────────────────────────────────┴───────────┘
```

**Ask** (`#everydayBar`) is the only row written in store language. Five questions, plus Tour and Explain.

**Layers** (`#controls`) is the left rail. Its title is “People-flow field”. In the workspace the rail starts collapsed so the floor can breathe; the React shell tells the iframe to fold it when the app sidebar opens, so two left rails never sit open together.

**East dock**: “This patch vs nearby” (`#glance`) and a zone card (`#probes`). Glance has a “Go deeper” button.

**Legend** follows the active scalar (dwell seconds, a regime key, a share-shift ramp).

**How to read this floor** (`#readKey`) becomes the change card when the question is “Did my change work?”: earlier/later colours, five palettes, a contrast slider, and the two dates.

**Explain** is off by default. When on, hovering a chip or a figure fills `#explainDock`. Click pins it.

**Story dock** sits on the bottom: a STORY MODE button that expands into prev / ticks / next / play / exit.

**Drill** (`#drill`) covers the viewport for the margin Why → Who → One ID sequence.

**Why this bay** (`#whyChip`) opens that drill on the selected facing.

Also on the canvas: pause, pan vs rotate, a hidden-panel tray, and (in the executive report embed) a PDF download sheet.

### 6.2 Five ways to ask, and they fight

The prototype accumulated four guided systems plus a free mix. The Tour button’s own tooltip says the quiet part out loud: “Walk the five questions. Not Guided view, not Story Mode.”

**1. Ask — the five everyday questions** (`EVERYDAY_VIEWS`). Each one sets a slice, a surface colour, a camera, and a couple of reading layers. The left rail stays free; the tour does not lock it.

| Ask | Slice | Colour | Camera | What the eye should do |
|---|---|---|---|---|
| How the shop moved | all day | Dwell | Oblique | White lines are walks. Warm colour and hills are stops. Cool floor is passage |
| Where they stopped | all day | Dwell, hills at 8 m, peak glow | Pulled back (“wind”) | Linger as terrain. Lines stay on so an empty aisle is not mistaken for a dead store |
| Queues & checkout | evening | Dwell | Checkout spine | No zone pre-selected. Click a lane. Stop-rate stays off |
| Hot / cold bays | evening | Outlier | Oblique | Gold puddles = linger. The comparison is versus the aisle around the hill |
| Did my change work? | all day | Share shift vs a second day | Oblique | Colour is traffic share. Hills are still linger, not the size of the change |

**2. Tour** walks those five in order, with a card (`#tourCard`) and the note stored on each view. It is a teacher for Ask. It is not a separate analysis.

**3. Guided view** (`VIEW_PRESETS`, inside Advanced) is a second menu of ten analyst bundles. Choosing one clears the Ask highlight and stops Story Mode.

| Preset | The question it actually is | Slice | Colour | Layers it turns on |
|---|---|---|---|---|
| How the shop works | Where is a spine, a two-way aisle, a dwell node? | all | Regime | Isolines |
| Consolidation | Where do streams sink? | all | Convergence | Streamlines |
| Evening rewrite | Did the field change from morning to evening? | all | `shift_me` | Isolines |
| Weekend rewrite | Is the weekend a different trip? | all | `shift_ww` | Isolines |
| Engagement trap | High traffic, low stop — which bay? | evening | Outlier | Curtain on a pre-picked trap zone |
| Margin chimney | Where does the heuristic euro leave the facing? | evening | Dwell | Profit particles, category colour, peak glow, flow off |
| Media as a rudder | Did heading in the cone point at the advertised shelf? | evening | Purity | Screen cone, media trails, curtain |
| Media as a stop | Did anyone dwell on the facing after the cone? | evening | Dwell | Screen, media |
| Glass vs PA | Who can the screen see, and who can only the speakers reach? | all | Footfall | Screen and speaker rings |
| Screen on a commute | Is the cone just a through-route, so a “lift” would be fake? | evening | Purity | Screen cone only |

**4. Story Mode** (`STORY_BEATS`) is a third script, ten beats, auto-advance 14–18 seconds, for a customer meeting. It is not Ask and it is not Guided view.

| Beat | Rung | What it performs |
|---|---|---|
| The floor is a wind field | Observe | All day, isolines, the wind camera |
| Evening is a different store | Sense | Slice flips to 19:00–22:00 |
| They pass — they do not stop | Alert | Evening, trap zone, category colour, curtain |
| Margin leaving the shelf | Quantify | Profit chimney, flow off |
| Why this bay leaks | Explain | Opens the drill on Why |
| Who is leaking this | Explain | Drill on Who |
| One shopper, full kinematics | Explain | Drill on a demo id |
| The screen is seen. The shelf is not | Explain | Screen cone + media trails, labelled simulated |
| Speakers reach aisles the screen never sees | Explain | 58 dBA rings |
| One move, priced | Recommend | Highest-€ bay, a lever, €/day and €/year |

Rungs are coloured as a ladder: Observe/Sense blue, Alert/Explain amber, Quantify/Recommend green. That ladder is the right *shape* for a meeting (see the floor, name the exception, price a move). The content of the upper rungs is ahead of the evidence (section 4.5).

**5. Advanced free mix.** Surface colour (dwell, footfall, speed, purity, convergence, plus the analysis scalars), analysis chips that duplicate the guided presets, particle count, trail length, time compression, κ, terrain height, and a stack of checkboxes: streamlines, dwell relief, mean arrows, dwell drag, floor plan, fixtures, mirror, heat rise, screen FOV, speakers, profit, category, ticker, isolines, peak glow, aisle curtain. Plus **alignment nudge**: rotation ±20°, offset ±30 m. That nudge is a commissioning tool sitting in the analysis rail. A store director who moves it mis-registers the entire story and will not know they did.

Any manual tweak marks the guided view as Custom and clears the Ask highlight. So the five questions, which are the only calm part of the UI, lose their selection the moment someone learns.

### 6.3 Interaction model that is worth keeping

These behaviours are the product. A refactor that flattens them into a dashboard of charts throws away the reason the field exists.

- **The floor is the chart.** Colour, height, and motion are three channels and they are allowed to disagree on purpose. Height is always dwell in the current design (“extra readings sit on top — they do not replace the floor”). A tall hill with a quiet share-shift means people still linger and the traffic mix did not move. That sentence is the best piece of copy in the tool.
- **Click a place, get a comparison to nearby**, not a dump of every scalar. Glance is “is this hill special?”.
- **A zone can be an ROI or a drawn polygon.** Pick ROI snaps to the smallest containing region. Draw zone is for a bay the CAD did not name. Clear zone returns to the whole floor.
- **A question sets a camera.** Checkout is a place you fly to. A trap bay is a place you stand in. The oblique view is the store. Camera is part of the question, not a leftover orbit control — though pan and rotate remain, and they should.
- **Coverage stays dark.** Unmeasured floor is not interpolated into a gentle blue. Keep that. A refactor that “fills the gaps” will reintroduce the 3,881 m² bug in spirit.
- **Two-way aisles stay two-way.** Mean arrows default off. The rose plus κ is why the picture looks like a shop and not like a single arrow per cell.
- **Time is a slice you can feel.** Switching 07:00–22:00 to 19:00–22:00 rewrites the carpet without moving the CAD. That is the demonstration that evening is a different P&L.

### 6.4 Where the current UX breaks a visitor

1. **Three products in one iframe.** Ask is a store tool. Guided view is an analyst workbench. Story Mode is a pitch. They reset each other. The visitor cannot tell which one is “the” analysis.
2. **The left rail leads with machinery.** Trading day and time window are the right first controls. Below them, Advanced is open by default (`<details open>`), and it starts with regime / outlier / shift — a second Ask — then a preset dropdown, then rendering constants (2,400 particles, κ = 2.8, 12× time). The constants are real and they are tuned. They are not a decision.
3. **Weekday and weekend do not mean what the buttons say.** They are a rolling seven days. “This Monday morning” cannot be asked. The day picker and the weekday chip look like one control family.
4. **Hot / cold and the engagement trap are the same scalar** (outlier) reached from different doors, with different cameras and a pre-picked zone only on the trap preset. The visitor thinks they are two findings.
5. **Queues are a dwell camera, not a queue KPI.** The checkout flight is right. The number a director needs — waiting minutes per entrant, per lane, fixed objects removed — lives in `daily_kpi`, not in the cell dwell colour. The evening dwell hill at the tills mixes a queue, a cashier, and people walking past.
6. **“Did my change work?” cannot yet be about a change.** It compares traffic share between two days. It cannot see a planogram edit, a price, or a screen. The copy already says DEMO cannot prove a layout change. The button still asks the question as if it can.
7. **Money, media, and a single shopper are performed, not measured**, and they occupy the climax of Story Mode. That is the moment a customer remembers. It is the moment the tool is least entitled to be believed.
8. **Explain is a second manual.** It is good writing and it is off, because the floor is already covered in panels that exist to say what the colour means. A floor that needs an Explain mode, a read-key card, a legend, a tour card, and a story card is a floor whose question was not chosen.
9. **Live tracks is a different app.** You cannot be looking at the evening outlier on the dairy bay and flip to “show me bodies on this bay”. The toggle throws the camera, the day, and the zone away.

---

## 7. The flow UX to build

One spine. The floor stays the chart. Everything that is a rendering constant or a pitch goes behind a door that says what it is.

### 7.1 The spine

**Question → Window → Place → Proof.**

The question is the only primary navigation. There is one list. Tour walks that list. Story Mode, if it stays, plays that list for a meeting and cannot introduce a beat the list does not contain. Guided view as a separate dropdown goes away; its real questions join the list as a second group.

**Store questions** (open by default):

| Question | Colour | Height | Motion | Window default | Place | The card on the right | Next action |
|---|---|---|---|---|---|---|---|
| How did the shop move? | Dwell | On, 6 m | Streamlines | This day, all open hours | Whole floor, oblique | Coverage, busiest spine, purity of that spine | “Stand in the busiest aisle” |
| Where did they stop? | Dwell | On, taller, peak glow | Streamlines stay | This day | Whole floor, pulled back | Top hills, each vs the aisle around it | Click a hill |
| Where is the queue? | Dwell, **tills only** | On | Streamlines | This day, **the band that contains the peak** (not always 19–22) | Checkout camera | Per lane, from `daily_kpi`: waiting min per entrant, fixed / transit / waiting. Stop-rate hidden | Click a lane |
| Which bays are cold? | Outlier | Dwell still owns the height | Streamlines dim | This day, the same band | Oblique, no pre-picked “trap” | Stop-rate vs the 45 % mark, footfall, vs nearby. The mark is labelled “reference”, not “target” | “Open this bay in Live” if the day is today |
| Did the mix move? | Share shift | Dwell | Streamlines | Two explicit dates, same slice | Oblique | “Colour is share. Height is linger.” The two dates are the title, not a footnote | Pick the pair |

Rename “Did my change work?”. The algorithm compares share of footfall. The button should say that. A true change test (before/after a known intervention, with a control aisle) is a later KPI, not a relabel of `shift_day`.

**Deeper questions** (one disclosure, closed by default — this is where Guided view goes to live):

| Question | What it is | Replaces |
|---|---|---|
| What kind of aisle is this? | Regime colour | “How the shop works” |
| Where do people collect? | Convergence | “Consolidation” |
| Morning versus evening | `shift_me` on one carpet | “Evening rewrite” |
| Weekday versus weekend | `shift_ww`, and the chrome says “last 7 days” | “Weekend rewrite” |
| What could the screen see? | Cone, purity inside it, dwell on the facing. No euro, no lift claim | The three media presets, collapsed |
| Who never enters the cone? | Speaker rings against the cone | “Glass vs PA” |

Media stays in Deeper until a measured path exists from “in the cone” to “dwell on the advertised facing” on reconciled journeys. Until then the card says what is drawn (a cone, a ring, a heading) and does not say lift.

### 7.2 One card, not a dock of panels

The right side is a single card that the question owns. It always has the same four lines:

1. **The question, in the words of the button.**
2. **The window, in one sentence** that includes the kind of time: “Tuesday 14 September, 07:00–22:00” or “weekday hours across 8–14 September, not a single Monday”.
3. **The place:** whole floor, or the zone name, or “drawn area”.
4. **Two or three figures**, each with the one-line reading that Explain already wrote (`kpi-dwell`, `kpi-stop`, `change-hills`). Those lines are the card, so Explain as a mode can go. A figure that is estimated or simulated wears that word in the card, in the same language as `daily_kpi` (`MEASURED` / `ESTIMATED` / `SIMULATED`).

Glance (“this patch vs nearby”) is the body of the card after a click, not a second panel. “Go deeper” becomes the next question, not a drill into a demo id.

Legend stays on the floor, small, and it names the scalar the question selected. It is not a second control.

### 7.3 Window, stated so it cannot be misread

The day control and the slice control stay, and they gain a subtitle that the data already knows:

- Hour slices: “this calendar day”.
- Weekday / weekend: “rolling 7 days ending this date”.
- Compare: two dates, same slice, share of footfall. If the second pack is missing, the question does not paint a fake delta; it says which date failed.

Default day is the latest pack with data, which the iframe already resolves. Do not default a customer to a baked snapshot and a live pack in the same menu without a badge. The `LIVE` badge on the day select stays.

### 7.4 Place, shared with Live tracks

Clicking a zone writes a small selection both views can read: venue id, zone id or polygon, camera target, and whether the intent is “now” or “that day”.

- Flow → Live: fly the live camera to that polygon and, if the flow day is today, keep the bodies. The toggle stops being amnesia.
- Live → Flow: open the flow on today and that zone, question “Where did they stop?”.

The flow iframe can keep its postMessage bridge (`ff-controls-collapsed`, `ff-story-toggle`). Add a message for the selection instead of inventing a second map.

### 7.5 What leaves the first screen

Move into a **Lab** drawer, labelled as lab, not as Advanced:

- Particle count, trail length, time scale, κ, inertia, dwell-drag toggle. Ship with the current defaults (2,400 / 18 / 12× / 2.8 / 0.82 / drag on). They are the picture’s tuning, documented in section 3.5, not a user’s analysis.
- Mean arrows. Off. A one-way spine can offer them because purity is high there; the two-way floor should not.
- Alignment nudge and mirror plan. Commissioning. They belong next to the DWG tools in Edit, where a mis-click is obviously a registration edit.
- Profit evaporate, the margin drill, and Story Mode’s euro beats. They return when `profitBasis === 'LIVE'` for that ROI, or when the One ID view is a real reconciled trajectory from Journey Lab rather than `demoTrail`. The interaction (Why → Who → one path) is worth keeping as the shape of that future screen. The hardcoded fingerprints are not.
- Insight ticker.

Heat rise, isolines, peak glow, and the aisle curtain stay as **reading aids inside the question that needs them**, not as a checkbox group. Peak glow belongs to “Where did they stop?”. The curtain belongs to a selected bay. Isolines belong to regime and to shift, where a boundary is the finding.

### 7.6 Story Mode, if a meeting still needs it

Five beats, the five store questions, in order, on a chosen day, with the card speaking only section 4.2 language. Auto-advance stays. The rungs collapse to three words the floor can support: **See** (how it moved, where it stopped), **Find** (queue, cold bay), **Compare** (the mix moved). Quantify and Recommend wait for a live euro.

Camera moves stay. They are the best part of the current story: the CAD does not move, the field does, the camera admits it by flying to the tills.

### 7.7 A session that should feel inevitable

Tuesday, after close, a department lead opens the floor.

1. **How did the shop move?** The carpet is today’s dwell, lines running the two-way aisles, the entrance and the tills visibly one-way. The card says the day and the hours.
2. **Where did they stop?** Hills rise on fresco and on one mid-aisle bay. The card lists three hills and how each compares with the aisle around it.
3. They click the mid-aisle hill. The card is that bay: footfall, dwell, stop-rate against the reference mark, “vs nearby”.
4. **Where is the queue?** The camera is already at the tills. The card is waiting minutes per entrant for the peak band, per lane, with fixed objects removed — the daily KPI, not a dwell average. A lane that is only transit does not look like a queue.
5. **Did the mix move?** They pick last Tuesday. Colour shifts on the bay they clicked; the hill is still there. The card says the traffic share moved and people still stop. That is a finding. It is not yet “the promo worked”.

If they want bodies, Live opens on that bay. They see cylinders and the fragmentation the card already refused to call “customers”. Both pictures stay true to their unit.

---

## 8. Algorithms the refactor must not “simplify”

Changing the chrome is safe. Changing these defaults changes the claim the picture makes.

| Keep | Why |
|---|---|
| 8-bin rose, not a mean vector | Mean flow is ~0 on the busiest floor |
| κ around 2.8 and inertia around 0.82 | Counter-streams in two-way aisles |
| Dwell drag | Pooling is the stop, shown in the motion |
| Blur for values, unblurred coverage for “we measured this” | Stops the carpet inventing floor |
| Percentile scales (support p95, colour p98) | One trolley must not black out the shop |
| Share-normalised shift | A quiet evening is not a loss everywhere |
| 15 s gap, 3 m/s cap, 0.25 m/s dwell, 0.4 m step | These match the extractor. Retune in `FlowFieldDailyService` and `field.js` together, with a day diff against 14 September |
| 1.5 m cell, stated in the card | So nobody quotes it as the 1 m heat or the 2 m executive flow vector |
| Dark uncovered cells | Absence of sensor is not absence of people, and it is not zero dwell |
| Regime priority dwell > through-route > one-way > two-way | Documented order; a bay can be only one class |
| Stop-rate hidden on checkout | A till is a wait, not a facing |
| Heuristic euros out of the customer climax | The formula in section 4.5 is a sketch |

If a simpler picture is needed for a first release, ship **four store questions** (moved, stopped, queue, mix) and leave cold-bays and Deeper for the next cut. Do not ship a mean-arrow field to make the legend easier.

---

## 9. Where the code is

| Concern | Path |
|---|---|
| Floor switch | `frontend/src/components/layout/FloorVizToggle.tsx`, `floorViz` in `frontend/src/App.tsx` |
| Shell, iframe lifetime | `frontend/src/components/layout/AppShell.tsx` |
| Embed and postMessage | `frontend/src/components/flowfield/FlowFieldEmbed.tsx` |
| Flow UI | `frontend/public/flowfield/index.html`, `main.js` |
| Field math | `frontend/public/flowfield/field.js` |
| Insight layers, heuristic € | `frontend/public/flowfield/layers.js` |
| Demo drill-down | `frontend/public/flowfield/drilldown.js` |
| Daily pack API | `backend/services/FlowFieldDailyService.js`, `backend/routes/flowfield.js` |
| Live reconciler and canvas | `backend/services/TrajectoryReconciler.js`, `frontend/src/context/TrackingContext.tsx`, `frontend/src/components/venue/MainViewport.tsx` |
| Live presets for this store | `frontend/src/components/matching/TrajectoryQualityPanel.tsx` |
| Contractual KPIs | `scripts/daily-customer-kpi.py`, `analysis/journey_lab/config/treviglio.json` |
| Executive / Cliente medio UI | `frontend/src/features/businessReporting/` |

The standalone prototype under `prototypes/flowfield/` mirrors the public app. Edit the public app (or port deliberately). Two copies have already drifted by a few lines.

---

## 10. What “done” means for the refactor

- A newcomer can name the active question in one phrase, and the right card repeats that phrase.
- No control on the first screen changes particle count, κ, plan registration, or a euro heuristic.
- Weekday and “this day” cannot be confused.
- The queue card shows the gated queue KPI when `daily_kpi` exists for that day, and says it is missing when it does not. It does not invent a wait from dwell colour.
- “Did the mix move?” refuses to render when the second day is absent.
- Story Mode, if present, has no beat whose number is simulated.
- Live tracks opened from a flow zone lands on that zone.
- Unmeasured floor stays dark.
- A two-way aisle still shows two directions.

## Implementation update — 11 October 2026

The standalone/embedded flow renderer now mounts `workspace.js` and `workspace.css`:

- Five question tabs, persistent date/time controls, one evidence panel, and an advanced-tools drawer.
- Question switches preserve the time slice, selected polygon and camera. Selecting the map no longer automatically opens illustrative shopper journeys.
- Movement uses the speed scalar. Question defaults disable dwell drag, profit particles and raised terrain. Relief and illustrative presets remain available under tools.
- Evidence aggregates **raw payload cells**, separate from the smoothed map: summed slow-presence seconds, slow/presence ratio when presence exists, step-weighted speed and heading distribution. It deliberately has no summed “unique shoppers” metric.
- Full-screen expansion keeps the original iframe mounted. Four-slice time profile loads on request. Saved view restores date, slice, question, area and camera in the same browser.
- The existing share-change map is retained. When a second API day is available, the evidence panel adds period totals and matched 2D cell maps with common bounds and colour scale. These maps compare accumulated slow presence; they are not two synchronised 3D renderers.
- Mobile evidence opens through an explicit Evidence button. Reduced-motion preference pauses animation on initial load.

Validation: raw aggregation tests (`node --test frontend/public/flowfield/workspace-metrics.test.mjs`), JavaScript syntax checks, and standalone browser checks of question/time persistence, map selection, saved-view restore and the four-slice profile. Desktop and phone layouts checked with bundled demo data.

The Queue view can request the existing daily-KPI endpoint and shows waiting minutes per entrant only for an `ok` daily row, explicitly scoped to the store and 08:00–20:00. The embedded workspace can open the selected area in Live tracks at its venue-metre centre; the destination shows now. These integrations and production date comparisons still need verification against the running application/API. Per-lane KPI overlays and area-versus-area comparison are not implemented. No production deployment was performed. Local Vite startup was blocked by a missing optional Rollup native dependency; the standalone preview uses a static server.

Full TypeScript checking was attempted and reports repository-wide errors, including existing unused declarations and object-type mismatches outside the changed logic. The Vite build is not verified.

## Business UX revision — 11 October 2026

The analysis workspace now leads with a store finding, named locations and a next operational check. The angle distribution has been removed from the business interface. The previous engineering drawer, guided-demo controls and illustrative commercial layers are absent from the default workspace; Display exposes only controls relevant to the active question.

The five views have separate encodings:

- **Store movement:** cyan tapered streams and luminous heads over a subdued plan. These sample the direction field, not individual journeys. Movement near named department frontages is ranked by accepted steps per observed square metre, relative to the department median.
- **Browsing & stops:** amber dwell relief with subdued motion; departments rank by slow-presence share. The explanation keeps browsing, service and obstruction as possible interpretations, not identified intent.
- **Checkout pressure:** the overview frames the checkout area. Only queue regions receive the coral heat treatment. Lanes rank by accumulated slow-presence time, displayed as hours/minutes across the chosen window, never as individual waiting time. The daily waiting-per-entrant KPI remains a separate report.
- **Department balance:** blue/amber department-frontage areas show negative/positive differences in slow-time share against the observed department median. No conversion or sales inference is made.
- **Before & after:** neutral until two dated store packs are available. No substitute morning/evening heatmap is presented as an intervention result.

`business-analysis.js` groups configured frontages by category and uses the union of polygons so overlap within a department cannot duplicate observations. Checkout queue polygons remain lane-specific. Areas require at least 30 seconds of observed presence to enter a ranking. This is an observation floor, not a calibrated confidence or sensor-quality certification. The ranking population and methodology are accessible under Evidence & time pattern. Broad department labels refer only to their configured, observed frontages.

Numbered map markers and ranked cards select the same area. Multi-frontage selection masks preserve the polygon union. Distinct views preserve a compatible selection; entering checkout analysis clears a department selection and leaving it clears a lane selection; the unselected checkout overview frames the tills. Display settings do not expose particle counts, heading commitment, coordinate calibration, heuristic profit or demo journeys.

Verification includes business-analysis tests for polygon union, queue-versus-service filtering, missing-data suppression, signed department differences and duration formatting, plus the existing raw-metric tests. Production accuracy still depends on the underlying field's coverage, calibration and contamination controls; these UI changes do not certify the tracking data.

### Value opportunities integration — 11 October 2026

The sixth business view places numbered gold markers and translucent gold polygon outlines on the windflow map. Streamlines remain subdued movement context; neither their colour nor the gold footprint size encodes lost money. Selecting a marker focuses the area and opens findings on mobile.

Two explicitly separate scopes are available:

- **Selected flow period:** review priority = accepted movement per observed square metre × (1 − slow-presence share). Only supported department frontages are eligible; the top three receive markers. This is a screening heuristic, not the 12-axis fingerprint, conversion, or a euro estimate. No euros are generated from static flow data.
- **Current Profit Radar snapshot:** an explicit load requests `/api/profit-radar/insights?venueId=…`. The response must match the selected venue. Only insights marked observed, with positive track count, a mapped ROI, and source observations no older than 120 seconds are eligible. Synthetic product-zone fillers are excluded even if they happen to have an active zone. The source timestamp comes from the oldest contributing fingerprint in the zone, not the API response time. Displayed results expire on a 30-second UI check. Current radar findings remain labelled current while the historical flow remains contextual.

Configured shelf/store economics permit a modelled gross-margin range, expected scenario, three dominant fingerprint signals, suggested experiment, alternative action estimates, and formula disclosure. Default economics show investigation evidence without a euro headline. Scores are labelled out of 100, not percentages of shoppers. Actions use the existing engine's 60% effort scenario. There is no new effort-slider formula or independent model in the windflow renderer.

One highest-expected scenario is retained per ROI. Alternatives and overlapping areas are not totalled. This does not establish unique store-wide recovery. Realised margin, purchase conversion, causal price objections, and statistical confidence intervals are not inferred. Zero recovery now stays zero in the engine's headline band. The backend severity zero-index bug and Pulse's incorrect use of the first insight's confidence for both comparison operands were corrected.

The current snapshot path requires the updated backend metadata contract; an older/unavailable endpoint fails closed. Static demo data remains useful for flow screening. Local browser checks covered the real demo map, marker selection, mobile findings, unavailable API handling, and a clearly labelled temporary UI fixture for priced scenario rendering. Production radar delivery has not been verified or deployed.

### Executive inspection scorecards — supplied-report correction (11 October 2026)

This section supersedes the earlier windflow recommendations to show slow-person-time or daily minutes per entrant in the default business inspection. The user's supplied `esselunga-executive-2026-09-14 2.pdf` is a different report contract: 14 September, **00:00–23:30 Europe/Rome**, with stopping, category dwell, engagement, crossings and average queue waits.

**Calculation source.** `frontend/public/flowfield/executive-report.js` requests `/api/reporting/summary` with persona `esselunga-executive`, variant `hq`, the attached report's exact start/end timestamps and its 5-second stopping, 15-second engagement-ranking and 10-second queue thresholds. The response's `supporting.esselungaJourney` comes from `ExecutiveJourneyService.computeExecutiveJourney`. Windflow performs no separate KPI estimation from vector-field cells. The adapter only maps names, units and report reliability flags. Venue and time-window mismatches fail closed. Geometry radii and resolved thresholds come from the report payload.

The supplied PDF corresponds to the `EsselungaExecutivePdf` customer-journey renderer. The current repository also has a newer daily-KPI PDF route and a different daily-per-entrant model. These are distinct measurement contracts; do not silently substitute one for the other. This inspection uses the customer-journey contract explicitly requested via the attachment.

**Department calculations.** `buildFrescoDepartments` in `ExecutiveJourneyService` uses `CategoryPresenceIndex` for category-presence episodes. Stopping is the share of category visits reaching the shelf face (default 0.5 m). Category dwell is the median duration within the category halo (default 2 m), among engaged visits. Engagement is median shelf-face time, nested within category dwell. The service applies the 30-crossing reportability gate, presence/engagement episode support gates and reconstructed-polygon-episode fallback. Windflow retains `reportable`, `dwellReliable`, `engagementReliable` and missing values. The crossings column counts zone entries, not the stopping denominator: do not divide displayed stops by displayed crossings to recreate stopping percentage.

**Checkout calculations.** The adapter reads each channel/lane's calculated `avgWaitSec`, `sessions`, `completed`, and `abandonPct`; it never derives average waiting from accumulated cell dwell or divides by store entrants. Lane comparisons use the same channel's average. The report service retains queue-session filtering, grouping and weighting. The PDF only prints the six longest-wait lanes; missing lanes in the archived fallback stay unavailable. A service response can supply all calculated lanes.

**UX.** Four persistent inspection values show stopping percentage, category dwell seconds, engagement seconds and crossings. The checkout overview shows average wait, sessions, completed sessions and abandonment; selecting a lane shows its wait, shoppers, abandonment and channel baseline. Department comparison switches between stopping, dwell, engagement and crossings; mean category dwell and small-sample categories are not promoted into the fresco median ranking. The map shows thin mapped frontage polygons with a shared scale; the legacy yellow outlier circles and slow-time terrain are disabled. Selection highlights the zone without a disruptive camera zoom. At laptop sizes KPI cards sit beside the floor plan and comparisons remain in the findings rail.

**Local preview and provenance.** The calculation endpoint is attempted first. If unavailable, the explicitly labelled attached-PDF snapshot in `journey-reference.json` provides the published values, never a live-data claim. Its cross-checks include Verdura 70% / 19s / 16s / 11,780 crossings and checkout 4: 54s, 143 shoppers, 0% abandonment. Flow time buttons affect spatial context only; report KPIs retain the stated report window. Refresh report retries the calculation endpoint. Profit Radar remains a separate modelled-economics view; this PDF provides no measured profit-loss values.

**Validation.** Focused Node tests cover the published reference values, missing lanes/departments, comparable ranking populations, adapter reliability gates, venue/window rejection, and request parameters. Browser validation covers department selection, comparison metric changes, checkout inspection and the no-circles map. Recomputed production-data parity cannot be confirmed while the report endpoint is unavailable in the static local preview. No deployment was performed.

## Spatial workspace — seven lenses (12 October 2026, Claude)

Replaces the 11 October business workspace (`workspace.js` / `workspace.css`) with one shell around the same iframe renderer: **Pulse, Flow Explorer, Engagement, Service, Opportunities, Compare, Live**. Visual direction: `Hyperspace_Retail_UX_7_Views` references. Screenshots of the running code: `docs/design/retail-ux/screens/`. Not deployed.

**Architecture.** The flowfield iframe keeps owning the shell (header, rail, inspector, timeline) because the scene, selection masks and camera live there and the React shell already embeds it with one postMessage bridge (`ff-open-live`). React is unchanged. `main.js` keeps every flow algorithm; it gained a small lens API (`lens`, `select`, `flyTo`, `overview`, `top`, `relief`, `scalarInfo`, `packInfo`, `setDate`, `hasSlice`, `ensureLive`, `pause`, `suspend`), narrower cyan stream cores (ribbon 0.075 m, head points 0.42 m, dimmer additive colour) and a `flow` business mode that keeps the selected scalar on the floor. Rendering stops while the tab is hidden and while Compare shows its 2D maps; the iframe is never reloaded.

**Numbers: two contracts, never merged.**

| Source | Where | Window | Adapter |
|---|---|---|---|
| Visitor Journey = `daily_kpi` (default) | Pulse, Engagement, Service, Opportunities, Compare | 08–20, 2-hour slots | `visitor-journey.js` (selects rows, never computes; status ≠ ok → "—" + reason) |
| Executive customer-journey report | Pulse, Engagement, Service (toggle in the inspector) | 00:00–23:30 | Astra's `executive-report.js` → `/api/reporting/summary`; archived PDF snapshot `journey-reference.json`, labelled |

Each card, chip and footer names its source and window. Visitor Journey slot chips move the numbers and, when a dated pack exists, the floor (new slices `trading`, `h08_10` … `h18_20` in `FlowFieldDailyService.SLICES`). With the Executive report the chips are flow windows only and the report keeps 00:00–23:30.

**Geometry.** `visitor-areas.json` is exported by `scripts/daily_kpi/export_area_geometry.py` from the same 0.25 m raster as `199_department_areas` (nearest strip owns, 3 m reach, 1 m al banco, checkout/entrance/staff exclusions, observed-cell mask). Areas match `199_department_areas.json areas_m2` to the cell (Frutta 142.6 m², Verdura 88.9 m², …). Checkout lane polygons are the `Checkout N - Queue/Service` ROIs. Executive-report areas are ROI frontage unions (as Astra built them).

**Lenses.**

| Lens | Floor | Inspector | Data |
|---|---|---|---|
| Pulse | Cyan streams; Flow / Dwell / Departments | Department and service signals, Visitor Journey KPIs, visit composition | daily_kpi (or report) |
| Flow Explorer | One scalar at a time: movement, dwell, activity, purity, convergence, regimes | Movement anatomy, spatial evidence, legend; Lab button | flow pack only, no KPI |
| Engagement | Measured department areas (amber), al-banco band, choice index | Minutes in area, al banco, choice index, slots, "Da qui si va a" (recon gate), ranking | daily_kpi; report: stopping / dwell / engagement / crossings |
| Service | Camera to tills, lanes coral by share of waiting, service ROIs dashed | Queue and service per customer, 1-minute line, lane shares, selected lane | daily_kpi; report: avgWait / sessions / abandonment / channel avg |
| Opportunities | Gold review areas A/B/C | Evidence, Observe → Test → Verify; current Profit Radar on demand (fail-closed `radarAreas`) | daily_kpi rules (queue slot over 1 min; department crossed not worked, served counters excluded); no euros without configured economics |
| Compare | Two matched 2D top maps (same grid, scale, share-normalised) or a difference map | Window pickers; Visitor Journey side by side only when both windows are KPI slots | flow packs |
| Live | NOW clock; region selection carried over | Occupancy "—" until a verified feed; "Open Live tracks here" posts `ff-open-live` | none in the iframe |

**Tests.** `node --test frontend/public/flowfield/visitor-journey.test.mjs` (parity with the 14 Sep audited set: 1,948 / 17.62 min / 0.641 min, 18–20 = 1.01; lanes 5, 7, 13; failed rows unavailable; venue/day fail closed). Existing flowfield tests unchanged. Browser interaction check: `docs/design/retail-ux/e2e-lenses.mjs` (19 checks incl. selection carry-over, slot change, source switch, Checkout 4 54 s and Verdura 70 % on the report source).

**Open points.** Visitor Journey itself still prints values whose status is `unreliable`; the lens hides them. On the Casse table the lane rows are per session and "Tutte" is per entrant. Live bodies are not drawn inside the iframe; Live tracks stays in `MainViewport`. The 2-hour flow slices need one rebuild of each cached day pack (automatic on first request).
