export interface BenchmarkBarItem {
  label: string
  /** 0..1 */
  value: number
  /** 0..1 — store-average reference marker */
  benchmark?: number
  tone?: 'bad' | 'good' | 'neutral'
}

const TONE: Record<NonNullable<BenchmarkBarItem['tone']>, string> = {
  bad: '#f87171',
  good: '#4ade80',
  neutral: '#60a5fa',
}

/** Horizontal metric bars with a store-average benchmark tick. Custom SVG-free. */
export default function BenchmarkBars({ items }: { items: BenchmarkBarItem[] }) {
  return (
    <div className="space-y-2.5">
      {items.map(item => {
        const pct = Math.max(0, Math.min(1, item.value)) * 100
        const color = TONE[item.tone ?? 'neutral']
        return (
          <div key={item.label}>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-gray-400">{item.label}</span>
              <span className="font-medium tabular-nums" style={{ color }}>{pct.toFixed(0)}%</span>
            </div>
            <div className="relative h-2 rounded-full bg-gray-800 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
              {typeof item.benchmark === 'number' && (
                <div
                  className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-gray-300/70"
                  style={{ left: `${Math.max(0, Math.min(1, item.benchmark)) * 100}%` }}
                  title={`Store avg ${(item.benchmark * 100).toFixed(0)}%`}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
