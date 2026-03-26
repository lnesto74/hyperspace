/**
 * LiveMetricsPanel - Q1 of Neural Dashboard
 * 
 * Monospace metrics display matching neural cortex style.
 * Shows real-time venue KPIs with glowing accents.
 */

import { useState, useEffect, useRef } from 'react'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'

interface LiveMetricsPanelProps {
  totalPax: number
  peakOccupancy: number
  activeZones: number
  avgOccupancy: number
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
  avgOccupancy 
}: LiveMetricsPanelProps) {
  const { venue } = useVenue()
  const [checkoutMetrics, setCheckoutMetrics] = useState<CheckoutMetrics | null>(null)
  const [throughput, setThroughput] = useState(0)
  const prevPaxRef = useRef(totalPax)
  const entriesRef = useRef(0)
  
  // Track entries over time
  useEffect(() => {
    if (totalPax > prevPaxRef.current) {
      entriesRef.current += totalPax - prevPaxRef.current
    }
    prevPaxRef.current = totalPax
  }, [totalPax])

  // Fetch checkout metrics (stop polling after 404 to prevent spam)
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
          // Endpoint doesn't exist for this venue - stop polling
          checkoutDisabledRef.current = true
        }
      } catch (err) {
        // Silent fail
      }
    }
    
    fetchCheckout()
    const interval = setInterval(fetchCheckout, 5000)
    return () => clearInterval(interval)
  }, [venue?.id])

  return (
    <div className="h-full flex flex-col p-4 font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[rgba(255,255,255,0.06)]">
        <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
        <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500">VENUE STATUS</span>
      </div>
      
      {/* Main Metric */}
      <div className="mb-6">
        <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">LIVE OCCUPANCY</div>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold text-white tabular-nums" style={{ textShadow: '0 0 20px rgba(59,130,246,0.3)' }}>
            {totalPax}
          </span>
          <span className="text-gray-500">PAX</span>
        </div>
      </div>
      
      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 flex-1">
        <MetricRow label="PEAK" value={peakOccupancy} />
        <MetricRow label="ENTRIES" value={entriesRef.current} />
        <MetricRow label="ZONES" value={activeZones} suffix="active" />
        <MetricRow label="AVG/ZONE" value={avgOccupancy.toFixed(1)} />
        
        {checkoutMetrics && (
          <>
            <div className="col-span-2 border-t border-[rgba(255,255,255,0.04)] pt-2 mt-1">
              <div className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">CHECKOUT</div>
            </div>
            <MetricRow 
              label="LANES" 
              value={`${checkoutMetrics.openLanes}/${checkoutMetrics.totalLanes}`} 
            />
            <MetricRow 
              label="WAIT" 
              value={formatTime(checkoutMetrics.avgWaitSec)} 
            />
            <MetricRow label="QUEUE" value={checkoutMetrics.queuePressure.toFixed(1)} suffix="/lane" />
            <MetricRow label="THRU" value={throughput} suffix="/hr" />
          </>
        )}
      </div>
      
      {/* Footer timestamp */}
      <div className="mt-auto pt-3 border-t border-[rgba(255,255,255,0.04)]">
        <div className="text-[10px] text-gray-600 tabular-nums">
          {new Date().toLocaleTimeString('en-US', { hour12: false })}
        </div>
      </div>
    </div>
  )
}

function MetricRow({ 
  label, 
  value, 
  suffix, 
  color = 'text-white' 
}: { 
  label: string
  value: string | number
  suffix?: string
  color?: string 
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] text-gray-600 uppercase tracking-wider">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className={`text-lg font-semibold tabular-nums ${color}`}>{value}</span>
        {suffix && <span className="text-[10px] text-gray-600">{suffix}</span>}
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
