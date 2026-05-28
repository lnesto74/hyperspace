import { useMemo, useState } from 'react';
import CategoryVisitsPanel from './CategoryVisitsPanel';
import CategoryHeatmapLegend from './CategoryHeatmapLegend';
import HeatmapEmbedPreview from '../../../components/heatmap/HeatmapEmbedPreview';
import type { CategoryRankingRow } from './CategoryRankingPanel';

type MetricMode = 'visits' | 'dwell';

interface CategoryTrafficSectionProps {
  categories: CategoryRankingRow[];
  venueId: string;
  heatmapTimeframe: 'day' | 'week' | 'month';
  onOpenCategoryHeatmap?: (row: CategoryRankingRow) => void;
  compact?: boolean;
}

export default function CategoryTrafficSection({
  categories,
  venueId,
  heatmapTimeframe,
  onOpenCategoryHeatmap,
  compact = true,
}: CategoryTrafficSectionProps) {
  const [metric, setMetric] = useState<MetricMode>('visits');
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const [lockedCategory, setLockedCategory] = useState<string | null>(null);

  const highlightCategory = lockedCategory ?? hoveredCategory;

  const lockedRow = useMemo(
    () => categories.find(c => c.category === lockedCategory),
    [categories, lockedCategory],
  );

  const handleSelectCategory = (row: CategoryRankingRow) => {
    if (lockedCategory === row.category) {
      setLockedCategory(null);
    } else {
      setLockedCategory(row.category);
    }
  };

  const handleExpand = () => {
    if (lockedRow && onOpenCategoryHeatmap) {
      onOpenCategoryHeatmap(lockedRow);
      return;
    }
    const fallback = categories.find(c => (c.roiIds?.length ?? 0) > 0);
    if (fallback && onOpenCategoryHeatmap) onOpenCategoryHeatmap(fallback);
  };

  return (
    <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700/60 flex items-center justify-between gap-2">
        <div>
          <span className="text-xs font-medium text-white">Category Traffic</span>
          <span className="text-[10px] text-gray-500 ml-2">Surgelati · Frutta · Verdura · …</span>
        </div>
        <span className="text-[10px] text-gray-500 shrink-0 hidden sm:inline">
          hover row → highlight · click → lock · expand → full heatmap
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-0 xl:divide-x divide-gray-700/60">
        <div className="xl:col-span-2 p-3">
          <CategoryVisitsPanel
            categories={categories}
            compact={compact}
            metric={metric}
            onMetricChange={setMetric}
            highlightCategory={highlightCategory}
            hoveredCategory={hoveredCategory}
            lockedCategory={lockedCategory}
            onHoverCategory={setHoveredCategory}
            onSelectCategory={handleSelectCategory}
            onOpenHeatmap={onOpenCategoryHeatmap}
            embedded
          />
        </div>

        <div className="xl:col-span-3 p-3 flex flex-col min-h-[280px] border-t xl:border-t-0 border-gray-700/60">
          <HeatmapEmbedPreview
            venueId={venueId}
            categories={categories}
            timeframe={heatmapTimeframe}
            metric={metric}
            highlightCategory={highlightCategory}
            onExpand={handleExpand}
          />
          <CategoryHeatmapLegend
            categories={categories}
            highlightCategory={highlightCategory}
          />
        </div>
      </div>
    </div>
  );
}
