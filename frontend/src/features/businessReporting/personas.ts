/**
 * Business Reporting Persona Configuration
 * 
 * Single source of truth for persona dashboards, KPI definitions, and UI copy.
 * MAX 7 KPIs per persona (hard cap enforced at runtime).
 */

export const MAX_KPIS_PER_PERSONA = 7;

export type KpiFormat = 'percent' | 'seconds' | 'minutes' | 'int' | 'float' | 'score' | 'currency';

export interface KpiThresholds {
  good: number;
  warn: number;
  bad: number;
  /** 'lower' = lower is better (e.g., wait time), 'higher' = higher is better (e.g., conversion rate) */
  direction: 'lower' | 'higher';
}

export interface KpiTileDefinition {
  id: string;
  title: string;
  unit?: string;
  format: KpiFormat;
  meaning: string;       // <= 90 chars, what it means
  action: string;        // <= 90 chars, what to do
  tooltip: string;       // <= 160 chars, how computed
  thresholds?: KpiThresholds;
}

export interface PersonaConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  maxKpis: number;
  kpis: KpiTileDefinition[];
}

// ============================================
// PERSONA A: Store Manager - Operations Pulse
// ============================================
const storeManagerKpis: KpiTileDefinition[] = [
  {
    id: 'avgWaitingTimeMin',
    title: 'Avg Wait Time',
    unit: 'min',
    format: 'minutes',
    meaning: 'Average time shoppers wait before being served.',
    action: 'Open a lane or reassign staff if this rises.',
    tooltip: 'Measured from queue entry to service start for completed visits.',
    thresholds: { good: 2, warn: 5, bad: 10, direction: 'lower' },
  },
  {
    id: 'abandonRate',
    title: 'Abandon Rate',
    unit: '%',
    format: 'percent',
    meaning: 'Share of shoppers who leave the queue without checkout.',
    action: 'Reduce wait time or open another lane.',
    tooltip: 'Count of queue exits without service divided by total queue entrants.',
    thresholds: { good: 5, warn: 15, bad: 25, direction: 'lower' },
  },
  {
    id: 'currentQueueLength',
    title: 'Queue Length',
    unit: 'people',
    format: 'int',
    meaning: 'Number of shoppers currently waiting in line.',
    action: 'Call for backup if queue exceeds comfortable levels.',
    tooltip: 'Live count of people in queue zones right now.',
    thresholds: { good: 3, warn: 8, bad: 15, direction: 'lower' },
  },
  {
    id: 'peakOccupancy',
    title: 'Peak Occupancy',
    unit: 'people',
    format: 'int',
    meaning: 'Maximum number of people in the store at once.',
    action: 'Plan staffing around peak hours.',
    tooltip: 'Highest simultaneous occupancy recorded in selected time range.',
    thresholds: { good: 50, warn: 80, bad: 100, direction: 'lower' },
  },
  {
    id: 'avgOccupancy',
    title: 'Avg Occupancy',
    unit: 'people',
    format: 'float',
    meaning: 'Average number of shoppers in store at any moment.',
    action: 'Compare to targets to assess foot traffic health.',
    tooltip: 'Mean occupancy across all time intervals in selected range.',
  },
  {
    id: 'utilizationRate',
    title: 'Space Utilization',
    unit: '%',
    format: 'percent',
    meaning: 'How much of store time/space is actively used by shoppers.',
    action: 'Fix dead zones or redesign layouts to improve usage.',
    tooltip: 'Occupied time divided by open time across target areas.',
    thresholds: { good: 70, warn: 40, bad: 20, direction: 'higher' },
  },
  {
    id: 'deadZonesCount',
    title: 'Dead Zones',
    unit: 'zones',
    format: 'int',
    meaning: 'Number of areas with very low shopper activity.',
    action: 'Relocate products or add signage to activate these areas.',
    tooltip: 'Count of zones with utilization below 10% in selected range.',
    thresholds: { good: 0, warn: 2, bad: 5, direction: 'lower' },
  },
];

