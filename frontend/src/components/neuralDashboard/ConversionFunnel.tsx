/**
 * ConversionFunnel — Animated engagement funnel for the Neural Dashboard
 * 
 * Stages: ENTRY → SHOP → ENGAGE → BASKET → CHECKOUT
 * Each bar animates width on data change. Shows drop% between stages.
 * Neural style: monospace, dark bg, minimal accent colors.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'
import AnimatedNumber from './AnimatedNumber'

interface FunnelStage {
  id: string
  label: string
  count: number
  dropPct: number
  pctOfEntry: number
}

interface FunnelData {
  stages: FunnelStage[]
  biggestLeak: { from: string; to: string; dropPct: number; lost: number } | null
  range: string
}

const STAGE_COLORS = [
  'rgba(0, 255, 136, 0.8)',   // ENTRY — green
  'rgba(0, 200, 255, 0.7)',   // SHOP — cyan
  'rgba(100, 140, 255, 0.7)', // ENGAGE — blue
  'rgba(180, 100, 255, 0.7)', // BASKET — purple
  'rgba(255, 180, 50, 0.8)',  // CHECKOUT — amber
]

export default function ConversionFunnel({ batchFunnel }: { batchFunnel?: FunnelData | null }) {
  const { venue } = useVenue()
  const [data, setData] = useState<FunnelData | null>(null)
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('1h')
  const [animatedWidths, setAnimatedWidths] = useState<number[]>([])
  const prevDataRef = useRef<FunnelData | null>(null)

  // Use batch data if available
  useEffect(() => {
    if (batchFunnel) setData(batchFunnel)
  }, [batchFunnel])

  const fetchFunnel = useCallback(async () => {
    if (!venue?.id || batchFunnel) return
    try {
      const res = await fetch(`${API_BASE}/api/neural/funnel?venueId=${venue.id}&range=${range}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (e) {
      // silent
    }
  }, [venue?.id, range, batchFunnel])

  useEffect(() => {
    if (batchFunnel) return
    fetchFunnel()
    const interval = setInterval(fetchFunnel, 10000)
    return () => clearInterval(interval)
  }, [fetchFunnel, batchFunnel])

  // Animate widths when data changes
  useEffect(() => {
    if (!data?.stages) return
    // Start from 0 or previous values
    const prev = prevDataRef.current?.stages?.map(s => s.pctOfEntry) || data.stages.map(() => 0)
    setAnimatedWidths(prev)

    // Animate to target
    const timer = setTimeout(() => {
      setAnimatedWidths(data.stages.map(s => s.pctOfEntry))
    }, 50)

    prevDataRef.current = data
    return () => clearTimeout(timer)
  }, [data])

  return (
    <div className="h-full flex flex-col p-3 font-mono text-[10px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-white/60 tracking-wider uppercase">
          Engagement Funnel
        </div>
        <div className="flex gap-1">
          {(['1h', '24h', '7d'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                range === r 
                  ? 'bg-white/10 text-white' 
                  : 'text-white/30 hover:text-white/50'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Funnel bars */}
      <div className="flex-1 flex flex-col justify-center gap-1.5">
        {data?.stages?.map((stage, i) => (
          <div key={stage.id} className="flex items-center gap-2">
            {/* Label */}
            <div className="w-[52px] text-right text-white/40 text-[9px] shrink-0">
              {stage.label}
            </div>

            {/* Bar container */}
            <div className="flex-1 h-[18px] bg-white/[0.03] rounded-sm relative overflow-hidden">
              {/* Animated bar */}
              <div
                className="h-full rounded-sm relative"
                style={{
                  width: `${Math.max(animatedWidths[i] || 0, 2)}%`,
                  background: STAGE_COLORS[i],
                  transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: `0 0 8px ${STAGE_COLORS[i].replace('0.7', '0.3').replace('0.8', '0.3')}`,
                }}
              >
                {/* Count inside bar */}
                {stage.count > 0 && (
                  <AnimatedNumber
                    value={stage.count}
                    duration={800}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-black/70 font-bold"
                  />
                )}
              </div>
            </div>

            {/* Drop % */}
            <div className="w-[36px] text-right shrink-0">
              {i > 0 && stage.dropPct > 0 ? (
                <span className="text-red-400/70 text-[9px]">-{stage.dropPct}%</span>
              ) : i === 0 ? (
                <span className="text-white/20 text-[9px]">100%</span>
              ) : (
                <span className="text-white/20 text-[9px]">—</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Biggest leak insight */}
      {data?.biggestLeak && data.biggestLeak.lost > 0 && (
        <div className="mt-2 pt-2 border-t border-white/[0.04]">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-red-400/60 animate-pulse" />
            <span className="text-white/40 text-[9px]">
              Biggest leak: {data.biggestLeak.from} → {data.biggestLeak.to}{' '}
              <span className="text-red-400/70">({data.biggestLeak.lost} lost, -{data.biggestLeak.dropPct}%)</span>
            </span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {(!data || data.stages?.[0]?.count === 0) && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-white/20 text-[10px]">No funnel data for this period</span>
        </div>
      )}
    </div>
  )
}
