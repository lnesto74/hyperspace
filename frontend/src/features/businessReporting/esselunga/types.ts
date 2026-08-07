export type ExecutiveVariant = 'live' | 'hq';

export interface MetricThresholds {
  dwellSec: number;
  engagementSec: number;
  minVisitMs: number;
  source: 'venue_default' | 'preview';
}

export interface TimelinePoint {
  label: string;
  value: number;
}

export interface ActivityTimeline {
  grain: 'hour' | 'day';
  visitors: TimelinePoint[];
  dwells: TimelinePoint[];
  /** Calendar day in venue TZ (YYYY-MM-DD) for hourly "today" chart */
  dateKey?: string;
  timeZone?: string;
  throughHour?: number | null;
  throughHourLabel?: string | null;
}

export interface ActivityTimelineSet {
  hourly: ActivityTimeline;
  daily: ActivityTimeline;
}

export interface HeatmapCategoryRow {
  category: string;
  zoneCount: number;
  roiIds?: string[];
  totalVisits: number;
  totalDwellMin?: number;
  browsingRate: number;
  engagementRate: number;
  conversionRate: number;
  avgBrowseTimeMin: number;
  avgBrowseTimeSec?: number;
}

export interface JourneySignals {
  reconciliationRequired: boolean;
  ingress: {
    visitors: number;
    gateEstimated?: number;
    recovered: number;
  };
  shopping: {
    aisleZoneVisits: number;
    dwellVisits: number;
    stoppingPct: number;
    /** Of the crossings that happened, the share that did not stop. */
    passThroughPct?: number;
    /** Esselunga's definition: 100 - penetration. Null when penetration is unmeasurable. */
    bypassPct: number | null;
  };
  checkout: {
    sessionsCompleted: number;
    totalSessions: number;
    avgWaitMin: number;
    abandonPct: number;
    laneCount: number;
  };
}

export interface FrescoDepartment {
  id: string;
  label: string;
  visits: number;
  dwellVisits?: number;
  uniqueVisitors: number;
  avgDwellMin: number;
  avgDwellSec?: number;
  stoppingPct?: number;
  passThroughPct?: number;
  hasQueueZones?: boolean;
  browsingPct: number;
  waitingPct: number;
  abandonPct: number;
  serviceEfficiency: number | null;
  roiIds: string[];
}

/** A single till. Queue and service zones of the same checkout are one lane. */
export interface CheckoutLane {
  id: string;
  label: string;
  sessions: number;
  completed?: number;
  avgWaitMin: number;
  avgWaitSec?: number;
  abandonPct: number;
  currentQueue: number;
  roiIds: string[];
}

export interface CheckoutChannel {
  id: string;
  label: string;
  sessions: number;
  completed?: number;
  avgWaitMin: number;
  avgWaitSec?: number;
  abandonPct: number;
  currentQueue: number;
  roiIds: string[];
  lanes?: CheckoutLane[];
}

export interface AisleCategoryGroup {
  category: string;
  visits: number;
  uniqueVisitors: number;
  stoppingPowerPct: number;
  avgDwellMin: number;
  avgDwellSec?: number;
  roiCount: number;
}

export interface AisleRow {
  id: string;
  name: string;
  category: string;
  visits: number;
  stoppingPowerPct: number;
  avgDwellMin: number;
  avgDwellSec?: number;
}

export interface ExecutiveInsight {
  id: string;
  severity: 'good' | 'warn' | 'bad' | 'info';
  title: string;
  message: string;
  action: string;
  section: string;
}

/** The same window one week earlier, so headline numbers can carry a direction. */
export interface ExecutiveComparison {
  label: string;
  range: { startTs: number; endTs: number };
  /** False when the comparison window predates a change in how the data is measured. */
  comparable: boolean;
  caveat: string;
  entrants: number;
  totalVisitors: number;
  shoppingDwellMin: number;
  shoppingDwellReliable: boolean;
  stoppingPowerPct: number;
  penetrationPct: number | null;
  checkoutCompleted: number;
  avgWaitMin: number;
  avgTicket: number | null;
  spi: number | null;
}

