import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

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
  const [kpiData, setKpiData] = useState<LiveKPIData | null>(null)
  const [previousOccupancy, setPreviousOccupancy] = useState(0)
  const [loading, setLoading] = useState(true)
  const previousValueRef = useRef(0)

  const fetchKPIs = useCallback(async () => {
    try {
      // Fetch live occupancy
      const liveRes = await fetch(`${API_BASE}/api/roi/${roiId}/occupancy/live`)
      const liveData = await liveRes.json()
      
      // Fetch summary KPIs (last hour)
      const kpiRes = await fetch(`${API_BASE}/api/roi/${roiId}/kpis?period=hour`)
      const kpiFullData = await kpiRes.json()
      
      setPreviousOccupancy(previousValueRef.current)
      previousValueRef.current = liveData.currentOccupancy
      
      setKpiData({
        currentOccupancy: liveData.currentOccupancy,
        peakOccupancy: kpiFullData.kpis?.peakOccupancy || 20,
        avgOccupancy: kpiFullData.kpis?.avgOccupancy || 0,
        totalEntries: kpiFullData.kpis?.totalEntries || 0,
        dwellRate: kpiFullData.kpis?.dwellRate || 0,
        previousOccupancy: previousValueRef.current,
      })
      setLoading(false)
    } catch (err) {
      console.error('Failed to fetch zone KPIs:', err)
      setLoading(false)
    }
  }, [roiId])

  useEffect(() => {
    fetchKPIs()
    const interval = setInterval(fetchKPIs, 2000)
    return () => clearInterval(interval)
  }, [fetchKPIs])

  if (loading || !kpiData) {
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
          previous={previousOccupancy} 
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
        <div className="text-center">
          <div className="text-[10px] text-white/40">Dwell</div>
          <div className="text-xs font-medium text-white/80">{kpiData.dwellRate.toFixed(0)}%</div>
        </div>
      </div>
    </div>
  )
}