// ============================================
// PERSONA B: Merchandising - Shelf & Category
// ============================================
const merchandisingKpis: KpiTileDefinition[] = [
  {
    id: 'browsingRate',
    title: 'Browsing Rate',
    unit: '%',
    format: 'percent',
    meaning: 'Percentage of visitors who stopped to browse shelves.',
    action: 'Improve shelf displays if browsing is low.',
    tooltip: 'Visitors who dwelled at shelf divided by total shelf zone visitors.',
    thresholds: { good: 60, warn: 40, bad: 20, direction: 'higher' },
  },
  {
    id: 'avgBrowseTime',
    title: 'Avg Browse Time',
    unit: 'sec',
    format: 'seconds',
    meaning: 'Average time shoppers spend looking at products.',
    action: 'Longer browse time often leads to higher conversion.',
    tooltip: 'Mean dwell duration for visitors who engaged with shelves.',
    thresholds: { good: 30, warn: 15, bad: 5, direction: 'higher' },
  },
  {
    id: 'passbyCount',
    title: 'Pass-by Traffic',
    unit: 'people',
    format: 'int',
    meaning: 'Shoppers who walked past without stopping.',
    action: 'Test new displays or signage to capture attention.',
    tooltip: 'Visitors minus those who dwelled at shelf zones.',
  },
  {
    id: 'categoryEngagementRate',
    title: 'Category Engagement',
    unit: '%',
    format: 'percent',
    meaning: 'How often shoppers engage with the selected category.',
    action: 'Boost low-engagement categories with promotions.',
    tooltip: 'Engagements in category shelves divided by category zone visits.',
    thresholds: { good: 50, warn: 30, bad: 15, direction: 'higher' },
  },
  {
    id: 'categoryConversionRate',
    title: 'Category Conversion',
    unit: '%',
    format: 'percent',
    meaning: 'Rate at which category browsers convert to buyers.',
    action: 'Investigate pricing or availability if conversion is low.',
    tooltip: 'Purchases in category divided by category engagements.',
    thresholds: { good: 25, warn: 15, bad: 5, direction: 'higher' },
  },
  {
    id: 'brandEfficiencyIndex',
    title: 'Brand Efficiency',
    unit: 'index',
    format: 'float',
    meaning: 'Are brands getting fair engagement vs shelf space?',
    action: 'Reallocate shelf space if index is below 1.0.',
    tooltip: 'Engagement share divided by shelf share. Above 1 = over-performing.',
    thresholds: { good: 1.2, warn: 0.8, bad: 0.5, direction: 'higher' },
  },
  {
    id: 'skuPositionScoreAvg',
    title: 'Avg Position Score',
    unit: 'score',
    format: 'score',
    meaning: 'Quality of product placement across shelves.',
    action: 'Move low-score products to better shelf positions.',
    tooltip: 'Average position score (0-100) based on eye-level and prominence.',
    thresholds: { good: 70, warn: 50, bad: 30, direction: 'higher' },
  },
];

// ============================================
// PERSONA C: Retail Media - PEBLE™ Effectiveness
// ============================================
const retailMediaKpis: KpiTileDefinition[] = [
  {
    id: 'eal',
    title: 'Exposure Lift (EAL)',
    unit: '%',
    format: 'percent',
    meaning: 'Incremental lift in shelf visits after screen exposure.',
    action: 'Increase budget on screens with high lift.',
    tooltip: 'Relative difference between exposed and matched control groups.',
    thresholds: { good: 20, warn: 10, bad: 0, direction: 'higher' },
  },
  {
    id: 'ces',
    title: 'Campaign Score (CES)',
    unit: 'score',
    format: 'score',
    meaning: 'Overall campaign effectiveness combining lift, speed, and quality.',
    action: 'Use to rank campaigns and justify pricing.',
    tooltip: 'Composite score from PEBLE metrics weighted by confidence.',
    thresholds: { good: 70, warn: 50, bad: 30, direction: 'higher' },
  },
  {
    id: 'aqs',
    title: 'Attention Quality (AQS)',
    unit: 'score',
    format: 'score',
    meaning: 'How focused was viewer attention on the screen?',
    action: 'Optimize screen placement if AQS is low.',
    tooltip: 'Composite of dwell, proximity, orientation, slowdown, and stability.',
    thresholds: { good: 70, warn: 40, bad: 20, direction: 'higher' },
  },
  {
    id: 'aar',
    title: 'Attention-to-Action (AAR)',
    unit: '%',
    format: 'percent',
    meaning: 'Rate at which quality exposures lead to conversions.',
    action: 'High AAR = effective creative. Low = revisit messaging.',
    tooltip: 'Conversions divided by qualified exposures (AQS >= 40).',
    thresholds: { good: 15, warn: 8, bad: 3, direction: 'higher' },
  },
  {
    id: 'ttaSec',
    title: 'Time-to-Action',
    unit: 'sec',
    format: 'seconds',
    meaning: 'How quickly do exposed shoppers act?',
    action: 'Faster action = stronger ad impact.',
    tooltip: 'Median seconds from exposure end to target engagement.',
    thresholds: { good: 60, warn: 120, bad: 300, direction: 'lower' },
  },
  {
    id: 'dci',
    title: 'Direction Change (DCI)',
    unit: 'index',
    format: 'float',
    meaning: 'Did shoppers change direction toward target after exposure?',
    action: 'Positive DCI indicates ad influenced path.',
    tooltip: 'Change in trajectory alignment toward target shelf. Range -1 to +1.',
    thresholds: { good: 0.3, warn: 0.1, bad: -0.1, direction: 'higher' },
  },
  {
    id: 'confidencePct',
    title: 'Confidence',
    unit: '%',
    format: 'percent',
    meaning: 'Statistical confidence in the attribution results.',
    action: 'Wait for more data if confidence is low.',
    tooltip: 'Based on control match quality and sample size.',
    thresholds: { good: 80, warn: 60, bad: 40, direction: 'higher' },
  },
];

