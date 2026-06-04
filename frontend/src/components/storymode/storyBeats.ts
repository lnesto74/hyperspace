/** Story Mode beat script — shared by StoryMode driver and layout chrome. */

export type StoryViewMode =
  | 'main'
  | 'planogram'
  | 'dwgImporter'
  | 'lidarPlanner'
  | 'edgeCommissioning'
  | 'doohAnalytics'
  | 'doohEffectiveness'
  | 'businessReporting'
  | 'profitRadar'
  | 'benchmark'
  | 'dailyDebrief'

export type StoryRung =
  | 'OBSERVE'
  | 'SENSE'
  | 'ALERT'
  | 'EXPLAIN'
  | 'QUANTIFY'
  | 'DECIDE'
  | 'RECOMMEND'
  | 'REMEMBER'

export interface StoryStageActions {
  setViewMode: (m: StoryViewMode) => void
  setNeuralEnabled: (enabled: boolean) => void
  openHeatmap: () => void
  closeHeatmap: () => void
  openNarrator: () => void
  closeNarrator: () => void
  openCheckout: () => void
  openStoryGrid: () => void
  selectFirstCampaign: (name?: string) => void
  selectRadarZone: () => void
}

export interface StoryBeat {
  id: string
  time: string
  period: 'Morning' | 'Afternoon' | 'Evening'
  rung: StoryRung
  title: string
  floor: string
  hyperspace: string
  outcome: string
  component: string
  stage: (a: StoryStageActions) => void
  seekPct?: number
  dim?: 'soft' | 'tight' | 'none'
}

export const STORY_RUNG_COLOR: Record<StoryRung, string> = {
  OBSERVE: '#3b82f6',
  SENSE: '#3b82f6',
  ALERT: '#e0a83e',
  EXPLAIN: '#e0a83e',
  QUANTIFY: '#3ea06b',
  DECIDE: '#3b82f6',
  RECOMMEND: '#3ea06b',
  REMEMBER: '#9ca3af',
}

export const STORY_BEATS: StoryBeat[] = [
  {
    id: 'ready',
    time: '07:30',
    period: 'Morning',
    rung: 'OBSERVE',
    title: 'Before the doors open, the store wakes up',
    floor: 'Aisles are dark. Nobody knows yet if today\u2019s data will be trustworthy.',
    hyperspace: 'The digital twin comes online and every sensor self-checks before the first customer arrives.',
    outcome: '0 blind spots \u00b7 sensors green',
    component: 'Digital Twin \u00b7 LiDAR Network',
    stage: (a) => { a.setViewMode('main') },
    dim: 'none',
  },
  {
    id: 'live',
    time: '08:00',
    period: 'Morning',
    rung: 'OBSERVE',
    title: 'Doors open \u2014 the store starts seeing',
    floor: 'First shoppers enter. A manager sees a busy floor and a gut feeling.',
    hyperspace: 'Every journey is tracked anonymously \u2014 no cameras \u2014 turning movement into live, measurable flow.',
    outcome: '100% anonymous \u00b7 live at 20 FPS',
    component: 'Real-Time Tracking \u00b7 Neural Dashboard',
    stage: (a) => { a.setViewMode('main'); a.setNeuralEnabled(true) },
    seekPct: 0.08,
  },
  {
    id: 'heatmap',
    time: '09:30',
    period: 'Morning',
    rung: 'SENSE',
    title: 'Patterns no one would notice by eye',
    floor: 'The store looks full. A whole aisle is quietly being skipped.',
    hyperspace: 'The heatmap reveals a cold aisle pulling a fraction of average traffic \u2014 hiding in plain sight.',
    outcome: '12% of avg traffic \u00b7 Aisle 7',
    component: 'Heatmap Viewer',
    stage: (a) => { a.setViewMode('main'); a.openHeatmap() },
    dim: 'tight',
  },
  {
    id: 'queue',
    time: '11:00',
    period: 'Morning',
    rung: 'ALERT',
    title: 'A queue forms \u2014 before a single complaint',
    floor: 'A line builds at checkout. By the time staff react, customers are already frustrated.',
    hyperspace: 'Queue buildup trips an alert; the Checkout command center opens with live lanes, waits and the fix: open Lane 4 \u2014 proactively.',
    outcome: 'wait 6m20s \u2192 1m50s',
    component: 'Checkout Command Center',
    stage: (a) => { a.setViewMode('main'); a.setNeuralEnabled(true); a.openCheckout() },
    seekPct: 0.45,
    dim: 'tight',
  },
  {
    id: 'peble',
    time: '13:00',
    period: 'Afternoon',
    rung: 'EXPLAIN',
    title: 'The promo gets seen \u2014 but doesn\u2019t convert',
    floor: 'The screen is clearly grabbing attention. Marketing assumes the campaign is working.',
    hyperspace: 'PEBLE\u2122 proves exposure is high but shelf lift is flat \u2014 the creative, not the traffic, is the problem.',
    outcome: '+38% seen \u00b7 +4% shelf lift',
    component: 'PEBLE\u2122 Attribution',
    stage: (a) => { a.setViewMode('doohEffectiveness'); a.selectFirstCampaign('Frutta E V') },
    dim: 'none',
  },
  {
    id: 'radar',
    time: '15:00',
    period: 'Afternoon',
    rung: 'QUANTIFY',
    title: 'Opportunity, priced in euros',
    floor: 'A high-traffic aisle feels fine. Its real upside is invisible on a spreadsheet.',
    hyperspace: 'Profit Radar ranks opportunities by \u20ac impact and proposes the exact merchandising fix.',
    outcome: '\u20ac2,400 / wk recoverable',
    component: 'Profit Radar',
    stage: (a) => { a.setViewMode('profitRadar'); a.selectRadarZone() },
    dim: 'none',
  },
  {
    id: 'funnel',
    time: '16:30',
    period: 'Afternoon',
    rung: 'DECIDE',
    title: 'Where the journey leaks',
    floor: 'Sales are \u201ca bit soft\u201d today. No one can point to where shoppers drop off.',
    hyperspace: 'The conversion funnel pinpoints the ENGAGE \u2192 BASKET leak and the friction zone causing it.',
    outcome: '-11% at ENGAGE \u2192 BASKET',
    component: 'Conversion Funnel \u00b7 Intent Field',
    stage: (a) => { a.setViewMode('main'); a.setNeuralEnabled(true) },
    seekPct: 0.72,
  },
  {
    id: 'narrator',
    time: '18:00',
    period: 'Evening',
    rung: 'RECOMMEND',
    title: '\u201cWhat should I improve tomorrow?\u201d',
    floor: 'A manager wants answers, not dashboards \u2014 in plain language, ranked by what matters.',
    hyperspace: 'Narrator answers in plain English with a ranked action plan, each step linked to the proof.',
    outcome: '5 actions, ranked by \u20ac',
    component: 'AI Narrator',
    stage: (a) => { a.setViewMode('main'); a.openNarrator() },
    dim: 'tight',
  },
  {
    id: 'review',
    time: '20:00',
    period: 'Evening',
    rung: 'REMEMBER',
    title: 'The store replays its own day',
    floor: 'The team goes home. Today\u2019s wins and misses usually walk out the door with them.',
    hyperspace: 'Every key moment was saved as a replayable episode \u2014 queue spikes, promo wins, friction points. The store hands back a ready-to-watch day, and tomorrow\u2019s plan writes itself.',
    outcome: 'a full day \u2192 a ranked plan',
    component: 'End-of-Day Debrief',
    stage: (a) => { a.setViewMode('dailyDebrief') },
    dim: 'tight',
  },
]
