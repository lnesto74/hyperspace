# Kimi 2.5 Prompt — Hyperspace Promotional Landing Page

Copy everything below the line into Kimi 2.5:

---

Build a stunning, modern promotional landing page for **Hyperspace** — an enterprise-grade LiDAR-based spatial analytics platform for retail, smart venues, and physical spaces. The page must be a single-page React app (Vite + TailwindCSS + Framer Motion) with a dark sci-fi aesthetic (deep navy/black background, electric blue and neon green accents, subtle grid lines). No backend needed — purely static/presentational.

## Brand Identity

- **Product Name:** Hyperspace
- **Tagline:** "Turn Physical Space Into Intelligent Space"
- **Secondary tagline:** "LiDAR-Powered Spatial Analytics for Retail & Smart Venues"
- **Logo:** Use a stylized "H" icon or the text "HYPERSPACE" in a futuristic tech font (e.g. Inter, Space Grotesk, or Exo 2). Accent color: electric blue `#007bff` and neon green `#00ff88`.
- **Target audience:** Retail executives, store operations managers, marketing/media buyers, category managers, real estate/facility managers.
- **Tone:** Professional yet futuristic. Data-driven. Confident. Not consumer-facing — this is B2B enterprise SaaS.

## Page Sections (in order)

### 1. Hero Section
Full-viewport hero with:
- Animated particle/dot grid background simulating real-time people tracking (dots moving along paths in a top-down venue view). Use canvas or CSS animations.
- Large headline: **"Turn Physical Space Into Intelligent Space"**
- Subheadline: "Hyperspace uses LiDAR sensors to anonymously track movement, measure engagement, and optimize every square meter of your retail space — in real time."
- Two CTA buttons: **"Request a Demo"** (primary, filled blue) and **"Watch Overview"** (secondary, outlined)
- A floating 3D-looking isometric illustration or mockup of a retail store with glowing dots representing tracked people, sensor coverage cones, and zone overlays.

### 2. Trusted By / Social Proof Bar
- Logos placeholder row: "Trusted by leading retailers" with 5-6 placeholder grey logos (use generic shapes labeled "Partner 1", "Partner 2", etc.)
- A single stat bar: **"50+ KPIs"** | **"100% Anonymous"** | **"Real-Time at 20 FPS"** | **"< 1s Latency"**

### 3. What is Hyperspace? (Platform Overview)
Short paragraph + animated diagram:
> "Hyperspace is a full-stack spatial analytics platform. Import your floor plan, place LiDAR sensors, define zones, and instantly get rich analytics — from foot traffic and dwell time to ad attribution and queue management. All from a single browser-based interface."

Show an animated horizontal pipeline/flow:
```
Import Floor Plan → Place LiDAR Sensors → Define Zones (ROI) → Track People → Compute KPIs → Business Insights
```
Each step should have an icon and a brief label. Animate them appearing sequentially.

### 4. Core Platform Modules (Feature Grid)
A responsive grid of **12 feature cards** with icons, titles, and short descriptions. Each card should have a subtle hover glow effect. Use Lucide or Heroicons.