// ============================================
// PERSONA D: C-Level - Executive Summary
// ============================================
const executiveKpis: KpiTileDefinition[] = [
  {
    id: 'totalVisitors',
    title: 'Total Visitors',
    unit: 'people',
    format: 'int',
    meaning: 'Unique visitors in the store during this period.',
    action: 'Track trends to measure marketing impact.',
    tooltip: 'Count of distinct track_keys in zone_visits.',
    thresholds: { good: 1000, warn: 500, bad: 100, direction: 'higher' },
  },
  {
    id: 'engagementRate',
    title: 'Engagement Rate',
    unit: '%',
    format: 'percent',
    meaning: 'Percentage of visitors who engaged with products.',
    action: 'Improve displays to boost engagement.',
    tooltip: 'Engagements divided by unique visitors.',
    thresholds: { good: 50, warn: 30, bad: 10, direction: 'higher' },
  },
  {
    id: 'avgWaitingTimeMin',
    title: 'Avg Wait Time',
    unit: 'min',
    format: 'minutes',
    meaning: 'Average checkout queue wait time.',
    action: 'High wait times hurt customer satisfaction.',
    tooltip: 'Mean wait from queue entry to service start.',
    thresholds: { good: 2, warn: 5, bad: 10, direction: 'lower' },
  },
  {
    id: 'abandonRate',
    title: 'Abandon Rate',
    unit: '%',
    format: 'percent',
    meaning: 'Shoppers who left without completing purchase.',
    action: 'Each abandonment is lost revenue.',
    tooltip: 'Queue exits without service divided by queue entries.',
    thresholds: { good: 5, warn: 15, bad: 25, direction: 'lower' },
  },
  {
    id: 'ces',
    title: 'Ad Effectiveness (CES)',
    unit: 'score',
    format: 'score',
    meaning: 'How well are in-store ads driving behavior?',
    action: 'Use to evaluate retail media ROI.',
    tooltip: 'Average Campaign Effectiveness Score across active campaigns.',
    thresholds: { good: 70, warn: 50, bad: 30, direction: 'higher' },
  },
  {
    id: 'eal',
    title: 'Ad Lift (EAL)',
    unit: '%',
    format: 'percent',
    meaning: 'Incremental visits driven by in-store advertising.',
    action: 'Demonstrates DOOH value to brand partners.',
    tooltip: 'Average Exposure Attribution Lift across campaigns.',
    thresholds: { good: 20, warn: 10, bad: 0, direction: 'higher' },
  },
  {
    id: 'utilizationRate',
    title: 'Space Utilization',
    unit: '%',
    format: 'percent',
    meaning: 'Percentage of store space being actively used.',
    action: 'Low utilization = opportunity for layout optimization.',
    tooltip: 'Occupied time divided by open hours across all zones.',
    thresholds: { good: 70, warn: 40, bad: 20, direction: 'higher' },
  },
];

// ============================================
// PERSONA REGISTRY
// ============================================
export const PERSONAS: PersonaConfig[] = [
  {
    id: 'store-manager',
    name: 'Operations Pulse',
    description: 'Real-time store operations for managers on the floor.',
    icon: 'Store',
    color: '#22c55e',
    maxKpis: MAX_KPIS_PER_PERSONA,
    kpis: storeManagerKpis,
  },
  {
    id: 'merchandising',
    name: 'Shelf & Category Performance',
    description: 'Product placement and category insights for merchandising teams.',
    icon: 'ShoppingBag',
    color: '#f59e0b',
    maxKpis: MAX_KPIS_PER_PERSONA,
    kpis: merchandisingKpis,
  },
  {
    id: 'retail-media',
    name: 'PEBLE™ Effectiveness',
    description: 'In-store media performance and attribution for retail media teams.',
    icon: 'Monitor',
    color: '#8b5cf6',
    maxKpis: MAX_KPIS_PER_PERSONA,
    kpis: retailMediaKpis,
  },
  {
    id: 'executive',
    name: 'Executive Summary',
    description: 'High-level business metrics for leadership review.',
    icon: 'TrendingUp',
    color: '#3b82f6',
    maxKpis: MAX_KPIS_PER_PERSONA,
    kpis: executiveKpis,
  },
];

/**
 * Get persona by ID
 */
export function getPersonaById(id: string): PersonaConfig | undefined {
  return PERSONAS.find(p => p.id === id);
}

/**
 * Enforce KPI cap - throws in dev, truncates in prod
 */
export function enforceKpiCap(persona: PersonaConfig): KpiTileDefinition[] {
  if (persona.kpis.length > MAX_KPIS_PER_PERSONA) {
    if (import.meta.env.DEV) {
      console.error(
        `[BusinessReporting] Persona "${persona.id}" has ${persona.kpis.length} KPIs, exceeding cap of ${MAX_KPIS_PER_PERSONA}`
      );
    }
    return persona.kpis.slice(0, MAX_KPIS_PER_PERSONA);
  }
  return persona.kpis;
}

/**
 * All valid persona IDs
 */
export const VALID_PERSONA_IDS = PERSONAS.map(p => p.id);
