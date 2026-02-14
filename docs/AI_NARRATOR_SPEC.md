# AI Narrator with Deep-Linking & KPI Storytelling

## Overview

The AI Narrator is an **additive, non-invasive** layer that:
- Explains KPIs and insights in plain business language
- Guides users through the UI via deep-linking and visual highlighting
- Adapts narration to user persona
- Proactively surfaces anomalies and opportunities (toggle-controlled)
- Learns from usage patterns to improve suggestions

**It is NOT:**
- A chatbot
- Documentation
- An agent controlling the app

**It IS:**
- A business interpreter
- A guided UI navigator
- A storytelling layer on top of real data

---

## Critical Constraints

### ❌ DO NOT
- Modify existing KPI computation
- Modify DWG importer
- Modify LiDAR Planner, Network Panel, or Simulator
- Let AI execute UI logic directly
- Let AI invent KPIs, buttons, or features

### ✅ MUST
- All AI outputs are interpreted, validated, and mapped by deterministic frontend code
- Intent whitelist strictly enforced
- Schema validation on all OpenAI responses
- Fallback copy when AI fails or confidence is low

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        NARRATOR LAYER (NEW)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │ NarratorContext  │───▶│ OpenAI Service   │                   │
│  │ (React Context)  │    │ (Backend Proxy)  │                   │
│  └────────┬─────────┘    └──────────────────┘                   │
│           │                                                     │
│           ▼                                                     │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │ UiIntentMapper   │───▶│ HighlightContext │                   │
│  │ (Deterministic)  │    │ (Visual Overlay) │                   │
│  └──────────────────┘    └──────────────────┘                   │
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │ InsightEngine    │───▶│ UsageTracker     │                   │
│  │ (Proactive)      │    │ (Learning)       │                   │
│  └──────────────────┘    └──────────────────┘                   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                     EXISTING LAYERS (UNCHANGED)                 │
├─────────────────────────────────────────────────────────────────┤
│  VenueContext │ RoiContext │ TrackingContext │ LidarContext     │
│  PlanogramContext │ HeatmapContext │ DwgContext                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## UI Design: Right Sidebar Drawer

**Placement:** Right sidebar drawer, 320px width (48px collapsed)
**Toggle:** Button in bottom toolbar alongside KPI buttons

### Layout

```
┌─────────────────────────────────────┐
│ 🤖 AI Narrator           [×]       │
├─────────────────────────────────────┤
│ [Persona ▼] [🔔 Proactive] [Story] │
├─────────────────────────────────────┤
│                                     │
│ ┌─ PROACTIVE ALERTS (if ON) ──────┐ │
│ │ ⚠️ Queue wait 2x normal     [→] │ │
│ │ 📈 Abandon rate trending up [→] │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ───────────────────────────────────  │
│                                     │
│ 📊 Current Focus: Queue Performance │
│                                     │
│ Your average wait time is 4.2 min   │
│ — above your 2 min target.          │
│                                     │
│ • 8 people waiting now              │
│ • Abandon rate at 12%               │
│ • Peak expected in 20 min           │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ [→ Open Checkout Manager]       │ │
│ │ [→ View Queue Heatmap]          │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ─────── Ask me about ─────────      │
│                                     │
│ 💬 "Why is abandon rate high?"      │
│ 💬 "Compare to yesterday"           │
│ 💬 "Which lane is slowest?"         │
│                                     │
│ ◄ Prev              Next ►          │
└─────────────────────────────────────┘
```

---

## Personas (Existing in Hyperspace)

| ID | Name | Focus |
|----|------|-------|
| `store-manager` | Operations Pulse | Queues, occupancy, wait times |
| `merchandising` | Shelf & Category | Browsing, engagement, shelf efficiency |
| `retail-media` | PEBLE™ Effectiveness | Screen attention, lift, attribution |
| `executive` | Executive Summary | High-level business metrics |

Each persona has max 7 KPIs (enforced).

---

## Allowed UI Intents

