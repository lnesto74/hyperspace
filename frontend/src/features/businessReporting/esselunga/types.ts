export type ExecutiveVariant = 'live' | 'hq';

export type JourneyTab = 'overview' | 'fresco' | 'aisles' | 'checkout' | 'media';

export interface FrescoDepartment {
  id: string;
  label: string;
  visits: number;
  uniqueVisitors: number;
  avgDwellMin: number;
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
  taxonomy: {
    totalRois: number;
    fresco: number;
    aisles: number;
    checkout: number;
    ingress: number;
  };
  overview: {
    totalVisitors: number;
    ingressEpisodes?: number;
    ingressUnique?: number;
    avgStoreDwellMin: number;
    currentOccupancy: number;
    avgTicket: number | null;
    spi: number | null;
    spiSource: string;
  };
  fresco: { departments: FrescoDepartment[] };
  aisles: {
    penetrationPct: number;
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
    frictionScore: number | null;
  };
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
