/**
 * DOOH Analytics Page
 * 
 * Digital Out-Of-Home analytics for digital display screens.
 * Uses LiDAR trajectory data to compute attention opportunity metrics.
 * 
 * Feature flag: FEATURE_DOOH_KPIS
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Monitor,
  Plus,
  Settings,
  Play,
  RefreshCw,
  ChevronRight,
  Clock,
  Users,
  Eye,
  Zap,
  TrendingUp,
  Calendar,
  X,
  Save,
  Trash2,
  AlertCircle,
  HelpCircle,
  Power,
} from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { TierCard, ImpressionsChart, AqsGauge, AqsHistogram } from './DoohCharts'
import { KPI_DEFINITIONS } from '../kpi/kpiDefinitions'
import PlaylistManager from './PlaylistManager'

type AnalyticsTab = 'overview' | 'timeseries' | 'attention' | 'video'

interface VideoKpi {
  videoId: string
  videoName: string
  videoDurationMs: number
  playCount: number
  totalImpressions: number
  qualifiedImpressions: number
  avgDwellS: number | null
  avgAqs: number | null
  totalPlayDurationMs: number
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

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
          className="fixed w-72 p-3 bg-gray-900 border border-gray-600 rounded-lg shadow-2xl text-xs text-gray-300 leading-relaxed pointer-events-none"
          style={{
            zIndex: 99999,
            top: tooltipPos.top,
            left: tooltipPos.left,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {definition.split('\n').map((line, i) => {
            const formattedLine = line.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white">$1</strong>')
            return (
              <span key={i} className={line === '' ? 'block h-2' : 'block'} dangerouslySetInnerHTML={{ __html: formattedLine }} />
            )
          })}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-600" />
        </div>
      )}
    </div>
  )
}

interface DoohScreen {
  id: string
  venueId: string
  objectId: string | null
  name: string
  position: { x: number; y: number; z: number }
  yawDeg: number
  mountHeightM: number
  sezPolygon: { x: number; z: number }[]
  azPolygon: { x: number; z: number }[] | null
  params: Record<string, any>
  doubleSided: boolean  // If true, screen has SEZ on both sides (yaw and yaw+180)
  enabled: boolean
  createdAt: string
  updatedAt: string
}

interface DoohKpiBucket {
  id: string
  screenId: string
  bucketStartTs: number
  bucketMinutes: number
  impressions: number
  qualifiedImpressions: number
  premiumImpressions: number
  uniqueVisitors: number
  avgAqs: number | null
  p75Aqs: number | null
  totalAttentionS: number
  avgAttentionS: number | null
  freqAvg: number | null
  contextBreakdown: Record<string, any> | null
}

interface RunResult {
  success: boolean
  screens: number
  tracks: number
  events: number
  buckets: number
}

// Default SEZ geometry params
const DEFAULT_SEZ_PARAMS = {
  sez_reach_m: 15,
  sez_near_width_m: 2.0,
  sez_far_width_m: 12.0,
}

// Ensure SEZ params are initialized when editing
const ensureSezParams = (screen: Partial<DoohScreen>): Partial<DoohScreen> => {
  console.log('🔧 ensureSezParams - input SEZ:', { 
    reach: screen.params?.sez_reach_m, 
    near: screen.params?.sez_near_width_m, 
    far: screen.params?.sez_far_width_m 
  })
  const result = {
    ...screen,
    params: {
      ...DEFAULT_SEZ_PARAMS,
      ...screen.params,
    },
  }
  console.log('🔧 ensureSezParams - result SEZ:', { 
    reach: result.params?.sez_reach_m, 
    near: result.params?.sez_near_width_m, 
    far: result.params?.sez_far_width_m 
  })
  return result
}

export default function DoohAnalyticsPage({ onClose }: { onClose: () => void }) {
  const { venue } = useVenue()
  const [screens, setScreens] = useState<DoohScreen[]>([])
  const [selectedScreen, setSelectedScreen] = useState<DoohScreen | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [kpiBuckets, setKpiBuckets] = useState<DoohKpiBucket[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [editingScreen, setEditingScreen] = useState<Partial<DoohScreen> | null>(null)
  const [availableDisplays, setAvailableDisplays] = useState<Array<{
    id: string
    name: string
    position: { x: number; y: number; z: number }
    yawDeg: number
  }>>([])
  const [showDisplayPicker, setShowDisplayPicker] = useState(false)
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview')
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [consolidation, setConsolidation] = useState<'hour' | 'day' | 'week' | 'month'>('hour')
  const [videoKpis, setVideoKpis] = useState<VideoKpi[]>([])
  const [isLoadingVideoKpis, setIsLoadingVideoKpis] = useState(false)

  // Time range for KPIs
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | 'custom'>('24h')
  const [customStartTs, setCustomStartTs] = useState<number>(Date.now() - 24 * 60 * 60 * 1000)
  const [customEndTs, setCustomEndTs] = useState<number>(Date.now())

  const getTimeRange = useCallback(() => {
    const now = Date.now()
    switch (timeRange) {
      case '1h':
        return { startTs: now - 60 * 60 * 1000, endTs: now }
      case '24h':
        return { startTs: now - 24 * 60 * 60 * 1000, endTs: now }
      case '7d':
        return { startTs: now - 7 * 24 * 60 * 60 * 1000, endTs: now }
      case 'custom':
        return { startTs: customStartTs, endTs: customEndTs }
    }
  }, [timeRange, customStartTs, customEndTs])

  // Load screens
  const loadScreens = useCallback(async () => {
    if (!venue?.id) return
    setIsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/dooh/screens?venueId=${venue.id}&_t=${Date.now()}`)
      if (!res.ok) {
        if (res.status === 404) {
          setError('DOOH KPI feature not enabled. Set FEATURE_DOOH_KPIS=true')
          return
        }
        throw new Error('Failed to load screens')
      }
      const data = await res.json()
      console.log('📋 Loaded screens:', data.screens?.map((s: DoohScreen) => ({ 
        id: s.id, 
        name: s.name, 
        sez_reach_m: s.params?.sez_reach_m,
        sez_near_width_m: s.params?.sez_near_width_m,
        sez_far_width_m: s.params?.sez_far_width_m
      })))
      setScreens(data.screens || [])
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [venue?.id])

  // Load available digital display objects from venue
  const loadAvailableDisplays = useCallback(async () => {
    if (!venue?.id) return
    try {
      const res = await fetch(`${API_BASE}/api/dooh/available-displays?venueId=${venue.id}`)
      if (res.ok) {
        const data = await res.json()
        setAvailableDisplays(data.displays || [])
      }
    } catch (err) {
      console.error('Failed to load available displays:', err)
    }
  }, [venue?.id])

  // Cache key for localStorage
  const getCacheKey = (screenId: string) => `dooh_kpis_${screenId}`
  const getVideoKpiCacheKey = (screenId: string) => `dooh_video_kpis_${screenId}`

  // Load cached KPIs from localStorage
  const loadCachedKpis = useCallback((screenId: string) => {
    try {
      const cached = localStorage.getItem(getCacheKey(screenId))
      if (cached) {
        const { buckets, timestamp } = JSON.parse(cached)
        console.log('📦 Loaded cached KPIs for screen', screenId, 'from', new Date(timestamp).toLocaleTimeString())
        return buckets
      }
    } catch (err) {
      console.error('Failed to load cached KPIs:', err)
    }
    return null
  }, [])

  // Save KPIs to localStorage cache
  const saveCachedKpis = useCallback((screenId: string, buckets: DoohKpiBucket[]) => {
    try {
      localStorage.setItem(getCacheKey(screenId), JSON.stringify({
        buckets,
        timestamp: Date.now()
      }))
      console.log('💾 Cached KPIs for screen', screenId)
    } catch (err) {
      console.error('Failed to cache KPIs:', err)
    }
  }, [])

  // Load cached video KPIs from localStorage
  const loadCachedVideoKpis = useCallback((screenId: string): VideoKpi[] | null => {
    try {
      const cached = localStorage.getItem(getVideoKpiCacheKey(screenId))
      if (cached) {
        const { videoKpis: kpis, timestamp } = JSON.parse(cached)
        console.log('📦 Loaded cached video KPIs for screen', screenId, 'from', new Date(timestamp).toLocaleTimeString())
        return kpis
      }
    } catch (err) {
      console.error('Failed to load cached video KPIs:', err)
    }
    return null
  }, [])

  // Save video KPIs to localStorage cache
  const saveCachedVideoKpis = useCallback((screenId: string, kpis: VideoKpi[]) => {
    try {
      localStorage.setItem(getVideoKpiCacheKey(screenId), JSON.stringify({
        videoKpis: kpis,
        timestamp: Date.now()
      }))
      console.log('💾 Cached video KPIs for screen', screenId)
    } catch (err) {
      console.error('Failed to cache video KPIs:', err)
    }
  }, [])

  // Load KPIs for selected screen (from API)
  const loadKpis = useCallback(async () => {
    if (!selectedScreen) return
    const { startTs, endTs } = getTimeRange()
    try {
      const res = await fetch(
        `${API_BASE}/api/dooh/kpis?screenId=${selectedScreen.id}&startTs=${startTs}&endTs=${endTs}`
      )
      if (!res.ok) throw new Error('Failed to load KPIs')
      const data = await res.json()
      const buckets = data.buckets || []
      setKpiBuckets(buckets)
      // Cache the results
      saveCachedKpis(selectedScreen.id, buckets)
    } catch (err: any) {
      console.error('Failed to load KPIs:', err)
    }
  }, [selectedScreen, getTimeRange, saveCachedKpis])

  // Load per-video KPIs (show cached immediately, then refresh)
  const loadVideoKpis = useCallback(async () => {
    if (!selectedScreen) return
    
    // Show cached data immediately
    const cached = loadCachedVideoKpis(selectedScreen.id)
    if (cached && cached.length > 0) {
      setVideoKpis(cached)
      // Still show loading indicator but data is visible
    }
    
    setIsLoadingVideoKpis(true)
    const { startTs, endTs } = getTimeRange()
    try {
      const res = await fetch(
        `${API_BASE}/api/dooh/kpis/video?screenId=${selectedScreen.id}&startTs=${startTs}&endTs=${endTs}`
      )
      if (!res.ok) throw new Error('Failed to load video KPIs')
      const data = await res.json()
      const kpis = data.videoKpis || []
      setVideoKpis(kpis)
      // Cache the results
      saveCachedVideoKpis(selectedScreen.id, kpis)
    } catch (err: any) {
      console.error('Failed to load video KPIs:', err)
      // Keep cached data if API fails
      if (!cached) setVideoKpis([])
    } finally {
      setIsLoadingVideoKpis(false)
    }
  }, [selectedScreen, getTimeRange, loadCachedVideoKpis, saveCachedVideoKpis])

  // Run KPI computation
  const runComputation = async () => {
    if (!venue?.id) return
    setIsRunning(true)
    setRunResult(null)
    const { startTs, endTs } = getTimeRange()
    try {
      const res = await fetch(`${API_BASE}/api/dooh/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId: venue.id,
          startTs,
          endTs,
          screenIds: selectedScreen ? [selectedScreen.id] : null,
        }),
      })
      if (!res.ok) throw new Error('Computation failed')
      const result = await res.json()
      setRunResult(result)
      // Reload KPIs after computation
      if (selectedScreen) {
        await loadKpis()
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsRunning(false)
    }
  }

  // Helper to generate SEZ polygon from params
  const generateSezPolygon = (screen: Partial<DoohScreen>) => {
    const pos = screen.position || { x: 0, y: 0, z: 0 }
    const yawRad = (screen.yawDeg || 0) * Math.PI / 180
    const reach = screen.params?.sez_reach_m ?? 15
    const nearWidth = screen.params?.sez_near_width_m ?? 2.0
    const farWidth = screen.params?.sez_far_width_m ?? 12.0
    const nearDist = 0.5
    
    console.log('🔄 generateSezPolygon called with:', { 
      pos, yawDeg: screen.yawDeg, reach, nearWidth, farWidth,
      params: screen.params 
    })
    
    const dirX = Math.sin(yawRad)
    const dirZ = Math.cos(yawRad)
    const perpX = Math.cos(yawRad)
    const perpZ = -Math.sin(yawRad)
    
    const polygon = [
      { x: pos.x + dirX * nearDist - perpX * nearWidth/2, z: pos.z + dirZ * nearDist - perpZ * nearWidth/2 },
      { x: pos.x + dirX * nearDist + perpX * nearWidth/2, z: pos.z + dirZ * nearDist + perpZ * nearWidth/2 },
      { x: pos.x + dirX * reach + perpX * farWidth/2, z: pos.z + dirZ * reach + perpZ * farWidth/2 },
      { x: pos.x + dirX * reach - perpX * farWidth/2, z: pos.z + dirZ * reach - perpZ * farWidth/2 },
    ]
    console.log('🔄 Generated polygon:', polygon)
    return polygon
  }

  // Create/Update screen
  const saveScreen = async () => {
    if (!editingScreen || !venue?.id) return
    setIsSaving(true)
    setSaveSuccess(false)
    try {
      const isNew = !editingScreen.id
      const url = isNew
        ? `${API_BASE}/api/dooh/screens`
        : `${API_BASE}/api/dooh/screens/${editingScreen.id}`
      
      // Always regenerate SEZ polygon from params to ensure correct positioning
      const sezPolygon = generateSezPolygon(editingScreen)
      
      const payload = {
        ...editingScreen,
        sezPolygon,
        venueId: venue.id,
      }
      console.log('💾 Saving screen:', { 
        isNew, 
        url, 
        sez_reach_m: payload.params?.sez_reach_m,
        sez_near_width_m: payload.params?.sez_near_width_m,
        sez_far_width_m: payload.params?.sez_far_width_m,
        sezPolygonLength: payload.sezPolygon?.length 
      })
      
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      
      const responseData = await res.json()
      console.log('💾 Save response:', responseData)
      
      if (!res.ok) throw new Error(responseData.error || 'Failed to save screen')
      
      setSaveSuccess(true)
      // Brief delay to show success state before closing
      await new Promise(r => setTimeout(r, 500))
      
      setShowEditor(false)
      setEditingScreen(null)
      await loadScreens()
      await loadAvailableDisplays()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSaving(false)
    }
  }

  // Delete screen
  const deleteScreen = async (screenId: string) => {
    if (!confirm('Delete this screen?')) return
    try {
      await fetch(`${API_BASE}/api/dooh/screens/${screenId}?hard=true`, {
        method: 'DELETE',
      })
      await loadScreens()
      if (selectedScreen?.id === screenId) {
        setSelectedScreen(null)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  // Toggle screen enabled state
  const toggleEnabled = async (screen: DoohScreen) => {
    try {
      const res = await fetch(`${API_BASE}/api/dooh/screens/${screen.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...screen, enabled: !screen.enabled }),
      })
      if (!res.ok) throw new Error('Failed to update screen')
      await loadScreens()
      // Notify viewport to refresh video playback
      window.dispatchEvent(new CustomEvent('dooh-playlist-updated'))
    } catch (err: any) {
      setError(err.message)
    }
  }

  useEffect(() => {
    loadScreens()
    loadAvailableDisplays()
  }, [loadScreens, loadAvailableDisplays])

  // Load cached KPIs immediately when screen is selected (no auto-compute)
  useEffect(() => {
    if (!selectedScreen) return

    // Load cached data immediately for instant display
    const cached = loadCachedKpis(selectedScreen.id)
    if (cached) {
      setKpiBuckets(cached)
    } else {
      // No cache - show empty state, user must click Compute
      setKpiBuckets([])
    }
  }, [selectedScreen?.id, loadCachedKpis])

  // Consolidate buckets by period (hour/day/week/month)
  const consolidatedBuckets = useMemo(() => {
    if (!kpiBuckets.length) return []
    
    const getPeriodKey = (ts: number) => {
      const d = new Date(ts)
      switch (consolidation) {
        case 'hour': return `${d.toLocaleDateString()} ${d.getHours()}:00`
        case 'day': return d.toLocaleDateString()
        case 'week': {
          const startOfWeek = new Date(d)
          startOfWeek.setDate(d.getDate() - d.getDay())
          return `Week of ${startOfWeek.toLocaleDateString()}`
        }
        case 'month': return `${d.toLocaleString('default', { month: 'short' })} ${d.getFullYear()}`
      }
    }
    
    const groups: Record<string, { ts: number; impressions: number; qualified: number; premium: number; aqs: number[]; attention: number; visitors: number }> = {}
    
    kpiBuckets.forEach(b => {
      const key = getPeriodKey(b.bucketStartTs)
      if (!groups[key]) groups[key] = { ts: b.bucketStartTs, impressions: 0, qualified: 0, premium: 0, aqs: [], attention: 0, visitors: 0 }
      groups[key].impressions += b.impressions
      groups[key].qualified += b.qualifiedImpressions
      groups[key].premium += b.premiumImpressions
      if (b.avgAqs != null) groups[key].aqs.push(b.avgAqs)
      groups[key].attention += b.totalAttentionS
      groups[key].visitors += b.uniqueVisitors
      if (b.bucketStartTs < groups[key].ts) groups[key].ts = b.bucketStartTs
    })
    
    return Object.entries(groups).map(([label, g]) => ({
      label,
      bucketStartTs: g.ts,
      impressions: g.impressions,
      qualifiedImpressions: g.qualified,
      premiumImpressions: g.premium,
      avgAqs: g.aqs.length ? g.aqs.reduce((a, b) => a + b, 0) / g.aqs.length : null,
      totalAttentionS: g.attention,
      uniqueVisitors: g.visitors,
    })).sort((a, b) => a.bucketStartTs - b.bucketStartTs)
  }, [kpiBuckets, consolidation])

  // Calculate summary stats
  const summaryStats = {
    totalImpressions: kpiBuckets.reduce((sum, b) => sum + b.impressions, 0),
    qualifiedImpressions: kpiBuckets.reduce((sum, b) => sum + b.qualifiedImpressions, 0),
    premiumImpressions: kpiBuckets.reduce((sum, b) => sum + b.premiumImpressions, 0),
    avgAqs: kpiBuckets.length > 0
      ? kpiBuckets.reduce((sum, b) => sum + (b.avgAqs || 0), 0) / kpiBuckets.length
      : 0,
    totalAttention: kpiBuckets.reduce((sum, b) => sum + b.totalAttentionS, 0),
    uniqueVisitors: kpiBuckets.reduce((sum, b) => sum + b.uniqueVisitors, 0),
  }

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col">
      {/* Header */}
      <div className="h-14 bg-gray-800 border-b border-gray-700 flex items-center px-4 gap-4">
        <Monitor className="w-6 h-6 text-purple-400" />
        <h1 className="text-lg font-semibold text-white">DOOH Analytics</h1>
        <span className="text-xs bg-purple-600/30 text-purple-300 px-2 py-0.5 rounded">
          Digital Display Attention Metrics
        </span>
        <div className="flex-1" />
        
        {/* Time Range Selector */}
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as any)}
            className="bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600"
          >
            <option value="1h">Last 1 hour</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-900/50 border-b border-red-700 px-4 py-2 flex items-center gap-2 text-red-300">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Screen List */}
        <div className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col">
          <div className="p-3 border-b border-gray-700 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">Screens</span>
            <div className="relative">
              <button
                onClick={() => setShowDisplayPicker(!showDisplayPicker)}
                className="p-1 bg-purple-600 hover:bg-purple-500 rounded text-white"
                title="Add Screen from Digital Display"
              >
                <Plus className="w-4 h-4" />
              </button>
              
              {/* Display Picker Dropdown */}
              {showDisplayPicker && (
                <div className="absolute right-0 top-8 w-64 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-50">
                  <div className="p-2 border-b border-gray-600">
                    <span className="text-xs text-gray-400">Select Digital Display</span>
                  </div>
                  {availableDisplays.length === 0 ? (
                    <div className="p-3 text-center text-gray-400 text-sm">
                      No unconfigured displays found
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto">
                      {availableDisplays.map((display) => (
                        <button
                          key={display.id}
                          onClick={() => {
                            // Generate viewing cone SEZ based on yaw direction
                            // yaw 0° = facing +Z, 90° = facing +X
                            const yawRad = (display.yawDeg || 0) * Math.PI / 180
                            const px = display.position.x
                            const pz = display.position.z
                            
                            // Viewing cone parameters (defaults)
                            const nearDist = 0.5  // Start 0.5m in front of screen
                            const farDist = 15    // Extend 15m out (configurable via sez_reach_m)
                            const nearWidth = 2   // 2m wide at near
                            const farWidth = 12   // 12m wide at far (cone spread)
                            
                            // Direction vector (facing direction)
                            const dirX = Math.sin(yawRad)
                            const dirZ = Math.cos(yawRad)
                            
                            // Perpendicular vector (left/right)
                            const perpX = Math.cos(yawRad)
                            const perpZ = -Math.sin(yawRad)
                            
                            // Generate trapezoid points (near-left, near-right, far-right, far-left)
                            const sezPolygon = [
                              { x: px + dirX * nearDist - perpX * nearWidth/2, z: pz + dirZ * nearDist - perpZ * nearWidth/2 },
                              { x: px + dirX * nearDist + perpX * nearWidth/2, z: pz + dirZ * nearDist + perpZ * nearWidth/2 },
                              { x: px + dirX * farDist + perpX * farWidth/2, z: pz + dirZ * farDist + perpZ * farWidth/2 },
                              { x: px + dirX * farDist - perpX * farWidth/2, z: pz + dirZ * farDist - perpZ * farWidth/2 },
                            ]
                            
                            setEditingScreen({
                              objectId: display.id,
                              name: display.name,
                              position: display.position,
                              yawDeg: display.yawDeg,
                              mountHeightM: display.position.y || 2.5,
                              sezPolygon,
                              params: { sez_reach_m: farDist, sez_near_width_m: nearWidth, sez_far_width_m: farWidth },
                              enabled: true,
                            })
                            setShowDisplayPicker(false)
                            setShowEditor(true)
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-gray-600 text-white text-sm flex items-center gap-2"
                        >
                          <Monitor className="w-4 h-4 text-purple-400" />
                          <div>
                            <div className="font-medium">{display.name}</div>
                            <div className="text-xs text-gray-400">
                              ({display.position.x.toFixed(1)}, {display.position.z.toFixed(1)})
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="p-2 border-t border-gray-600">
                    <button
                      onClick={() => {
                        // Generate proper cone-shaped SEZ (facing +Z direction at yaw=0)
                        const pos = { x: 0, y: 2.5, z: 0 }
                        const reach = 15, nearWidth = 2, farWidth = 12, nearDist = 0.5
                        setEditingScreen({
                          name: 'New Screen',
                          position: pos,
                          yawDeg: 0,
                          mountHeightM: 2.5,
                          sezPolygon: [
                            { x: pos.x - nearWidth/2, z: pos.z + nearDist },      // near-left
                            { x: pos.x + nearWidth/2, z: pos.z + nearDist },      // near-right
                            { x: pos.x + farWidth/2, z: pos.z + reach },          // far-right
                            { x: pos.x - farWidth/2, z: pos.z + reach },          // far-left
                          ],
                          params: { sez_reach_m: reach, sez_near_width_m: nearWidth, sez_far_width_m: farWidth },
                          enabled: true,
                        })
                        setShowDisplayPicker(false)
                        setShowEditor(true)
                      }}
                      className="w-full text-xs text-gray-400 hover:text-white py-1"
                    >
                      + Add manually instead
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {isLoading ? (
              <div className="text-center text-gray-500 py-8">
                <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
                <p className="text-sm">Loading screens...</p>
              </div>
            ) : screens.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <Monitor className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No screens configured</p>
                <p className="text-xs mt-1">Add a digital display screen to start</p>
              </div>
            ) : (
              screens.map((screen) => (
                <div
                  key={screen.id}
                  onClick={() => setSelectedScreen(screen)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedScreen?.id === screen.id
                      ? 'bg-purple-600/30 border border-purple-500'
                      : 'bg-gray-700/50 hover:bg-gray-700 border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{screen.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleEnabled(screen)
                        }}
                        className={`p-1 rounded transition-colors ${
                          screen.enabled 
                            ? 'bg-green-600/30 text-green-400 hover:bg-green-600/50' 
                            : 'bg-gray-600/30 text-gray-500 hover:bg-gray-600/50'
                        }`}
                        title={screen.enabled ? 'Disable screen' : 'Enable screen'}
                      >
                        <Power className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingScreen(ensureSezParams(screen))
                          setShowEditor(true)
                        }}
                        className="p-1 hover:bg-gray-600 rounded text-gray-400 hover:text-white"
                      >
                        <Settings className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteScreen(screen.id)
                        }}
                        className="p-1 hover:bg-red-600/50 rounded text-gray-400 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                    <span className={screen.enabled ? 'text-green-400' : 'text-gray-500'}>
                      {screen.enabled ? '● Active' : '○ Disabled'}
                    </span>
                    <span>•</span>
                    <span>SEZ: {screen.sezPolygon.length} pts</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Run Button */}
          <div className="p-3 border-t border-gray-700">
            <button
              onClick={runComputation}
              disabled={isRunning || screens.length === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Computing...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Compute KPIs
                </>
              )}
            </button>
            {runResult && (
              <div className="mt-2 text-xs text-gray-400 text-center">
                Processed {runResult.tracks} tracks → {runResult.events} events → {runResult.buckets} buckets
              </div>
            )}
          </div>
        </div>

        {/* Main Dashboard Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedScreen ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <Monitor className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg">Select a screen to view analytics</p>
                <p className="text-sm mt-2">or add a new screen to get started</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Screen Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white">{selectedScreen.name}</h2>
                  <p className="text-gray-400 text-sm">
                    Position: ({selectedScreen.position.x.toFixed(1)}, {selectedScreen.position.z.toFixed(1)}) • 
                    Yaw: {selectedScreen.yawDeg}° • 
                    Height: {selectedScreen.mountHeightM}m
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (selectedScreen) setEditingScreen(ensureSezParams(selectedScreen))
                    setShowEditor(true)
                  }}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
                >
                  <Settings className="w-4 h-4" />
                  Configure
                </button>
              </div>

              {/* Live Banner - fixed position, fade in/out without layout shift */}
              <div className={`bg-gradient-to-r from-purple-900/50 to-blue-900/50 border border-purple-500/30 rounded-lg px-4 py-3 flex items-center gap-3 transition-opacity duration-300 ${isRunning ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-sm text-white">Live tracking active</span>
                <span className="text-xs text-gray-400 ml-auto">{summaryStats.totalImpressions} impressions</span>
              </div>

              {/* Tabs Row */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                {/* Main Tabs */}
                <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                  {(['overview', 'timeseries', 'attention', 'video'] as AnalyticsTab[]).map(tab => (
                    <button
                      key={tab}
                      onClick={() => {
                        setActiveTab(tab)
                        if (tab === 'video') loadVideoKpis()
                      }}
                      className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                        activeTab === tab ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
                      }`}
                    >
                      {tab === 'overview' ? 'Overview' : tab === 'timeseries' ? 'Time Series' : tab === 'attention' ? 'Attention Quality' : 'Video Analytics'}
                    </button>
                  ))}
                </div>
                
                {/* Consolidation Period */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Group by:</span>
                  <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                    {(['hour', 'day', 'week', 'month'] as const).map(period => (
                      <button
                        key={period}
                        onClick={() => setConsolidation(period)}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          consolidation === period ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        {period.charAt(0).toUpperCase() + period.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* OVERVIEW TAB */}
              {activeTab === 'overview' && (
                <div className="space-y-4">
                  {/* Tier Breakdown Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <TierCard tier="Basic Impressions" count={summaryStats.totalImpressions - summaryStats.qualifiedImpressions} total={summaryStats.totalImpressions} color="#6b7280" icon={Eye} />
                    <TierCard tier="Qualified" count={summaryStats.qualifiedImpressions - summaryStats.premiumImpressions} total={summaryStats.totalImpressions} color="#eab308" icon={Zap} />
                    <TierCard tier="Premium" count={summaryStats.premiumImpressions} total={summaryStats.totalImpressions} color="#22c55e" icon={TrendingUp} />
                  </div>
                  
                  {/* Summary Row */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-center gap-2 text-gray-400 mb-1"><Eye className="w-4 h-4" /><span className="text-xs">Total Impressions</span><HelpTooltip definitionKey="totalImpressions" /></div>
                      <div className="text-2xl font-bold text-white">{summaryStats.totalImpressions}</div>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-center gap-2 text-gray-400 mb-1"><Clock className="w-4 h-4 text-blue-400" /><span className="text-xs">Total Attention</span><HelpTooltip definitionKey="totalAttention" /></div>
                      <div className="text-2xl font-bold text-blue-400">{(summaryStats.totalAttention / 60).toFixed(1)}m</div>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-center gap-2 text-gray-400 mb-1"><Users className="w-4 h-4 text-cyan-400" /><span className="text-xs">Unique Visitors</span><HelpTooltip definitionKey="uniqueVisitors" /></div>
                      <div className="text-2xl font-bold text-cyan-400">{summaryStats.uniqueVisitors}</div>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 flex items-center justify-center">
                      <AqsGauge value={summaryStats.avgAqs} size={80} />
                    </div>
                  </div>

                  {/* Impressions Chart */}
                  <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                    <h3 className="text-sm font-medium text-white mb-3">Impressions by {consolidation.charAt(0).toUpperCase() + consolidation.slice(1)}</h3>
                    <ImpressionsChart buckets={consolidatedBuckets} height={160} />
                  </div>
                </div>
              )}

              {/* TIME SERIES TAB */}
              {activeTab === 'timeseries' && (
                <div className="space-y-4">
                  <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                    <h3 className="text-sm font-medium text-white mb-3">Impressions by {consolidation.charAt(0).toUpperCase() + consolidation.slice(1)}</h3>
                    <ImpressionsChart buckets={consolidatedBuckets} height={180} />
                  </div>
                  <div className="bg-gray-800 rounded-lg border border-gray-700">
                    <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                      <h3 className="font-medium text-white">By {consolidation.charAt(0).toUpperCase() + consolidation.slice(1)}</h3>
                      <span className="text-xs text-gray-500">{consolidatedBuckets.length} periods</span>
                    </div>
                    <div className="overflow-x-auto max-h-80">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-700/50 sticky top-0">
                          <tr>
                            <th className="px-4 py-2 text-left text-gray-400">Period</th>
                            <th className="px-4 py-2 text-right text-gray-400">Total</th>
                            <th className="px-4 py-2 text-right text-gray-400">Qual</th>
                            <th className="px-4 py-2 text-right text-gray-400">Prem</th>
                            <th className="px-4 py-2 text-right text-gray-400">AQS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {consolidatedBuckets.length === 0 ? (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No data</td></tr>
                          ) : (
                            [...consolidatedBuckets].reverse().slice(0, 20).map((bucket, idx) => (
                              <tr key={idx} className="border-t border-gray-700 hover:bg-gray-700/30">
                                <td className="px-4 py-2 text-gray-300 text-xs">{bucket.label}</td>
                                <td className="px-4 py-2 text-right text-white">{bucket.impressions}</td>
                                <td className="px-4 py-2 text-right text-yellow-400">{bucket.qualifiedImpressions}</td>
                                <td className="px-4 py-2 text-right text-green-400">{bucket.premiumImpressions}</td>
                                <td className="px-4 py-2 text-right text-purple-400">{bucket.avgAqs?.toFixed(1) || '-'}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ATTENTION QUALITY TAB */}
              {activeTab === 'attention' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 flex flex-col items-center">
                      <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-1">Average AQS Score<HelpTooltip definitionKey="avgAqs" /></h3>
                      <AqsGauge value={summaryStats.avgAqs} size={120} />
                      <div className="mt-4 text-xs text-gray-400 text-center">
                        {summaryStats.avgAqs >= 70 ? 'Premium quality attention' : summaryStats.avgAqs >= 40 ? 'Qualified attention' : 'Basic attention'}
                      </div>
                    </div>
                    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                      <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-1">AQS Distribution<HelpTooltip definitionKey="aqsDistribution" /></h3>
                      <AqsHistogram buckets={kpiBuckets} />
                      <div className="mt-4 flex justify-between text-xs text-gray-500">
                        <span>Low (0-40)</span>
                        <span>Medium (40-70)</span>
                        <span>High (70-100)</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">Avg Attention Time<HelpTooltip definitionKey="avgAttentionTime" /></div>
                      <div className="text-xl font-bold text-blue-400">{(summaryStats.totalAttention / Math.max(summaryStats.totalImpressions, 1)).toFixed(1)}s</div>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">Total Attention<HelpTooltip definitionKey="totalAttention" /></div>
                      <div className="text-xl font-bold text-blue-400">{(summaryStats.totalAttention / 60).toFixed(1)}m</div>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">Qualified Rate<HelpTooltip definitionKey="qualifiedRate" /></div>
                      <div className="text-xl font-bold text-yellow-400">{summaryStats.totalImpressions > 0 ? ((summaryStats.qualifiedImpressions / summaryStats.totalImpressions) * 100).toFixed(0) : 0}%</div>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">Premium Rate<HelpTooltip definitionKey="premiumRate" /></div>
                      <div className="text-xl font-bold text-green-400">{summaryStats.totalImpressions > 0 ? ((summaryStats.premiumImpressions / summaryStats.totalImpressions) * 100).toFixed(0) : 0}%</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Parameters Display */}
              <div className="bg-gray-800 rounded-lg border border-gray-700">
                <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                  <h3 className="font-medium text-white">Screen Parameters</h3>
                  <button
                    onClick={() => {
                      if (selectedScreen) setEditingScreen(ensureSezParams(selectedScreen))
                      setShowEditor(true)
                    }}
                    className="text-xs text-purple-400 hover:text-purple-300"
                  >
                    Edit <ChevronRight className="w-3 h-3 inline" />
                  </button>
                </div>
                <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-400">Min Duration:</span>
                    <span className="ml-2 text-white">{selectedScreen.params.T_min_seconds || 0.7}s</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Attention Speed Max:</span>
                    <span className="ml-2 text-white">{selectedScreen.params.speed_attention_max_mps || 1.2} m/s</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Distance Range:</span>
                    <span className="ml-2 text-white">
                      {selectedScreen.params.d_min_m || 0.8} - {selectedScreen.params.d_max_m || 4.0}m
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">AQS Thresholds:</span>
                    <span className="ml-2 text-white">
                      Q≥{selectedScreen.params.AQS_qualified_min || 40} P≥{selectedScreen.params.AQS_premium_min || 70}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIDEO ANALYTICS TAB */}
          {activeTab === 'video' && (
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-medium text-white flex items-center gap-2">
                    <Play className="w-4 h-4 text-purple-400" />
                    Per-Video Performance
                  </h4>
                  <button
                    onClick={() => loadVideoKpis()}
                    disabled={isLoadingVideoKpis}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingVideoKpis ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
                
                {isLoadingVideoKpis && videoKpis.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                    Loading video analytics...
                  </div>
                ) : videoKpis.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <Play className="w-8 h-8 mx-auto text-gray-500 mb-2" />
                    <p className="text-sm">No video playback data available</p>
                    <p className="text-xs text-gray-500 mt-1">Upload videos to the screen playlist to start tracking</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {videoKpis
                      .filter(vkpi => vkpi.videoName && vkpi.videoDurationMs > 0) // Filter out invalid/stale entries
                      .map((vkpi, index) => (
                      <div key={vkpi.videoId} className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h5 className="text-white font-medium">{vkpi.videoName || `Video ${index + 1}`}</h5>
                            <p className="text-xs text-gray-400">
                              Duration: {Math.round((vkpi.videoDurationMs || 0) / 1000)}s
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-lg font-bold text-purple-400">{vkpi.playCount}</span>
                            <p className="text-xs text-gray-400">plays</p>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div className="bg-gray-800/50 rounded p-2">
                            <div className="text-xs text-gray-400">Total Impressions</div>
                            <div className="text-white font-medium">{vkpi.totalImpressions}</div>
                          </div>
                          <div className="bg-gray-800/50 rounded p-2">
                            <div className="text-xs text-gray-400">Qualified</div>
                            <div className="text-yellow-400 font-medium">{vkpi.qualifiedImpressions}</div>
                          </div>
                          <div className="bg-gray-800/50 rounded p-2">
                            <div className="text-xs text-gray-400">Avg Dwell</div>
                            <div className="text-blue-400 font-medium">
                              {vkpi.avgDwellS ? `${vkpi.avgDwellS.toFixed(1)}s` : '-'}
                            </div>
                          </div>
                          <div className="bg-gray-800/50 rounded p-2">
                            <div className="text-xs text-gray-400">Avg AQS</div>
                            <div className="text-green-400 font-medium">
                              {vkpi.avgAqs ? Math.round(vkpi.avgAqs) : '-'}
                            </div>
                          </div>
                        </div>
                        
                        {/* Impressions per play calculation */}
                        <div className="mt-3 pt-3 border-t border-gray-600">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-400">Impressions per play</span>
                            <span className="text-white font-medium">
                              {vkpi.playCount > 0 ? (vkpi.totalImpressions / vkpi.playCount).toFixed(1) : '-'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs mt-1">
                            <span className="text-gray-400">Total airtime</span>
                            <span className="text-white font-medium">
                              {Math.round((vkpi.totalPlayDurationMs || 0) / 60000)}m
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <p className="text-xs text-gray-500">
                Video analytics are based on proof-of-play records matched with trajectory data during playback windows.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Screen Editor Modal */}
      {showEditor && editingScreen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60">
          <div className="bg-gray-800 rounded-lg w-[600px] max-h-[80vh] overflow-y-auto shadow-xl border border-gray-700">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="font-medium text-white">
                {editingScreen.id ? 'Edit Screen' : 'Add Screen'}
              </h3>
              <button
                onClick={() => {
                  setShowEditor(false)
                  setEditingScreen(null)
                }}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Basic Info */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Screen Name</label>
                <input
                  type="text"
                  value={editingScreen.name || ''}
                  onChange={(e) => setEditingScreen({ ...editingScreen, name: e.target.value })}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600"
                  placeholder="e.g., Checkout Display 1"
                />
              </div>

              {/* Position */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Position X (m)</label>
                  <input
                    type="number"
                    value={editingScreen.position?.x || 0}
                    onChange={(e) => setEditingScreen({
                      ...editingScreen,
                      position: { ...editingScreen.position!, x: parseFloat(e.target.value) }
                    })}
                    className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600"
                    step="0.1"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Position Z (m)</label>
                  <input
                    type="number"
                    value={editingScreen.position?.z || 0}
                    onChange={(e) => setEditingScreen({
                      ...editingScreen,
                      position: { ...editingScreen.position!, z: parseFloat(e.target.value) }
                    })}
                    className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600"
                    step="0.1"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Mount Height (m)</label>
                  <input
                    type="number"
                    value={editingScreen.mountHeightM || 2.5}
                    onChange={(e) => setEditingScreen({
                      ...editingScreen,
                      mountHeightM: parseFloat(e.target.value)
                    })}
                    className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600"
                    step="0.1"
                  />
                </div>
              </div>

              {/* Yaw */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Facing Direction (Yaw °)</label>
                <input
                  type="number"
                  value={editingScreen.yawDeg || 0}
                  onChange={(e) => {
                    const newYaw = parseFloat(e.target.value)
                    const newScreen = { ...editingScreen, yawDeg: newYaw }
                    newScreen.sezPolygon = generateSezPolygon(newScreen)
                    setEditingScreen(newScreen)
                  }}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600"
                  min="-180"
                  max="180"
                />
                <p className="text-xs text-gray-500 mt-1">0° = facing +Z, 90° = facing +X</p>
              </div>

              {/* Double-Sided Toggle */}
              <div className="flex items-center justify-between py-2">
                <div>
                  <label className="text-sm text-gray-400">Double-Sided Screen</label>
                  <p className="text-xs text-gray-500">SEZ on both front and back</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingScreen.doubleSided || false}
                    onChange={(e) => setEditingScreen({ ...editingScreen, doubleSided: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

              {/* SEZ Viewing Cone Geometry */}
              <div className="border-t border-gray-700 pt-4">
                <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                  <Eye className="w-4 h-4 text-purple-400" />
                  Viewing Cone Geometry
                </h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Reach Distance (meters)
                    </label>
                    <input
                      type="range"
                      min="5"
                      max="50"
                      step="1"
                      value={editingScreen.params?.sez_reach_m || 15}
                      onChange={(e) => {
                        const newReach = parseFloat(e.target.value)
                        const newParams = { ...editingScreen.params, sez_reach_m: newReach }
                        const newScreen = { ...editingScreen, params: newParams }
                        newScreen.sezPolygon = generateSezPolygon(newScreen)
                        setEditingScreen(newScreen)
                      }}
                      className="w-full accent-purple-500"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>5m</span>
                      <span className="text-purple-400 font-medium">{editingScreen.params?.sez_reach_m || 15}m</span>
                      <span>50m</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Near Width (m)</label>
                      <input
                        type="number"
                        value={editingScreen.params?.sez_near_width_m || 2.0}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 2.0
                          const newParams = { ...editingScreen.params, sez_near_width_m: val }
                          const newScreen = { ...editingScreen, params: newParams }
                          newScreen.sezPolygon = generateSezPolygon(newScreen)
                          setEditingScreen(newScreen)
                        }}
                        className="w-full bg-gray-700 text-white rounded px-2 py-1 border border-gray-600 text-sm"
                        step="0.5"
                        min="0.5"
                        max="10"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Far Width (m)</label>
                      <input
                        type="number"
                        value={editingScreen.params?.sez_far_width_m || 12.0}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 12.0
                          const newParams = { ...editingScreen.params, sez_far_width_m: val }
                          const newScreen = { ...editingScreen, params: newParams }
                          newScreen.sezPolygon = generateSezPolygon(newScreen)
                          setEditingScreen(newScreen)
                        }}
                        className="w-full bg-gray-700 text-white rounded px-2 py-1 border border-gray-600 text-sm"
                        step="0.5"
                        min="2"
                        max="30"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newSezPolygon = generateSezPolygon(editingScreen)
                      setEditingScreen({ ...editingScreen, sezPolygon: newSezPolygon })
                    }}
                    className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-sm font-medium transition-colors"
                  >
                    Preview SEZ Polygon
                  </button>
                  <p className="text-xs text-gray-500 mt-1">
                    SEZ polygon is auto-generated from params on save
                  </p>
                </div>
              </div>

              {/* SEZ Polygon (advanced - show as JSON) */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  SEZ Polygon (Advanced)
                </label>
                <textarea
                  value={JSON.stringify(editingScreen.sezPolygon || [], null, 2)}
                  onChange={(e) => {
                    try {
                      const polygon = JSON.parse(e.target.value)
                      setEditingScreen({ ...editingScreen, sezPolygon: polygon })
                    } catch {}
                  }}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 font-mono text-xs"
                  rows={4}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Auto-generated from cone params, or manually edit as {"{ x, z }"} points
                </p>
              </div>

              {/* Key Parameters */}
              <div className="border-t border-gray-700 pt-4">
                <h4 className="text-sm font-medium text-white mb-3">Key Parameters</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Min Duration (s)</label>
                    <input
                      type="number"
                      value={editingScreen.params?.T_min_seconds || 0.7}
                      onChange={(e) => setEditingScreen({
                        ...editingScreen,
                        params: { ...editingScreen.params, T_min_seconds: parseFloat(e.target.value) }
                      })}
                      className="w-full bg-gray-700 text-white rounded px-2 py-1 border border-gray-600 text-sm"
                      step="0.1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Attention Speed Max (m/s)</label>
                    <input
                      type="number"
                      value={editingScreen.params?.speed_attention_max_mps || 1.2}
                      onChange={(e) => setEditingScreen({
                        ...editingScreen,
                        params: { ...editingScreen.params, speed_attention_max_mps: parseFloat(e.target.value) }
                      })}
                      className="w-full bg-gray-700 text-white rounded px-2 py-1 border border-gray-600 text-sm"
                      step="0.1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Qualified AQS Min</label>
                    <input
                      type="number"
                      value={editingScreen.params?.AQS_qualified_min || 40}
                      onChange={(e) => setEditingScreen({
                        ...editingScreen,
                        params: { ...editingScreen.params, AQS_qualified_min: parseFloat(e.target.value) }
                      })}
                      className="w-full bg-gray-700 text-white rounded px-2 py-1 border border-gray-600 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Premium AQS Min</label>
                    <input
                      type="number"
                      value={editingScreen.params?.AQS_premium_min || 70}
                      onChange={(e) => setEditingScreen({
                        ...editingScreen,
                        params: { ...editingScreen.params, AQS_premium_min: parseFloat(e.target.value) }
                      })}
                      className="w-full bg-gray-700 text-white rounded px-2 py-1 border border-gray-600 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Enabled */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enabled"
                  checked={editingScreen.enabled !== false}
                  onChange={(e) => setEditingScreen({ ...editingScreen, enabled: e.target.checked })}
                  className="rounded border-gray-600 bg-gray-700 text-purple-500"
                />
                <label htmlFor="enabled" className="text-sm text-gray-300">Enabled</label>
              </div>

              {/* Video Playlist Section - Only show for existing screens */}
              {editingScreen.id && venue?.id && (
                <div className="border-t border-gray-700 pt-4">
                  <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                    <Play className="w-4 h-4 text-purple-400" />
                    Video Playlist
                  </h4>
                  <PlaylistManager screenId={editingScreen.id} venueId={venue.id} />
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowEditor(false)
                  setEditingScreen(null)
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={saveScreen}
                disabled={isSaving}
                className={`px-4 py-2 text-white rounded flex items-center gap-2 transition-all ${
                  saveSuccess 
                    ? 'bg-green-600' 
                    : isSaving 
                      ? 'bg-purple-700 cursor-wait' 
                      : 'bg-purple-600 hover:bg-purple-500'
                }`}
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : saveSuccess ? (
                  <>
                    <Eye className="w-4 h-4" />
                    Saved!
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Screen
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