```typescript
const HYPERSPACE_UI_INTENTS = {
  // View Mode Navigation
  OPEN_MAIN_VIEW: () => setMode('main'),
  OPEN_DWG_IMPORTER: () => setMode('dwgImporter'),
  OPEN_LIDAR_PLANNER: () => setMode('lidarPlanner'),
  OPEN_PLANOGRAM_BUILDER: () => setMode('planogram'),
  OPEN_EDGE_COMMISSIONING: () => setMode('edgeCommissioning'),
  OPEN_DOOH_ANALYTICS: () => setMode('doohAnalytics'),
  OPEN_DOOH_EFFECTIVENESS: () => setMode('doohEffectiveness'),
  OPEN_BUSINESS_REPORTING: () => setMode('businessReporting'),
  
  // Modal Toggles
  OPEN_HEATMAP_MODAL: () => setShowHeatmapModal(true),
  OPEN_CHECKOUT_MANAGER: () => setShowCheckoutManager(true),
  OPEN_SMART_KPI_MODAL: () => setShowSmartKpiModal(true),
  OPEN_ACTIVITY_LEDGER: () => setShowLedger(true),
  
  // Layer Toggles
  TOGGLE_KPI_OVERLAYS: () => toggleKPIOverlays(),
  TOGGLE_COVERAGE_HEATMAP: () => toggleLayer('coverage'),
  TOGGLE_LIDAR_FOV: () => toggleLayer('lidarFov'),
  
  // Entity Highlights (soft glow, 3-5 sec)
  HIGHLIGHT_ZONE: (id) => highlightEntity('zone', id),
  HIGHLIGHT_SHELF: (id) => highlightEntity('shelf', id),
  HIGHLIGHT_SCREEN: (id) => highlightEntity('screen', id),
  HIGHLIGHT_LIDAR: (id) => highlightEntity('lidar', id),
  HIGHLIGHT_QUEUE: (id) => highlightEntity('queue', id),
  
  // Persona Switch
  SELECT_PERSONA: (id) => setActivePersona(id),
} as const;
```

---

## Narrator Input Schema

```typescript
interface NarratorInput {
  persona: 'store-manager' | 'merchandising' | 'retail-media' | 'executive';
  currentView: ViewMode;
  selectedEntity: {
    type: 'zone' | 'shelf' | 'screen' | 'lidar' | 'queue' | 'category' | 'none';
    id?: string;
    name?: string;
  };
  kpiSnapshot: Record<string, number | null>;
  venueContext: {
    venueId: string;
    venueName: string;
    hasLidars: boolean;
    hasDwgLayout: boolean;
    hasScreens: boolean;
  };
  proactiveInsights?: ProactiveInsight[];  // If proactive mode ON
  usageHistory?: NarratorUsageHistory;      // For personalization
  allowedUiIntents: string[];
  storyStepGoal?: string;
}
```

---

## Narrator Output Schema (Strict JSON)

```typescript
interface NarratorOutput {
  headline: string;                    // Max 120 chars
  narration: string[];                 // Bullet points
  businessMeaning: string;             // Plain language
  
  recommendedActions: {
    label: string;
    uiIntent: string;                  // Must be in allowedUiIntents
    reason: string;
  }[];
  
  suggestedFollowUps: {
    question: string;
    intentType: 'explain_kpi' | 'compare_trend' | 'drill_down' | 'navigate';
    context?: {
      targetKpi?: string;
      targetEntity?: string;
    };
  }[];
  
  uiFocus: {
    highlight: string[];               // Entity IDs
    layersOn: string[];
    layersOff: string[];
  };
  
  confidence: 'high' | 'medium' | 'low';
}
```

---

## Proactive Insight Engine

### Detection Types

| Type | Logic | Example |
|------|-------|---------|
| Anomaly | Value > 2σ from rolling avg | "Wait time jumped to 6 min" |
| Threshold | Crossed persona threshold | "Abandon rate hit 15%" |
| Trend | 3+ periods same direction | "Engagement dropping 3 hours" |
| Opportunity | Positive anomaly | "Lane 2 empty, queue is 8" |
| Comparison | Delta vs benchmark | "Traffic 30% below Tuesday" |

### Proactive Insight Schema

```typescript
interface ProactiveInsight {
  type: 'anomaly' | 'trend' | 'threshold_breach' | 'opportunity' | 'comparison';
  severity: 'critical' | 'warning' | 'info';
  kpiId: string;
  currentValue: number;
  benchmark: number;
  delta: number;
  headline: string;
  explanation: string;
  suggestedAction: string;
  relevantEntities: string[];
}
```

