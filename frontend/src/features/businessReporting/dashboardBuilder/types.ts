/** Stable widget ids for the custom dashboard builder registry. */
export type WidgetId =
  | 'ops-hero-kpi-strip'
  | 'ops-alerts-panel'
  | 'reporting-kpi-strip'
  | 'reporting-insights-panel'
  | 'exec-store-health-pillars'
  | 'exec-highlight-chips'
  | 'category-visits-panel'
  | 'zone-performance-map'
  | 'peble-screen-campaign-map'
  | 'campaign-ranking-table'
  | 'exec-header-headline'
  | 'exec-action-insights'
  | 'activity-timeline-chart'
  | 'floor-visual-toggle'
  | 'journey-signals-panel'
  | 'fresco-department-cards'
  | 'aisle-stat-stack'
  | 'checkout-panel'
  | 'media-ring-gauges';

export type WidgetKind = 'kpi' | 'chart' | 'map' | 'table' | 'insight';

export type WidgetSource =
  | 'Operations Pulse'
  | 'Shelf & Category'
  | 'PEBLE'
  | 'Executive Summary'
  | 'Esselunga Executive';

/** Grid span in a 12-column layout. */
export interface WidgetSize {
  colSpan: 3 | 4 | 6 | 8 | 12;
  /** Approximate row height units (1 ≈ 140px). */
  rowSpan: 1 | 2 | 3;
}

export interface DashboardItem {
  instanceId: string;
  widgetId: WidgetId;
  colSpan: WidgetSize['colSpan'];
  rowSpan: WidgetSize['rowSpan'];
}

export interface DashboardLayout {
  id: string;
  name: string;
  updatedAt: number;
  items: DashboardItem[];
}

export interface WidgetDefinition {
  id: WidgetId;
  name: string;
  description: string;
  kind: WidgetKind;
  sources: WidgetSource[];
  defaultSize: WidgetSize;
  /** Counts toward the max-two-maps rule. */
  isMap?: boolean;
  /** Needs Esselunga journey payload. */
  needsJourney?: boolean;
  /** Needs operations console payload. */
  needsOps?: boolean;
  superadminOnly?: boolean;
}

export const CUSTOM_DASHBOARD_PERSONA = 'custom-dashboard';

export const MAX_MAP_TILES = 2;
