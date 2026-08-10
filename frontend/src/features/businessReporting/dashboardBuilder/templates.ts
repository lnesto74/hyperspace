import type { DashboardLayout, WidgetId } from './types';

function item(widgetId: WidgetId, colSpan: 3 | 4 | 6 | 8 | 12, rowSpan: 1 | 2 | 3) {
  return {
    instanceId: `${widgetId}-${Math.random().toString(36).slice(2, 8)}`,
    widgetId,
    colSpan,
    rowSpan,
  };
}

export const DASHBOARD_TEMPLATES: Omit<DashboardLayout, 'updatedAt'>[] = [
  {
    id: 'tpl-store-director',
    name: 'Store Director',
    items: [
      item('exec-header-headline', 12, 1),
      item('floor-visual-toggle', 12, 3),
      item('activity-timeline-chart', 6, 2),
      item('exec-action-insights', 6, 2),
      item('aisle-stat-stack', 12, 1),
      item('checkout-panel', 6, 2),
      item('category-visits-panel', 6, 2),
    ],
  },
  {
    id: 'tpl-ops-day',
    name: 'Ops day board',
    items: [
      item('ops-hero-kpi-strip', 12, 1),
      item('ops-store-activity-chart', 12, 2),
      item('ops-footfall-by-hour', 8, 2),
      item('ops-alerts-panel', 4, 2),
      item('category-visits-panel', 6, 2),
      item('zone-performance-map', 6, 2),
    ],
  },
  {
    id: 'tpl-hybrid',
    name: 'Hybrid (ops + flow)',
    items: [
      item('ops-hero-kpi-strip', 12, 1),
      item('floor-visual-toggle', 12, 3),
      item('activity-timeline-chart', 6, 2),
      item('exec-action-insights', 6, 2),
      item('campaign-ranking-table', 6, 2),
      item('media-ring-gauges', 6, 1),
    ],
  },
  {
    id: 'tpl-blank',
    name: 'Blank',
    items: [],
  },
];

export function cloneTemplate(templateId: string): DashboardLayout | null {
  const tpl = DASHBOARD_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return null;
  return {
    id: `dash-${Date.now().toString(36)}`,
    name: tpl.name === 'Blank' ? 'My dashboard' : `${tpl.name}`,
    updatedAt: Date.now(),
    items: tpl.items.map((it) => ({
      ...it,
      instanceId: `${it.widgetId}-${Math.random().toString(36).slice(2, 8)}`,
    })),
  };
}
