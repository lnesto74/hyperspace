export type TimelineGrain = 'hour' | 'day' | 'week';

export interface TimelinePoint {
  label: string;
  bucketStartTs: number;
  value: number;
  isOpen: boolean;
  peak?: number;
  avgVal?: number;
}

export interface OperationsTimeline {
  grain: TimelineGrain;
  visitors: TimelinePoint[];
  occupancy: TimelinePoint[];
  visitorSource?: 'ingress' | 'queue_proxy' | 'none';
}

export interface StoreHoursInfo {
  openingHour: number;
  closingHour: number;
  footfallRoiId: string | null;
  footfallZoneName: string | null;
  savedFootfallRoiId?: string | null;
}

export interface OpsDataHealth {
  dbWritable: true;
  ingressRecording: boolean;
  ingressVisitCount: number;
  visitorSource: 'ingress' | 'queue_proxy' | 'none';
  savedFootfallRoiId: string | null;
  message?: string;
}

export interface FootfallHourRow {
  hour: string;
  visits: number;
  isOpen: boolean;
}

export interface FootfallSummary {
  configured: boolean;
  footfallRoiId?: string;
  footfallZoneName?: string | null;
  dataSource?: string;
  ingressRecording?: boolean;
  warning?: string | null;
  openingHour: number;
  closingHour: number;
  hoursLabel: string;
  openHoursPerDay: number;
  totalVisitsOpenHours: number;
  avgVisitsPerOpenHour: number;
  peakOpenHour: string | null;
  peakOpenHourVisits: number;
  visitsByHour: FootfallHourRow[];
}

export interface QueueLaneRow {
  id: string;
  name: string;
  sessions: number;
  avgWaitMin: number;
  abandonPct: number;
  completed: number;
  abandoned: number;
  currentQueue: number;
}

export interface OpsAlert {
  id: string;
  severity: 'info' | 'warn' | 'bad';
  title: string;
  message: string;
  metric?: string;
  value?: number;
  laneId?: string;
}

export interface PeriodDeltas {
  visitorsDeltaPct: number | null;
  visitsDeltaPct: number | null;
  engagementDeltaPct: number | null;
  previousPeriodStartTs: number;
  previousPeriodEndTs: number;
}

export interface StoreActivityHourRow {
  hour: string;
  avgOccupancy: number;
  isOpen: boolean;
}

export interface OperationsConsoleData {
  grain: TimelineGrain;
  storeHours: StoreHoursInfo;
  timeline: OperationsTimeline;
  footfall: FootfallSummary;
  storeActivityByHour?: StoreActivityHourRow[];
  queueLanes: QueueLaneRow[];
  alerts: OpsAlert[];
  dataHealth: OpsDataHealth;
  shopperMetricSource?: 'perception_frames' | 'zone_snapshots';
  secondaryKpiIds: string[];
  heroKpiIds: string[];
  dataWindowStartTs: number;
  dataWindowEndTs: number;
}

export type DrillDownView = 'traffic' | 'checkout' | 'occupancy' | 'lane' | null;
