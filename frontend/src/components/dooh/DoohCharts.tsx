import { Eye, Zap, TrendingUp } from 'lucide-react'

export function ProgressRing({ value, max = 100, size = 60, color = '#3b82f6' }: {
  value: number; max?: number; size?: number; color?: string
}) {
  const r = (size - 6) / 2, c = r * 2 * Math.PI, o = c - (Math.min(value / max, 1)) * c
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#374151" strokeWidth={6} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={c} strokeDashoffset={o} strokeLinecap="round" />
    </svg>
  )
}

export function TierCard({ tier, count, total, color, icon: Icon }: {
  tier: string; count: number; total: number; color: string; icon: any
}) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex items-center gap-4">
      <div className="relative">
        <ProgressRing value={pct} color={color} size={70} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-white">{Math.round(pct)}%</span>
        </div>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
          <Icon className="w-4 h-4" style={{ color }} />
          <span>{tier}</span>
        </div>
        <div className="text-2xl font-bold text-white">{count}</div>
        <div className="text-xs text-gray-500">of {total} total</div>
      </div>
    </div>
  )
}

interface BucketData {
  bucketStartTs: number
  impressions: number
  qualifiedImpressions: number
  premiumImpressions: number
}

export function ImpressionsChart({ buckets, height = 140 }: { buckets: BucketData[]; height?: number }) {
  if (!buckets?.length) return <div className="text-gray-500 text-xs text-center py-8">No data</div>
  const sorted = [...buckets].sort((a, b) => a.bucketStartTs - b.bucketStartTs).slice(-24)
  const h = height - 30
  const max = Math.max(...sorted.map(b => b.impressions), 1)
  const fmt = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-0.5" style={{ height: h }}>
        {sorted.map((b, i) => {
          const total = (b.impressions / max) * h
          const qual = (b.qualifiedImpressions / max) * h
          const prem = (b.premiumImpressions / max) * h
          return (
            <div key={i} className="flex-1 flex flex-col items-center group relative">
              <div className="w-full flex flex-col-reverse">
                <div className="w-full bg-gray-500" style={{ height: Math.max(total - qual, 0) }} />
                <div className="w-full bg-yellow-500" style={{ height: Math.max(qual - prem, 0) }} />
                <div className="w-full bg-green-500 rounded-t" style={{ height: Math.max(prem, 0) }} />
              </div>
              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-white whitespace-nowrap z-10">
                <div>Total: <b>{b.impressions}</b></div>
                <div className="text-yellow-400">Qualified: {b.qualifiedImpressions}</div>
                <div className="text-green-400">Premium: {b.premiumImpressions}</div>
                <div className="text-gray-400 mt-1">{fmt(b.bucketStartTs)}</div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[9px] text-gray-500">
        <span>{fmt(sorted[0].bucketStartTs)}</span>
        {sorted.length > 2 && <span>{fmt(sorted[Math.floor(sorted.length / 2)].bucketStartTs)}</span>}
        <span>{fmt(sorted[sorted.length - 1].bucketStartTs)}</span>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-gray-400 justify-center">
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-gray-500 rounded" /><span>Basic</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-yellow-500 rounded" /><span>Qualified</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-green-500 rounded" /><span>Premium</span></div>
      </div>
    </div>
  )
}

export function AqsGauge({ value, size = 100 }: { value: number; size?: number }) {
  const color = value >= 70 ? '#22c55e' : value >= 40 ? '#eab308' : '#6b7280'
  return (
    <div className="relative inline-flex items-center justify-center">
      <ProgressRing value={value} max={100} size={size} color={color} />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-white">{value.toFixed(1)}</span>
        <span className="text-[10px] text-gray-400">AQS</span>
      </div>
    </div>
  )
}

export function AqsHistogram({ buckets }: { buckets: { avgAqs: number | null }[] }) {
  const bins = Array(10).fill(0)
  buckets.forEach(b => {
    if (b.avgAqs != null) bins[Math.min(Math.floor(b.avgAqs / 10), 9)]++
  })
  const max = Math.max(...bins, 1)
  return (
    <div className="space-y-1">
      <div className="flex items-end gap-1 h-16">
        {bins.map((count, i) => {
          const h = (count / max) * 60
          const color = i >= 7 ? '#22c55e' : i >= 4 ? '#eab308' : '#6b7280'
          return (
            <div key={i} className="flex-1 flex flex-col items-center">
              <div className="w-full rounded-t" style={{ height: Math.max(h, 2), backgroundColor: color }} />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[8px] text-gray-500">
        <span>0</span><span>50</span><span>100</span>
      </div>
    </div>
  )
}
