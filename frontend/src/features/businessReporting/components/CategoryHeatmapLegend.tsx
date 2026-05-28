import { getCategoryVisual } from '../operationsConsole/categoryVisuals';
import type { CategoryRankingRow } from './CategoryRankingPanel';

interface CategoryHeatmapLegendProps {
  categories: CategoryRankingRow[];
  highlightCategory?: string | null;
  maxItems?: number;
}

export default function CategoryHeatmapLegend({
  categories,
  highlightCategory = null,
  maxItems = 8,
}: CategoryHeatmapLegendProps) {
  const items = categories
    .filter(c => (c.roiIds?.length ?? 0) > 0 && c.category !== 'Uncategorized')
    .slice(0, maxItems);

  if (!items.length) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-2 border-t border-gray-700/50">
      {items.map(row => {
        const { Icon, color } = getCategoryVisual(row.category);
        const active = highlightCategory === row.category;
        return (
          <div
            key={row.category}
            className={`inline-flex items-center gap-1.5 text-[9px] transition-opacity ${
              highlightCategory && !active ? 'opacity-40' : 'opacity-100'
            } ${active ? 'ring-1 ring-white/30 rounded-full px-1.5 py-0.5 bg-white/5' : ''}`}
          >
            <Icon className="w-3 h-3 shrink-0" style={{ color }} strokeWidth={2.25} />
            <span className="text-gray-300 truncate max-w-[88px]">{row.category}</span>
          </div>
        );
      })}
    </div>
  );
}
