import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

export interface CategoryRankingRow {
  category: string
  zoneCount: number
  roiIds?: string[]
  totalVisits: number
  totalDwellMin?: number
  browsingRate: number
  engagementRate: number
  conversionRate: number
  avgBrowseTimeMin: number
}

interface CategoryRankingPanelProps {
  categories: CategoryRankingRow[]
  selectedCategoryId?: string
  onSelectCategory?: (categoryId: string) => void
}

function RateBadge({ value, suffix = '%' }: { value: number; suffix?: string }) {
  const color =
    value >= 5 ? 'text-green-400' : value >= 1 ? 'text-amber-400' : 'text-red-400'
  const Icon = value >= 5 ? TrendingUp : value >= 1 ? Minus : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 ${color}`}>
      <Icon className="w-3 h-3" />
      {value.toFixed(1)}{suffix}
    </span>
  )
}

export default function CategoryRankingPanel({
  categories,
  selectedCategoryId,
  onSelectCategory,
}: CategoryRankingPanelProps) {
  if (!categories.length) {
    return (
      <div className="text-sm text-gray-400 py-4">
        No category performance data yet. Map product categories to shelves in DWG or Smart KPI.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 border-b border-gray-700">
            <th className="pb-2 pr-3 font-medium">#</th>
            <th className="pb-2 pr-3 font-medium">Category</th>
            <th className="pb-2 pr-3 font-medium text-right">Zones</th>
            <th className="pb-2 pr-3 font-medium text-right">Visits</th>
            <th className="pb-2 pr-3 font-medium text-right">Browsing</th>
            <th className="pb-2 pr-3 font-medium text-right">Engagement</th>
            <th className="pb-2 pr-3 font-medium text-right">Conversion</th>
            <th className="pb-2 font-medium text-right">Avg browse</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((row, index) => {
            const isSelected = selectedCategoryId === row.category
            return (
              <tr
                key={row.category}
                onClick={() => onSelectCategory?.(row.category)}
                className={`border-b border-gray-800/80 transition-colors ${
                  onSelectCategory ? 'cursor-pointer hover:bg-gray-700/40' : ''
                } ${isSelected ? 'bg-amber-500/10' : ''}`}
              >
                <td className="py-2.5 pr-3 text-gray-400">{index + 1}</td>
                <td className="py-2.5 pr-3">
                  <span
                    className="inline-block rounded-full px-2.5 py-1 text-xs font-semibold truncate max-w-[220px]"
                    style={{
                      color: '#fcd34d',
                      backgroundColor: '#fcd34d18',
                      border: '1px solid #fcd34d44',
                    }}
                  >
                    {row.category}
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-right text-gray-300">{row.zoneCount}</td>
                <td className="py-2.5 pr-3 text-right text-gray-300">{row.totalVisits}</td>
                <td className="py-2.5 pr-3 text-right"><RateBadge value={row.browsingRate} /></td>
                <td className="py-2.5 pr-3 text-right"><RateBadge value={row.engagementRate} /></td>
                <td className="py-2.5 pr-3 text-right"><RateBadge value={row.conversionRate} /></td>
                <td className="py-2.5 text-right text-gray-300">{row.avgBrowseTimeMin.toFixed(1)}m</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