/**
 * Resolved on the server, including the deltas, so the tab and the PDF render
 * the same numbers rather than each deriving their own.
 */
export interface HeadlineKpi {
  id: string;
  label: string;
  value: number | null;
  display: string;
  hint: string;
  previous: number | null;
  higherIsBetter: boolean;
  deltaPct: number | null;
  /** Set when the delta was withheld rather than simply unavailable. */
  noCompareReason?: string | null;
  direction: 'up' | 'down' | 'flat';
  /** Whether the movement is good news — a longer queue is a bigger number and a worse store. */
  good: boolean | null;
}

export interface ExecutiveHeadline {
  tone: 'good' | 'warn' | 'bad' | 'info';
  text: string;
}

export interface EsselungaJourneyPayload {
  variant: ExecutiveVariant;
  venueId: string;
  range: { startTs: number; endTs: number };
  generatedAt: number;
  metricThresholds?: MetricThresholds;
  storeHours?: {
    openingHour: number;
    closingHour: number;
    hoursLabel: string;
  };
  activityTimeline?: ActivityTimeline;
  activityTimelines?: ActivityTimelineSet;
  heatmapCategories?: HeatmapCategoryRow[];
  taxonomy: {
    totalRois: number;
    fresco: number;
    aisles: number;
    checkout: number;
    ingress: number;
  };
  overview: {
    totalVisitors: number;
    perimeterEntrants?: number;
    perimeterUniqueTracks?: number;
    perimeterMethod?: string;
    ingressEpisodes?: number;
    ingressUnique?: number;
    ingressRecovered?: number;
    ingressDirectEstimated?: number;
    footfallRecoveryPct?: number;
    footfallMethod?: string;
    avgStoreDwellMin: number;
    medianStoreDwellMin?: number;
    dwellP25Min?: number;
    dwellP75Min?: number;
    avgStoreDwellReliable?: boolean;
    dwellSessionCount?: number;
    sessionAnalyticsMethod?: string;
    stitchedEntranceSessions?: number;
    currentOccupancy: number;
    currentOccupancySource?: 'live_frame' | 'track_positions' | 'recent_visits';
    avgTicket: number | null;
    spi: number | null;
    spiSource: string;
  };
  fresco: { departments: FrescoDepartment[] };
  aisles: {
    penetrationPct: number | null;
    aisleDwellUnique?: number;
    aisleReachReliable?: boolean;
    dwellVisits?: number;
    stoppingPowerPct: number;
    /** Of the crossings that happened, the share that did not stop. */
    passThroughPct?: number;
    /** Esselunga's definition: 100 - penetration. Null when penetration is unmeasurable. */
    bypassPct: number | null;
    totalAisleVisits: number;
  /** Shelf zones with no category in the mapper, so the split understates them. */
  untaggedZones?: number;
  taggedZones?: number;
    aisleConversionPct: number | null;
    categoryGroups?: AisleCategoryGroup[];
    topAisles: AisleRow[];
  };
  checkout: {
    channels: CheckoutChannel[];
    avgWaitMin: number;
    avgWaitSec?: number;
    completed?: number;
    frictionScore: number | null;
  };
  journeySignals?: JourneySignals;
  crossKpis: {
    spi: number | null;
    spiSource: string;
    shoppingEfficiency: number | null;
    checkoutFrictionScore: number | null;
    avgTicket: number | null;
    totalRevenue: number | null;
    mediaCes: number;
    mediaEal: number;
  };
  media: { ces: number; eal: number };
  erp: {
    hasData: boolean;
    lastUpload: string | null;
    rowCount: number;
    byCategory: Array<{ category: string; revenue: number; transactions: number }>;
  };
  insights: ExecutiveInsight[];
  comparison?: ExecutiveComparison | null;
  headlineKpis?: HeadlineKpi[];
  headline?: ExecutiveHeadline;
  hqSummary?: {
    headline: string;
    topInsights: ExecutiveInsight[];
    kpis: Record<string, number | null>;
  };
}
