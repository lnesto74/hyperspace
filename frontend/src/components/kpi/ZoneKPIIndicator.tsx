import { useState, useEffect, useRef, useMemo } from 'react'
import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react'
import { useTracksRef } from '../../context/TrackingContext'
import { useRoi } from '../../context/RoiContext'
import { isPointInPolygon } from '../../utils/zoneLiveMetrics'
import { ROI_CATEGORY_COLOR } from '../../utils/roiCategoryUtils'

interface ZoneKPIIndicatorProps {
  roiId: string
  roiName: string
  roiColor: string
  categoryLabel?: string | null
  highlighted?: boolean
  compact?: boolean
  onClick?: () => void
  onHover?: (roiId: string | null) => void
  onMetricsUpdate?: (roiId: string, metrics: { currentOccupancy: number; totalEntries: number; peakOccupancy?: number }) => void
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

export default function ZoneKPIIndicator({
  roiId,
  roiName,
  roiColor,
  categoryLabel,
  highlighted = false,
  compact = false,
  onClick,
  onHover,
  onMetricsUpdate,
}: ZoneKPIIndicatorProps) {
  const tracksRef = useTracksRef()
  const { regions } = useRoi()
  const previousOccupancyRef = useRef(0)
  const peakOccupancyRef = useRef(0)
  const totalEntriesRef = useRef(0)
  const lastTracksInZoneRef = useRef<Set<string>>(new Set())
  const trackEntryTimesRef = useRef<Map<string, number>>(new Map())

  const roiVertices = useMemo(() => {
    const roi = regions.find(r => r.id === roiId)
    return roi?.vertices || []
  }, [regions, roiId])
  const roiVerticesRef = useRef(roiVertices)
  roiVerticesRef.current = roiVertices

  const [kpiData, setKpiData] = useState<LiveKPIData>({
    currentOccupancy: 0,
    peakOccupancy: 0,
    avgOccupancy: 0,
    totalEntries: 0,
    dwellRate: 0,
    previousOccupancy: 0,
    avgWaitingTime: 0,
  })

  useEffect(() => {
    const KPI_INTERVAL = 500
    const tick = () => {
      const verts = roiVerticesRef.current
      if (verts.length < 3) return
      const tracks = tracksRef.current

      let occupancy = 0
      const currentInZone = new Set<string>()
      const now = Date.now()
      const newEntryTimes = new Map<string, number>()
      let totalWaitMs = 0
      let waitCount = 0

      tracks.forEach((track, trackKey) => {
        const pos = track.venuePosition
        if (isPointInPolygon(pos.x, pos.z, verts)) {
          occupancy++
          currentInZone.add(trackKey)
          const existingEntry = trackEntryTimesRef.current.get(trackKey)
          if (existingEntry) {
            newEntryTimes.set(trackKey, existingEntry)
            totalWaitMs += now - existingEntry
          } else {
            newEntryTimes.set(trackKey, now)
          }
          waitCount++
        }
      })

      currentInZone.forEach(tk => {
        if (!lastTracksInZoneRef.current.has(tk)) totalEntriesRef.current++
      })
      lastTracksInZoneRef.current = currentInZone
      trackEntryTimesRef.current = newEntryTimes
      if (occupancy > peakOccupancyRef.current) peakOccupancyRef.current = occupancy

      const prev = previousOccupancyRef.current
      previousOccupancyRef.current = occupancy
      const avgWait = waitCount > 0 ? (totalWaitMs / waitCount) / 60000 : 0

      setKpiData({
        currentOccupancy: occupancy,
        peakOccupancy: peakOccupancyRef.current,
        avgOccupancy: 0,
        totalEntries: totalEntriesRef.current,
        dwellRate: 0,
        previousOccupancy: prev,
        avgWaitingTime: avgWait,
      })
      onMetricsUpdate?.(roiId, {
        currentOccupancy: occupancy,
        totalEntries: totalEntriesRef.current,
        peakOccupancy: peakOccupancyRef.current,
      })
    }
    const id = setInterval(tick, KPI_INTERVAL)
    tick()
    return () => clearInterval(id)
  }, [roiId, onMetricsUpdate])

  if (!kpiData) {
    return (
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-2 min-w-[140px] animate-pulse shadow-lg">
        <div className="h-12 bg-white/10 rounded" />
      </div>
    )
  }

  const maxCapacity = Math.max(kpiData.peakOccupancy * 1.5, 20)
  const occupancyPercent = (kpiData.currentOccupancy / maxCapacity) * 100
  const isQueue = roiName.toLowerCase().includes('queue')

  if (compact) {
    return (
      <div
        className={`group relative rounded-lg p-2 cursor-pointer transition-all ${
          highlighted
            ? 'bg-white/10 ring-1 ring-inset'
            : 'bg-black/25 border border-white/5 hover:bg-black/35 hover:border-white/15'
        }`}
        style={highlighted ? { boxShadow: `inset 0 0 0 1px ${roiColor}` } : undefined}
        onClick={onClick}
        onMouseEnter={() => onHover?.(roiId)}
        onMouseLeave={() => onHover?.(null)}
      >
        {highlighted && (
          <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full" style={{ backgroundColor: roiColor }} />
        )}
        <div className="flex items-center gap-1 mb-1 min-w-0">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: roiColor }} />
          <span className="text-[10px] font-medium text-white/90 truncate flex-1">{roiName}</span>
          {categoryLabel && (
            <span
              className="text-[8px] px-1 py-px rounded truncate max-w-[52px]"
              style={{ color: ROI_CATEGORY_COLOR, backgroundColor: `${ROI_CATEGORY_COLOR}15` }}
            >
              {categoryLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <CircularGauge value={occupancyPercent} size={32} strokeWidth={3} showPercent={false} color={roiColor} />
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-white leading-none tabular-nums">{kpiData.currentOccupancy}</div>
            <div className="text-[9px] text-white/35">PAX</div>
          </div>
          <div className="text-right opacity-0 group-hover:opacity-100 transition-opacity">
            <TrendArrow current={kpiData.currentOccupancy} previous={kpiData.previousOccupancy || 0} />
          </div>
        </div>
        <div className="flex justify-between mt-1 pt-1 border-t border-white/5 text-[9px]">
          <span className="text-white/35">In <span className="text-white/70 tabular-nums">{kpiData.totalEntries}</span></span>
          <span className="text-white/35">Peak <span className="text-white/70 tabular-nums">{kpiData.peakOccupancy}</span></span>
          {isQueue && (
            <span className="text-amber-400/80 tabular-nums">
              {kpiData.avgWaitingTime && kpiData.avgWaitingTime > 0
                ? (kpiData.avgWaitingTime < 1 ? `${Math.round(kpiData.avgWaitingTime * 60)}s` : `${kpiData.avgWaitingTime.toFixed(1)}m`)
                : '0s'}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div 
      className={`relative backdrop-blur-xl rounded-xl p-2.5 cursor-pointer transition-colors shadow-lg min-w-[160px] ${
        highlighted 
          ? 'bg-gray-900/90' 
          : 'bg-black/40 border border-white/10 hover:bg-black/50 hover:border-white/20'
      }`}
      style={highlighted ? {
        boxShadow: `inset 0 0 0 2px ${roiColor}`,
      } : undefined}
      onClick={onClick}
      onMouseEnter={() => onHover?.(roiId)}
      onMouseLeave={() => onHover?.(null)}
    >
      {highlighted && (
        <div
          className="absolute left-0 top-2 bottom-2 w-1 rounded-full"
          style={{ backgroundColor: roiColor }}
        />
      )}
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

      {categoryLabel && (
        <div className="mt-2 flex justify-center">
          <span
            className="inline-block w-full text-center rounded-full px-2 py-1 text-[10px] font-semibold tracking-wide truncate"
            style={{
              color: ROI_CATEGORY_COLOR,
              backgroundColor: `${ROI_CATEGORY_COLOR}18`,
              border: `1px solid ${ROI_CATEGORY_COLOR}44`,
            }}
          >
            {categoryLabel}
          </span>
        </div>
      )}
    </div>
  )
}
