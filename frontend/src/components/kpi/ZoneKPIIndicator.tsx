import { useState, useEffect, useRef, useMemo } from 'react'
import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react'
import { useTracking } from '../../context/TrackingContext'
import { useRoi } from '../../context/RoiContext'

// Point-in-polygon test using ray casting
const isPointInPolygon = (x: number, z: number, vertices: { x: number; z: number }[]): boolean => {
  if (vertices.length < 3) return false
  let inside = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, zi = vertices[i].z
    const xj = vertices[j].x, zj = vertices[j].z
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

interface ZoneKPIIndicatorProps {
  roiId: string
  roiName: string
  roiColor: string
  onClick?: () => void
}

interface LiveKPIData {
  currentOccupancy: number
  peakOccupancy: number
  avgOccupancy: number
  totalEntries: number
  dwellRate: number
  previousOccupancy?: number
  avgWaitingTime?: number // Average waiting time in minutes for queue zones
}

interface CircularGaugeProps {
  value: number
  maxValue?: number
  size?: number
  strokeWidth?: number
  color?: string
  showPercent?: boolean
}

function CircularGauge(props: CircularGaugeProps) {
  const { 
    value, 
    maxValue = 100, 
    size = 50, 
    strokeWidth = 5,
    color = '#22c55e',
    showPercent = true,
  } = props
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const percentage = Math.min((value / maxValue) * 100, 100)
  const offset = circumference - (percentage / 100) * circumference
  
  // Color based on percentage thresholds
  const getColor = () => {
    if (color !== '#22c55e') return color
    if (percentage >= 80) return '#ef4444' // red
    if (percentage >= 60) return '#f97316' // orange
    if (percentage >= 40) return '#eab308' // yellow
    return '#22c55e' // green
  }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#374151"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold text-white">
          {showPercent ? `${Math.round(percentage)}%` : value}
        </span>
      </div>
    </div>
  )
}

