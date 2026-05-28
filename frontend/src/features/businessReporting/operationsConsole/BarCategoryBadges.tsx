import { getCategoryVisual } from './categoryVisuals';
import type { TimelineCategoryLeader } from './types';

interface BarCategoryBadgesProps {
  categories: TimelineCategoryLeader[];
  max?: number;
}

export default function BarCategoryBadges({ categories, max = 3 }: BarCategoryBadgesProps) {
  if (!categories.length) return null;

  return (
    <div className="flex items-center justify-center gap-0.5 mb-1 min-h-[16px]">
      {categories.slice(0, max).map(cat => {
        const { Icon, color, bg } = getCategoryVisual(cat.category);
        return (
          <span
            key={cat.category}
            title={`${cat.category} · ${cat.visits.toLocaleString()} visits`}
            className="inline-flex items-center justify-center rounded-full w-4 h-4 shrink-0 ring-1 ring-white/10"
            style={{ backgroundColor: bg }}
          >
            <Icon className="w-2.5 h-2.5" style={{ color }} strokeWidth={2.25} />
          </span>
        );
      })}
    </div>
  );
}
