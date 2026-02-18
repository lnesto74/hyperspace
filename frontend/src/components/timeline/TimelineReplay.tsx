import { useState, useEffect, useCallback, useRef } from 'react'
import { Play, Pause, SkipBack, SkipForward, Clock, ChevronDown, MapPin, RefreshCw } from 'lucide-react'
import { useTracking } from '../../context/TrackingContext'
import { TrackWithTrail } from '../../types'
import TimelineInsightMarkers from '../replay-insight/TimelineInsightMarkers'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface TimelineReplayProps {
  venueId: string
  isOpen: boolean
  onTimeChange?: (timestamp: number) => void
}

interface TimeSlot {
  timestamp: number
  time: string
  date: string
  occupancy: number
  peakOccupancy: number
  visits: number
  dwells: number
  engagements: number
}

interface KPIOption {
  id: string
  label: string
  color: string
}

interface ROI {
  id: string
  name: string
  color: string
}

const KPI_OPTIONS: KPIOption[] = [
  { id: 'occupancy', label: 'Occupancy', color: '#3b82f6' },
  { id: 'visits', label: 'Visits', color: '#22c55e' },
  { id: 'dwells', label: 'Dwells', color: '#f59e0b' },
  { id: 'engagements', label: 'Engagements', color: '#8b5cf6' },
]

