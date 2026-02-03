import { useState, useEffect, useCallback, useRef } from 'react'
import { X, TrendingUp, Users, Clock, Target, Activity, ArrowUpRight, ArrowDownRight, Minus, HelpCircle, Settings } from 'lucide-react'
import { KPI_DEFINITIONS } from './kpiDefinitions'
import ZoneSettingsPanel from './ZoneSettingsPanel'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface KPIData {
  visits: number
  totalEntries: number
  timeSpent: number
  avgTimeSpent: number
  avgTimeSpentCT: number
  dwellAvgTime: number
  dwellAvgTimeCT: number
  dwellsCumulative: number
  dwellsUnique: number
  dwellsPerVisit: number
  dwellRate: number
  dwellShare: number
  engagementAvgTime: number
  engagementAvgTimeCT: number
  engagementsCumulative: number
  engagementsPerVisit: number
  engagementsUnique: number
  engagementRate: number
  engagementShare: number
  draws: number
  drawRate: number
  drawShare: number
  exits: number
  exitRate: number
  exitShare: number
  bounces: number
  bounceRate: number
  bounceShare: number
  peakOccupancy: number
  avgOccupancy: number
  avgVelocity: number
  avgVelocityInMotion: number
  atRestTotalTime: number
  inMotionTotalTime: number
  percentAtRest: number
  percentInMotion: number
  visitsByHour: { hour: string; visits: number }[]
  occupancyOverTime: { timestamp: number; avgOccupancy: number; maxOccupancy: number }[]
  dwellDistribution: { bucket: string; count: number }[]
}

interface ZoneKPIPopupProps {
  roiId: string
  roiName: string
  roiColor: string
  onClose: () => void
}

type TimePeriod = 'hour' | 'day' | 'week' | 'month'

function HelpTooltip({ definitionKey }: { definitionKey: string }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const definition = KPI_DEFINITIONS[definitionKey]
  
  const handleMouseEnter = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setTooltipPos({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      })
    }
    setShowTooltip(true)
  }
  
  if (!definition) return null
  
  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={(e) => { e.stopPropagation(); setShowTooltip(!showTooltip) }}
        className="text-gray-500 hover:text-gray-300 transition-colors"
      >
        <HelpCircle className="w-3 h-3" />
      </button>
      {showTooltip && (
        <div 
          className="fixed w-64 p-2 bg-gray-900 border border-gray-600 rounded-lg shadow-2xl text-xs text-gray-300 leading-relaxed pointer-events-none"
          style={{
            zIndex: 99999,
            top: tooltipPos.top,
            left: tooltipPos.left,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {definition}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-600" />
        </div>
      )}
    </div>
  )
}

