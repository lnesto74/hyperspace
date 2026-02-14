# Hyperspace - Complete Application Documentation

**The LiDAR-Powered Spatial Analytics Platform**

---

## Table of Contents

1. [Introduction](#introduction)
2. [Architecture Overview](#architecture-overview)
3. [Application Modules](#application-modules)
   - [3D Venue Builder](#3d-venue-builder)
   - [DWG Importer](#dwg-importer)
   - [LiDAR Coverage Planner](#lidar-coverage-planner)
   - [Edge Commissioning Portal](#edge-commissioning-portal)
   - [Regions of Interest (ROI)](#regions-of-interest-roi)
   - [Real-time Tracking](#real-time-tracking)
   - [Heatmap Visualization](#heatmap-visualization)
   - [Planogram Builder](#planogram-builder)
   - [Checkout Manager](#checkout-manager)
   - [Smart KPI Mode](#smart-kpi-mode)
   - [DOOH Analytics](#dooh-analytics)
   - [PEBLE™ Attribution](#peble-attribution)
   - [Business Reporting](#business-reporting)
4. [KPI Reference](#kpi-reference)
   - [Standard Zone KPIs](#standard-zone-kpis)
   - [Queue KPIs](#queue-kpis)
   - [DOOH KPIs](#dooh-kpis)
   - [PEBLE™ Attribution KPIs](#peble-attribution-kpis)
   - [Shelf Analytics KPIs](#shelf-analytics-kpis)
5. [Data Flow & Storage](#data-flow--storage)
6. [API Reference](#api-reference)
7. [WebSocket Events](#websocket-events)
8. [Configuration](#configuration)
9. [Deployment](#deployment)

---

## Introduction

**Hyperspace** is an enterprise-grade LiDAR-based spatial analytics platform designed for retail environments, smart venues, and any physical space requiring anonymous human movement tracking and behavioral analytics.

### Core Capabilities

| Capability | Description |
|------------|-------------|
| **3D Venue Modeling** | Create digital twins of physical spaces with accurate dimensions |
| **LiDAR Integration** | Connect to LiDAR sensors for real-time trajectory tracking |
| **Anonymous Tracking** | Track movement patterns without personally identifiable information |
| **Zone Analytics** | Measure foot traffic, dwell time, and engagement per zone |
| **Queue Management** | Real-time queue monitoring with wait time prediction |
| **DOOH Measurement** | Digital signage attention and exposure analytics |
| **Attribution Engine** | PEBLE™ system for measuring ad effectiveness on behavior |
| **Shelf Analytics** | Planogram-integrated product engagement metrics |

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, Vite, Three.js, TailwindCSS |
| **Backend** | Node.js, Express, Socket.IO |
| **Database** | SQLite (embedded) |
| **Real-time** | WebSockets, MQTT |
| **Networking** | Tailscale VPN for secure device communication |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HYPERSPACE PLATFORM                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         FRONTEND (React + Three.js)                  │   │
│  │                                                                     │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│  │  │ 3D Venue    │ │ DWG         │ │ LiDAR       │ │ Edge        │   │   │
│  │  │ Builder     │ │ Importer    │ │ Planner     │ │ Commission  │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│  │  │ ROI         │ │ Heatmap     │ │ Planogram   │ │ Queue       │   │   │
│  │  │ Manager     │ │ Viewer      │ │ Builder     │ │ Manager     │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│  │  │ DOOH        │ │ PEBLE™      │ │ Business    │ │ Smart KPI   │   │   │
│  │  │ Analytics   │ │ Attribution │ │ Reporting   │ │ Mode        │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                          REST API + WebSocket                               │
│                                    │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         BACKEND (Node.js + Express)                  │   │
│  │                                                                     │   │
│  │  ┌────────────────────────────────────────────────────────────┐    │   │
│  │  │ SERVICES                                                    │    │   │
│  │  │ • TailscaleService      • TrajectoryStorageService         │    │   │
│  │  │ • LidarConnectionManager • KPICalculator                   │    │   │
│  │  │ • TrackAggregator       • DoohKpiEngine                    │    │   │
│  │  │ • MockLidarGenerator    • DoohAttributionEngine (PEBLE™)   │    │   │
│  │  │ • MqttTrajectoryService • SmartKpiService                  │    │   │
│  │  │ • ShelfKPIEnricher      • PlacementService                 │    │   │
│  │  └────────────────────────────────────────────────────────────┘    │   │
│  │                                                                     │   │
│  │  ┌────────────────────────────────────────────────────────────┐    │   │
│  │  │ DATABASE (SQLite)                                           │    │   │
│  │  │ • venues, objects        • track_positions, zone_visits    │    │   │
│  │  │ • regions_of_interest    • queue_sessions, zone_occupancy  │    │   │
│  │  │ • dooh_screens           • dooh_exposure_events            │    │   │
│  │  │ • dooh_campaigns         • dooh_attribution_events         │    │   │
│  │  │ • planograms             • sku_items                       │    │   │
│  │  │ • lidar_placements       • edge_lidar_pairings             │    │   │
│  │  └────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                    Tailscale VPN / MQTT / Direct TCP                        │
│                                    │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         EDGE LAYER                                   │   │
│  │                                                                     │   │
│  │  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐    │   │
│  │  │ Edge Server 1  │    │ Edge Server 2  │    │ Edge Server N  │    │   │
│  │  │ (Ulisse Box)   │    │ (Ulisse Box)   │    │ (Ulisse Box)   │    │   │
│  │  │                │    │                │    │                │    │   │
│  │  │ ┌───┐ ┌───┐   │    │ ┌───┐ ┌───┐   │    │ ┌───┐ ┌───┐   │    │   │
│  │  │ │LiD│ │LiD│   │    │ │LiD│ │LiD│   │    │ │LiD│ │LiD│   │    │   │
│  │  │ │AR │ │AR │   │    │ │AR │ │AR │   │    │ │AR │ │AR │   │    │   │
│  │  │ └───┘ └───┘   │    │ └───┘ └───┘   │    │ └───┘ └───┘   │    │   │
│  │  └────────────────┘    └────────────────┘    └────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **LiDAR Sensors** detect objects and generate point clouds
2. **Edge Servers** process point clouds into trajectory data (person tracks)
3. **Main Server** receives trajectories via MQTT or direct TCP
4. **TrackAggregator** combines tracks from multiple sources
5. **TrajectoryStorageService** records positions at 1Hz and detects zone interactions
6. **KPICalculator** computes analytics metrics per zone
7. **Frontend** displays real-time visualizations and KPI dashboards

---

## Application Modules

### 3D Venue Builder

The core module for creating and managing venue digital twins.

#### Features

| Feature | Description |
|---------|-------------|
| **Venue Creation** | Define venue name, dimensions (width × depth × height) |
| **Tile Grid** | Visual grid overlay for positioning reference |
| **Object Library** | Place shelves, walls, checkouts, displays, and custom objects |
| **3D Manipulation** | Drag, rotate, scale objects in 3D space |
| **Import/Export** | JSON-based venue configuration backup and restore |

#### Object Types

| Object | Icon | Properties |
|--------|------|------------|
| **Shelf** | 📦 | Width, height, depth, levels, slots |
| **Wall** | 🧱 | Length, height, thickness |
| **Checkout** | 🛒 | Counter dimensions, register position |
| **Display** | 📺 | Screen size, orientation |
| **Entrance** | 🚪 | Width, direction |
| **Generic** | ⬛ | Custom dimensions |

#### Context Providers

- `VenueContext` - Venue state, objects, dimensions
- `RoiContext` - Regions of interest management
- `TrackingContext` - Real-time track visualization

---

### DWG Importer

Import CAD floor plans (.dwg files) and extract geometry for venue creation.

#### Workflow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Upload    │───►│   Parse     │───►│   Map       │───►│   Import    │
│   DWG File  │    │   Layers    │    │   Groups    │    │   to Venue  │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

#### Features

| Feature | Description |
|---------|-------------|
| **Layer Detection** | Automatically detects CAD layers |
| **Group Mapping** | Map layers to object types (walls, shelves, etc.) |
| **Scale Calibration** | Set real-world dimensions using reference measurements |
| **Preview** | 3D preview before importing |
| **Selective Import** | Choose which layers/objects to import |

#### Components

- `DwgImporterPage` - Main importer interface
- `UploadCard` - File upload handler
- `MappingPanel` - Layer-to-object mapping
- `PreviewPanel` - 3D preview with layer controls
- `Layout3DPreview` - Three.js preview renderer

---

### LiDAR Coverage Planner

Plan optimal LiDAR sensor placement for complete venue coverage.

#### Features

| Feature | Description |
|---------|-------------|
| **Sensor Library** | Pre-configured LiDAR models with FOV specs |
| **Drag & Drop** | Place sensors in 3D space |
| **FOV Visualization** | See sensor coverage cones |
| **Coverage Analysis** | Heatmap showing coverage quality |
| **Overlap Detection** | Identify redundant coverage areas |
| **Mount Height** | Configure ceiling/wall mount positions |

#### Supported LiDAR Models

| Model | HFOV | VFOV | Range | Mode |
|-------|------|------|-------|------|
| **Livox Mid-360** | 360° | 59° | 40m | Dome |
| **Livox Avia** | 70° | 77° | 450m | Standard |
| **Livox HAP** | 120° | 25° | 150m | Wide |
| **Ouster OS1-64** | 360° | 45° | 120m | Dome |
| **Velodyne VLP-16** | 360° | 30° | 100m | Dome |

#### Solver Algorithm

The `PlacementService` includes an optimization algorithm that:
1. Analyzes venue geometry and obstacles
2. Calculates coverage requirements per zone
3. Suggests optimal sensor positions
4. Minimizes total sensors while maximizing coverage

---

### Edge Commissioning Portal

Configure and deploy settings to edge servers (Ulisse boxes) in the field.

#### Architecture

```
Main Server ←──Tailscale VPN──► Edge Server ←──LAN──► LiDAR Sensors
```

#### Workflow

1. **Discover Edges** - Scan Tailscale network for edge devices
2. **Scan LiDARs** - Edge scans its local LAN for sensors
3. **Pair LiDARs** - Map physical LiDARs to planned placements
4. **Deploy Config** - Push extrinsics package to edge
5. **Validate** - Verify deployment and check status

#### Extrinsics Package

Configuration deployed to edge servers:

```json
{
  "deploymentId": "uuid",
  "edgeId": "edge-001",
  "venueId": "venue-123",
  "mqtt": {
    "broker": "mqtt://main-server:1883",
    "topic": "hyperspace/trajectories/edge-001"
  },
  "lidars": [
    {
      "lidarId": "lidar-001",
      "ip": "192.168.10.21",
      "extrinsics": {
        "x_m": 2.5, "y_m": 4.0, "z_m": 8.0,
        "yaw_deg": 90, "pitch_deg": 0, "roll_deg": 0
      }
    }
  ]
}
```

#### Database Tables

- `edge_lidar_pairings` - LiDAR-to-placement mappings
- `edge_deploy_history` - Deployment audit trail

---

### Regions of Interest (ROI)

Define measurement zones within the venue for KPI tracking.

#### Zone Types

| Type | Purpose | Example |
|------|---------|---------|
| **Standard** | General foot traffic | Aisle, department |
| **Queue** | Waiting line monitoring | Checkout queue |
| **Service** | Transaction area | Checkout register |
| **Shelf Engagement** | Product interaction | Shelf section |
| **DOOH Screen** | Digital display zone | Advertising screen |
| **Entrance/Exit** | Traffic counting | Store entrance |

#### Zone Properties

| Property | Description |
|----------|-------------|
| **Name** | Display name for the zone |
| **Color** | Visual identification color |
| **Vertices** | Polygon boundary points |
| **Template** | Zone type (standard, queue, etc.) |
| **Linked Zone** | For queue→service zone connections |
| **Dwell Threshold** | Minimum time for dwell event (default: 60s) |
| **Engagement Threshold** | Minimum time for engagement (default: 120s) |

#### Zone Settings

Per-zone configurable thresholds:

| Setting | Default | Description |
|---------|---------|-------------|
| `dwell_threshold_sec` | 60 | Dwell event minimum |
| `engagement_threshold_sec` | 120 | Engagement minimum |
| `queue_warning_threshold_sec` | 60 | Queue yellow alert |
| `queue_critical_threshold_sec` | 120 | Queue red alert |
| `linked_zone_id` | null | Service zone for queues |

---

### Real-time Tracking

Visualize live trajectory data from LiDAR sensors.

#### Track Data Format (NDJSON)

```json
{
  "id": "track_001",
  "timestamp": 1706000000000,
  "position": {"x": 1.5, "y": 0.0, "z": 2.3},
  "velocity": {"x": 0.5, "y": 0.0, "z": -0.2},
  "objectType": "person"
}
```

#### Visualization Options

| Option | Description |
|--------|-------------|
| **Track Markers** | Colored dots showing current positions |
| **Trails** | Path history showing recent movement |
| **Velocity Vectors** | Arrows showing movement direction |
| **Zone Highlighting** | Active zone occupancy indication |
| **Heatmap Overlay** | Density visualization |

#### Data Sources

| Source | Connection | Use Case |
|--------|------------|----------|
| **Direct TCP** | LiDAR → Main Server | Development/small venues |
| **MQTT** | Edge → Broker → Main | Production/distributed |
| **Mock Generator** | Internal simulation | Testing without hardware |

---

### Heatmap Visualization

Density-based visualization of foot traffic patterns.

#### Heatmap Types

| Type | Data Source | Purpose |
|------|-------------|---------|
| **Real-time** | Live tracks | Current activity |
| **Historical** | track_positions table | Time-range analysis |
| **Dwell** | zone_visits | Engagement hotspots |
| **Velocity** | Position deltas | Speed patterns |

#### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| **Resolution** | 0.5m | Grid cell size |
| **Blur** | 0.8 | Smoothing radius |
| **Opacity** | 0.7 | Overlay transparency |
| **Color Scale** | Blue→Red | Low→High density |

---

### Planogram Builder

Product placement and shelf configuration tool.

#### Features

| Feature | Description |
|---------|-------------|
| **Shelf Designer** | Configure levels, slots, dimensions |
| **SKU Library** | Product catalog with images and metadata |
| **Drag & Drop** | Place products on shelf positions |
| **Position Scoring** | Automatic visibility scoring |
| **Category Management** | Organize products by category/brand |
| **Version History** | Track planogram changes over time |

#### Position Scoring Algorithm

```
Position Score = 50 × levelMultiplier × (1 + slotBonus)
```

| Level Type | Multiplier | Description |
|------------|------------|-------------|
| Eye-level | 1.5× | Prime visibility |
| Waist | 1.0× | Standard |
| Stretch | 0.7× | Top shelf |
| Stooping | 0.6× | Bottom shelf |

| Slot Type | Bonus | Description |
|-----------|-------|-------------|
| Center | +20% | Center positions |
| Endcap | +40% | End positions |
| Edge | 0% | Edge positions |

#### Components

- `PlanogramBuilder` - Main builder interface
- `PlanogramViewport` - 3D shelf visualization
- `ShelfInspectorPanel` - Slot configuration
- `SkuLibraryPanel` - Product catalog management

---

### Checkout Manager

Queue monitoring and service zone configuration.

#### Features

| Feature | Description |
|---------|-------------|
| **Queue Zones** | Define waiting line areas |
| **Service Zones** | Link to checkout registers |
| **Wait Time Tracking** | Real-time and historical |
| **Threshold Alerts** | Visual queue status indicators |
| **Abandonment Detection** | Track customers who leave queue |

#### Queue Status Colors

| Status | Color | Threshold |
|--------|-------|-----------|
| **OK** | 🟢 Green | < 60 seconds |
| **Warning** | 🟡 Yellow | 60-120 seconds |
| **Critical** | 🔴 Red | > 120 seconds |

#### Queue Session States

```
WAITING → SERVED → COMPLETED
    ↓
ABANDONED (left queue without service)
```

---

### Smart KPI Mode

AI-assisted automatic zone generation from floor plans.

#### Features

| Feature | Description |
|---------|-------------|
| **Auto-Detection** | Analyze DWG layout for zone suggestions |
| **Template Library** | Pre-configured zone types |
| **Batch Creation** | Generate multiple zones at once |
| **Smart Naming** | Automatic descriptive zone names |
| **Threshold Presets** | Zone type-specific defaults |

#### Zone Templates

| Template | Dwell Threshold | Engagement | Use Case |
|----------|-----------------|------------|----------|
| **Aisle** | 30s | 60s | Shopping aisles |
| **Department** | 60s | 120s | Store sections |
| **Promotional** | 20s | 45s | Display areas |
| **Queue** | N/A | N/A | Waiting lines |
| **Entrance** | 10s | 30s | Entry points |

---

### DOOH Analytics

Digital Out-of-Home screen exposure measurement.

#### Screen Configuration

| Property | Description |
|----------|-------------|
| **SEZ** | Screen Exposure Zone polygon |
| **AZ** | Attention Zone (inner high-quality area) |
| **Yaw** | Screen facing direction |
| **Distance Range** | Min/max viewing distances |
| **Content** | Playlist/video assignments |

#### Exposure Detection Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `T_min_seconds` | 0.7 | Minimum exposure duration |
| `max_gap_seconds` | 1.5 | Gap tolerance before new exposure |
| `speed_attention_max_mps` | 1.2 | Max speed for attention credit |
| `d_min_m` | 0.8 | Minimum viewing distance |
| `d_max_m` | 4.0 | Maximum viewing distance |

#### AQS (Attention Quality Score)

**Formula:** `AQS = 100 × (w_dwell × Sd + w_proximity × Sp + w_orientation × So + w_slowdown × Ss + w_stability × St)`

| Component | Weight | Description |
|-----------|--------|-------------|
| **Dwell Score** | 35% | Time in exposure zone |
| **Proximity Score** | 20% | Distance to screen |
| **Orientation Score** | 20% | Facing angle quality |
| **Slowdown Score** | 15% | Speed reduction intent |
| **Stability Score** | 10% | Stationary behavior |

#### AQS Tiers

| Tier | Range | Description |
|------|-------|-------------|
| **Premium** | ≥70 | High-quality focused attention |
| **Qualified** | 40-69 | Standard quality exposure |
| **Low** | <40 | Pass-by or minimal attention |

---

### PEBLE™ Attribution

**Post-Exposure Behavioral Lift Engine** - Measuring ad effectiveness on shopper behavior.

#### Methodology

PEBLE uses **matched control attribution** to isolate the incremental effect of DOOH exposure:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     MATCHED CONTROL DESIGN                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  EXPOSED GROUP                    CONTROL GROUP                     │
│  ┌─────────────────┐              ┌─────────────────┐              │
│  │ Viewers with    │              │ Similar visitors │              │
│  │ AQS ≥ 50        │              │ who passed NEAR  │              │
│  │ in SEZ          │              │ but NOT in SEZ   │              │
│  └────────┬────────┘              └────────┬────────┘              │
│           │                                │                        │
│           ▼                                ▼                        │
│  Did they visit target              Did they visit target           │
│  within action window?              within action window?           │
│           │                                │                        │
│           ▼                                ▼                        │
│       pExposed                         pControl                     │
│                                                                     │
│  EAL = (pExposed - pControl) / pControl × 100%                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Matching Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `action_window_minutes` | 10 | Conversion time window |
| `match_time_bucket_min` | 15 | Time bucket for matching |
| `control_matches_M` | 5 | Target controls per exposed |
| `min_controls_required` | 3 | Minimum for valid measurement |
| `near_corridor_buffer_m` | 1.5 | Buffer around SEZ |
| `aqs_min_for_exposed` | 50 | Minimum AQS for exposed group |

#### Campaign Targets

| Type | Description | Example |
|------|-------------|---------|
| `shelf` | Specific fixture | "Shelf-A1" |
| `category` | Product category | "Snacks" |
| `brand` | Brand name | "Coca-Cola" |
| `sku` | Specific product | "Coke 500ml" |

#### Primary KPIs

| KPI | Formula | Description |
|-----|---------|-------------|
| **EAL™** | `(pExposed - pControl) / pControl` | Exposure-to-Action Lift |
| **TTA™** | Time from exposure to action | Time-to-Action |
| **DCI™** | Post - Pre trajectory alignment | Direction Change Index |
| **CES™** | Composite effectiveness score | Campaign Effectiveness Score |
| **AAR™** | Conversions / Qualified exposures | Attention-to-Action Rate |

---

### Business Reporting

Executive dashboards and persona-based reporting views.

#### Personas

| Persona | Focus | Key Metrics |
|---------|-------|-------------|
| **Store Manager** | Operations | Traffic, queue times, staffing |
| **Category Manager** | Products | Shelf performance, engagement |
| **Marketing Manager** | Campaigns | DOOH exposure, attribution |
| **Operations Director** | Multi-venue | Comparative analytics |
| **Finance Director** | Revenue | Conversion, revenue attribution |

#### Dashboard Components

- **KPI Summary Cards** - High-level metrics overview
- **Trend Charts** - Time-series visualizations
- **Comparison Tables** - Zone/period comparisons
- **Alert Feed** - Threshold violations
- **Export Tools** - PDF/CSV report generation

---

## KPI Reference

### Standard Zone KPIs

#### Basic Metrics

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **visits** | Count | `COUNT(DISTINCT track_key)` | Unique visitors |
| **totalEntries** | Count | `COUNT(*)` | Total zone entries |
| **timeSpent** | Minutes | `SUM(duration_ms) / 60000` | Total time in zone |
| **avgTimeSpent** | Minutes | `timeSpent / visits` | Average per visitor |

#### Dwell Metrics

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **dwellsCumulative** | Count | `SUM(is_dwell = 1)` | Total dwell events |
| **dwellsUnique** | Count | Distinct track_key with dwell | Unique dwellers |
| **dwellAvgTime** | Minutes | Average dwell duration | Dwell quality |
| **dwellRate** | Percentage | `dwellsUnique / visits × 100` | Stickiness rate |
| **dwellShare** | Percentage | Zone's share of venue dwells | Relative importance |

#### Engagement Metrics

| KPI | Type | Formula | Description |
|-----|------|---------|-------------|
| **engagementsCumulative** | Count | Total engagement events | Deep interest count |
| **engagementsUnique** | Count | Unique engaged visitors | Quality visitors |
| **engagementAvgTime** | Minutes | Average engagement duration | Engagement depth |
| **engagementRate** | Percentage | `engagementsUnique / visits × 100` | Engagement efficiency |

#### Flow Metrics

| KPI | Type | Description |
|-----|------|-------------|
| **draws** | Count | First dwell location for visitors |
| **drawRate** | Percentage | Zone's ability to attract first engagement |
| **exits** | Count | Last dwell before leaving |
| **exitRate** | Percentage | Visitors who exited from here |
| **bounces** | Count | Single-zone visitors |
| **bounceRate** | Percentage | Percentage with single-zone journey |

#### Velocity Metrics

| KPI | Type | Description |
|-----|------|-------------|
| **avgVelocity** | m/s | Average movement speed |
| **avgVelocityInMotion** | m/s | Speed excluding stationary |
| **percentAtRest** | Percentage | Time stationary |
| **percentInMotion** | Percentage | Time moving |

#### Occupancy Metrics

| KPI | Type | Description |
|-----|------|-------------|
| **peakOccupancy** | Count | Maximum simultaneous people |
| **avgOccupancy** | Float | Average occupancy |
| **currentOccupancy** | Count | Live count |

---

### Queue KPIs

| KPI | Type | Description |
|-----|------|-------------|
| **totalSessions** | Count | People who joined queue |
| **completedSessions** | Count | Successfully served |
| **abandonedSessions** | Count | Left without service |
| **abandonRate** | Percentage | Abandonment rate |
| **avgWaitingTimeMs** | ms | Average wait time |
| **avgWaitingTimeSec** | sec | Formatted seconds |
| **maxWaitingTimeMs** | ms | Longest wait |
| **p90WaitingTimeMs** | ms | 90th percentile wait |
| **avgServiceTimeMs** | ms | Average service duration |
| **currentQueueLength** | Count | People currently waiting |

---

### DOOH KPIs

| KPI | Type | Description |
|-----|------|-------------|
| **exposures** | Count | Total exposure events |
| **uniqueVisitors** | Count | Unique viewers |
| **avgAqs** | Score | Average attention quality |
| **premiumRate** | Percentage | Premium tier rate |
| **qualifiedRate** | Percentage | Qualified tier rate |
| **avgDwellS** | Seconds | Average attention dwell |
| **totalAttention** | Seconds | Cumulative attention time |

---

### PEBLE™ Attribution KPIs

| KPI | Formula | Description |
|-----|---------|-------------|
| **pExposed** | `exposed_converted / exposed_count` | Exposed conversion rate |
| **pControl** | `control_converted / control_count` | Control conversion rate |
| **liftAbs** | `pExposed - pControl` | Absolute lift |
| **liftRel (EAL)** | `liftAbs / pControl` | Relative lift |
| **ttaAccel** | `ttaControl / ttaExposed` | TTA acceleration |
| **engagementLiftS** | `dwellExposed - dwellControl` | Engagement dwell lift |
| **ces** | Composite score | Campaign Effectiveness Score |
| **aar** | `conversions / qualified_exposures` | Attention-to-Action Rate |

---

### Shelf Analytics KPIs

| KPI | Formula | Description |
|-----|---------|-------------|
| **browsingRate** | `dwells / visits × 100` | Browsing percentage |
| **avgBrowseTime** | `dwellAvgTime × 60` | Browse duration (seconds) |
| **passbyCount** | `visits - dwells` | Passed without browsing |
| **shareOfShelf** | `slotCount / totalSlots × 100` | Category shelf share |
| **avgPositionScore** | Average position quality | Placement quality |
| **efficiencyIndex** | `positionScore / shareOfShelf` | Performance vs. space |

---

## Data Flow & Storage

### Database Tables

#### Core Tables

| Table | Purpose |
|-------|---------|
| `venues` | Venue definitions |
| `objects` | 3D objects in venues |
| `regions_of_interest` | Zone polygons |
| `zone_settings` | Per-zone configuration |

#### Tracking Tables

| Table | Purpose |
|-------|---------|
| `track_positions` | Raw trajectory data (1Hz) |
| `zone_visits` | Aggregated zone visits |
| `zone_occupancy` | Occupancy snapshots |
| `zone_kpi_daily` | Daily aggregates |
| `zone_kpi_hourly` | Hourly aggregates |

#### Queue Tables

| Table | Purpose |
|-------|---------|
| `queue_sessions` | Queue experiences |

#### DOOH Tables

| Table | Purpose |
|-------|---------|
| `dooh_screens` | Screen configuration |
| `dooh_exposure_events` | Exposure events |
| `dooh_screen_kpi_buckets` | Aggregated screen KPIs |

#### PEBLE Tables

| Table | Purpose |
|-------|---------|
| `dooh_campaigns` | Campaign configuration |
| `dooh_attribution_events` | Attribution events |
| `dooh_control_matches` | Control match data |
| `dooh_campaign_kpis` | Attribution KPIs |

#### Planogram Tables

| Table | Purpose |
|-------|---------|
| `planograms` | Planogram versions |
| `shelf_planograms` | Shelf slot configuration |
| `sku_items` | Product catalog |

#### Edge Tables

| Table | Purpose |
|-------|---------|
| `lidar_placements` | Planned sensor positions |
| `edge_lidar_pairings` | LiDAR-to-placement mappings |
| `edge_deploy_history` | Deployment audit trail |

---

## API Reference

### Venues

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/venues` | List all venues |
| POST | `/api/venues` | Create venue |
| GET | `/api/venues/:id` | Get venue details |
| PUT | `/api/venues/:id` | Update venue |
| DELETE | `/api/venues/:id` | Delete venue |
| GET | `/api/venues/:id/export` | Export venue config |
| POST | `/api/venues/import` | Import venue config |

### Regions of Interest

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/roi/:venueId` | List zones for venue |
| POST | `/api/roi/:venueId` | Create zone |
| PUT | `/api/roi/:venueId/:roiId` | Update zone |
| DELETE | `/api/roi/:venueId/:roiId` | Delete zone |

### Zone KPIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/kpi/roi/:roiId/kpis` | Get zone KPIs |
| GET | `/api/kpi/venues/:venueId/kpis` | Get all venue zone KPIs |
| GET | `/api/kpi/roi/:roiId/live-stats` | Real-time statistics |
| GET | `/api/kpi/roi/:roiId/queue-kpis` | Queue KPIs for zone |

### DOOH

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/dooh/screens` | Screen management |
| POST | `/api/dooh/run` | Compute exposure events |
| GET | `/api/dooh/kpis` | Get screen KPI buckets |
| GET | `/api/dooh/events` | Exposure events |

### PEBLE Attribution

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/dooh-attribution/campaigns` | Campaign management |
| POST | `/api/dooh-attribution/run` | Run attribution analysis |
| GET | `/api/dooh-attribution/kpis` | Attribution KPI buckets |
| GET | `/api/dooh-attribution/kpis/summary` | Summary KPIs |

### Edge Commissioning

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/edge-commissioning/scan-edges` | Discover edges |
| POST | `/api/edge-commissioning/edge/:id/scan-lidars` | Scan LiDARs |
| GET | `/api/edge-commissioning/edge/:id/inventory` | Get LiDAR inventory |
| POST | `/api/edge-commissioning/edge/:id/deploy` | Deploy config |
| GET/POST | `/api/edge-commissioning/pairings` | Manage pairings |

### LiDAR Planner

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/lidar-planner/venues/:id/placements` | Get placements |
| POST | `/api/lidar-planner/venues/:id/placements` | Create placement |
| PUT | `/api/lidar-planner/placements/:id` | Update placement |
| DELETE | `/api/lidar-planner/placements/:id` | Delete placement |
| POST | `/api/lidar-planner/venues/:id/solve` | Run coverage solver |

### Planogram

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/planogram/venues/:id` | Get venue planograms |
| POST | `/api/planogram/shelves/:id` | Create planogram |
| PUT | `/api/planogram/:id` | Update planogram |
| GET/POST | `/api/planogram/skus` | SKU management |

---

## WebSocket Events

### Namespace: `/tracking`

#### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe` | `{ venueId }` | Start receiving tracks |
| `unsubscribe` | `{ venueId }` | Stop receiving tracks |

#### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `tracks` | `{ venueId, tracks[] }` | Track updates (20 fps) |
| `lidar_status` | `{ deviceId, status, message }` | LiDAR connection status |
| `track_removed` | `{ trackKey }` | Track TTL expired |

---

## Configuration

### Environment Variables

#### Backend (.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `MOCK_LIDAR` | false | Enable mock LiDAR data |
| `MQTT_ENABLED` | false | Enable MQTT trajectory service |
| `MQTT_BROKER_URL` | mqtt://localhost:1883 | MQTT broker address |
| `MOCK_EDGE` | false | Enable mock edge responses |
| `EDGE_PORT` | 8080 | Edge server port |
| `TAILSCALE_POLL_INTERVAL` | 30000 | Device scan interval (ms) |

#### Frontend (.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | http://localhost:3001 | Backend API URL |

### Threshold Defaults

| Threshold | Default | Purpose |
|-----------|---------|---------|
| `DWELL_THRESHOLD_MS` | 60,000 | Dwell event minimum |
| `ENGAGEMENT_THRESHOLD_MS` | 120,000 | Engagement minimum |
| `VISIT_END_GRACE_MS` | 1,000 | Visit end grace period |
| `POSITION_SAMPLE_MS` | 1,000 | Position sampling rate |

---

## Deployment

### Development

```bash
# Frontend (port 5173)
cd frontend
npm install
npm run dev

# Backend (port 3001)
cd backend
npm install
npm run dev
```

### Production

#### Using Start Scripts

```bash
# Start all services
./start-server.sh

# Stop all services
./stop-server.sh
```

#### Edge Server Deployment

```bash
cd edge-server
docker-compose up -d
```

### Prerequisites

- **Node.js** 20 LTS
- **npm** 9+
- **Tailscale** (for device discovery)
- **MQTT Broker** (for edge trajectory data)

---

## Glossary

| Term | Definition |
|------|------------|
| **AQS** | Attention Quality Score - 0-100 score measuring exposure quality |
| **DOOH** | Digital Out-of-Home - Digital advertising screens |
| **DWG** | AutoCAD Drawing format for floor plans |
| **EAL** | Exposure-to-Action Lift - Incremental conversion increase |
| **Edge Server** | On-premise compute device aggregating LiDAR data |
| **Extrinsics** | LiDAR position and orientation configuration |
| **FOV** | Field of View - Sensor coverage angle |
| **NDJSON** | Newline-Delimited JSON - Streaming data format |
| **PEBLE** | Post-Exposure Behavioral Lift Engine |
| **ROI** | Region of Interest - Measurement zone |
| **SEZ** | Screen Exposure Zone - DOOH viewing area |
| **SKU** | Stock Keeping Unit - Unique product identifier |
| **TTA** | Time-to-Action - Seconds from exposure to engagement |
| **Ulisse** | Edge server hardware platform |

---

*Document generated from Hyperspace codebase - February 2026*