| # | Module | Icon Suggestion | Description |
|---|--------|----------------|-------------|
| 1 | **3D Venue Builder** | Box/Cube | Create digital twins of physical spaces with accurate dimensions, tile grids, and object placement (shelves, walls, checkouts, displays, entrances). |
| 2 | **DWG/CAD Importer** | FileUp/Upload | Import AutoCAD floor plans (.dwg/.dxf), auto-detect fixtures, map them to 3D assets, and generate venue layouts in seconds. |
| 3 | **LiDAR Coverage Planner** | Radar/Eye | Plan optimal sensor placement with FOV visualization, coverage heatmaps, and an auto-solver that minimizes sensors while maximizing coverage. Supports Livox, Ouster, Velodyne, Hesai. |
| 4 | **Edge Commissioning** | Server/Network | Discover edge servers over Tailscale VPN, scan LiDARs on local networks, pair sensors to planned positions, and deploy extrinsics configs with one click. |
| 5 | **Real-Time Tracking** | Activity/Zap | Visualize live trajectories at 20 FPS with trails, velocity vectors, and zone highlighting. Supports direct TCP, MQTT, and simulated data sources. |
| 6 | **Heatmap Visualization** | Flame/Map | Density-based foot traffic heatmaps — real-time, historical, dwell-based, and velocity patterns with configurable resolution and color scales. |
| 7 | **Regions of Interest (ROI)** | Square/Layers | Draw polygonal zones on your venue for measurement — standard zones, queue zones, service zones, shelf engagement zones, DOOH screen zones, and entrance/exit counters. |
| 8 | **Queue Management** | Clock/Users | Real-time queue monitoring with wait time tracking, abandonment detection, threshold alerts (green/yellow/red), and service time analytics. |
| 9 | **Planogram Builder** | Grid/Package | Design shelf layouts, import SKU catalogs (CSV/Excel), drag-and-drop products onto shelves, and get automatic position scoring (eye-level, endcap, center bonuses). |
| 10 | **DOOH Analytics** | Monitor/Screen | Measure digital signage effectiveness with the proprietary AQS™ (Attention Quality Score) — combining dwell, proximity, orientation, slowdown, and stability signals. |
| 11 | **PEBLE™ Attribution** | TrendingUp/Target | Post-Exposure Behavioral Lift Engine — matched control methodology measuring incremental ad impact with EAL™ (lift), TTA™ (time-to-action), DCI™ (direction change), and CES™ (campaign score). |
| 12 | **AI Narrator** | Bot/MessageSquare | An AI-powered business interpreter that explains KPIs in plain language, guides users through the UI with deep-linking, surfaces anomalies, and adapts to user personas. |

### 5. How It Works (Technical Architecture — Simplified)
A visually appealing 3-layer architecture diagram animated on scroll:

**Layer 1 — Edge Layer (bottom)**
- LiDAR sensors → Edge servers (Ulisse boxes) processing point clouds into trajectories
- "Supports any LiDAR: Livox Mid-360, Ouster OS1, Velodyne VLP-16, Hesai XT32"
- "Pluggable algorithm providers via Docker containers (HER — Hyperspace Edge Runtime)"

**Layer 2 — Platform Layer (middle)**
- Node.js + Express backend with SQLite
- MQTT broker receives trajectories from distributed edges
- TrackAggregator combines multi-source tracks
- KPI Calculator, DOOH Engine, PEBLE™ Attribution Engine, Shelf Analytics
- Real-time WebSocket streaming at 20 FPS

**Layer 3 — Application Layer (top)**
- React + Three.js browser-based UI
- 3D venue visualization
- KPI dashboards and business reporting
- Persona-based views (Store Manager, Category Manager, Marketing Manager, Executive)

### 6. KPI Showcase (The Numbers That Matter)
Highlight the **4 analytics domains** with animated counter cards:

**Zone Analytics (50+ KPIs)**
- Visits, dwell time, engagement rate, bounce rate, draw rate, exit rate
- Occupancy tracking (peak, average, real-time)
- Velocity analysis (speed, stationary vs. moving)
- Utilization rate, conversion tracking
- Time-series: hourly distribution, occupancy over time

**Queue Intelligence**
- Real-time queue length and wait times
- Abandonment rate with threshold alerts
- P90/P95 wait time percentiles
- Service time analytics
- Arrival rate calculations (queuing theory)

**DOOH Measurement (AQS™)**
- Attention Quality Score (0-100) combining 5 behavioral signals
- Premium / Qualified / Low tier classification
- Exposure events with dwell, proximity, orientation scoring
- Context segmentation (queue, checkout, aisle, entrance, exit)
- Proof-of-play integration

**PEBLE™ Attribution**
- EAL™ — Exposure-to-Action Lift (did the ad drive visits?)
- TTA™ — Time-to-Action (how fast did they respond?)
- DCI™ — Direction Change Index (did they redirect toward the target?)
- CES™ — Campaign Effectiveness Score (overall campaign grade)
- AAR™ — Attention-to-Action Rate (conversion efficiency)
- Matched control methodology with statistical confidence scoring

### 7. Use Cases Section
3-4 horizontally scrollable cards with illustrations:

**Retail Store Optimization**
> "Track every shopper journey from entrance to checkout. Identify dead zones, optimize layouts, reduce queue wait times, and measure the impact of in-store promotions — all without cameras."

**Retail Media Measurement**
> "Prove DOOH ad effectiveness with PEBLE™ attribution. Measure exactly how many shoppers redirected to the advertised shelf after seeing a screen, with matched control groups and statistical rigor."

