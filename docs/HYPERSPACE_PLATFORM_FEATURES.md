# Hyperspace Platform - Complete Feature Guide

**The LiDAR-Powered Spatial Analytics Platform for Retail & Smart Venues**

*A comprehensive business-oriented guide to all platform capabilities*

---

## Table of Contents

1. [Platform Overview](#platform-overview)
2. [Venue Setup & Configuration](#venue-setup--configuration)
   - [Venue Creation](#venue-creation)
   - [DWG Floor Plan Import](#dwg-floor-plan-import)
   - [3D Venue Builder](#3d-venue-builder)
3. [LiDAR Infrastructure](#lidar-infrastructure)
   - [LiDAR Coverage Planner](#lidar-coverage-planner)
   - [Edge Commissioning Portal](#edge-commissioning-portal)
   - [LiDAR Network Panel](#lidar-network-panel)
4. [Zones & Regions of Interest](#zones--regions-of-interest)
   - [Zone Types & Templates](#zone-types--templates)
   - [Smart KPI Mode](#smart-kpi-mode)
5. [Real-Time Tracking & Visualization](#real-time-tracking--visualization)
   - [Live Tracking View](#live-tracking-view)
   - [Heatmap Visualization](#heatmap-visualization)
6. [Analytics & KPIs](#analytics--kpis)
   - [Foot Traffic Analytics](#foot-traffic-analytics)
   - [Dwell & Engagement Metrics](#dwell--engagement-metrics)
   - [Queue Management](#queue-management)
   - [Flow Analysis](#flow-analysis)
7. [Retail-Specific Features](#retail-specific-features)
   - [Planogram Builder](#planogram-builder)
   - [Shelf Analytics](#shelf-analytics)
   - [Checkout Manager](#checkout-manager)
8. [Digital Advertising (DOOH)](#digital-advertising-dooh)
   - [Screen Configuration](#screen-configuration)
   - [Exposure & Attention Metrics](#exposure--attention-metrics)
   - [PEBLE™ Attribution Engine](#peble-attribution-engine)
9. [Business Intelligence](#business-intelligence)
   - [AI Narrator](#ai-narrator)
   - [Replay Insights](#replay-insights)
   - [Business Reporting](#business-reporting)
10. [Key Business Flows](#key-business-flows)
11. [Glossary](#glossary)

---

## Platform Overview

**Hyperspace** is an enterprise-grade spatial analytics platform that uses LiDAR sensors to track anonymous human movement through physical spaces. Unlike camera-based solutions, Hyperspace provides privacy-compliant tracking without capturing personal images.

### What Hyperspace Delivers

| Business Value | Description |
|----------------|-------------|
| **Anonymous People Tracking** | Track visitor movements without cameras or personal data capture |
| **Digital Twin Creation** | Build accurate 3D models of your physical space |
| **Real-Time Insights** | See live foot traffic, queue lengths, and occupancy |
| **Behavioral Analytics** | Understand dwell times, engagement patterns, and customer journeys |
| **Advertising Effectiveness** | Measure DOOH screen attention and impact on shopper behavior |
| **Operational Optimization** | Reduce queue wait times, optimize staffing, improve layouts |

### Who Uses Hyperspace

| Persona | Primary Use Cases |
|---------|-------------------|
| **Store Manager** | Queue monitoring, occupancy management, staffing decisions |
| **Category Manager** | Shelf performance, product placement optimization |
| **Marketing Manager** | Campaign effectiveness, advertising ROI measurement |
| **Operations Director** | Multi-venue analytics, performance benchmarking |
| **Finance Director** | Revenue attribution, conversion tracking |

---

## Venue Setup & Configuration

### Venue Creation

The first step in using Hyperspace is creating a **digital twin** of your physical space.

**Process:**
1. Navigate to **Venue Settings** 
2. Create a new venue with:
   - **Venue name** (e.g., "Downtown Flagship Store")
   - **Dimensions** (width × depth × height in meters)
3. The platform generates a 3D canvas representing your space

**Business Value:** A digital twin allows you to visualize analytics in context, making insights immediately actionable.

---

### DWG Floor Plan Import

Import existing CAD floor plans to accelerate venue setup and ensure accuracy.

**How It Works:**

```
Upload DWG/DXF → Auto-detect Fixtures → Map to 3D Assets → Generate Layout
```

**Step-by-Step Flow:**

1. **Upload** - Drag and drop your DWG or DXF floor plan file
2. **Automatic Grouping** - The system identifies fixtures (shelves, counters, displays) and groups similar items
3. **Asset Mapping** - Map each fixture group to a 3D model from the catalog:
   - Shelves, gondolas, refrigerators
   - Checkout counters
   - Display stands
   - Entrances/exits
4. **Configure Placement** - Adjust:
   - Anchor points (center, back, corners)
   - Position offsets
   - Rotation alignment
5. **Generate** - Create the full 3D venue layout

**Supported Formats:**
- DXF (native support)
- DWG (requires LibreDWG or ODA converter)

**Business Value:** Reduces venue setup time from days to hours by leveraging existing architectural drawings.

---

### 3D Venue Builder

Manually create or refine your venue layout with the interactive 3D builder.

**Capabilities:**

| Feature | Description |
|---------|-------------|
| **Object Library** | Place shelves, walls, checkouts, displays, entrances |
| **Drag & Drop** | Position objects anywhere in 3D space |
| **Rotate & Scale** | Adjust object orientation and size |
| **Tile Grid** | Visual positioning reference |
| **Import/Export** | Save and restore venue configurations |

**Object Types Available:**

| Object | Typical Use |
|--------|-------------|
| **Shelf** | Gondolas, aisles, product displays |
| **Wall** | Perimeter and internal barriers |
| **Checkout** | Cash registers, self-checkout stations |
| **Display** | Promotional stands, end caps |
| **Entrance** | Entry/exit points for traffic counting |
| **Generic** | Custom fixtures with custom dimensions |

**Business Value:** Complete control over venue representation ensures analytics match your actual physical layout.

---

## LiDAR Infrastructure

### LiDAR Coverage Planner

Plan optimal LiDAR sensor placement before physical installation.

**Planning Workflow:**

1. **Select Sensors** - Choose from supported LiDAR models:
   - **Livox Mid-360** - 360° coverage, ideal for ceiling mount
   - **Livox Avia** - Long range, directional
   - **Livox HAP** - Wide angle
   - **Ouster OS1-64** - High resolution dome
   - **Velodyne VLP-16** - Industry standard

2. **Place Sensors** - Drag sensors onto the venue:
   - Set mounting height (ceiling height)
   - Configure pitch/tilt angles
   - Adjust yaw orientation

3. **Visualize Coverage** - See:
   - Field-of-view cones for each sensor
   - Coverage heatmap overlay
   - Overlap areas (redundancy)
   - Dead zones (gaps)

4. **Optimize** - Use the coverage solver to:
   - Automatically suggest sensor positions
   - Minimize sensor count while maximizing coverage
   - Ensure no blind spots in key zones

**Coverage Metrics:**

| Metric | Description |
|--------|-------------|
| **Coverage %** | Percentage of floor area covered |
| **Overlap %** | Areas covered by 2+ sensors |
| **Dead Zones** | Areas with no coverage |

**Business Value:** Avoid costly re-installation by planning coverage upfront. Ensure every zone has adequate tracking.

---

### Edge Commissioning Portal

Deploy and configure edge servers (Ulisse boxes) connected to LiDAR sensors in the field.

**Architecture:**

```
Main Server ←── Tailscale VPN ──► Edge Server ←── LAN ──► LiDAR Sensors
                  (cloud)            (on-site)
```

**Commissioning Workflow:**

1. **Discover Edge Servers**
   - Click "Scan Tailnet for Edges"
   - All edge devices on your secure network appear
   - View status: online/offline, last seen, IP address

2. **Scan LiDARs**
   - Select an edge server
   - Click "Scan LAN" to discover connected LiDARs
   - See: IP address, model, serial number

3. **Pair LiDARs to Placements**
   - Drag discovered LiDARs from inventory
   - Drop onto planned placements from the Coverage Planner
   - System validates model compatibility

4. **Deploy Configuration**
   - Click "Deploy to Edge"
   - System sends **extrinsics package** containing:
     - Venue ID and coordinate system
     - MQTT broker settings for data transmission
     - LiDAR positions (x, y, z) and orientations (yaw, pitch, roll)
   - Edge applies configuration and confirms

5. **Validate Deployment**
   - Check edge status panel for:
     - Configuration hash (version tracking)
     - LiDAR connection status
     - Data streaming status
   - View deployment history for audit trail

**Status Indicators:**

| Status | Meaning |
|--------|---------|
| 🟢 **Connected** | LiDAR streaming data |
| 🟡 **Pending** | Configuration deployed, awaiting connection |
| 🔴 **Offline** | LiDAR not responding |

**Business Value:** Centrally manage all field hardware without physical access. Deploy configuration changes remotely.

---

### LiDAR Network Panel

Monitor real-time status of all connected LiDAR sensors.

**Features:**

| Feature | Description |
|---------|-------------|
| **Device List** | All LiDARs with status indicators |
| **Connection Status** | Real-time connectivity monitoring |
| **Data Flow** | Tracks/second from each sensor |
| **Diagnostics** | Error messages and troubleshooting |

**Business Value:** Immediate visibility into hardware health ensures data continuity.

---

## Zones & Regions of Interest

Regions of Interest (ROIs) are the measurement areas where analytics are computed.

### Zone Types & Templates

| Zone Type | Purpose | Example Locations |
|-----------|---------|-------------------|
| **Standard** | General foot traffic measurement | Aisles, departments, sections |
| **Queue** | Waiting line monitoring | Checkout queues, service desks |
| **Service** | Transaction area (linked to queue) | Checkout registers, counters |
| **Entrance/Exit** | Traffic counting | Store entrances, department entries |
| **Promotional** | Special display engagement | End caps, promotional islands |
| **Shelf Engagement** | Product browsing measurement | Shelf fronts, gondola sections |
| **DOOH Screen** | Digital display viewing zone | Advertising screens |

**Creating Zones:**

1. Draw a polygon on the 3D venue view
2. Name the zone (e.g., "Checkout Queue 1")
3. Select zone template (type)
4. Configure thresholds:
   - **Dwell threshold** - Time to count as "dwelled" (default: 60 seconds)
   - **Engagement threshold** - Time for deep engagement (default: 120 seconds)
5. For queue zones: Link to associated service zone

**Zone Settings:**

| Setting | Default | Purpose |
|---------|---------|---------|
| **Dwell Threshold** | 60 sec | Minimum time to trigger dwell |
| **Engagement Threshold** | 120 sec | Minimum time for engagement flag |
| **Queue Warning** | 60 sec | Yellow alert threshold |
| **Queue Critical** | 120 sec | Red alert threshold |

**Business Value:** Granular measurement of every area enables optimization of layout, staffing, and merchandising.

---

### Smart KPI Mode

AI-assisted automatic zone generation from floor plans.

**How It Works:**

1. Upload a DWG floor plan
2. Smart KPI analyzes the layout
3. System suggests zones based on:
   - Fixture positions
   - Traffic flow patterns
   - Standard retail templates
4. Review and refine suggestions
5. One-click zone creation

**Auto-Generated Zone Types:**

| Detected Pattern | Suggested Zone | Pre-set Thresholds |
|------------------|----------------|---------------------|
| Linear shelf arrangement | Aisle | 30s dwell, 60s engagement |
| Grouped shelves | Department | 60s dwell, 120s engagement |
| Near entrance | Entry Zone | 10s dwell |
| Checkout area | Queue + Service | Queue thresholds |
| Open display area | Promotional | 20s dwell |

**Business Value:** Dramatically accelerates zone setup while ensuring best-practice configurations.

---

## Real-Time Tracking & Visualization

### Live Tracking View

See anonymous human movement through your venue in real-time.

**Visualization Elements:**

| Element | Description |
|---------|-------------|
| **Track Markers** | Colored dots showing current positions |
| **Trails** | Path history showing recent movement |
| **Velocity Vectors** | Arrows indicating direction and speed |
| **Zone Highlighting** | Active zones pulse when occupied |
| **Occupancy Counts** | Live people count per zone |

**Display Options:**

- Toggle track trails on/off
- Adjust trail length (history duration)
- Color-code by zone or velocity
- Show/hide velocity vectors

**Data Sources:**

| Source | Use Case |
|--------|----------|
| **Direct LiDAR** | Development, small venues |
| **MQTT from Edge** | Production, distributed deployment |
| **Simulator** | Demos, testing without hardware |

**Business Value:** Instant understanding of current store activity. Identify bottlenecks and opportunities in real-time.

---

### Heatmap Visualization

Density-based visualization of foot traffic patterns over time.

**Heatmap Types:**

| Type | Data Source | Shows |
|------|-------------|-------|
| **Traffic Density** | Position history | Where people walk most |
| **Dwell Heatmap** | Zone visits | Where people spend time |
| **Velocity Map** | Movement speed | Fast vs. slow movement areas |
| **Coverage Heatmap** | LiDAR placements | Sensor coverage quality |

**Time Range Selection:**

- Real-time (last 15 minutes)
- Hourly
- Daily
- Weekly
- Custom date range

**Controls:**

| Control | Options |
|---------|---------|
| **Resolution** | 0.25m to 1m grid |
| **Blur** | Smoothing intensity |
| **Opacity** | Overlay transparency |
| **Color Scale** | Blue→Red (cool→hot) |

**Business Value:** Visualize traffic patterns to optimize store layout, fixture placement, and merchandising.

---

## Analytics & KPIs

### Foot Traffic Analytics

Core metrics measuring visitor flow through zones.

| KPI | Description | Business Use |
|-----|-------------|--------------|
| **Visits** | Unique visitors entering a zone | Traffic volume |
| **Total Entries** | All entries (includes re-entries) | Interaction frequency |
| **Time Spent** | Cumulative time in zone | Attention measurement |
| **Avg Time Spent** | Average per visitor | Zone "stickiness" |
| **Peak Occupancy** | Maximum simultaneous people | Capacity planning |
| **Avg Occupancy** | Average people present | Utilization baseline |

**Traffic Patterns:**

- **Visits by Hour** - 24-hour distribution
- **Peak Hours** - Busiest times
- **Quiet Periods** - Staffing optimization opportunities

---

### Dwell & Engagement Metrics

Measuring meaningful customer interest beyond passing traffic.

| KPI | Definition | Business Meaning |
|-----|------------|------------------|
| **Dwells** | Stays > dwell threshold | Showed interest |
| **Dwell Rate** | % of visitors who dwell | Zone attraction power |
| **Dwell Time** | Average dwell duration | Interest depth |
| **Engagements** | Stays > engagement threshold | Deep consideration |
| **Engagement Rate** | % of visitors engaged | Conversion potential |
| **Dwell Share** | Zone's % of venue dwells | Relative importance |

**Example Interpretation:**

> "Zone A has 500 visits with 25% dwell rate and 3-minute average dwell time, indicating strong engagement. Zone B has 400 visits but only 8% dwell rate — visitors are passing through without stopping."

---

### Queue Management

Comprehensive queue monitoring and wait time analytics.

**Queue Session Lifecycle:**

```
Enter Queue → Waiting → Exit Queue → Enter Service → Service Complete
                ↓
           Abandoned (left without service)
```

**Core Queue KPIs:**

| KPI | Description | Target Example |
|-----|-------------|----------------|
| **Current Queue Length** | People waiting now | < 5 people |
| **Avg Wait Time** | Historical average | < 2 minutes |
| **Max Wait Time** | Longest wait recorded | < 5 minutes |
| **90th Percentile Wait** | 90% served within | < 4 minutes |
| **Abandon Rate** | Left without service | < 5% |
| **Service Time** | Time at register | Benchmark: 90 sec |

**Queue Status Indicators:**

| Status | Color | Condition |
|--------|-------|-----------|
| **OK** | 🟢 Green | Wait < warning threshold |
| **Warning** | 🟡 Yellow | Wait 60-120 seconds |
| **Critical** | 🔴 Red | Wait > 120 seconds |

**Business Actions:**

- Open additional lanes when queue critical
- Analyze abandonment patterns
- Optimize staffing schedules
- Compare queue performance across locations

---

### Flow Analysis

Understanding customer journey patterns through the venue.

| KPI | Description | Insight |
|-----|-------------|---------|
| **Draws** | First dwell location per visitor | Initial attraction zones |
| **Draw Rate** | Zone's share of first engagements | Entry path influence |
| **Exits** | Last dwell before leaving | Journey endpoint zones |
| **Exit Rate** | % leaving from this zone | Terminal path indicator |
| **Bounces** | Single-zone visitors | Missed opportunity indicator |
| **Bounce Rate** | % with single-zone journey | Cross-sell potential |

**Journey Analysis:**

- Common paths through the store
- Conversion funnels (entry → browse → checkout)
- Cross-zone movement patterns

---

## Retail-Specific Features

### Planogram Builder

Configure product placement on shelves for analytics and visualization.

**Workflow:**

1. **Select a Shelf** - Choose from venue objects
2. **Configure Structure:**
   - Number of levels (shelves)
   - Slots per level
   - Level heights
3. **Add Products (SKUs):**
   - Upload SKU catalog (CSV)
   - Includes: name, category, brand, price, image
4. **Place Products:**
   - Drag SKUs to shelf slots
   - Configure facings (horizontal copies)
5. **Save Version** - Planogram version history maintained

**Position Scoring:**

Products are automatically scored by placement quality:

| Level Type | Multiplier | Description |
|------------|------------|-------------|
| **Eye Level** | 1.5× | Prime visibility (chest to eye height) |
| **Waist Level** | 1.0× | Standard visibility |
| **Stretch Level** | 0.7× | Requires reaching up |
| **Stooping Level** | 0.6× | Requires bending down |

| Slot Type | Bonus | Description |
|-----------|-------|-------------|
| **Center** | +20% | Middle of shelf |
| **Endcap** | +40% | End positions (promotional) |
| **Edge** | 0% | Edge positions |

**Business Value:** Link product placement to engagement data for optimized merchandising decisions.

---

### Shelf Analytics

Combine planogram data with zone engagement for product-level insights.

| KPI | Formula | Business Use |
|-----|---------|--------------|
| **Browsing Rate** | Dwells / Visits | Product interest |
| **Avg Browse Time** | Average dwell duration | Consideration depth |
| **Pass-by Count** | Visits without dwell | Missed opportunities |
| **Share of Shelf** | Category's % of slots | Space allocation |
| **Position Score** | Weighted placement quality | Placement fairness |
| **Efficiency Index** | Performance / Space | Brand ROI |

**Category Breakdown:**

- Slots per category
- Category share of shelf
- Average position score per category
- Estimated engagement distribution

**Brand Analysis:**

- Brand share of shelf
- Brand position quality
- Efficiency index (performance vs. space)

---

### Checkout Manager

Configure and monitor checkout zones.

**Setup:**

1. Create **Queue Zone** around waiting area
2. Create **Service Zone** around register
3. Link queue to service zone
4. Configure thresholds

**Live Dashboard:**

- Current queue length
- Average wait time (with trend)
- Service time
- Abandon alerts
- Lane-by-lane comparison

**Business Value:** Optimize staffing and reduce customer frustration through proactive queue management.

---

## Digital Advertising (DOOH)

### Screen Configuration

Configure digital signage screens for attention measurement.

**For Each Screen, Define:**

| Setting | Description |
|---------|-------------|
| **Position** | X, Y coordinates in venue |
| **Screen Size** | Width × Height |
| **Yaw** | Screen facing direction (0° = forward) |
| **SEZ Polygon** | Screen Exposure Zone (viewable area) |
| **AZ Polygon** | Attention Zone (high-quality viewing area) |
| **Distance Range** | Min/max viewing distances |

**Exposure Detection Parameters:**

| Parameter | Default | Purpose |
|-----------|---------|---------|
| **Minimum Duration** | 0.7 sec | Ignore brief glances |
| **Max Gap** | 1.5 sec | Group interrupted viewing |
| **Max Speed** | 1.2 m/s | Filter pass-through traffic |

---

### Exposure & Attention Metrics

Measure screen viewing quality without cameras.

**Exposure Event Data:**

| Metric | Description |
|--------|-------------|
| **Duration** | Total time in SEZ |
| **Effective Dwell** | Time at attention-eligible speed |
| **Min Distance** | Closest approach to screen |
| **Mean Speed** | Average movement speed |
| **Slowdown** | Speed reduction indicating attention |

**AQS - Attention Quality Score (0-100):**

Composite score measuring exposure quality:

| Component | Weight | Measures |
|-----------|--------|----------|
| **Dwell** | 35% | Time spent viewing |
| **Proximity** | 20% | Distance to screen |
| **Orientation** | 20% | Facing the screen |
| **Slowdown** | 15% | Deliberate attention |
| **Stability** | 10% | Stationary viewing |

**AQS Tiers:**

| Tier | Score Range | Quality Level |
|------|-------------|---------------|
| **Premium** | ≥ 70 | Focused attention |
| **Qualified** | 40-69 | Standard exposure |
| **Low** | < 40 | Passing glance |

**Aggregated Screen KPIs:**

| KPI | Description |
|-----|-------------|
| **Exposures** | Total exposure events |
| **Unique Viewers** | Distinct viewers |
| **Avg AQS** | Average attention quality |
| **Premium Rate** | % premium-tier exposures |
| **Total Attention** | Cumulative attention time |

---

### PEBLE™ Attribution Engine

**Post-Exposure Behavioral Lift Engine** - Measuring DOOH advertising effectiveness on shopper behavior.

**The Business Question:**
> "Did seeing that ad actually influence shoppers to engage with the promoted product?"

**How PEBLE Works:**

```
                    EXPOSED GROUP                    CONTROL GROUP
                 ┌─────────────────┐              ┌─────────────────┐
                 │ Saw the ad      │              │ Similar visitors │
                 │ (AQS ≥ 50)      │              │ who passed NEAR  │
                 │ in screen zone  │              │ but NOT exposed  │
                 └────────┬────────┘              └────────┬────────┘
                          │                                │
                          ▼                                ▼
              Did they visit target              Did they visit target
              within 10 minutes?                 within 10 minutes?
                          │                                │
                          ▼                                ▼
                    pExposed = 32%                   pControl = 18%
                                    
                    LIFT = (32% - 18%) / 18% = +78%
```

**Campaign Setup:**

1. **Create Campaign:**
   - Name and description
   - Associated screen(s)
   - Target zone(s) - where conversion is measured

2. **Define Target:**
   - Specific shelf
   - Product category
   - Brand
   - SKU

3. **Configure Parameters:**
   - Action window (time to convert after exposure)
   - Minimum AQS for exposed group
   - Control matching criteria

**PEBLE KPIs:**

| KPI | Formula | Meaning |
|-----|---------|---------|
| **EAL™** | (pExposed - pControl) / pControl | Exposure-to-Action Lift |
| **TTA™** | Median time from exposure to action | Time-to-Action |
| **DCI™** | Change in trajectory toward target | Direction Change Index |
| **CES™** | Weighted composite of lift metrics | Campaign Effectiveness Score |
| **AAR™** | Conversions / Qualified exposures | Attention-to-Action Rate |

**Example Report:**

| Campaign | Exposures | Lift (EAL) | TTA | CES |
|----------|-----------|------------|-----|-----|
| "Coke Summer" | 2,450 | +42% | 3.2 min | 68 |
| "New Snack Launch" | 1,890 | +28% | 4.8 min | 52 |
| "Premium Coffee" | 980 | +15% | 6.1 min | 41 |

**Business Value:** Prove DOOH advertising ROI with rigorous, scientifically-valid attribution methodology.

---

## Business Intelligence

### AI Narrator

AI-powered assistant that explains KPIs in plain business language.

**Capabilities:**

| Feature | Description |
|---------|-------------|
| **KPI Explanation** | "What does this number mean for my business?" |
| **Anomaly Alerts** | "Wait time jumped 2x normal" |
| **Trend Detection** | "Engagement dropping 3 hours straight" |
| **Guided Navigation** | "Click here to see the heatmap" |
| **Proactive Insights** | Surfaces important changes automatically |

**Persona-Based Narratives:**

| Persona | Focus Areas |
|---------|-------------|
| **Store Manager** | Queues, occupancy, wait times |
| **Merchandising** | Shelf browsing, engagement, efficiency |
| **Retail Media** | Screen attention, lift, attribution |
| **Executive** | High-level summary, key metrics |

**Story Mode:**

Step-by-step guided narratives through relevant KPIs:
1. Current situation
2. Key metrics
3. Comparisons
4. Recommended actions
5. Summary

**Business Value:** Makes complex analytics accessible to all users regardless of technical expertise.

---

### Replay Insights

Replay and analyze significant events from the past.

**Episode Types:**

| Episode Category | Examples |
|------------------|----------|
| **Queue Events** | Sudden queue buildup, high abandonment |
| **Traffic Anomalies** | Unusual foot traffic patterns |
| **Engagement Spikes** | High dwell activity in a zone |
| **Operational Issues** | Dead zones, coverage gaps |

**For Each Episode:**

- **Title** - What happened
- **Time Range** - When it occurred
- **Severity** - High, Medium, Low
- **Affected KPIs** - Which metrics were impacted
- **Business Summary** - Plain language explanation
- **Recommended Actions** - What to do about it
- **Confidence Score** - How certain the analysis is

**Insight Mode:**

1. Select an episode from the timeline
2. Click "Play Insight"
3. System highlights affected zones
4. Step through recommended actions
5. Optionally ask AI narrator for explanation

**Story Recipes:**

Pre-built narratives combining multiple episodes:
- "Morning Rush Review"
- "Queue Performance Deep-Dive"
- "Weekly Traffic Trends"

**Business Value:** Learn from past events to prevent future issues. Build institutional knowledge.

---

### Business Reporting

Executive dashboards and persona-based reporting views.

**Dashboard Components:**

| Component | Description |
|-----------|-------------|
| **KPI Summary Cards** | High-level metrics at a glance |
| **Trend Charts** | Time-series visualizations |
| **Zone Comparison** | Side-by-side zone performance |
| **Alert Feed** | Recent threshold violations |
| **Heatmap Preview** | Traffic density overview |

**Time Period Options:**

- Today
- Yesterday
- Last 7 days
- Last 30 days
- Custom date range

**Export Capabilities:**

- PDF reports
- CSV data export
- Scheduled email reports

**Business Value:** Standardized reporting for stakeholders at all levels.

---

## Key Business Flows

### Flow 1: New Venue Setup (Full Deployment)

```
1. Create Venue
      ↓
2. Import DWG Floor Plan (or build manually)
      ↓
3. Map fixtures to 3D assets
      ↓
4. Generate venue layout
      ↓
5. Plan LiDAR coverage
      ↓
6. Install physical LiDARs + Edge servers
      ↓
7. Commission LiDARs (pair to placements)
      ↓
8. Deploy configuration to edge
      ↓
9. Create zones (or use Smart KPI Mode)
      ↓
10. Validate tracking (live view)
      ↓
11. Configure thresholds and alerts
      ↓
12. Go live with analytics
```

### Flow 2: LiDAR Commissioning

```
1. Scan Tailnet → Discover edge servers
      ↓
2. Select edge → Scan LAN for LiDARs
      ↓
3. Drag LiDAR → Drop on planned placement
      ↓
4. Repeat for all LiDARs
      ↓
5. Review pairings
      ↓
6. Deploy to Edge (sends extrinsics)
      ↓
7. Edge applies config
      ↓
8. Validate: Check status panel
      ↓
9. View live tracking to confirm
```

### Flow 3: Queue Monitoring Setup

```
1. Create Queue Zone (waiting area polygon)
      ↓
2. Create Service Zone (register area)
      ↓
3. Link queue to service zone
      ↓
4. Configure thresholds (warning: 60s, critical: 120s)
      ↓
5. Save configuration
      ↓
6. Monitor via Checkout Manager
      ↓
7. Receive alerts when thresholds breached
```

### Flow 4: DOOH Campaign Attribution

```
1. Configure DOOH Screen (position, SEZ, parameters)
      ↓
2. Create Campaign with target zone
      ↓
3. Run exposure detection
      ↓
4. System identifies exposed viewers
      ↓
5. System matches control group
      ↓
6. Measure conversion for both groups
      ↓
7. Calculate lift (EAL), TTA, CES
      ↓
8. View attribution dashboard
      ↓
9. Export campaign report
```

### Flow 5: Planogram & Shelf Analytics

```
1. Select shelf object in venue
      ↓
2. Configure shelf structure (levels, slots)
      ↓
3. Import SKU catalog
      ↓
4. Place products on shelf (drag & drop)
      ↓
5. Save planogram version
      ↓
6. Create engagement zone for shelf
      ↓
7. Collect visitor data
      ↓
8. View shelf analytics:
   - Browsing rate
   - Category breakdown
   - Brand efficiency
```

---

## Glossary

| Term | Definition |
|------|------------|
| **AQS** | Attention Quality Score - 0-100 measure of exposure quality |
| **Dwell** | Visitor staying in zone longer than threshold |
| **DOOH** | Digital Out-of-Home - Digital advertising screens |
| **DWG** | AutoCAD Drawing format for floor plans |
| **EAL** | Exposure-to-Action Lift - Incremental conversion from ad exposure |
| **Edge Server** | On-premise hardware processing LiDAR data |
| **Engagement** | Deep dwell exceeding engagement threshold |
| **Extrinsics** | LiDAR position and orientation configuration |
| **FOV** | Field of View - Sensor coverage angle |
| **PEBLE** | Post-Exposure Behavioral Lift Engine - Attribution system |
| **Planogram** | Product placement configuration on shelf |
| **ROI** | Region of Interest - Measurement zone |
| **SEZ** | Screen Exposure Zone - DOOH viewable area |
| **SKU** | Stock Keeping Unit - Unique product identifier |
| **TTA** | Time-to-Action - Seconds from ad exposure to engagement |
| **Ulisse** | Edge server hardware platform |

---

*Document Version: 1.0 | Generated: February 2026*
*Hyperspace Platform - The LiDAR-Powered Spatial Analytics Platform*
