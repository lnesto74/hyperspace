# Hyperspace KPI Documentation

**Comprehensive Guide to All KPIs, Metrics, and Correlations**

---

## Table of Contents

1. [Overview](#overview)
2. [Standard Zone KPIs](#standard-zone-kpis)
3. [Queue KPIs](#queue-kpis)
4. [DOOH (Digital Out-of-Home) KPIs](#dooh-kpis)
5. [PEBLE™ Attribution KPIs](#peble-attribution-kpis)
6. [Shelf Analytics KPIs](#shelf-analytics-kpis)
7. [KPI Correlations](#kpi-correlations)
8. [Data Sources & Tables](#data-sources--tables)
9. [API Endpoints](#api-endpoints)

---

## Overview

Hyperspace is a LiDAR-based spatial analytics platform that computes KPIs from trajectory data. The system tracks anonymous human movement through physical spaces (venues) and calculates metrics across four main domains:

1. **Standard Zone KPIs** - General foot traffic, dwell, and engagement metrics
2. **Queue KPIs** - Queue theory-based waiting time and throughput metrics
3. **DOOH KPIs** - Digital display exposure and attention quality metrics
4. **PEBLE™ Attribution KPIs** - Post-exposure behavioral lift measurement

All KPIs are computed from raw trajectory data stored at 1Hz sampling rate in the `track_positions` table.

---

## Standard Zone KPIs

**Source:** `@/Users/lnesto/CascadeProjects/Hyperspace/backend/services/KPICalculator.js`

Standard KPIs are calculated per **Region of Interest (ROI)** / Zone within a venue. These represent the core footfall analytics metrics.

### Basic Metrics

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **visits** | Count | `COUNT(DISTINCT track_key)` | Unique visitors who entered the zone |
| **totalEntries** | Count | `COUNT(*)` | Total number of zone entries (includes re-entries) |
| **timeSpent** | Minutes | `SUM(duration_ms) / 60000` | Total cumulative time spent in zone by all visitors |
| **avgTimeSpent** | Minutes | `timeSpent / visits` | Average time per unique visitor |
| **avgTimeSpentCT** | Minutes | Same, filtered by `is_complete_track = 1` | Average time for complete tracks only (not truncated) |

### Dwell Metrics

Dwell occurs when a visitor stays in a zone longer than the **dwell threshold** (default: 10 seconds).

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **dwellsCumulative** | Count | `SUM(is_dwell = 1)` | Total number of dwell events |
| **dwellsUnique** | Count | `COUNT(DISTINCT track_key WHERE is_dwell = 1)` | Unique visitors who dwelled |
| **dwellAvgTime** | Minutes | `AVG(duration_ms WHERE is_dwell = 1) / 60000` | Average dwell duration |
| **dwellAvgTimeCT** | Minutes | Same, filtered by complete tracks | Average dwell for complete tracks |
| **dwellRate** | Percentage | `(dwellsUnique / visits) × 100` | % of visitors who dwelled |
| **dwellsPerVisit** | Ratio | `dwellsCumulative / visits` | Average dwells per visitor |
| **dwellShare** | Percentage | `(dwellsCumulative / venueTotalDwells) × 100` | Zone's share of all venue dwells |

### Engagement Metrics

Engagement occurs when dwell exceeds the **engagement threshold** (default: 30 seconds).

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **engagementsCumulative** | Count | `SUM(is_engagement = 1)` | Total engagement events |
| **engagementsUnique** | Count | `COUNT(DISTINCT track_key WHERE is_engagement = 1)` | Unique engaged visitors |
| **engagementAvgTime** | Minutes | `AVG(duration_ms WHERE is_engagement = 1) / 60000` | Average engagement duration |
| **engagementRate** | Percentage | `(engagementsUnique / visits) × 100` | % of visitors who engaged |
| **engagementsPerVisit** | Ratio | `engagementsCumulative / visits` | Average engagements per visitor |
| **engagementShare** | Percentage | `(engagementsCumulative / venueTotalEngagements) × 100` | Zone's share of engagements |

### Flow Metrics

Flow metrics track customer journey patterns through the venue.

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **draws** | Count | First dwell location for each visitor | How many visitors' first dwell was in this zone |
| **drawRate** | Percentage | `(draws / visits) × 100` | Zone's ability to attract first engagement |
| **drawShare** | Percentage | `(draws / venueTotalDraws) × 100` | Share of all first engagements |
| **exits** | Count | Last dwell before leaving (non-conversion) | How many left venue from this zone |
| **exitRate** | Percentage | `(exits / visits) × 100` | % of visitors who exited from here |
| **exitShare** | Percentage | `(exits / venueTotalExits) × 100` | Share of all venue exits |
| **bounces** | Count | Visitors who dwelled ONLY in this zone | Single-zone visitors |
| **bounceRate** | Percentage | `(bounces / visits) × 100` | % of visitors with single-zone journey |
| **bounceShare** | Percentage | `(bounces / venueTotalBounces) × 100` | Share of all bounces |

### Occupancy Metrics

Real-time and historical occupancy tracking.

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **peakOccupancy** | Count | `MAX(occupancy_count)` | Maximum simultaneous people in zone |
| **avgOccupancy** | Float | `AVG(occupancy_count)` | Average occupancy over time period |

### Velocity Metrics

Movement speed analysis within zones.

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **avgVelocity** | m/s | `AVG(SQRT(vx² + vz²))` | Average movement speed |
| **avgVelocityInMotion** | m/s | Same, filtered where speed > 0.1 m/s | Average speed excluding stationary |
| **atRestTotalTime** | Minutes | Count samples where speed ≤ 0.1 m/s | Total stationary time |
| **inMotionTotalTime** | Minutes | Count samples where speed > 0.1 m/s | Total moving time |
| **percentAtRest** | Percentage | `(atRestSamples / totalSamples) × 100` | % of time stationary |
| **percentInMotion** | Percentage | `(inMotionSamples / totalSamples) × 100` | % of time moving |

### Utilization Metrics

Space efficiency tracking.

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **utilizationTimeMin** | Minutes | Time intervals where occupancy > 0 | Total time zone was occupied |
| **utilizationRate** | Percentage | `(utilizationTime / totalTimeRange) × 100` | % of time zone was used |
| **hourlyUtilization** | Minutes | Same, for last hour | Utilization in recent hour |
| **hourlyUtilizationRate** | Percentage | Hourly utilization rate | Recent hour efficiency |
| **dailyUtilization** | Boolean | Any visits today? | Whether zone was used today |
| **dailyUtilizationRate** | Percentage | Daily utilization percentage | Daily efficiency |

### Conversion Metrics

Transaction correlation (when POS integration available).

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **conversions** | Count | Zone visits followed by checkout | Direct conversions from zone |
| **conversionRate** | Percentage | `(conversions / visits) × 100` | Zone conversion efficiency |
| **attributedConversions** | Count | Conversions with zone in path | Attributed conversion count |
| **attributedConversionRate** | Percentage | Attribution rate | Attribution efficiency |
| **conversionDrivers** | Count | Zone was last engagement before conversion | Zone drove the sale |
| **conversionDriverRate** | Percentage | Driver rate | Sales influence metric |

### Time Series Data

| Data | Structure | Description |
|------|-----------|-------------|
| **visitsByHour** | `[{hour: "00", visits: N}, ...]` | 24-hour visit distribution |
| **occupancyOverTime** | `[{timestamp, avgOccupancy, maxOccupancy}, ...]` | 15-minute occupancy buckets |
| **dwellDistribution** | `[{bucket: "0-30s", count: N}, ...]` | Dwell time histogram |

---

## Queue KPIs

**Source:** `@/Users/lnesto/CascadeProjects/Hyperspace/backend/services/TrajectoryStorageService.js:597-652`

Queue KPIs follow **queuing theory** principles. They require linking a **queue zone** to a **service zone** (e.g., checkout line → checkout register).

### Queue Session Lifecycle

```
Queue Entry → Waiting in Queue → Queue Exit → Service Entry → Service Exit
     ↓                                              ↓
  Abandoned                                     Completed
```

### Core Queue Metrics

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **totalSessions** | Count | All queue entries | Total people who joined queue |
| **completedSessions** | Count | Sessions with service exit | Successfully served customers |
| **abandonedSessions** | Count | Left queue without service | Customers who gave up |
| **abandonRate** | Percentage | `(abandoned / total) × 100` | Queue abandonment rate |

### Waiting Time Metrics

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **avgWaitingTimeMs** | Milliseconds | `AVG(waiting_time_ms)` | Average wait time |
| **avgWaitingTimeSec** | Seconds | `avgWaitingTimeMs / 1000` | Formatted seconds |
| **avgWaitingTimeMin** | Minutes | `avgWaitingTimeMs / 60000` | Formatted minutes |
| **historicalAvgWaitMs** | Milliseconds | Historical average | Database average |
| **currentWaitMs** | Milliseconds | Live from in-memory sessions | Real-time current wait |
| **avgWaitingTimeCompleteMs** | Milliseconds | Wait time for completed sessions only | Successful wait average |
| **maxWaitingTimeMs** | Milliseconds | `MAX(waiting_time_ms)` | Longest wait recorded |
| **medianWaitingTimeMs** | Milliseconds | P50 percentile | Median wait time |
| **p90WaitingTimeMs** | Milliseconds | 90th percentile | 90% served within this time |
| **p95WaitingTimeMs** | Milliseconds | 95th percentile | 95% served within this time |

### Service Metrics

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **avgServiceTimeMs** | Milliseconds | `AVG(service_time_ms)` | Average service duration |
| **avgTimeInSystemMs** | Milliseconds | `AVG(time_in_system_ms)` | Total time (wait + service) |
| **arrivalRatePerHour** | Float | `COUNT / hours` | Customer arrival rate (λ) |
| **currentQueueLength** | Count | Live occupancy in queue zone | People currently waiting |

### Queue Zone Settings

Configurable thresholds per queue zone:

| Setting | Default | Description |
|---------|---------|-------------|
| `queue_warning_threshold_sec` | 60 | Yellow alert threshold |
| `queue_critical_threshold_sec` | 120 | Red alert threshold |
| `queue_ok_color` | #22c55e | Green status color |
| `queue_warning_color` | #f59e0b | Warning status color |
| `queue_critical_color` | #ef4444 | Critical status color |

---

## DOOH KPIs

**Source:** `@/Users/lnesto/CascadeProjects/Hyperspace/backend/services/dooh/DoohKpiEngine.js`

DOOH (Digital Out-of-Home) KPIs measure exposure quality for digital display screens using LiDAR trajectory data only (no cameras).

### Screen Configuration

Each DOOH screen has:
- **SEZ (Screen Exposure Zone)**: Viewing cone polygon where exposure is measured
- **AZ (Attention Zone)**: Optional high-attention sub-zone
- **Yaw angle**: Screen facing direction (0° = +Z, 90° = +X)

### Exposure Detection Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `T_min_seconds` | 0.7 | Minimum exposure duration |
| `max_gap_seconds` | 1.5 | Max gap before new exposure |
| `speed_attention_max_mps` | 1.2 | Max speed for attention credit |
| `speed_stationary_max_mps` | 0.35 | Stationary speed threshold |
| `speed_passby_max_mps` | 2.0 | Pass-by filter threshold |
| `d_min_m` | 0.8 | Minimum viewing distance |
| `d_max_m` | 4.0 | Maximum viewing distance |

### Exposure Event Metrics

| Metric | Formula | Description |
|--------|---------|-------------|
| **durationS** | `(endTs - startTs) / 1000` | Total exposure duration |
| **effectiveDwellS** | Sum of time at attention-eligible speed | Quality-weighted duration |
| **minDistanceM** | `MIN(distances)` | Closest approach to screen |
| **p10DistanceM** | 10th percentile of distances | Typical viewing distance |
| **meanSpeedMps** | `AVG(speed)` | Average movement speed |
| **minSpeedMps** | `MIN(speed)` | Slowest speed (attention indicator) |
| **entrySpeedMps** | Speed in first 1 second | Entry approach speed |

### AQS (Attention Quality Score)

**Formula:** `AQS = 100 × (w_dwell × Sd + w_proximity × Sp + w_orientation × So + w_slowdown × Ss + w_stability × St)`

#### Component Scores

| Score | Weight | Formula | Description |
|-------|--------|---------|-------------|
| **Dwell Score (Sd)** | 0.35 | `1 - exp(-Te / τd)` | Exponential dwell credit (τd = 2.5s) |
| **Proximity Score (Sp)** | 0.20 | `clamp((d_max - d_eff) / (d_max - d_min), 0, 1)` | Distance quality |
| **Orientation Score (So)** | 0.20 | `sqrt(f × g)` where f=heading alignment, g=screen normal | Facing quality |
| **Slowdown Score (Ss)** | 0.15 | `r^γ` where r = (entry_speed - min_speed) / entry_speed | Deceleration intent |
| **Stability Score (St)** | 0.10 | `0.5 × F_stat + 0.5 × Sd` | Stationary behavior |

#### AQS Tiers

| Tier | AQS Range | Description |
|------|-----------|-------------|
| **premium** | ≥ 70 | High-quality, focused attention |
| **qualified** | 40-69 | Standard quality exposure |
| **low** | < 40 | Pass-by or minimal attention |

### Context Segmentation

Exposures are tagged with journey context:

| Context | Priority | Description |
|---------|----------|-------------|
| `queue` | 1 | In checkout queue |
| `checkout` | 2 | At checkout |
| `promo` | 3 | In promotional area |
| `aisle` | 4 | Shopping aisle |
| `entrance` | 5 | Arriving |
| `exit` | 6 | Departing |
| `other` | 7 | Unclassified |

### Aggregated Screen KPIs

Per time bucket (default 15 minutes):

| KPI | Formula | Description |
|-----|---------|-------------|
| **exposures** | Count of exposure events | Total exposures |
| **uniqueVisitors** | `COUNT(DISTINCT track_key)` | Unique viewers |
| **avgAqs** | `AVG(aqs)` | Average attention quality |
| **premiumRate** | `premium_count / total × 100` | Premium tier percentage |
| **qualifiedRate** | `qualified_count / total × 100` | Qualified tier percentage |
| **avgDwellS** | `AVG(effective_dwell_s)` | Average attention dwell |
| **contextBreakdown** | Distribution by context | Journey phase distribution |

---

## PEBLE™ Attribution KPIs

**PEBLE™ = Post-Exposure Behavioral Lift Engine**

**Source:** `@/Users/lnesto/CascadeProjects/Hyperspace/backend/services/dooh_attribution/DoohAttributionEngine.js`

PEBLE implements a **matched control attribution algorithm** to measure incremental lift from DOOH ad exposure on shelf engagement.

### Attribution Methodology

#### Matched Control Design

1. **Exposed Group**: Visitors with qualifying AQS exposure to campaign screen
2. **Control Group**: Similar visitors who passed *near* the screen (corridor) but weren't exposed
3. **Matching Criteria**: Time bucket, heading, speed, pre-zone context

#### Matching Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `action_window_minutes` | 10 | Time window to measure conversion after exposure |
| `match_time_bucket_min` | 15 | Time bucket for control matching |
| `control_matches_M` | 5 | Number of controls per exposed |
| `min_controls_required` | 3 | Minimum controls for valid measurement |
| `near_corridor_buffer_m` | 1.5 | Buffer around SEZ for control candidates |
| `aqs_min_for_exposed` | 50 | Minimum AQS to qualify as exposed |
| `visitor_reset_minutes` | 45 | Reset visitor identity window |
| `confidence_floor` | 0.3 | Minimum confidence threshold |

#### Matching Weights

| Weight | Default | Description |
|--------|---------|-------------|
| `w_time` | 0.4 | Time proximity weight |
| `w_heading` | 0.3 | Heading similarity weight |
| `w_speed` | 0.3 | Speed similarity weight |

### Campaign Target Types

| Type | Description | Example |
|------|-------------|---------|
| `shelf` | Specific shelf fixture | "Shelf-A1" |
| `category` | Product category | "Snacks" |
| `brand` | Brand name | "Coca-Cola" |
| `sku` | Specific product | "Coke 500ml" |
| `slot` | Planogram slot | "Level-2-Slot-5" |

### Attribution Event Metrics

| Metric | Type | Description |
|--------|------|-------------|
| **converted** | Boolean | Did visitor engage with target within action window? |
| **ttaS** | Seconds | Time-to-Action (exposure end → engagement start) |
| **dciValue** | Float (-1 to 1) | Direction Change Index |
| **confidence** | Float (0-1) | Confidence in attribution |

### DCI (Direction Change Index)

**Formula:** `DCI = post_alignment - pre_alignment`

Where alignment = dot product of movement direction and target direction.

| DCI Value | Interpretation |
|-----------|----------------|
| > 0 | Trajectory turned TOWARD target after exposure |
| = 0 | No change in trajectory alignment |
| < 0 | Trajectory turned AWAY from target |

### Aggregated Campaign KPIs

Computed per time bucket:

| KPI | Formula | Description |
|-----|---------|-------------|
| **pExposed** | `exposedConverted / exposedCount` | Exposed group conversion rate |
| **pControl** | `controlConverted / controlCount` | Control group conversion rate |
| **liftAbs** | `pExposed - pControl` | Absolute lift |
| **liftRel** | `liftAbs / pControl` | Relative lift (EAL) |
| **medianTtaExposed** | Median TTA for exposed | Exposed action speed |
| **medianTtaControl** | Median TTA for control | Control action speed |
| **ttaAccel** | `ttaControl / ttaExposed` | Time-to-action acceleration |
| **meanEngagementDwellExposed** | Exposed engagement dwell | Engagement depth (exposed) |
| **meanEngagementDwellControl** | Control engagement dwell | Engagement depth (control) |
| **engagementLiftS** | `dwellExposed - dwellControl` | Engagement dwell lift |
| **meanAqsExposed** | Average AQS for exposed | Exposure quality |
| **meanDciExposed** | Average DCI for exposed | Trajectory change (exposed) |
| **meanDciControl** | Average DCI for control | Trajectory change (control) |
| **confidenceMean** | Average confidence | Statistical confidence |

### CES (Campaign Effectiveness Score)

**Formula:** `CES = 100 × confidence × (0.55 × sLift + 0.25 × sTta + 0.20 × sEng)`

| Component | Formula | Description |
|-----------|---------|-------------|
| **sLift** | `clamp(liftRel / 0.5, 0, 1)` | Normalized lift score |
| **sTta** | `1 - exp(-max(ttaAccel - 1, 0) / 1.0)` | TTA acceleration score |
| **sEng** | `1 - exp(-max(engagementLiftS, 0) / 10.0)` | Engagement lift score |

### AAR (Attention-to-Action Rate)

**Formula:** `AAR = (conversions / qualified_exposures) × 100`

Where qualified_exposures = exposures with AQS ≥ 40.

### Summary KPIs

Aggregated across all buckets:

| KPI | Description |
|-----|-------------|
| **totalExposed** | Total exposed visitors |
| **totalControls** | Total control matches |
| **eal** | Exposure Attribution Lift (average relative lift) |
| **ttaAccel** | Average time-to-action acceleration |
| **engagementLift** | Average engagement dwell lift |
| **ces** | Average Campaign Effectiveness Score |
| **aar** | Average Attention-to-Action Rate |

---

## Shelf Analytics KPIs

**Source:** `@/Users/lnesto/CascadeProjects/Hyperspace/backend/services/ShelfKPIEnricher.js`

Shelf KPIs combine zone visit data with planogram (product placement) data for retail-specific analytics.

### Position Scoring

| Level Type | Multiplier | Description |
|------------|------------|-------------|
| `eye-level` | 1.5× | Prime visibility |
| `waist` | 1.0× | Standard visibility |
| `stretch` | 0.7× | Top shelf, requires reaching |
| `stooping` | 0.6× | Bottom shelf, requires bending |

| Slot Type | Bonus | Description |
|-----------|-------|-------------|
| `center` | +20% | Center shelf positions |
| `endcap` | +40% | End positions (promotional) |
| `edge` | 0% | Edge positions |

**Position Score:** `score = 50 × levelMultiplier × (1 + slotBonus)`

### Shelf-Specific KPIs

| KPI | Formula | Description |
|-----|---------|-------------|
| **browsingRate** | `(dwellsCumulative / visits) × 100` | % who browsed this shelf |
| **avgBrowseTime** | `dwellAvgTime × 60` (seconds) | Average browsing duration |
| **passbyCount** | `visits - dwellsCumulative` | Visitors who passed without browsing |

### Category Breakdown

Per category on shelf:

| Metric | Description |
|--------|-------------|
| **slotCount** | Number of slots for category |
| **facings** | Total product facings |
| **shareOfShelf** | `(slotCount / totalSlots) × 100` |
| **avgPositionScore** | Average position quality |
| **uniqueSkus** | Distinct products |
| **uniqueBrands** | Distinct brands |
| **avgPrice** | Average product price |
| **avgMargin** | Average product margin |
| **levelDistribution** | Slots per shelf level |

### Brand Breakdown

Per brand on shelf:

| Metric | Description |
|--------|-------------|
| **shareOfShelf** | Brand's shelf space percentage |
| **avgPositionScore** | Brand's position quality |
| **categories** | Categories brand appears in |

### Brand Efficiency Index

**Formula:** `efficiencyIndex = (avgPositionScore / 50) × 100 / shareOfShelf`

| Value | Interpretation |
|-------|----------------|
| > 1.0 | Over-performing (good positions relative to space) |
| = 1.0 | Neutral efficiency |
| < 1.0 | Under-performing (poor positions relative to space) |

### Revenue Metrics

| Metric | Formula | Description |
|--------|---------|-------------|
| **avgShelfPrice** | Average of all products | Average item value |
| **estimatedEngagementValue** | `dwells × avgPrice × 0.15` | Estimated revenue (15% conversion) |
| **revenuePerVisit** | `engagementValue / visits` | Revenue efficiency |

### Category Engagement Distribution

Estimated based on position score weighting:

| Metric | Formula |
|--------|---------|
| **estimatedEngagementShare** | `(cat.positionScore × cat.slotCount) / totalPositionWeight × 100` |
| **estimatedDwells** | `totalDwells × engagementShare` |
| **estimatedRevenue** | `engagementValue × engagementShare` |

---

## KPI Correlations

### Zone KPIs ↔ Queue KPIs

| Correlation | Relationship | Calculation |
|-------------|--------------|-------------|
| **Dwell vs Wait Time** | High dwell in queue zone = high wait time | `correlation(dwellAvgTime, avgWaitingTime)` |
| **Visits vs Arrivals** | Zone visits ≈ queue arrival rate | `zone.visits ≈ queue.arrivalRatePerHour × hours` |
| **Occupancy vs Queue Length** | Real-time equivalence | `queue.currentQueueLength = zone.currentOccupancy` (for queue zones) |
| **Exit Rate vs Abandon Rate** | Zone exit without conversion ≈ queue abandon | Tracks leaving queue zone without entering service zone |

### DOOH KPIs ↔ Zone KPIs

| Correlation | Relationship |
|-------------|--------------|
| **Exposure → Zone Visit** | Exposure event leads to zone visit within action window |
| **AQS → Engagement Quality** | Higher AQS correlates with longer zone engagement |
| **Context → Dwell Distribution** | Journey phase affects dwell patterns |
| **Screen Traffic → Zone Traffic** | SEZ occupancy correlates with nearby zone traffic |

### PEBLE Attribution Correlations

| Correlation | How It's Measured |
|-------------|-------------------|
| **Exposure → Conversion** | `pExposed vs pControl` differential |
| **AQS → Conversion Rate** | Higher AQS tiers have higher conversion rates |
| **DCI → Conversion** | Positive DCI correlates with conversion |
| **TTA → Engagement Quality** | Faster TTA correlates with stronger engagement |
| **Exposure Context → Conversion** | Journey phase affects conversion likelihood |
| **Dwell Lift → Revenue Impact** | Engagement dwell lift indicates revenue opportunity |

### Cross-Domain Correlations

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CORRELATION FLOW                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  DOOH Exposure (AQS)                                               │
│        │                                                           │
│        ▼                                                           │
│  Direction Change (DCI) ────► Zone Visit (dwell/engagement)        │
│        │                              │                             │
│        ▼                              ▼                             │
│  Time-to-Action (TTA) ◄───── Engagement Duration                   │
│        │                              │                             │
│        ▼                              ▼                             │
│  Shelf Engagement ──────────► Conversion/Purchase                  │
│        │                                                           │
│        ▼                                                           │
│  Category/Brand Impact ─────► Revenue Attribution                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Statistical Relationships

| Analysis | Formula | Description |
|----------|---------|-------------|
| **Lift Calculation** | `(pExposed - pControl) / pControl` | Relative incremental lift |
| **Confidence Weighting** | `confidence × kpi_value` | Quality-weighted metrics |
| **Propensity Matching** | `distance = w_time × Δt + w_heading × Δh + w_speed × Δs` | Control matching quality |
| **Attribution Window** | `exposure.endTs + action_window_minutes` | Conversion attribution timeframe |

### Zone-to-Zone Flow Analysis

The `getFlowMetrics()` function correlates cross-zone behavior:

1. **Draw Analysis**: Which zone captures first engagement?
2. **Exit Analysis**: Which zone is last before leaving?
3. **Bounce Analysis**: Single-zone vs multi-zone journeys
4. **Path Analysis**: Common zone sequences in trajectories

---

## Data Sources & Tables

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `track_positions` | Raw trajectory data (1Hz) | `track_key, timestamp, position_x/z, velocity_x/z, roi_id` |
| `zone_visits` | Aggregated zone visits | `roi_id, track_key, start_time, duration_ms, is_dwell, is_engagement` |
| `zone_occupancy` | Occupancy snapshots | `roi_id, timestamp, occupancy_count` |
| `zone_kpi_daily` | Daily aggregates | `roi_id, date, visits, dwells, engagements...` |
| `zone_kpi_hourly` | Hourly aggregates | `roi_id, date, hour, visits...` |

### Queue Tables

| Table | Purpose |
|-------|---------|
| `queue_sessions` | Individual queue experiences |
| `zone_settings` | Queue thresholds and linked zones |

### DOOH Tables

| Table | Purpose |
|-------|---------|
| `dooh_screens` | Screen configuration and SEZ |
| `dooh_exposure_events` | Individual exposure events with AQS |
| `dooh_screen_kpi_buckets` | Aggregated screen KPIs |

### PEBLE Tables

| Table | Purpose |
|-------|---------|
| `dooh_campaigns` | Campaign configuration |
| `dooh_attribution_events` | Attribution events with outcomes |
| `dooh_control_matches` | Matched control data |
| `dooh_campaign_kpis` | Aggregated attribution KPIs |

### Shelf Tables

| Table | Purpose |
|-------|---------|
| `planograms` | Planogram versions |
| `shelf_planograms` | Shelf-level slot configuration |
| `sku_items` | Product catalog |

---

## API Endpoints

### Zone KPIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/kpi/roi/:roiId/kpis` | GET | Get all KPIs for a zone |
| `/api/kpi/venues/:venueId/kpis` | GET | Get KPIs for all zones in venue |
| `/api/kpi/roi/:roiId/live-stats` | GET | Real-time zone statistics |
| `/api/kpi/roi/:roiId/queue-kpis` | GET | Queue KPIs for a zone |
| `/api/kpi/venues/:venueId/queue-kpis` | GET | All queue KPIs for venue |

### DOOH KPIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dooh/screens` | GET/POST/PUT/DELETE | Screen management |
| `/api/dooh/run` | POST | Compute exposure events |
| `/api/dooh/kpis` | GET | Get screen KPI buckets |
| `/api/dooh/kpis/context` | GET | KPIs grouped by context |
| `/api/dooh/events` | GET | Exposure events (debug) |

### PEBLE Attribution

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dooh-attribution/campaigns` | GET/POST/PUT/DELETE | Campaign management |
| `/api/dooh-attribution/run` | POST | Run attribution analysis |
| `/api/dooh-attribution/kpis` | GET | Get attribution KPI buckets |
| `/api/dooh-attribution/kpis/latest` | GET | Most recent analysis results |
| `/api/dooh-attribution/kpis/summary` | GET | Summary KPIs only |

---

## Appendix: Threshold Defaults

### Zone Thresholds

| Threshold | Default | Purpose |
|-----------|---------|---------|
| `DWELL_THRESHOLD_MS` | 10,000 ms | Minimum time for dwell |
| `ENGAGEMENT_THRESHOLD_MS` | 30,000 ms | Minimum time for engagement |
| `VISIT_END_GRACE_MS` | 1,000 ms | Grace period before ending visit |
| `MIN_VISIT_DURATION_MS` | 1,000 ms | Minimum visit duration |
| `POSITION_SAMPLE_MS` | 1,000 ms | Position sampling rate |

### Queue Thresholds

| Threshold | Default | Purpose |
|-----------|---------|---------|
| `queue_warning_threshold_sec` | 60 | Warning level wait time |
| `queue_critical_threshold_sec` | 120 | Critical level wait time |

### DOOH Thresholds

| Threshold | Default | Purpose |
|-----------|---------|---------|
| `AQS_qualified_min` | 40 | Qualified tier minimum |
| `AQS_premium_min` | 70 | Premium tier minimum |
| `T_min_seconds` | 0.7 | Minimum exposure duration |

### PEBLE Thresholds

| Threshold | Default | Purpose |
|-----------|---------|---------|
| `aqs_min_for_exposed` | 50 | Minimum AQS for attribution |
| `confidence_floor` | 0.3 | Minimum confidence |
| `min_controls_required` | 3 | Minimum controls for validity |

---

*Document generated from Hyperspace codebase analysis - February 2026*
