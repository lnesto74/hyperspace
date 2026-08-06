import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

export interface CampaignRankingRow {
  id: string
  name: string
  ces: number
  eal: number
  aar: number
  exposures: number
  confidence: number
}

interface CampaignRankingPanelProps {
  campaigns: CampaignRankingRow[]
  selectedCampaignId?: string
  onSelectCampaign?: (campaignId: string) => void
}

function ScoreBadge({ value, suffix = '' }: { value: number; suffix?: string }) {
  const color =
    value >= 50 ? 'text-green-400' : value >= 20 ? 'text-amber-400' : 'text-red-400'
  const Icon = value >= 50 ? TrendingUp : value >= 20 ? Minus : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 ${color}`}>
      <Icon className="w-3 h-3" />
      {value.toFixed(1)}{suffix}
    </span>
  )
}

export default function CampaignRankingPanel({
  campaigns,
  selectedCampaignId,
  onSelectCampaign,
}: CampaignRankingPanelProps) {
  if (!campaigns.length) {
    return (
      <div className="text-sm text-gray-400 py-4">
        No campaign performance data in this period. Check DOOH campaigns and PEBLE attribution buckets.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 border-b border-gray-700">
            <th className="pb-2 pr-3 font-medium">#</th>
            <th className="pb-2 pr-3 font-medium">Campaign</th>
            <th className="pb-2 pr-3 font-medium text-right">CES</th>
            <th className="pb-2 pr-3 font-medium text-right">EAL</th>
            <th className="pb-2 pr-3 font-medium text-right">AAR</th>
            <th className="pb-2 pr-3 font-medium text-right">Exposures</th>
            <th className="pb-2 font-medium text-right">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((row, index) => {
            const isSelected = selectedCampaignId === row.id
            return (
              <tr
                key={row.id}
                onClick={() => onSelectCampaign?.(row.id)}
                className={`border-b border-gray-800/80 transition-colors ${
                  onSelectCampaign ? 'cursor-pointer hover:bg-gray-700/40' : ''
                } ${isSelected ? 'bg-purple-500/10' : ''}`}
              >
                <td className="py-2.5 pr-3 text-gray-400">{index + 1}</td>
                <td className="py-2.5 pr-3">
                  <span
                    className="inline-block rounded-full px-2.5 py-1 text-xs font-semibold truncate max-w-[220px]"
                    style={{
                      color: '#c4b5fd',
                      backgroundColor: '#8b5cf618',
                      border: '1px solid #8b5cf644',
                    }}
                  >
                    {row.name}
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-right"><ScoreBadge value={row.ces} /></td>
                <td className="py-2.5 pr-3 text-right"><ScoreBadge value={row.eal} suffix="%" /></td>
                <td className="py-2.5 pr-3 text-right"><ScoreBadge value={row.aar} suffix="%" /></td>
                <td className="py-2.5 pr-3 text-right text-gray-300">{row.exposures.toLocaleString()}</td>
                <td className="py-2.5 text-right text-gray-300">{row.confidence.toFixed(1)}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