### Toggle Behavior

- **Proactive ON:** Alerts shown in collapsible section at top
- **Proactive OFF:** Alerts hidden, main narrator flow uninterrupted
- **Max alerts:** 3 at a time
- **Click alert:** Optionally focuses narrator on that insight

---

## Usage Learning

### What Gets Tracked

```typescript
interface NarratorUsageHistory {
  personaId: string;
  venueId: string;
  followUpClicks: { question: string; context: string; wasHelpful: boolean }[];
  intentsTaken: { intent: string; afterKpi: string; frequency: number }[];
  successfulPaths: { kpiStart: string; stepsFollowed: string[]; outcomeAction: string }[];
}
```

### How It Improves Suggestions

- Rank follow-ups by click frequency
- Suggest actions that worked before
- Adjust narration length based on engagement
- Demote suggestions that get skipped

### Privacy

- No PII stored
- Local-first (localStorage)
- Optional backend sync
- 90-day retention

---

## Story Mode (Persona-Driven)

### Store Manager (5 steps)
1. Queue Pressure → avgWaitingTimeMin, currentQueueLength
2. Peak Planning → peakOccupancy, avgOccupancy
3. Space Efficiency → utilizationRate, deadZonesCount
4. Action Items → Navigate to checkout/heatmap
5. Summary → Key recommendations

### Merchandising (5 steps)
1. Shelf Attraction → browsingRate, passbyCount
2. Engagement Depth → avgBrowseTime, categoryEngagementRate
3. Conversion Impact → categoryConversionRate
4. Brand Balance → brandEfficiencyIndex
5. Optimization → Navigate to planogram

### Retail Media (5 steps)
1. Campaign Overview → ces, confidencePct
2. Attention Quality → aqs
3. Lift & Attribution → eal, aar
4. Speed to Action → ttaSec, dci
5. Optimization → Navigate to DOOH

### Executive (4 steps)
1. Traffic Health → totalVisitors, avgOccupancy
2. Experience Quality → avgWaitingTimeMin, abandonRate
3. Engagement → engagementRate, utilizationRate
4. Media ROI → ces, eal

---

## Demo Mode

URL flag: `?guidedDemo=true`

Behavior:
- Locks Story Mode
- Auto-advances steps (5s delay)
- Perfect for sales demos
- Exit button always visible

---

## Failsafe & Fallback

If OpenAI fails, schema invalid, or confidence=low:

```
"Data available. Select a KPI to explore."
```

No UI intents executed on failure.

---

## File Structure

```
frontend/src/
├── context/
│   └── NarratorContext.tsx
├── components/narrator/
│   ├── NarratorDrawer.tsx
│   ├── NarratorToggle.tsx
│   ├── ProactiveAlerts.tsx
│   ├── StoryModeProgress.tsx
│   ├── FollowUpSuggestions.tsx
│   └── HighlightOverlay.tsx
├── services/
│   └── narratorService.ts
├── types/
│   └── narrator.ts
├── hooks/
│   └── useNarrator.ts

backend/
├── routes/
│   └── narrator.js
├── services/
│   └── insightEngine.js
```

---

## Implementation Phases

| Phase | Scope | Effort |
|-------|-------|--------|
| 1 | Backend: OpenAI proxy + insight engine | 6h |
| 2 | Context: NarratorContext + types | 3h |
| 3 | UI: Drawer + proactive alerts | 6h |
| 4 | Integration: Intent mapping + highlights | 4h |
| 5 | Learning: Usage tracking + ranking | 4h |
| 6 | Story Mode + Demo Mode | 3h |

**Total:** ~26 hours

---

## OpenAI Configuration

- **Model:** GPT-4o (latest stable)
- **Temperature:** 0.2
- **Output:** Strict JSON (no markdown)
- **Rate limit:** Max 10 calls/min per session
- **Timeout:** 10s with retry

---

## Definition of Done

- [ ] Narrator explains KPIs clearly in business language
- [ ] Narrator deep-links users to correct UI views
- [ ] Proactive alerts surface anomalies (toggle-controlled)
- [ ] Follow-up suggestions are contextual and learnable
- [ ] No existing functionality altered
- [ ] No hallucinated buttons or KPIs
- [ ] Works in live demo mode
- [ ] Fully optional and dismissible