export default function TimelineReplay({ venueId, isOpen, onTimeChange }: TimelineReplayProps) {
  const { setReplayMode, setReplayTracks } = useTracking()
  const [timelineData, setTimelineData] = useState<TimeSlot[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [kpi1, setKpi1] = useState<string>('occupancy')
  const [kpi2, setKpi2] = useState<string>('visits')
  const [showKpi1Dropdown, setShowKpi1Dropdown] = useState(false)
  const [showKpi2Dropdown, setShowKpi2Dropdown] = useState(false)
  const [dateRange, setDateRange] = useState<'today' | 'yesterday' | 'week'>('today')
  const [selectedZone, setSelectedZone] = useState<string>('all')
  const [zones, setZones] = useState<ROI[]>([])
  const [showZoneDropdown, setShowZoneDropdown] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  // Enable/disable replay mode when timeline opens/closes
  useEffect(() => {
    setReplayMode(isOpen)
    return () => setReplayMode(false)
  }, [isOpen, setReplayMode])

  // Fetch ROIs/zones for the venue
  useEffect(() => {
    if (!venueId) return
    fetch(`${API_BASE}/api/venues/${venueId}/regions`)
      .then(res => res.json())
      .then(data => setZones(data.regions || []))
      .catch(err => console.error('Failed to fetch zones:', err))
  }, [venueId])

  const fetchTimelineData = useCallback(async (forceRefresh = false) => {
    setIsLoading(true)
    try {
      let startTime: number
      let endTime: number
      const now = Date.now()
      
      switch (dateRange) {
        case 'yesterday':
          const yesterdayStart = new Date()
          yesterdayStart.setDate(yesterdayStart.getDate() - 1)
          yesterdayStart.setHours(0, 0, 0, 0)
          startTime = yesterdayStart.getTime()
          const yesterdayEnd = new Date()
          yesterdayEnd.setHours(0, 0, 0, 0)
          endTime = yesterdayEnd.getTime()
          break
        case 'week':
          startTime = now - 7 * 24 * 60 * 60 * 1000
          endTime = now
          break
        default: // today
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          startTime = today.getTime()
          endTime = now
      }
      
      const zoneParam = selectedZone !== 'all' ? `&roiId=${selectedZone}` : ''
      const refreshParam = forceRefresh ? '&refresh=true' : ''
      const res = await fetch(
        `${API_BASE}/api/venues/${venueId}/timeline?start=${startTime}&end=${endTime}&interval=15${zoneParam}${refreshParam}`
      )
      
      if (res.ok) {
        const data = await res.json()
        console.log(`Timeline data for ${dateRange}:`, data.slots?.length, 'slots', data.fromCache ? '(cached)' : '(fresh)')
        setTimelineData(data.slots || [])
        setCurrentIndex(0)
      }
    } catch (err) {
      console.error('Failed to fetch timeline data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [venueId, dateRange, selectedZone])

  useEffect(() => {
    if (isOpen && venueId) {
      fetchTimelineData()
    }
  }, [isOpen, venueId, fetchTimelineData])

  useEffect(() => {
    if (isPlaying && timelineData.length > 0) {
      playIntervalRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          const next = prev + 1
          if (next >= timelineData.length) {
            setIsPlaying(false)
            return prev
          }
          return next
        })
      }, 1000 / playbackSpeed)
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current)
      }
    }
    
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current)
      }
    }
  }, [isPlaying, playbackSpeed, timelineData.length])

  useEffect(() => {
    if (timelineData[currentIndex] && onTimeChange) {
      onTimeChange(timelineData[currentIndex].timestamp)
    }
  }, [currentIndex, timelineData, onTimeChange])

  // Fetch historical trajectories when time slot changes
  useEffect(() => {
    if (!isOpen || !venueId || timelineData.length === 0) return
    
    const currentSlot = timelineData[currentIndex]
    if (!currentSlot) return
    
    const slotDuration = 15 * 60 * 1000 // 15 minutes in ms
    const startTime = currentSlot.timestamp
    const endTime = startTime + slotDuration
    
    fetch(`${API_BASE}/api/venues/${venueId}/trajectories?start=${startTime}&end=${endTime}`)
      .then(res => res.json())
      .then(data => {
        // Convert trajectory data to TrackWithTrail format
        const trackMap = new Map<string, TrackWithTrail>()
        
        if (data.tracks) {
          for (const [trackKey, positions] of Object.entries(data.tracks)) {
            const posArray = positions as Array<{ timestamp: number, x: number, z: number, vx?: number, vz?: number, roiIds?: string[] }>
            if (posArray.length === 0) continue
            
            // Get the last position for the current track state
            const lastPos = posArray[posArray.length - 1]
            
            // Build trail from all positions
            const trail = posArray.map(p => ({ x: p.x, y: 0, z: p.z }))
            
            trackMap.set(trackKey, {
              id: trackKey,
              trackKey,
              deviceId: 'replay',
              timestamp: lastPos.timestamp,
              position: { x: lastPos.x, y: 0, z: lastPos.z },
              venuePosition: { x: lastPos.x, y: 0, z: lastPos.z },
              velocity: { x: lastPos.vx || 0, y: 0, z: lastPos.vz || 0 },
              objectType: 'person' as const,
              trail,
            })
          }
        }
        
        setReplayTracks(trackMap)
      })
      .catch(err => console.error('Failed to fetch replay trajectories:', err))
  }, [isOpen, venueId, currentIndex, timelineData, setReplayTracks])

  const handleSkipBack = () => {
    setCurrentIndex(Math.max(0, currentIndex - 10))
  }

  const handleSkipForward = () => {
    setCurrentIndex(Math.min(timelineData.length - 1, currentIndex + 10))
  }

  // Drag-to-seek handlers
  const getIndexFromMouseEvent = (e: React.MouseEvent | MouseEvent) => {
    if (!timelineRef.current || timelineData.length === 0) return currentIndex
    const rect = timelineRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percent = Math.max(0, Math.min(1, x / rect.width))
    return Math.floor(percent * (timelineData.length - 1))
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (timelineData.length === 0) return
    setIsDragging(true)
    setIsPlaying(false)
    const index = getIndexFromMouseEvent(e)
    setCurrentIndex(index)
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    const index = getIndexFromMouseEvent(e)
    setCurrentIndex(index)
  }, [isDragging, timelineData.length])

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      // Optionally start playback after drag
      // setIsPlaying(true)
    }
  }, [isDragging])

  // Global mouse event listeners for drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const getKpiColor = (kpiId: string) => {
    return KPI_OPTIONS.find(k => k.id === kpiId)?.color || '#666'
  }

  const getKpiValue = (slot: TimeSlot, kpiId: string): number => {
    switch (kpiId) {
      case 'occupancy': return slot.occupancy
      case 'visits': return slot.visits
      case 'dwells': return slot.dwells
      case 'engagements': return slot.engagements
      default: return 0
    }
  }

  const getMaxValue = (kpiId: string) => {
    if (timelineData.length === 0) return 1
    const values = timelineData.map(slot => getKpiValue(slot, kpiId))
    return Math.max(...values, 1)
  }

  if (!isOpen) return null

  const currentSlot = timelineData[currentIndex]
  const maxKpi1 = getMaxValue(kpi1)
  const maxKpi2 = getMaxValue(kpi2)

  return (
    <div className="absolute bottom-12 left-0 right-0 h-40 bg-gray-900/95 backdrop-blur-sm border-t border-gray-700 z-40 flex flex-col">
      {/* Header Row */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700/50">
        <div className="flex items-center gap-4">
          {/* Playback Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleSkipBack}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
              title="Skip back 10"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`p-2 rounded-full transition-colors ${
                isPlaying ? 'bg-amber-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={handleSkipForward}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
              title="Skip forward 10"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>
          
          {/* Speed Control */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-500">Speed:</span>
            {[0.5, 1, 2, 4].map(speed => (
              <button
                key={speed}
                onClick={() => setPlaybackSpeed(speed)}
                className={`px-2 py-0.5 rounded ${
                  playbackSpeed === speed 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
          
          {/* Date Range */}
          <div className="flex items-center gap-1 text-xs border-l border-gray-700 pl-4">
            {(['today', 'yesterday', 'week'] as const).map(range => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-2 py-0.5 rounded capitalize ${
                  dateRange === range 
                    ? 'bg-gray-700 text-white' 
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {range}
              </button>
            ))}
            <button
              onClick={() => fetchTimelineData(true)}
              disabled={isLoading}
              className="p-1 ml-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
              title="Refresh (bypass cache)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          
          {/* Zone Selector */}
          <div className="relative border-l border-gray-700 pl-4">
            <button
              onClick={() => { setShowZoneDropdown(!showZoneDropdown); setShowKpi1Dropdown(false); setShowKpi2Dropdown(false) }}
              className="flex items-center gap-2 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs"
            >
              <MapPin className="w-3 h-3 text-gray-400" />
              <span className="text-gray-300">
                {selectedZone === 'all' ? 'All Zones' : zones.find(z => z.id === selectedZone)?.name || 'Zone'}
              </span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {showZoneDropdown && (
              <div className="absolute top-full mt-1 left-0 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[150px]">
                <button
                  onClick={() => { setSelectedZone('all'); setShowZoneDropdown(false) }}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-700 ${
                    selectedZone === 'all' ? 'bg-gray-700' : ''
                  }`}
                >
                  <MapPin className="w-3 h-3 text-gray-400" />
                  <span className="text-gray-300">All Zones</span>
                </button>
                {zones.map(zone => (
                  <button
                    key={zone.id}
                    onClick={() => { setSelectedZone(zone.id); setShowZoneDropdown(false) }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-700 ${
                      selectedZone === zone.id ? 'bg-gray-700' : ''
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: zone.color }} />
                    <span className="text-gray-300">{zone.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        
        {/* KPI Selectors */}
        <div className="flex items-center gap-4">
          {/* KPI 1 - Height */}
          <div className="relative">
            <button
              onClick={() => { setShowKpi1Dropdown(!showKpi1Dropdown); setShowKpi2Dropdown(false) }}
              className="flex items-center gap-2 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getKpiColor(kpi1) }} />
              <span className="text-gray-300">Height: {KPI_OPTIONS.find(k => k.id === kpi1)?.label}</span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {showKpi1Dropdown && (
              <div className="absolute top-full mt-1 right-0 bg-gray-800 border border-gray-600 rounded shadow-lg z-50">
                {KPI_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => { setKpi1(opt.id); setShowKpi1Dropdown(false) }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-700"
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />
                    <span className="text-gray-300">{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {/* KPI 2 - Color Intensity */}
          <div className="relative">
            <button
              onClick={() => { setShowKpi2Dropdown(!showKpi2Dropdown); setShowKpi1Dropdown(false) }}
              className="flex items-center gap-2 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getKpiColor(kpi2) }} />
              <span className="text-gray-300">Color: {KPI_OPTIONS.find(k => k.id === kpi2)?.label}</span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {showKpi2Dropdown && (
              <div className="absolute top-full mt-1 right-0 bg-gray-800 border border-gray-600 rounded shadow-lg z-50">
                {KPI_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => { setKpi2(opt.id); setShowKpi2Dropdown(false) }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-700"
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />
                    <span className="text-gray-300">{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {/* Current Time */}
          <div className="flex items-center gap-2 text-xs text-gray-400 border-l border-gray-700 pl-4">
            <Clock className="w-4 h-4" />
            <span className="text-white font-mono">
              {currentSlot?.time || '--:--'}
            </span>
          </div>
        </div>
      </div>
      
      {/* Timeline Bar Chart with Scrubber */}
      <div 
        ref={timelineRef}
        className={`flex-1 relative px-2 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={handleMouseDown}
        style={{ userSelect: 'none' }}
      >
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-gray-500 border-t-blue-500 rounded-full animate-spin" />
              Loading {dateRange} data...
            </div>
          </div>
        ) : timelineData.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
            No data available for selected period
          </div>
        ) : (
          <>
            {/* Bar Chart */}
            <div className="absolute inset-0 flex items-end gap-px">
              {timelineData.map((slot, _index) => {
                const kpi1Val = getKpiValue(slot, kpi1)
                const kpi2Val = getKpiValue(slot, kpi2)
                const heightPercent = (kpi1Val / maxKpi1) * 100
                const colorIntensity = kpi2Val / maxKpi2
                const baseColor = getKpiColor(kpi2)
                
                return (
                  <div
                    key={slot.timestamp}
                    className="flex-1 min-w-[2px]"
                    style={{
                      height: `${Math.max(5, heightPercent)}%`,
                      backgroundColor: baseColor,
                      opacity: 0.3 + colorIntensity * 0.7,
                    }}
                    title={`${slot.time}\n${KPI_OPTIONS.find(k => k.id === kpi1)?.label}: ${kpi1Val}\n${KPI_OPTIONS.find(k => k.id === kpi2)?.label}: ${kpi2Val}`}
                  />
                )
              })}
            </div>
            
            {/* Insight Markers Overlay (parallel system — does not modify timeline) */}
            <TimelineInsightMarkers
              timelineStartTs={timelineData[0]?.timestamp || 0}
              timelineEndTs={timelineData[timelineData.length - 1]?.timestamp || 0}
              containerWidth={timelineRef.current?.clientWidth || 0}
              isVisible={timelineData.length > 0}
            />
            
            {/* Playhead / Scrubber Line */}
            <div 
              className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg pointer-events-none z-10"
              style={{
                left: `${(currentIndex / Math.max(1, timelineData.length - 1)) * 100}%`,
                boxShadow: '0 0 8px rgba(255,255,255,0.5)',
              }}
            >
              {/* Playhead Handle */}
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow-md" />
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow-md" />
            </div>
            
            {/* Time tooltip on drag */}
            {isDragging && currentSlot && (
              <div 
                className="absolute -top-8 px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg pointer-events-none z-20"
                style={{
                  left: `${(currentIndex / Math.max(1, timelineData.length - 1)) * 100}%`,
                  transform: 'translateX(-50%)',
                }}
              >
                {currentSlot.time}
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Time Axis */}
      {timelineData.length > 0 && (
        <div className="h-6 relative px-2 border-t border-gray-700/50 flex-shrink-0">
          <div className="absolute inset-0 flex items-center px-2">
            {(() => {
              // Calculate time labels to show (every ~2 hours for today, every day for week)
              const labelCount = dateRange === 'week' ? 7 : 6;
              const step = Math.floor(timelineData.length / labelCount);
              const labels: { index: number; label: string }[] = [];
              
              for (let i = 0; i < timelineData.length; i += Math.max(1, step)) {
                const slot = timelineData[i];
                if (dateRange === 'week') {
                  // Show date for week view
                  const d = new Date(slot.timestamp);
                  labels.push({ index: i, label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) });
                } else {
                  // Show time for today/yesterday
                  labels.push({ index: i, label: slot.time });
                }
              }
              
              return labels.map(({ index, label }) => (
                <div
                  key={index}
                  className="absolute text-[10px] text-gray-500 transform -translate-x-1/2"
                  style={{ left: `${(index / Math.max(1, timelineData.length - 1)) * 100}%` }}
                >
                  {label}
                </div>
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
