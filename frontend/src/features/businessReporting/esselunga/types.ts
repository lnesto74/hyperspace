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
    bypassPct: number;
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

export interface CheckoutChannel {
  id: string;
  label: string;
  sessions: number;
  completed?: number;
  avgWaitMin: number;
  abandonPct: number;
  currentQueue: number;
  roiIds: string[];
}

export interface AisleCategoryGroup {
  category: string;
  visits: number;
  uniqueVisitors: number;
  stoppingPowerPct: number;
  avgDwellMin: number;
  roiCount: number;
}

export interface AisleRow {
  id: string;
  name: string;
  category: string;
  visits: number;
  stoppingPowerPct: number;
  avgDwellMin: number;
}

export interface ExecutiveInsight {
  id: string;
  severity: 'good' | 'warn' | 'bad' | 'info';
  title: string;
  message: string;
  action: string;
  section: string;
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
    bypassPct: number;
    totalAisleVisits: number;
    aisleConversionPct: number | null;
    categoryGroups?: AisleCategoryGroup[];
    topAisles: AisleRow[];
  };
  checkout: {
    channels: CheckoutChannel[];
    avgWaitMin: number;
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
  hqSummary?: {
    headline: string;
    topInsights: ExecutiveInsight[];
    kpis: Record<string, number | null>;
  };
}
