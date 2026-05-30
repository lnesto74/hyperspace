/**
 * LiveMetricsPanel - Metrics Tower for the Neural Dashboard
 * 
 * Vertical stack of animated KPIs: occupancy hero number, sparkline,
 * velocity/dwell/draw/bounce, top zones bar chart, checkout status.
 * All live-polled from /api/neural/venue-kpis + real-time props.
 * Neural style: monospace, dark bg, minimal accent colors.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'
import AnimatedNumber from './AnimatedNumber'
import Tooltip from './Tooltip'

interface LiveMetricsPanelProps {
  totalPax: number
  peakOccupancy: number
  activeZones: number
  avgOccupancy: number
  batchKpis?: any | null
}

interface VenueKpis {
  avgVelocity: number
  avgDwellSec: number
  drawRate: number
  bounceRate: number
  uniqueVisitors: number
  visitorSource?: 'entrance' | 'none'
  topZones: { name: string; peak: number; avg: number }[]
  sparkline: number[]
}

interface CheckoutMetrics {
  openLanes: number
  totalLanes: number
  avgWaitSec: number
  queuePressure: number
}

export default function LiveMetricsPanel({ 
  totalPax, 
  peakOccupancy, 
  activeZones,
  avgOccupancy,
  batchKpis,
}: LiveMetricsPanelProps) {
  const { venue } = useVenue()
  const [kpis, setKpis] = useState<VenueKpis | null>(null)
  const [checkoutMetrics, setCheckoutMetrics] = useState<CheckoutMetrics | null>(null)
  const [throughput, setThroughput] = useState(0)
  const [, setTick] = useState(0)

  // Use batch data if available, otherwise fall back to individual polling
  useEffect(() => {
    if (batchKpis) setKpis(batchKpis)
  }, [batchKpis])

  const fetchKpis = useCallback(async () => {
    if (!venue?.id || batchKpis) return
    try {
      const res = await fetch(`${API_BASE}/api/neural/venue-kpis?venueId=${venue.id}`)
      if (res.ok) setKpis(await res.json())
    } catch (e) { /* silent */ }
  }, [venue?.id, batchKpis])

  useEffect(() => {
    if (batchKpis) return
    fetchKpis()
    const interval = setInterval(fetchKpis, 8000)
    return () => clearInterval(interval)
  }, [fetchKpis, batchKpis])

  // Fetch checkout metrics (stop polling after 404) — kept separate (lightweight)
  const checkoutDisabledRef = useRef(false)
  useEffect(() => {
    if (!venue?.id) return
    const fetchCheckout = async () => {
      if (checkoutDisabledRef.current) return
      try {
        const res = await fetch(`${API_BASE}/api/venues/${venue.id}/checkout/status`)
        if (res.ok) {
          const data = await res.json()
          setCheckoutMetrics({
            openLanes: data.lanes?.filter((l: any) => l.status === 'OPEN').length || 0,
            totalLanes: data.lanes?.length || 0,
            avgWaitSec: data.lanes?.reduce((sum: number, l: any) => sum + (l.avgWaitTimeSec || 0), 0) / (data.lanes?.length || 1),
            queuePressure: data.pressure?.avgQueuePerLane || 0,
          })
          setThroughput(data.kpi?.throughputPerHour || 0)
        } else if (res.status === 404) {
          checkoutDisabledRef.current = true
        }
      } catch (err) { /* silent */ }
    }
    fetchCheckout()
    const interval = setInterval(fetchCheckout, 10000)
    return () => clearInterval(interval)
  }, [venue?.id])

  // Tick for timestamp — reduced to every 5s instead of 1s
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const sparkMax = kpis ? Math.max(...kpis.sparkline, 1) : 1
  const zoneMax = kpis?.topZones?.length ? Math.max(...kpis.topZones.map(z => z.avg), 1) : 1

  const visitorTip = kpis?.visitorSource === 'none'
    ? 'No entrance/footfall zone configured — set footfall ROI in Venue Settings'
    : 'Distinct entrants through entrance zones (visit ≥30s or ≥5s non-bounce), last hour'

  return (
    <div className="h-full flex flex-col p-3 font-mono text-[10px] overflow-y-auto neural-scrollbar">
      {/* ── HEADER ── */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/[0.06]">
        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_rgba(34,211,238,0.5)]" />
        <span className="text-[9px] uppercase tracking-[0.2em] text-white/50">Metrics Tower</span>
        <span className="ml-auto text-[9px] text-white/40 tabular-nums">
          {new Date().toLocaleTimeString('en-US', { hour12: false })}
        </span>
      </div>

      {/* ── HERO: OCCUPANCY ── */}
      <div className="mb-3">
        <Tooltip text="People currently detected inside the venue">
          <div className="text-white/50 text-[8px] uppercase tracking-wider mb-0.5 cursor-help">Live Occupancy</div>
        </Tooltip>
        <div className="flex items-baseline gap-1.5">
          <AnimatedNumber
            value={totalPax}
            duration={800}
            className="text-3xl font-bold text-white tabular-nums"
          />
          <span className="text-white/50 text-[9px]">pax</span>
        </div>
      </div>

      {/* ── SPARKLINE ── */}
      {kpis && kpis.sparkline.length > 0 && (
        <div className="mb-3 pb-2 border-b border-white/[0.04]">
          <Tooltip text="Occupancy trend over the last hour (5-min buckets)">
            <div className="text-white/50 text-[8px] mb-1 cursor-help">OCCUPANCY · 1h</div>
          </Tooltip>
          <div className="flex items-end gap-[2px] h-[24px]">
            {kpis.sparkline.map((v, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm transition-all duration-500"
                style={{
                  height: `${Math.max(2, (v / sparkMax) * 100)}%`,
                  background: i === kpis.sparkline.length - 1
                    ? 'rgba(34,211,238,0.6)'
                    : `rgba(100,180,255,${0.15 + (v / sparkMax) * 0.35})`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── KPI GRID ── */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-3 pb-2 border-b border-white/[0.04]">
        <TowerMetric label="PEAK" value={peakOccupancy} tip="Highest simultaneous occupancy this session" />
        <TowerMetric
          label="ENTRANTS"
          value={kpis?.uniqueVisitors ?? '—'}
          suffix={kpis ? '/ 1h' : undefined}
          tip={visitorTip}
        />
        <TowerMetric label="ZONES" value={activeZones} suffix="active" tip="Zones with at least 1 person detected" />
        <TowerMetric label="AVG/ZONE" value={avgOccupancy.toFixed(1)} tip="Average people per zone across all regions" />
      </div>

      {/* ── BEHAVIOR ── */}
      {kpis && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-3 pb-2 border-b border-white/[0.04]">
          <div className="col-span-2 text-white/50 text-[8px] uppercase tracking-wider">Behavior</div>
          <TowerMetric label="VELOCITY" value={kpis.avgVelocity} suffix="m/s" color={kpis.avgVelocity > 0.5 ? 'text-cyan-400/70' : 'text-white'} tip="Average walking speed of all tracked people" />
          <TowerMetric label="AVG DWELL" value={formatTime(kpis.avgDwellSec)} color={kpis.avgDwellSec > 30 ? 'text-green-400/70' : 'text-white'} tip="Average time visitors spend inside zones" />
          <TowerMetric label="DRAW" value={kpis.drawRate} suffix="%" color={kpis.drawRate > 30 ? 'text-green-400/70' : 'text-amber-400/60'} tip="% of passers-by who stop and engage in a zone" />
          <TowerMetric label="BOUNCE" value={kpis.bounceRate} suffix="%" color={kpis.bounceRate > 50 ? 'text-red-400/70' : 'text-white'} tip="% of visitors who leave a zone in under 5 seconds" />
        </div>
      )}

      {/* ── TOP ZONES ── */}
      {kpis && kpis.topZones.length > 0 && (
        <div className="mb-3 pb-2 border-b border-white/[0.04]">
          <Tooltip text="Top 5 zones by average occupancy (last 5 min)">
            <div className="text-white/50 text-[8px] uppercase tracking-wider mb-1.5 cursor-help">Hot Zones</div>
          </Tooltip>
          <div className="space-y-1">
            {kpis.topZones.map((z, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-white/60 text-[8px] w-[70px] truncate">{z.name}</span>
                <div className="flex-1 h-[4px] rounded-full bg-white/[0.04] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${(z.avg / zoneMax) * 100}%`,
                      background: i === 0 ? 'rgba(255,100,80,0.6)' : i === 1 ? 'rgba(255,180,50,0.5)' : 'rgba(100,180,255,0.4)',
                    }}
                  />
                </div>
                <span className="text-white/50 text-[8px] w-[16px] text-right tabular-nums">{z.peak}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CHECKOUT ── */}
      {checkoutMetrics && (
        <div className="mb-2">
          <div className="text-white/50 text-[8px] uppercase tracking-wider mb-1.5">Checkout</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <TowerMetric label="LANES" value={`${checkoutMetrics.openLanes}/${checkoutMetrics.totalLanes}`} />
            <TowerMetric label="WAIT" value={formatTime(checkoutMetrics.avgWaitSec)} />
            <TowerMetric label="QUEUE" value={checkoutMetrics.queuePressure.toFixed(1)} suffix="/lane" />
            <TowerMetric label="THRU" value={throughput} suffix="/hr" />
          </div>
        </div>
      )}

      <style>{`
        .neural-scrollbar::-webkit-scrollbar { width: 3px; }
        .neural-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .neural-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 2px; }
      `}</style>
    </div>
  )
}

function TowerMetric({ label, value, suffix, color = 'text-white', tip }: {
  label: string; value: string | number; suffix?: string; color?: string; tip?: string
}) {
  const isNumber = typeof value === 'number' || (typeof value === 'string' && /^\d+\.?\d*$/.test(value))
  const numDecimals = typeof value === 'string' && value.includes('.') ? value.split('.')[1]?.length || 0 : 0
  const inner = (
    <div className={`flex flex-col ${tip ? 'cursor-help' : ''}`}>
      <span className="text-[8px] text-white/50 uppercase tracking-wider">{label}</span>
      <div className="flex items-baseline gap-0.5">
        {isNumber ? (
          <AnimatedNumber
            value={parseFloat(String(value))}
            decimals={numDecimals}
            duration={600}
            className={`text-[14px] font-semibold tabular-nums ${color}`}
          />
        ) : (
          <span className={`text-[14px] font-semibold tabular-nums ${color}`}>{value}</span>
        )}
        {suffix && <span className="text-[8px] text-white/45">{suffix}</span>}
      </div>
    </div>
  )
  if (tip) return <Tooltip text={tip}>{inner}</Tooltip>
  return inner
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
