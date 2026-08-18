import { getWidget } from './registry';
import type { DashboardLayout } from './types';

export type CustomBoardPersonaId = 'store-manager' | 'executive' | 'esselunga-executive';

/** Widgets that need the Executive Summary payload (not covered by the journey). */
const EXECUTIVE_WIDGETS = new Set([
  'exec-store-health-pillars',
  'exec-highlight-chips',
  'zone-performance-map',
  'campaign-ranking-table',
  'peble-screen-campaign-map',
  'reporting-kpi-strip',
  'reporting-insights-panel',
]);

/**
 * Custom boards used to always fetch Ops + Executive + Esselunga. Store Director
 * only needs the journey; the extra two reports are what made 7d time out.
 */
export function personasNeededForLayout(
  layout: DashboardLayout | null | undefined,
): CustomBoardPersonaId[] {
  const needed = new Set<CustomBoardPersonaId>();
  let needsCategoryBars = false;
  for (const item of layout?.items || []) {
    const def = getWidget(item.widgetId);
    if (def.needsJourney) needed.add('esselunga-executive');
    if (def.needsOps) needed.add('store-manager');
    if (EXECUTIVE_WIDGETS.has(item.widgetId)) needed.add('executive');
    if (item.widgetId === 'category-visits-panel') needsCategoryBars = true;
  }
  // Category bars read journey.heatmapCategories, or Ops/Exec topCategories.
  // Don't add a third report just for that tile.
  if (needsCategoryBars && !needed.has('esselunga-executive')
    && !needed.has('executive') && !needed.has('store-manager')) {
    needed.add('esselunga-executive');
  }
  return [...needed];
}

export function sourcesKeyForLayout(layout: DashboardLayout | null | undefined): string {
  return personasNeededForLayout(layout).slice().sort().join(',');
}