**Category & Shelf Performance**
> "See which products attract attention and which get walked past. Combine planogram data with foot traffic to calculate browsing rates, share of shelf efficiency, and estimated engagement value per category."

**Smart Venue Management**
> "From airports to shopping malls — monitor occupancy in real time, detect crowd anomalies, manage queues, and generate executive reports by persona (operations, marketing, finance)."

### 8. Technology Stack Bar
A sleek horizontal strip showing tech logos:
- React 18 + TypeScript
- Three.js (3D)
- Node.js + Express
- SQLite (embedded, zero-config)
- Socket.IO (real-time)
- MQTT (IoT messaging)
- Tailscale (secure networking)
- Docker (edge runtime)
- OpenAI GPT-4o (AI Narrator)

### 9. Privacy & Compliance Section
A dark card with a shield icon:
- **"100% Anonymous Tracking"** — No cameras. No facial recognition. No PII. LiDAR sees geometry, not identity.
- **"GDPR-Friendly by Design"** — Trajectory data contains only position coordinates and timestamps. No biometric data collected or stored.
- **"On-Premise Option"** — Deploy entirely on your infrastructure. Data never leaves your network.

### 10. Business Reporting Personas
Show 4 persona cards side by side:

| Persona | Focus | Key Metrics |
|---------|-------|-------------|
| **Store Manager** | Operations | Traffic flow, queue times, peak occupancy, space utilization |
| **Category Manager** | Products | Shelf browsing rate, engagement depth, category conversion, brand efficiency |
| **Marketing Manager** | Campaigns | Screen attention (AQS), exposure lift (EAL), time-to-action (TTA), campaign score (CES) |
| **Executive** | Overview | Total visitors, experience quality, engagement rate, media ROI |

### 11. Integration & Deployment
- **CAD Import:** DWG/DXF floor plan import with automatic fixture detection
- **LiDAR Agnostic:** Works with Livox, Ouster, Velodyne, Hesai, and any vendor via MQTT
- **Edge Runtime (HER):** Deploy vendor algorithm providers as Docker containers to edge devices
- **API-First:** Full REST API + WebSocket events for custom integrations
- **Self-Hosted:** Runs on a single machine — Node.js + SQLite, no cloud dependency

### 12. CTA / Contact Section
- Headline: **"Ready to See Your Space in a New Dimension?"**
- Subtext: "Book a live demo and see Hyperspace transform your venue into an intelligent, data-driven environment."
- Email input + "Request Demo" button
- Secondary links: "View Documentation" | "Technical Specs" | "Contact Sales"

### 13. Footer
- Hyperspace logo + copyright
- Links: Platform, Solutions, Documentation, Blog, Contact
- "PEBLE™, EAL™, TTA™, DCI™, CES™, AQS™, AAR™, and SEQ™ are trademarks of Hyperspace Analytics."
- Social media icons (LinkedIn, Twitter/X, GitHub)

## Design Requirements

1. **Dark theme** — Background: `#0a0a0f` to `#0d1117`. Cards: `#111827` with subtle borders `#1f2937`.
2. **Accent colors** — Primary: `#007bff` (electric blue). Secondary: `#00ff88` (neon green). Tertiary: `#8b5cf6` (purple for PEBLE™ section).
3. **Typography** — Headlines: bold, large (48-72px hero, 36-48px sections). Body: 16-18px, light gray `#94a3b8`.
4. **Animations** — Framer Motion scroll-triggered reveals. Parallax on hero. Counter animations on KPI numbers. Subtle particle effects.
5. **Responsive** — Mobile-first. Feature grid collapses to single column. Hero image stacks below text on mobile.
6. **Performance** — Lazy load sections. Use CSS animations where possible. Optimize particle count on mobile.
7. **Glassmorphism** — Use frosted glass effects on cards (backdrop-blur with semi-transparent backgrounds).
8. **Grid patterns** — Subtle dot grid or line grid patterns in backgrounds to echo the venue grid concept.

## Implementation Notes

- Use Vite + React + TypeScript + TailwindCSS
- Use Framer Motion for scroll animations
- Use Lucide React for icons
- Use Inter or Space Grotesk font from Google Fonts
- No backend, no API calls — everything is static content
- The page should be a single `App.tsx` with section components
- Include a smooth-scrolling navbar that highlights the active section
- Add a "Back to top" floating button