function MetricCard({ 
  icon: Icon, 
  label, 
  value, 
  subValue, 
  trend,
  color = 'text-blue-400',
  definitionKey
}: { 
  icon: any
  label: string
  value: string | number
  subValue?: string
  trend?: number
  color?: string
  definitionKey?: string
}) {
  const getTrendIcon = () => {
    if (trend === undefined) return null
    if (trend > 0) return <ArrowUpRight className="w-3 h-3 text-green-400" />
    if (trend < 0) return <ArrowDownRight className="w-3 h-3 text-red-400" />
    return <Minus className="w-3 h-3 text-gray-400" />
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        <div className="flex items-center gap-1">
          {definitionKey && <HelpTooltip definitionKey={definitionKey} />}
          {trend !== undefined && (
            <div className="flex items-center gap-0.5 text-xs">
              {getTrendIcon()}
              <span className={trend > 0 ? 'text-green-400' : trend < 0 ? 'text-red-400' : 'text-gray-400'}>
                {Math.abs(trend).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className="text-lg font-semibold text-white">{value}</div>
      {subValue && <div className="text-[10px] text-gray-500 mt-0.5">{subValue}</div>}
    </div>
  )
}

function SimpleBarChart({ data, dataKey, labelKey, color = '#3b82f6', height = 120 }: {
  data: any[]
  dataKey: string
  labelKey: string
  color?: string
  height?: number
}) {
  if (!data || data.length === 0) return <div className="text-gray-500 text-xs text-center py-4">No data</div>
  
  const maxValue = Math.max(...data.map(d => d[dataKey]), 1)
  
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((item, idx) => {
        const barHeight = (item[dataKey] / maxValue) * (height - 20)
        return (
          <div key={idx} className="flex-1 flex flex-col items-center">
            <div 
              className="w-full rounded-t transition-all hover:opacity-80"
              style={{ 
                height: Math.max(barHeight, 2), 
                backgroundColor: color,
                minWidth: 4,
              }}
              title={`${item[labelKey]}: ${item[dataKey]}`}
            />
            <div className="text-[8px] text-gray-500 mt-1 truncate w-full text-center">
              {item[labelKey]}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function OccupancyChart({ data, height = 120 }: {
  data: { timestamp: number; avgOccupancy: number; maxOccupancy: number }[]
  height?: number
}) {
  if (!data || data.length === 0) {
    return <div className="text-gray-500 text-xs text-center py-4">No occupancy data available</div>
  }
  
  // Limit to last 20 data points for readability
  const chartData = data.slice(-20)
  const chartHeight = height - 30 // Leave room for labels
  const maxValue = Math.max(...chartData.map(d => d.maxOccupancy), 1)
  
  // Format timestamp to readable time
  const formatTime = (ts: number) => {
    const date = new Date(ts)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  
  return (
    <div className="space-y-2">
      {/* Chart */}
      <div className="flex items-end gap-1" style={{ height: chartHeight }}>
        {chartData.map((item, idx) => {
          const barHeight = Math.max((item.avgOccupancy / maxValue) * chartHeight, 2)
          const peakHeight = (item.maxOccupancy / maxValue) * chartHeight
          return (
            <div key={idx} className="flex-1 flex flex-col items-center relative group">
              {/* Peak indicator */}
              {item.maxOccupancy > item.avgOccupancy && (
                <div 
                  className="absolute w-full flex justify-center"
                  style={{ bottom: peakHeight }}
                >
                  <div className="w-2 h-0.5 bg-purple-400/50" />
                </div>
              )}
              {/* Avg bar */}
              <div
                className="w-full bg-purple-500 rounded-t hover:bg-purple-400 transition-colors cursor-pointer"
                style={{ height: barHeight }}
                title={`Avg: ${item.avgOccupancy} | Peak: ${item.maxOccupancy}\n${formatTime(item.timestamp)}`}
              />
              {/* Tooltip on hover */}
              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-white whitespace-nowrap z-10">
                <div>Avg: <span className="text-purple-400">{item.avgOccupancy}</span></div>
                <div>Peak: <span className="text-purple-300">{item.maxOccupancy}</span></div>
                <div className="text-gray-400">{formatTime(item.timestamp)}</div>
              </div>
            </div>
          )
        })}
      </div>
      
      {/* Time labels */}
      <div className="flex justify-between text-[9px] text-gray-500">
        {chartData.length > 0 && (
          <>
            <span>{formatTime(chartData[0].timestamp)}</span>
            {chartData.length > 2 && (
              <span>{formatTime(chartData[Math.floor(chartData.length / 2)].timestamp)}</span>
            )}
            <span>{formatTime(chartData[chartData.length - 1].timestamp)}</span>
          </>
        )}
      </div>
      
      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-gray-400 justify-center">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-purple-500 rounded" />
          <span>Avg Occupancy</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-0.5 bg-purple-400/50" />
          <span>Peak</span>
        </div>
      </div>
    </div>
  )
}

function ProgressRing({ value, max = 100, size = 60, strokeWidth = 6, color = '#3b82f6' }: {
  value: number
  max?: number
  size?: number
  strokeWidth?: number
  color?: string
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const percent = Math.min(value / max, 1)
  const offset = circumference - percent * circumference

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#374151"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-500"
      />
    </svg>
  )
}

export default function ZoneKPIPopup({ roiId, roiName, roiColor, onClose }: ZoneKPIPopupProps) {
  const [kpis, setKpis] = useState<KPIData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<TimePeriod>('day')
  const [activeTab, setActiveTab] = useState<'overview' | 'dwell' | 'flow' | 'velocity'>('overview')
  const [liveOccupancy, setLiveOccupancy] = useState<number>(0)
  const [showSettings, setShowSettings] = useState(false)

  const fetchKPIs = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const res = await fetch(`${API_BASE}/api/roi/${roiId}/kpis?period=${period}`)
      if (!res.ok) throw new Error('Failed to fetch KPIs')
      const data = await res.json()
      setKpis(data.kpis)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load KPIs')
    } finally {
      setLoading(false)
    }
  }, [roiId, period])

  // Fetch live occupancy every 2 seconds
  const fetchLiveOccupancy = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/roi/${roiId}/occupancy/live`)
      if (res.ok) {
        const data = await res.json()
        setLiveOccupancy(data.currentOccupancy)
      }
    } catch (err) {
      console.error('Failed to fetch live occupancy:', err)
    }
  }, [roiId])

  useEffect(() => {
    fetchKPIs()
    fetchLiveOccupancy()
    
    // Auto-refresh KPIs every 30 seconds
    const kpiInterval = setInterval(fetchKPIs, 30000)
    // Live occupancy every 2 seconds
    const liveInterval = setInterval(fetchLiveOccupancy, 2000)
    
    return () => {
      clearInterval(kpiInterval)
      clearInterval(liveInterval)
    }
  }, [fetchKPIs, fetchLiveOccupancy])

  const formatTime = (minutes: number) => {
    if (minutes < 1) return `${Math.round(minutes * 60)}s`
    if (minutes < 60) return `${minutes.toFixed(1)}m`
    return `${(minutes / 60).toFixed(1)}h`
  }

  const formatPercent = (value: number) => `${value.toFixed(1)}%`

  return (
    <>
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[800px] max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div 
              className="w-4 h-4 rounded"
              style={{ backgroundColor: roiColor }}
            />
            <div>
              <h2 className="text-lg font-semibold text-white">{roiName}</h2>
              <p className="text-xs text-gray-400">Zone Analytics & KPIs</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Time Period Selector */}
            <div className="flex bg-gray-800 rounded-lg p-0.5">
              {(['hour', 'day', 'week', 'month'] as TimePeriod[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    period === p 
                      ? 'bg-blue-600 text-white' 
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
            {/* Zone Settings Button */}
            <button
              onClick={() => setShowSettings(true)}
              className="p-1.5 text-gray-400 hover:text-amber-400 hover:bg-amber-500/20 rounded transition-colors"
              title="Zone Settings & Alert Rules"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 px-6">
          {(['overview', 'dwell', 'flow', 'velocity'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-400 mb-2">{error}</p>
              <button 
                onClick={fetchKPIs}
                className="text-sm text-blue-400 hover:underline"
              >
                Retry
              </button>
            </div>
          ) : kpis ? (
            <>
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Live Occupancy Banner */}
                  <div className="bg-gradient-to-r from-green-900/50 to-emerald-900/50 border border-green-600/50 rounded-lg p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                        <div className="absolute inset-0 w-3 h-3 bg-green-500 rounded-full animate-ping opacity-75" />
                      </div>
                      <div>
                        <div className="text-xs text-green-300 uppercase tracking-wide">Live Occupancy</div>
                        <div className="text-3xl font-bold text-white">{liveOccupancy} <span className="text-lg font-normal text-gray-400">people</span></div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-400">Peak: {kpis.peakOccupancy}</div>
                      <div className="text-xs text-gray-400">Avg: {kpis.avgOccupancy.toFixed(1)}</div>
                    </div>
                  </div>

                  {/* Primary Metrics */}
                  <div className="grid grid-cols-4 gap-3">
                    <MetricCard
                      icon={Users}
                      label="Total Entries"
                      value={kpis.totalEntries}
                      subValue={`${kpis.visits} unique visitors`}
                      color="text-blue-400"
                      definitionKey="totalEntries"
                    />
                    <MetricCard
                      icon={Clock}
                      label="Time Spent"
                      value={formatTime(kpis.timeSpent)}
                      subValue={`Avg: ${formatTime(kpis.avgTimeSpent)}`}
                      color="text-green-400"
                      definitionKey="timeSpent"
                    />
                    <MetricCard
                      icon={Target}
                      label="Dwell Rate"
                      value={formatPercent(kpis.dwellRate)}
                      subValue={`${kpis.dwellsCumulative} total dwells`}
                      color="text-amber-400"
                      definitionKey="dwellRate"
                    />
                    <MetricCard
                      icon={Activity}
                      label="Peak Occupancy"
                      value={kpis.peakOccupancy}
                      subValue={`Avg: ${kpis.avgOccupancy.toFixed(1)}`}
                      color="text-purple-400"
                      definitionKey="peakOccupancy"
                    />
                  </div>

                  {/* Charts Row */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Visits by Hour */}
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <h3 className="text-sm font-medium text-gray-300 mb-3">Visits by Hour</h3>
                      <SimpleBarChart 
                        data={kpis.visitsByHour} 
                        dataKey="visits" 
                        labelKey="hour"
                        color="#3b82f6"
                        height={100}
                      />
                    </div>

                    {/* Dwell Distribution */}
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <h3 className="text-sm font-medium text-gray-300 mb-3">Time Distribution</h3>
                      <SimpleBarChart 
                        data={kpis.dwellDistribution} 
                        dataKey="count" 
                        labelKey="bucket"
                        color="#f59e0b"
                        height={100}
                      />
                    </div>
                  </div>

                  {/* Engagement Metrics */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex items-center gap-4">
                      <div className="relative">
                        <ProgressRing value={kpis.dwellRate} color="#f59e0b" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-sm font-semibold text-white">{Math.round(kpis.dwellRate)}%</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 flex items-center gap-1">
                          Dwell Rate
                          <HelpTooltip definitionKey="dwellRate" />
                        </div>
                        <div className="text-sm text-white">{kpis.dwellsUnique} / {kpis.visits} visits</div>
                        <div className="text-xs text-gray-500">Avg: {formatTime(kpis.dwellAvgTime)}</div>
                      </div>
                    </div>

                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex items-center gap-4">
                      <div className="relative">
                        <ProgressRing value={kpis.engagementRate} color="#22c55e" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-sm font-semibold text-white">{Math.round(kpis.engagementRate)}%</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 flex items-center gap-1">
                          Engagement Rate
                          <HelpTooltip definitionKey="engagementRate" />
                        </div>
                        <div className="text-sm text-white">{kpis.engagementsUnique} / {kpis.visits} visits</div>
                        <div className="text-xs text-gray-500">Avg: {formatTime(kpis.engagementAvgTime)}</div>
                      </div>
                    </div>

                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex items-center gap-4">
                      <div className="relative">
                        <ProgressRing value={kpis.bounceRate} color="#ef4444" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-sm font-semibold text-white">{Math.round(kpis.bounceRate)}%</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 flex items-center gap-1">
                          Bounce Rate
                          <HelpTooltip definitionKey="bounceRate" />
                        </div>
                        <div className="text-sm text-white">{kpis.bounces} / {kpis.visits} visits</div>
                        <div className="text-xs text-gray-500">No other zone visited</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'dwell' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-4 gap-3">
                    <MetricCard
                      icon={Clock}
                      label="Dwell Avg Time"
                      value={formatTime(kpis.dwellAvgTime)}
                      subValue={`CT: ${formatTime(kpis.dwellAvgTimeCT)}`}
                      color="text-amber-400"
                      definitionKey="dwellAvgTime"
                    />
                    <MetricCard
                      icon={Users}
                      label="Dwells Cumulative"
                      value={kpis.dwellsCumulative}
                      subValue={`Unique: ${kpis.dwellsUnique}`}
                      color="text-blue-400"
                      definitionKey="dwellsCumulative"
                    />
                    <MetricCard
                      icon={TrendingUp}
                      label="Dwells Per Visit"
                      value={kpis.dwellsPerVisit.toFixed(2)}
                      color="text-green-400"
                      definitionKey="dwellsPerVisit"
                    />
                    <MetricCard
                      icon={Target}
                      label="Dwell Share"
                      value={formatPercent(kpis.dwellShare)}
                      subValue="of all location dwells"
                      color="text-purple-400"
                      definitionKey="dwellShare"
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-3">
                    <MetricCard
                      icon={Clock}
                      label="Engagement Avg Time"
                      value={formatTime(kpis.engagementAvgTime)}
                      subValue={`CT: ${formatTime(kpis.engagementAvgTimeCT)}`}
                      color="text-green-400"
                      definitionKey="engagementAvgTime"
                    />
                    <MetricCard
                      icon={Users}
                      label="Engagements Cumulative"
                      value={kpis.engagementsCumulative}
                      subValue={`Unique: ${kpis.engagementsUnique}`}
                      color="text-blue-400"
                      definitionKey="engagementsCumulative"
                    />
                    <MetricCard
                      icon={TrendingUp}
                      label="Engagements Per Visit"
                      value={kpis.engagementsPerVisit.toFixed(2)}
                      color="text-amber-400"
                      definitionKey="engagementsPerVisit"
                    />
                    <MetricCard
                      icon={Target}
                      label="Engagement Share"
                      value={formatPercent(kpis.engagementShare)}
                      subValue="of all location engagements"
                      color="text-purple-400"
                      definitionKey="engagementShare"
                    />
                  </div>

                  <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-300 mb-3">Dwell Time Distribution</h3>
                    <SimpleBarChart 
                      data={kpis.dwellDistribution} 
                      dataKey="count" 
                      labelKey="bucket"
                      color="#f59e0b"
                      height={150}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'flow' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-3 gap-4">
                    {/* Draws */}
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-1">
                          Draws (Entry Points)
                          <HelpTooltip definitionKey="draws" />
                        </h3>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-2xl font-bold text-white">{kpis.draws}</div>
                          <div className="text-xs text-gray-400">First dwell here</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-green-400">{formatPercent(kpis.drawRate)}</div>
                          <div className="text-xs text-gray-400">Draw rate</div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-gray-700">
                        <div className="text-xs text-gray-400">Draw Share: <span className="text-white">{formatPercent(kpis.drawShare)}</span></div>
                      </div>
                    </div>

                    {/* Exits */}
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-1">
                          Exits (Last Stop)
                          <HelpTooltip definitionKey="exits" />
                        </h3>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-2xl font-bold text-white">{kpis.exits}</div>
                          <div className="text-xs text-gray-400">Last dwell here</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-red-400">{formatPercent(kpis.exitRate)}</div>
                          <div className="text-xs text-gray-400">Exit rate</div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-gray-700">
                        <div className="text-xs text-gray-400">Exit Share: <span className="text-white">{formatPercent(kpis.exitShare)}</span></div>
                      </div>
                    </div>

                    {/* Bounces */}
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-1">
                          Bounces
                          <HelpTooltip definitionKey="bounces" />
                        </h3>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-2xl font-bold text-white">{kpis.bounces}</div>
                          <div className="text-xs text-gray-400">Only zone visited</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-amber-400">{formatPercent(kpis.bounceRate)}</div>
                          <div className="text-xs text-gray-400">Bounce rate</div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-gray-700">
                        <div className="text-xs text-gray-400">Bounce Share: <span className="text-white">{formatPercent(kpis.bounceShare)}</span></div>
                      </div>
                    </div>
                  </div>

                  {/* Occupancy Over Time */}
                  <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <h3 className="text-sm font-medium text-gray-300">Occupancy Over Time</h3>
                      <HelpTooltip definitionKey="avgOccupancy" />
                    </div>
                    <OccupancyChart 
                      data={kpis.occupancyOverTime}
                      height={140}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'velocity' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-4 gap-3">
                    <MetricCard
                      icon={Activity}
                      label="Avg Velocity"
                      value={`${kpis.avgVelocity.toFixed(2)} m/s`}
                      color="text-blue-400"
                    />
                    <MetricCard
                      icon={TrendingUp}
                      label="Avg Velocity (Moving)"
                      value={`${kpis.avgVelocityInMotion.toFixed(2)} m/s`}
                      subValue="Excluding stationary"
                      color="text-green-400"
                    />
                    <MetricCard
                      icon={Clock}
                      label="At Rest Time"
                      value={formatTime(kpis.atRestTotalTime)}
                      subValue={`${kpis.percentAtRest}% of time`}
                      color="text-amber-400"
                    />
                    <MetricCard
                      icon={Clock}
                      label="In Motion Time"
                      value={formatTime(kpis.inMotionTotalTime)}
                      subValue={`${kpis.percentInMotion}% of time`}
                      color="text-purple-400"
                    />
                  </div>

                  {/* Motion vs Rest Visualization */}
                  <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-300 mb-4">Motion Analysis</h3>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <div className="h-4 rounded-full bg-gray-700 overflow-hidden flex">
                          <div 
                            className="bg-amber-500 h-full transition-all"
                            style={{ width: `${kpis.percentAtRest}%` }}
                          />
                          <div 
                            className="bg-green-500 h-full transition-all"
                            style={{ width: `${kpis.percentInMotion}%` }}
                          />
                        </div>
                        <div className="flex justify-between mt-2 text-xs">
                          <span className="text-amber-400">At Rest: {kpis.percentAtRest}%</span>
                          <span className="text-green-400">In Motion: {kpis.percentInMotion}%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <h3 className="text-sm font-medium text-gray-300 mb-2">Typical Walking Speed</h3>
                      <p className="text-xs text-gray-400 mb-3">Human walking: 1.2-1.5 m/s</p>
                      <div className="relative h-2 bg-gray-700 rounded-full">
                        <div 
                          className="absolute h-full bg-blue-500 rounded-full"
                          style={{ width: `${Math.min((kpis.avgVelocityInMotion / 2) * 100, 100)}%` }}
                        />
                        <div 
                          className="absolute top-0 w-0.5 h-full bg-white"
                          style={{ left: '60%' }}
                          title="Typical walking speed"
                        />
                      </div>
                      <div className="flex justify-between mt-1 text-[10px] text-gray-500">
                        <span>0</span>
                        <span>2 m/s</span>
                      </div>
                    </div>

                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <h3 className="text-sm font-medium text-gray-300 mb-2">Peak Occupancy</h3>
                      <div className="flex items-end gap-4">
                        <div>
                          <div className="text-4xl font-bold text-purple-400">{kpis.peakOccupancy}</div>
                          <div className="text-xs text-gray-400">max concurrent</div>
                        </div>
                        <div className="text-sm text-gray-400">
                          Avg: <span className="text-white">{kpis.avgOccupancy.toFixed(1)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-gray-400">No data available</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-700 flex items-center justify-between text-xs text-gray-400">
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
          <button 
            onClick={fetchKPIs}
            className="text-blue-400 hover:underline"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
    
    {/* Zone Settings Panel - rendered outside backdrop to prevent click propagation issues */}
    <ZoneSettingsPanel
      roiId={roiId}
      roiName={roiName}
      roiColor={roiColor}
      isOpen={showSettings}
      onClose={() => setShowSettings(false)}
    />
    </>
  )
}