function TrendArrow({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous
  const percentChange = previous > 0 ? ((diff / previous) * 100).toFixed(0) : '0'
  
  if (diff > 0) {
    return (
      <div className="flex flex-col items-center">
        <ArrowUp className="w-4 h-4 text-green-400" />
        <span className="text-[10px] text-green-400">+{percentChange}%</span>
      </div>
    )
  } else if (diff < 0) {
    return (
      <div className="flex flex-col items-center">
        <ArrowDown className="w-4 h-4 text-red-400" />
        <span className="text-[10px] text-red-400">{percentChange}%</span>
      </div>
    )
  }
  
  return (
    <div className="flex flex-col items-center">
      <ArrowRight className="w-4 h-4 text-gray-400" />
      <span className="text-[10px] text-gray-400">0%</span>
    </div>
  )
}

export default function ZoneKPIIndicator({ roiId, roiName, roiColor, onClick }: ZoneKPIIndicatorProps) {
  const { tracks } = useTracking()
  const { regions } = useRoi()
  const [baseKpiData, setBaseKpiData] = useState<LiveKPIData | null>(null)
  const previousOccupancyRef = useRef(0)
  const peakOccupancyRef = useRef(0)
  const totalEntriesRef = useRef(0)
  const lastTracksInZoneRef = useRef<Set<string>>(new Set())
  const isMountedRef = useRef(true)

  // Get the ROI vertices for this zone
  const roiVertices = useMemo(() => {
    const roi = regions.find(r => r.id === roiId)
    return roi?.vertices || []
  }, [regions, roiId])

  // Compute LIVE occupancy from current tracks using point-in-polygon
  const liveOccupancy = useMemo(() => {
    if (roiVertices.length < 3) return 0
    
    let count = 0
    const currentTracksInZone = new Set<string>()
    
    tracks.forEach((track, trackKey) => {
      const pos = track.venuePosition
      if (isPointInPolygon(pos.x, pos.z, roiVertices)) {
        count++
        currentTracksInZone.add(trackKey)
      }
    })
    
    // Track entries (new tracks entering zone)
    currentTracksInZone.forEach(tk => {
      if (!lastTracksInZoneRef.current.has(tk)) {
        totalEntriesRef.current++
      }
    })
    lastTracksInZoneRef.current = currentTracksInZone
    
    // Update peak
    if (count > peakOccupancyRef.current) {
      peakOccupancyRef.current = count
    }
    
    return count
  }, [tracks, roiVertices])

  // Track entry times for waiting time calculation (client-side, no polling)
  const trackEntryTimesRef = useRef<Map<string, number>>(new Map())
  
  // Calculate waiting time from tracks (same approach as occupancy - no API calls)
  const avgWaitingTime = useMemo(() => {
    if (roiVertices.length < 3) return 0
    
    const now = Date.now()
    const currentEntryTimes = new Map<string, number>()
    let totalWaitMs = 0
    let count = 0
    
    tracks.forEach((track, trackKey) => {
      const pos = track.venuePosition
      if (isPointInPolygon(pos.x, pos.z, roiVertices)) {
        // Track is in zone - check if we have an entry time
        const existingEntry = trackEntryTimesRef.current.get(trackKey)
        if (existingEntry) {
          currentEntryTimes.set(trackKey, existingEntry)
          totalWaitMs += now - existingEntry
        } else {
          // New entry - record current time
          currentEntryTimes.set(trackKey, now)
        }
        count++
      }
    })
    
    // Update ref with current entry times
    trackEntryTimesRef.current = currentEntryTimes
    
    // Return average in minutes
    return count > 0 ? (totalWaitMs / count) / 60000 : 0
  }, [tracks, roiVertices])

  // Initialize base KPI data once (no polling needed)
  useEffect(() => {
    isMountedRef.current = true
    setBaseKpiData({
      currentOccupancy: 0,
      peakOccupancy: 0,
      avgOccupancy: 0,
      totalEntries: 0,
      dwellRate: 0,
      previousOccupancy: 0,
      avgWaitingTime: 0,
    })
    return () => { isMountedRef.current = false }
  }, [roiId])

  // Build live KPI data combining base + live occupancy + waiting time
  const kpiData = useMemo(() => {
    if (!baseKpiData) return null
    
    const prev = previousOccupancyRef.current
    previousOccupancyRef.current = liveOccupancy
    
    return {
      ...baseKpiData,
      currentOccupancy: liveOccupancy,
      peakOccupancy: Math.max(peakOccupancyRef.current, liveOccupancy),
      totalEntries: totalEntriesRef.current,
      previousOccupancy: prev,
      avgWaitingTime: avgWaitingTime, // Calculated from tracks (no API)
    }
  }, [baseKpiData, liveOccupancy, avgWaitingTime])

  if (!kpiData) {
    return (
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-2 min-w-[140px] animate-pulse shadow-lg">
        <div className="h-12 bg-white/10 rounded" />
      </div>
    )
  }

  // Calculate occupancy percentage (against a reasonable max, e.g., 30 or peak*1.5)
  const maxCapacity = Math.max(kpiData.peakOccupancy * 1.5, 20)
  const occupancyPercent = (kpiData.currentOccupancy / maxCapacity) * 100

  return (
    <div 
      className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-2.5 cursor-pointer hover:bg-black/50 hover:border-white/20 transition-all shadow-xl min-w-[160px]"
      onClick={onClick}
    >
      {/* Zone Name Header with subtle color indicator */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <div 
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: roiColor, boxShadow: `0 0 6px ${roiColor}` }}
        />
        <div className="text-[11px] font-medium truncate text-white/90">
          {roiName}
        </div>
      </div>
      
      {/* Main KPI Row */}
      <div className="flex items-center justify-between gap-2">
        {/* Circular Gauge */}
        <CircularGauge 
          value={occupancyPercent}
          maxValue={100}
          size={44}
          strokeWidth={4}
          showPercent={true}
        />
        
        {/* Trend Arrow */}
        <TrendArrow 
          current={kpiData.currentOccupancy} 
          previous={kpiData.previousOccupancy || 0} 
        />
        
        {/* Value Display */}
        <div className="text-right">
          <div className="text-xl font-bold text-white leading-none">
            {kpiData.currentOccupancy}
          </div>
          <div className="text-[10px] text-white/40">PAX</div>
        </div>
      </div>
      
      {/* Secondary Stats Row */}
      <div className="flex justify-between mt-1.5 pt-1.5 border-t border-white/10">
        <div className="text-center">
          <div className="text-[10px] text-white/40">Entries</div>
          <div className="text-xs font-medium text-white/80">{kpiData.totalEntries}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-white/40">Peak</div>
          <div className="text-xs font-medium text-white/80">{kpiData.peakOccupancy}</div>
        </div>
        {roiName.toLowerCase().includes('queue') ? (
          <div className="text-center">
            <div className="text-[10px] text-white/40">Wait</div>
            <div className="flex items-center justify-center gap-1">
              {/* Threshold status indicator dot */}
              <div 
                className="w-2 h-2 rounded-full"
                style={{ 
                  backgroundColor: kpiData.avgWaitingTime && kpiData.avgWaitingTime > 0
                    ? (kpiData.avgWaitingTime * 60 >= 120 ? '#ef4444' : kpiData.avgWaitingTime * 60 >= 60 ? '#f59e0b' : '#22c55e')
                    : '#22c55e',
                  boxShadow: `0 0 4px ${kpiData.avgWaitingTime && kpiData.avgWaitingTime > 0
                    ? (kpiData.avgWaitingTime * 60 >= 120 ? '#ef4444' : kpiData.avgWaitingTime * 60 >= 60 ? '#f59e0b' : '#22c55e')
                    : '#22c55e'}`
                }}
              />
              <div className="text-xs font-medium text-amber-400">
                {kpiData.avgWaitingTime && kpiData.avgWaitingTime > 0 
                  ? (kpiData.avgWaitingTime < 1 
                      ? `${Math.round(kpiData.avgWaitingTime * 60)}s` 
                      : `${kpiData.avgWaitingTime.toFixed(1)}m`)
                  : '0s'}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-[10px] text-white/40">Dwell</div>
            <div className="text-xs font-medium text-white/80">{kpiData.dwellRate.toFixed(0)}%</div>
          </div>
        )}
      </div>
    </div>
  )
}
