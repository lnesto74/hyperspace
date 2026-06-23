import type { ProfitRadarInsight } from '../../types'
import { patternLabel, shortTitle, valueScore } from './pulseUtils'

interface Props {
  insights: ProfitRadarInsight[]
  activeId: string | null
  onSelect: (insight: ProfitRadarInsight) => void
  className?: string
}

export default function PulseInsightQueue({ insights, activeId, onSelect, className = '' }: Props) {
  if (insights.length === 0) return null

  return (
    <div className={`flex flex-col overflow-hidden ${className}`}>
      <div className="px-3 py-2 border-b border-gray-800/60">
        <span className="text-[8px] uppercase tracking-[0.25em] text-gray-600">signals</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {insights.slice(0, 6).map((ins, idx) => {
          const active = ins.id === activeId
          const roi = ins.dataBasis?.roiId ? '●' : '○'
          return (
            <button
              key={ins.id}
              type="button"
              onClick={() => onSelect(ins)}
              className={`w-full text-left px-3 py-2 border-l-2 transition-colors ${
                active ? 'border-cyan-400 bg-cyan-500/5' : 'border-transparent hover:bg-gray-800/40'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[9px] font-mono text-gray-600">{String(idx + 1).padStart(2, '0')}</span>
                <span className="text-[8px] text-gray-500">{roi}</span>
                <span className="text-[8px] text-cyan-600/80 ml-auto tabular-nums">
                  {(valueScore(ins) * 100).toFixed(0)}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 leading-snug line-clamp-2 font-mono">
                {shortTitle(ins.title, 32)}
              </p>
              <p className="text-[8px] text-gray-600 mt-0.5 truncate">
                {patternLabel(ins).toLowerCase()}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
