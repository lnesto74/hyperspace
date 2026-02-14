/**
 * DoohEffectivenessPage
 * 
 * PEBLE™ - Post-Exposure Behavioral Lift Engine
 * DOOH Attribution & Effectiveness Dashboard
 * 
 * Feature flag: FEATURE_DOOH_ATTRIBUTION
 */

import { useState, useEffect, useCallback } from 'react'
import { useVenue } from '../../context/VenueContext'
import {
  ArrowLeft,
  Plus,
  Play,
  RefreshCw,
  Target,
  TrendingUp,
  Clock,
  Zap,
  BarChart3,
  Activity,
  AlertCircle,
  CheckCircle,
  Monitor,
  ShoppingBag,
  Tag,
  Package,
  Grid,
  Eye,
  Pencil,
  Users,
  Percent,
  Timer,
  Gauge,
  HelpCircle,
} from 'lucide-react'

// KPI Tooltip descriptions
const KPI_TOOLTIPS: Record<string, { title: string; description: string }> = {
  eal: {
    title: 'EAL™ - Exposure-to-Action Lift',
    description: 'Measures the relative increase in conversion rate between exposed shoppers and matched controls. A positive EAL indicates the DOOH ad drove incremental visits to the target shelf/category.',
  },
  tta: {
    title: 'TTA™ - Time-to-Action',
    description: 'Average time (in seconds) from DOOH exposure to shelf engagement. Lower values indicate faster customer response to the advertisement.',
  },
  dci: {
    title: 'DCI™ - Direction Change Index',
    description: 'Measures whether shoppers changed their trajectory toward the target after exposure. Positive values indicate the ad influenced movement direction.',
  },
  ces: {
    title: 'CES™ - Campaign Effectiveness Score',
    description: 'Overall campaign effectiveness score (0-100) combining lift, time-to-action acceleration, engagement quality, and statistical confidence. Higher is better.',
  },
  aqs: {
    title: 'AQS™ - Attention Quality Score',
    description: 'Average attention quality of exposures based on dwell time, proximity, orientation, and movement patterns. Range: 0-100.',
  },
  aar: {
    title: 'AAR™ - Attention-to-Action Rate',
    description: 'Percentage of high-quality exposures (AQS > threshold) that resulted in target engagement. Measures conversion efficiency.',
  },
  seq: {
    title: 'SEQ™ - Shelf Engagement Quality Lift',
    description: 'Additional dwell time (seconds) that exposed shoppers spent at the target shelf compared to control group.',
  },
  confidence: {
    title: 'Statistical Confidence',
    description: 'Reliability of the attribution results based on control match quality and sample size. Higher confidence means more trustworthy metrics.',
  },
  ttaAccel: {
    title: 'TTA Acceleration',
    description: 'How much faster exposed shoppers reached the target compared to controls. Values >1 indicate acceleration.',
  },
}

// Tooltip component - appears BELOW to avoid top cutoff
function KpiTooltip({ kpiKey }: { kpiKey: string }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const tooltip = KPI_TOOLTIPS[kpiKey]
  
  if (!tooltip) return null
  
  return (
    <div className="relative inline-block">
      <button
        className="text-gray-500 hover:text-gray-300 transition-colors ml-1"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={(e) => { e.stopPropagation(); setShowTooltip(!showTooltip) }}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {showTooltip && (
        <div className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-2 w-64 bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl">
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-[-1px]">
            <div className="border-4 border-transparent border-b-gray-700" />
          </div>
          <div className="text-xs font-semibold text-white mb-1">{tooltip.title}</div>
          <div className="text-xs text-gray-400 leading-relaxed">{tooltip.description}</div>
        </div>
      )}
    </div>
  )
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface Campaign {
  id: string
  venueId: string
  name: string
  screenIds: string[]
  target: {
    type: 'shelf' | 'category' | 'brand' | 'sku' | 'slot'
    ids: string[]
  }
  params: Record<string, unknown>
  enabled: boolean
  createdAt: string
  updatedAt: string
}

interface Screen {
  id: string
  name: string
  enabled: boolean
}

interface TargetOptions {
  shelves: { id: string; name: string }[]
  categories: string[]
  brands: string[]
  skus: { id: string; skuCode: string; name: string; brand?: string; category?: string }[]
}

interface KPISummary {
  totalExposed: number
  totalControls: number
  eal: number
  pExposed: number
  pControl: number
  ttaExposed: number | null
  ttaControl: number | null
  ttaAccel: number
  engagementLift: number
  aqs: number
  dciExposed: number | null
  dciControl: number | null
  confidence: number
  ces: number
  aar: number
}

interface KPIBucket {
  bucketStartTs: number
  exposedCount: number
  controlsCount: number
  pExposed: number
  pControl: number
  liftRel: number
  ttaAccel: number
  cesScore: number
  confidenceMean: number
}

interface DoohEffectivenessPageProps {
  onClose: () => void
}

export default function DoohEffectivenessPage({ onClose }: DoohEffectivenessPageProps) {
  const { venue } = useVenue()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [screens, setScreens] = useState<Screen[]>([])
  const [targetOptions, setTargetOptions] = useState<TargetOptions | null>(null)
  const [kpiSummary, setKpiSummary] = useState<KPISummary | null>(null)
  const [kpiBuckets, setKpiBuckets] = useState<KPIBucket[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [featureEnabled, setFeatureEnabled] = useState(true)
  
  // Campaign builder state
  const [showBuilder, setShowBuilder] = useState(false)
  const [builderName, setBuilderName] = useState('')
  const [builderScreenIds, setBuilderScreenIds] = useState<string[]>([])
  const [builderTargetType, setBuilderTargetType] = useState<'shelf' | 'category' | 'brand' | 'sku'>('category')
  const [builderTargetIds, setBuilderTargetIds] = useState<string[]>([])
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null)
  
  // Time range
  const [timeRange, setTimeRange] = useState<'hour' | 'day' | 'week'>('day')
  
  // Debug panel
  const [showDebug, setShowDebug] = useState(false)
  const [debugEvents, setDebugEvents] = useState<unknown[]>([])
  
  // Cached KPIs state
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<string | null>(null)
  const [hasAnalyzisData, setHasAnalyzisData] = useState(false)

  // Fetch campaigns
  const fetchCampaigns = useCallback(async () => {
    if (!venue?.id) return
    
    try {
      const res = await fetch(`${API_BASE}/api/dooh-attribution/campaigns?venueId=${venue.id}`)
      if (res.status === 404) {
        setFeatureEnabled(false)
        return
      }
      if (!res.ok) throw new Error('Failed to fetch campaigns')
      
      const data = await res.json()
      setCampaigns(data.campaigns || [])
      setFeatureEnabled(true)
    } catch (err) {
      console.error('Failed to fetch campaigns:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch campaigns')
    }
  }, [venue?.id])

  // Fetch screens
  const fetchScreens = useCallback(async () => {
    if (!venue?.id) return
    
    try {
      const res = await fetch(`${API_BASE}/api/dooh/screens?venueId=${venue.id}`)
      if (!res.ok) return
      
      const data = await res.json()
      setScreens(data.screens || [])
    } catch (err) {
      console.error('Failed to fetch screens:', err)
    }
  }, [venue?.id])

  // Fetch target options
  const fetchTargetOptions = useCallback(async () => {
    if (!venue?.id) return
    
    try {
      const res = await fetch(`${API_BASE}/api/dooh-attribution/target-options?venueId=${venue.id}`)
      if (!res.ok) return
      
      const data = await res.json()
      setTargetOptions(data)
    } catch (err) {
      console.error('Failed to fetch target options:', err)
    }
  }, [venue?.id])

  // Fetch latest/cached KPIs for selected campaign
  const fetchLatestKPIs = useCallback(async () => {
    if (!selectedCampaign) return
    
    setLoading(true)
    try {
      const res = await fetch(
        `${API_BASE}/api/dooh-attribution/kpis/latest?campaignId=${selectedCampaign.id}`
      )
      
      if (!res.ok) throw new Error('Failed to fetch latest KPIs')
      
      const data = await res.json()
      
      if (data.hasData) {
        setKpiSummary(data.summary || null)
        setLastAnalyzedAt(data.lastAnalyzedAt)
        setHasAnalyzisData(true)
        
        // Also fetch buckets for the chart
        const bucketsRes = await fetch(
          `${API_BASE}/api/dooh-attribution/kpis?campaignId=${selectedCampaign.id}&startTs=${data.timeRange.startTs}&endTs=${data.timeRange.endTs}`
        )
        if (bucketsRes.ok) {
          const bucketsData = await bucketsRes.json()
          setKpiBuckets(bucketsData.buckets || [])
        }
      } else {
        setKpiSummary(null)
        setKpiBuckets([])
        setLastAnalyzedAt(null)
        setHasAnalyzisData(false)
      }
    } catch (err) {
      console.error('Failed to fetch latest KPIs:', err)
      setHasAnalyzisData(false)
    } finally {
      setLoading(false)
    }
  }, [selectedCampaign])

  // Fetch KPIs for selected campaign (used after running analysis)
  const fetchKPIs = useCallback(async () => {
    if (!venue?.id || !selectedCampaign) return
    
    setLoading(true)
    try {
      const now = Date.now()
      let startTs = now - 24 * 60 * 60 * 1000 // Default: last day
      
      if (timeRange === 'hour') startTs = now - 60 * 60 * 1000
      else if (timeRange === 'week') startTs = now - 7 * 24 * 60 * 60 * 1000
      
      const res = await fetch(
        `${API_BASE}/api/dooh-attribution/kpis?venueId=${venue.id}&campaignId=${selectedCampaign.id}&startTs=${startTs}&endTs=${now}`
      )
      
      if (!res.ok) throw new Error('Failed to fetch KPIs')
      
      const data = await res.json()
      setKpiBuckets(data.buckets || [])
      setKpiSummary(data.summary || null)
      setHasAnalyzisData(true)
      setLastAnalyzedAt(new Date().toISOString())
    } catch (err) {
      console.error('Failed to fetch KPIs:', err)
    } finally {
      setLoading(false)
    }
  }, [venue?.id, selectedCampaign, timeRange])

  // Run attribution analysis
  const runAnalysis = async () => {
    if (!venue?.id || !selectedCampaign) return
    
    setRunning(true)
    setError(null)
    
    try {
      const now = Date.now()
      let startTs = now - 24 * 60 * 60 * 1000
      
      if (timeRange === 'hour') startTs = now - 60 * 60 * 1000
      else if (timeRange === 'week') startTs = now - 7 * 24 * 60 * 60 * 1000
      
      const res = await fetch(`${API_BASE}/api/dooh-attribution/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId: venue.id,
          campaignId: selectedCampaign.id,
          startTs,
          endTs: now,
          bucketMinutes: 15,
        }),
      })
      
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.message || 'Failed to run analysis')
      }
      
      // Refresh KPIs after run
      await fetchKPIs()
    } catch (err) {
      console.error('Failed to run analysis:', err)
      setError(err instanceof Error ? err.message : 'Failed to run analysis')
    } finally {
      setRunning(false)
    }
  }

  // Create or update campaign
  const saveCampaign = async () => {
    if (!venue?.id || !builderName || builderScreenIds.length === 0 || builderTargetIds.length === 0) {
      setError('Please fill in all required fields')
      return
    }
    
    try {
      const isEditing = !!editingCampaign
      const url = isEditing 
        ? `${API_BASE}/api/dooh-attribution/campaigns/${editingCampaign.id}`
        : `${API_BASE}/api/dooh-attribution/campaigns`
      
      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId: venue.id,
          name: builderName,
          screenIds: builderScreenIds,
          target: {
            type: builderTargetType,
            ids: builderTargetIds,
          },
        }),
      })
      
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.message || `Failed to ${isEditing ? 'update' : 'create'} campaign`)
      }
      
      // Reset builder and refresh
      setShowBuilder(false)
      setBuilderName('')
      setBuilderScreenIds([])
      setBuilderTargetIds([])
      setEditingCampaign(null)
      await fetchCampaigns()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save campaign')
    }
  }

  // Fetch debug events
  const fetchDebugEvents = async () => {
    if (!venue?.id || !selectedCampaign) return
    
    try {
      const now = Date.now()
      let startTs = now - 24 * 60 * 60 * 1000
      
      if (timeRange === 'hour') startTs = now - 60 * 60 * 1000
      else if (timeRange === 'week') startTs = now - 7 * 24 * 60 * 60 * 1000
      
      const res = await fetch(
        `${API_BASE}/api/dooh-attribution/debug/events?campaignId=${selectedCampaign.id}&startTs=${startTs}&endTs=${now}&includeControls=true&limit=50`
      )
      
      if (!res.ok) return
      
      const data = await res.json()
      setDebugEvents(data.events || [])
    } catch (err) {
      console.error('Failed to fetch debug events:', err)
    }
  }

  useEffect(() => {
    fetchCampaigns()
    fetchScreens()
    fetchTargetOptions()
  }, [fetchCampaigns, fetchScreens, fetchTargetOptions])

  useEffect(() => {
    if (selectedCampaign) {
      // Load cached KPIs when selecting a campaign
      fetchLatestKPIs()
    }
  }, [selectedCampaign, fetchLatestKPIs])

  useEffect(() => {
    if (showDebug && selectedCampaign) {
      fetchDebugEvents()
    }
  }, [showDebug, selectedCampaign])

  // Format percentage
  const formatPct = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—'
    return `${(val * 100).toFixed(1)}%`
  }

  // Format seconds
  const formatSeconds = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—'
    return `${val.toFixed(1)}s`
  }

  // Format score
  const formatScore = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—'
    return val.toFixed(1)
  }

  if (!featureEnabled) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center">
        <div className="text-center p-8">
          <AlertCircle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">DOOH Attribution Not Enabled</h2>
          <p className="text-gray-400 mb-4">
            Set <code className="bg-gray-800 px-2 py-1 rounded">FEATURE_DOOH_ATTRIBUTION=true</code> to enable this feature.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            Go Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-gray-700 flex items-center justify-between px-4 bg-gray-800 shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <div className="h-6 w-px bg-gray-600" />
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-400" />
            <span className="text-white font-semibold">PEBLE™ DOOH Effectiveness</span>
            <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded">Attribution Engine</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Time range selector */}
          <div className="flex bg-gray-700 rounded-lg p-0.5">
            {(['hour', 'day', 'week'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  timeRange === range
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {range === 'hour' ? '1H' : range === 'day' ? '24H' : '7D'}
              </button>
            ))}
          </div>
          
          {selectedCampaign && (
            <button
              onClick={runAnalysis}
              disabled={running}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 text-white rounded-lg text-sm"
            >
              {running ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Run Analysis
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/20 border-b border-red-500/30 px-4 py-2 flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-red-300 text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">×</button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Campaign sidebar */}
        <div className="w-72 border-r border-gray-700 bg-gray-800/50 flex flex-col shrink-0">
          <div className="p-4 border-b border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-white">Campaigns</h3>
              <button
                onClick={() => setShowBuilder(true)}
                className="p-1 hover:bg-gray-700 rounded"
                title="New Campaign"
              >
                <Plus className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Select a campaign to view attribution metrics
            </p>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2">
            {campaigns.length === 0 ? (
              <div className="text-center py-8">
                <Target className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No campaigns yet</p>
                <button
                  onClick={() => setShowBuilder(true)}
                  className="mt-2 text-sm text-purple-400 hover:text-purple-300"
                >
                  Create your first campaign
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {campaigns.map((campaign) => (
                  <div
                    key={campaign.id}
                    className={`relative p-3 rounded-lg transition-colors cursor-pointer ${
                      selectedCampaign?.id === campaign.id
                        ? 'bg-purple-600/20 border border-purple-500/30'
                        : 'bg-gray-700/50 hover:bg-gray-700 border border-transparent'
                    }`}
                    onClick={() => setSelectedCampaign(campaign)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Monitor className="w-4 h-4 text-purple-400" />
                        <span className="text-sm font-medium text-white truncate">{campaign.name}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCampaign(campaign);
                          setBuilderName(campaign.name);
                          setBuilderScreenIds(campaign.screenIds || []);
                          setBuilderTargetIds(campaign.target?.ids || []);
                          setShowBuilder(true);
                        }}
                        className="p-1 hover:bg-gray-600 rounded opacity-60 hover:opacity-100"
                        title="Edit campaign"
                      >
                        <Pencil className="w-3 h-3 text-gray-400" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="px-1.5 py-0.5 bg-gray-600 rounded">
                        {campaign.target?.type || 'No target'}
                      </span>
                      <span>{campaign.screenIds?.length || 0} screens</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main KPI dashboard */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedCampaign ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <BarChart3 className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-white mb-2">Select a Campaign</h3>
                <p className="text-gray-400 text-sm">
                  Choose a campaign from the sidebar to view attribution metrics
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto space-y-6">
              {/* Campaign header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">{selectedCampaign.name}</h2>
                  <p className="text-sm text-gray-400">
                    Target: {selectedCampaign.target.type} ({selectedCampaign.target.ids.length} items) • 
                    {selectedCampaign.screenIds.length} screens
                    {lastAnalyzedAt && (
                      <span className="ml-2 text-gray-500">
                        • Last analyzed: {new Date(lastAnalyzedAt).toLocaleString()}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setShowDebug(!showDebug)}
                  className={`px-3 py-1.5 rounded-lg text-sm ${
                    showDebug
                      ? 'bg-amber-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Debug Events
                </button>
              </div>

              {/* Primary KPI Cards */}
              {kpiSummary && (
                <div className="grid grid-cols-4 gap-4">
                  {/* EAL™ - Exposure-to-Action Lift */}
                  <div className="bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-500/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-5 h-5 text-purple-400" />
                      <span className="text-xs text-purple-300 font-medium">EAL™</span>
                      <KpiTooltip kpiKey="eal" />
                    </div>
                    <div className="text-3xl font-bold text-white mb-1">
                      {formatPct(kpiSummary.eal)}
                    </div>
                    <p className="text-xs text-gray-400">Exposure-to-Action Lift</p>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-green-400">{formatPct(kpiSummary.pExposed)}</span>
                      <span className="text-gray-500">vs</span>
                      <span className="text-gray-400">{formatPct(kpiSummary.pControl)}</span>
                    </div>
                  </div>

                  {/* TTA™ - Time-to-Action */}
                  <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-500/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-5 h-5 text-blue-400" />
                      <span className="text-xs text-blue-300 font-medium">TTA™</span>
                      <KpiTooltip kpiKey="tta" />
                    </div>
                    <div className="text-3xl font-bold text-white mb-1">
                      {formatSeconds(kpiSummary.ttaExposed)}
                    </div>
                    <p className="text-xs text-gray-400">Time-to-Action</p>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-blue-400">{formatScore(kpiSummary.ttaAccel)}x</span>
                      <span className="text-gray-500">acceleration</span>
                      <KpiTooltip kpiKey="ttaAccel" />
                    </div>
                  </div>

                  {/* DCI™ - Direction Change Index */}
                  <div className="bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 border border-cyan-500/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-5 h-5 text-cyan-400" />
                      <span className="text-xs text-cyan-300 font-medium">DCI™</span>
                      <KpiTooltip kpiKey="dci" />
                    </div>
                    <div className="text-3xl font-bold text-white mb-1">
                      {kpiSummary.dciExposed !== null ? (kpiSummary.dciExposed * 100).toFixed(0) : '—'}
                    </div>
                    <p className="text-xs text-gray-400">Direction Change Index</p>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-cyan-400">
                        {kpiSummary.dciExposed !== null && kpiSummary.dciControl !== null
                          ? `+${((kpiSummary.dciExposed - kpiSummary.dciControl) * 100).toFixed(0)}`
                          : '—'}
                      </span>
                      <span className="text-gray-500">vs control</span>
                    </div>
                  </div>

                  {/* CES™ - Campaign Effectiveness Score */}
                  <div className="bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Gauge className="w-5 h-5 text-amber-400" />
                      <span className="text-xs text-amber-300 font-medium">CES™</span>
                      <KpiTooltip kpiKey="ces" />
                    </div>
                    <div className="text-3xl font-bold text-white mb-1">
                      {formatScore(kpiSummary.ces)}
                    </div>
                    <p className="text-xs text-gray-400">Campaign Effectiveness</p>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-amber-400">{formatPct(kpiSummary.confidence)}</span>
                      <span className="text-gray-500">confidence</span>
                      <KpiTooltip kpiKey="confidence" />
                    </div>
                  </div>
                </div>
              )}

              {/* Secondary KPI Cards */}
              {kpiSummary && (
                <div className="grid grid-cols-5 gap-3">
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Eye className="w-4 h-4 text-gray-400" />
                      <span className="text-xs text-gray-400">AQS™</span>
                      <KpiTooltip kpiKey="aqs" />
                    </div>
                    <div className="text-xl font-semibold text-white">{formatScore(kpiSummary.aqs)}</div>
                    <p className="text-[10px] text-gray-500">Attention Quality</p>
                  </div>

                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Percent className="w-4 h-4 text-gray-400" />
                      <span className="text-xs text-gray-400">AAR™</span>
                      <KpiTooltip kpiKey="aar" />
                    </div>
                    <div className="text-xl font-semibold text-white">{formatPct(kpiSummary.aar / 100)}</div>
                    <p className="text-[10px] text-gray-500">Attention-to-Action Rate</p>
                  </div>

                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Timer className="w-4 h-4 text-gray-400" />
                      <span className="text-xs text-gray-400">SEQ™</span>
                      <KpiTooltip kpiKey="seq" />
                    </div>
                    <div className="text-xl font-semibold text-white">+{formatSeconds(kpiSummary.engagementLift)}</div>
                    <p className="text-[10px] text-gray-500">Engagement Quality Lift</p>
                  </div>

                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="w-4 h-4 text-gray-400" />
                      <span className="text-xs text-gray-400">Exposed</span>
                    </div>
                    <div className="text-xl font-semibold text-white">{kpiSummary.totalExposed.toLocaleString()}</div>
                    <p className="text-[10px] text-gray-500">Total exposures</p>
                  </div>

                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="w-4 h-4 text-gray-400" />
                      <span className="text-xs text-gray-400">Controls</span>
                    </div>
                    <div className="text-xl font-semibold text-white">{kpiSummary.totalControls.toLocaleString()}</div>
                    <p className="text-[10px] text-gray-500">Matched controls</p>
                  </div>
                </div>
              )}

              {/* How It Works - Simple Legend */}
              {kpiSummary && (
                <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 border border-gray-700 rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-white mb-2">How PEBLE™ Works</h3>
                  <p className="text-sm text-gray-400 mb-6">How in-store digital screens influence shopper behavior (LiDAR-based, privacy-safe)</p>
                  
                  {/* Flow Diagram */}
                  <div className="flex items-center justify-between gap-2 mb-8">
                    {/* Step 1: Exposure */}
                    <div className="flex-1 text-center">
                      <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center">
                        <Monitor className="w-6 h-6 text-purple-400" />
                      </div>
                      <div className="text-sm font-medium text-purple-300">Exposure</div>
                      <p className="text-[10px] text-gray-500 mt-1">Shopper passes near a PEBLE™ digital screen</p>
                    </div>
                    <div className="text-gray-600">→</div>
                    
                    {/* Step 2: Match */}
                    <div className="flex-1 text-center">
                      <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
                        <Users className="w-6 h-6 text-blue-400" />
                      </div>
                      <div className="text-sm font-medium text-blue-300">Match</div>
                      <p className="text-[10px] text-gray-500 mt-1">LiDAR tracks anonymous movement patterns</p>
                    </div>
                    <div className="text-gray-600">→</div>
                    
                    {/* Step 3: Track */}
                    <div className="flex-1 text-center">
                      <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
                        <Activity className="w-6 h-6 text-cyan-400" />
                      </div>
                      <div className="text-sm font-medium text-cyan-300">Track</div>
                      <p className="text-[10px] text-gray-500 mt-1">Monitors subsequent path and dwell time</p>
                    </div>
                    <div className="text-gray-600">→</div>
                    
                    {/* Step 4: Compare */}
                    <div className="flex-1 text-center">
                      <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                        <BarChart3 className="w-6 h-6 text-amber-400" />
                      </div>
                      <div className="text-sm font-medium text-amber-300">Compare</div>
                      <p className="text-[10px] text-gray-500 mt-1">Contrasts exposed vs. non-exposed behavior</p>
                    </div>
                    <div className="text-gray-600">→</div>
                    
                    {/* Step 5: Lift */}
                    <div className="flex-1 text-center">
                      <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center">
                        <TrendingUp className="w-6 h-6 text-green-400" />
                      </div>
                      <div className="text-sm font-medium text-green-300">Lift</div>
                      <p className="text-[10px] text-gray-500 mt-1">Quantifies net positive behavioral change</p>
                    </div>
                  </div>

                  {/* Infographic KPI Cards */}
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    {/* EAL */}
                    <div className="bg-gradient-to-br from-purple-600/30 to-purple-800/20 border border-purple-500/40 rounded-lg p-3">
                      <div className="text-[10px] text-purple-300 font-medium mb-1">EAL™ (Exposure-to-Action Lift)</div>
                      <div className="text-2xl font-bold text-white">
                        {kpiSummary.eal > 0 ? '+' : ''}{(kpiSummary.eal * 100).toFixed(0)}%
                      </div>
                      <p className="text-[9px] text-gray-400 mt-1">Increase in shoppers taking a desired action after screen exposure</p>
                    </div>
                    
                    {/* TTA */}
                    <div className="bg-gradient-to-br from-blue-600/30 to-blue-800/20 border border-blue-500/40 rounded-lg p-3">
                      <div className="text-[10px] text-blue-300 font-medium mb-1">TTA™ (Time-to-Action)</div>
                      <div className="text-2xl font-bold text-white">
                        {kpiSummary.ttaAccel > 1 ? `${((kpiSummary.ttaAccel - 1) * 100).toFixed(0)}% Faster` : formatSeconds(kpiSummary.ttaExposed)}
                      </div>
                      <p className="text-[9px] text-gray-400 mt-1">Reduction in time spent before reaching the product area</p>
                    </div>
                    
                    {/* DCI */}
                    <div className="bg-gradient-to-br from-cyan-600/30 to-cyan-800/20 border border-cyan-500/40 rounded-lg p-3">
                      <div className="text-[10px] text-cyan-300 font-medium mb-1">DCI™ (Direction Change Index)</div>
                      <div className="text-2xl font-bold text-white">
                        {kpiSummary.dciExposed !== null ? `+${(kpiSummary.dciExposed * 100).toFixed(1)}` : '—'}
                      </div>
                      <p className="text-[9px] text-gray-400 mt-1">Significant shift in path towards the promoted category</p>
                    </div>
                    
                    {/* CES */}
                    <div className="bg-gradient-to-br from-amber-600/30 to-amber-800/20 border border-amber-500/40 rounded-lg p-3">
                      <div className="text-[10px] text-amber-300 font-medium mb-1">CES™ (Campaign Effectiveness)</div>
                      <div className="text-2xl font-bold text-white">
                        {formatScore(kpiSummary.ces)}<span className="text-base text-gray-400">/100</span>
                      </div>
                      <p className="text-[9px] text-gray-400 mt-1">Composite score (lift × speed × quality × confidence)</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {/* AQS */}
                    <div className="bg-gray-700/40 border border-gray-600/50 rounded-lg p-3">
                      <div className="text-[10px] text-gray-300 font-medium mb-1">AQS™ (Attention Quality Score)</div>
                      <div className="text-xl font-bold text-white">
                        {formatScore(kpiSummary.aqs)}<span className="text-sm text-gray-400">/100</span>
                      </div>
                      <p className="text-[9px] text-gray-500 mt-1">Based on: ⏱ Longer Dwell • 📍 Closer Proximity • 🚶 Significant Slowdown</p>
                    </div>
                    
                    {/* AAR */}
                    <div className="bg-gray-700/40 border border-gray-600/50 rounded-lg p-3">
                      <div className="text-[10px] text-gray-300 font-medium mb-1">AAR™ (Attention-to-Action Rate)</div>
                      <div className="text-xl font-bold text-white">
                        {formatPct(kpiSummary.aar / 100)}
                      </div>
                      <p className="text-[9px] text-gray-500 mt-1">Percentage of attentive shoppers who converted to action</p>
                    </div>
                    
                    {/* SEQ */}
                    <div className="bg-gray-700/40 border border-gray-600/50 rounded-lg p-3">
                      <div className="text-[10px] text-gray-300 font-medium mb-1">SEQ™ (Shelf Engagement Quality Lift)</div>
                      <div className="text-xl font-bold text-white">
                        +{formatSeconds(kpiSummary.engagementLift)}
                      </div>
                      <p className="text-[9px] text-gray-500 mt-1">Increase in time spent actively engaging at the shelf, not just visiting</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Time series chart placeholder */}
              {kpiBuckets.length > 0 && (
                <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                  <h3 className="text-sm font-medium text-white mb-4">Attribution Metrics Over Time</h3>
                  <div className="h-48 flex items-end gap-1">
                    {kpiBuckets.map((bucket, i) => {
                      const maxCes = Math.max(...kpiBuckets.map(b => b.cesScore || 0), 1)
                      const height = ((bucket.cesScore || 0) / maxCes) * 100
                      
                      return (
                        <div
                          key={i}
                          className="flex-1 bg-purple-500/30 hover:bg-purple-500/50 rounded-t transition-colors relative group"
                          style={{ height: `${Math.max(height, 4)}%` }}
                        >
                          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 px-2 py-1 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                            CES: {formatScore(bucket.cesScore)} | Lift: {formatPct(bucket.liftRel)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex justify-between mt-2 text-xs text-gray-500">
                    <span>{new Date(kpiBuckets[0]?.bucketStartTs).toLocaleTimeString()}</span>
                    <span>{new Date(kpiBuckets[kpiBuckets.length - 1]?.bucketStartTs).toLocaleTimeString()}</span>
                  </div>
                </div>
              )}

              {/* Loading state */}
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-6 h-6 text-purple-400 animate-spin" />
                </div>
              )}

              {/* No data state */}
              {!loading && !kpiSummary && !hasAnalyzisData && (
                <div className="text-center py-12">
                  <BarChart3 className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-white mb-2">No Attribution Data</h3>
                  <p className="text-gray-400 text-sm mb-4">
                    Click "Run Analysis" to compute attribution metrics for this campaign
                  </p>
                  <button
                    onClick={runAnalysis}
                    disabled={running}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg inline-flex items-center gap-2"
                  >
                    <Play className="w-4 h-4" />
                    Run Analysis
                  </button>
                </div>
              )}

              {/* Debug events panel */}
              {showDebug && (
                <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                  <h3 className="text-sm font-medium text-white mb-4">Debug: Attribution Events</h3>
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {debugEvents.length === 0 ? (
                      <p className="text-gray-500 text-sm">No events found</p>
                    ) : (
                      debugEvents.map((event: any, i) => (
                        <div
                          key={i}
                          className={`p-3 rounded-lg border ${
                            event.converted
                              ? 'bg-green-500/10 border-green-500/30'
                              : 'bg-gray-700/50 border-gray-600'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {event.converted ? (
                                <CheckCircle className="w-4 h-4 text-green-400" />
                              ) : (
                                <AlertCircle className="w-4 h-4 text-gray-400" />
                              )}
                              <span className="text-sm font-medium text-white">
                                {event.trackKey.slice(0, 8)}...
                              </span>
                              <span className="text-xs px-2 py-0.5 bg-gray-600 rounded">{event.tier}</span>
                            </div>
                            <span className="text-xs text-gray-400">
                              AQS: {formatScore(event.aqs)} | Conf: {formatPct(event.confidence)}
                            </span>
                          </div>
                          {event.converted && event.ttaS && (
                            <p className="text-xs text-green-400">
                              Converted in {formatSeconds(event.ttaS)}
                            </p>
                          )}
                          {event.controls && event.controls.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gray-600">
                              <p className="text-xs text-gray-400 mb-1">
                                {event.controls.length} matched controls
                              </p>
                              <div className="flex gap-1">
                                {event.controls.map((ctrl: any, j: number) => (
                                  <span
                                    key={j}
                                    className={`text-xs px-1.5 py-0.5 rounded ${
                                      ctrl.converted
                                        ? 'bg-green-500/20 text-green-400'
                                        : 'bg-gray-600 text-gray-400'
                                    }`}
                                  >
                                    {ctrl.converted ? '✓' : '✗'}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Campaign builder modal */}
      {showBuilder && (
        <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-xl w-full max-w-lg border border-gray-700">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-medium text-white">{editingCampaign ? 'Edit Campaign' : 'New Attribution Campaign'}</h3>
              <button
                onClick={() => setShowBuilder(false)}
                className="text-gray-400 hover:text-white"
              >
                ×
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              {/* Campaign name */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Campaign Name</label>
                <input
                  type="text"
                  value={builderName}
                  onChange={(e) => setBuilderName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                  placeholder="e.g., Beverage Promo Attribution"
                />
              </div>

              {/* Screen selection */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Screens</label>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {screens.filter(s => s.enabled).map((screen) => (
                    <label
                      key={screen.id}
                      className="flex items-center gap-2 p-2 bg-gray-700/50 rounded hover:bg-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={builderScreenIds.includes(screen.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setBuilderScreenIds([...builderScreenIds, screen.id])
                          } else {
                            setBuilderScreenIds(builderScreenIds.filter(id => id !== screen.id))
                          }
                        }}
                        className="rounded"
                      />
                      <Monitor className="w-4 h-4 text-purple-400" />
                      <span className="text-sm text-white">{screen.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Target type */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Target Type</label>
                <div className="flex gap-2">
                  {(['category', 'brand', 'shelf', 'sku'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        setBuilderTargetType(type)
                        setBuilderTargetIds([])
                      }}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm ${
                        builderTargetType === type
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {type === 'category' && <Tag className="w-3 h-3" />}
                      {type === 'brand' && <ShoppingBag className="w-3 h-3" />}
                      {type === 'shelf' && <Grid className="w-3 h-3" />}
                      {type === 'sku' && <Package className="w-3 h-3" />}
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target selection */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Target Items</label>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {builderTargetType === 'category' && targetOptions?.categories.map((cat) => (
                    <label
                      key={cat}
                      className="flex items-center gap-2 p-2 bg-gray-700/50 rounded hover:bg-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={builderTargetIds.includes(cat)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setBuilderTargetIds([...builderTargetIds, cat])
                          } else {
                            setBuilderTargetIds(builderTargetIds.filter(id => id !== cat))
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm text-white">{cat}</span>
                    </label>
                  ))}
                  {builderTargetType === 'brand' && targetOptions?.brands.map((brand) => (
                    <label
                      key={brand}
                      className="flex items-center gap-2 p-2 bg-gray-700/50 rounded hover:bg-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={builderTargetIds.includes(brand)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setBuilderTargetIds([...builderTargetIds, brand])
                          } else {
                            setBuilderTargetIds(builderTargetIds.filter(id => id !== brand))
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm text-white">{brand}</span>
                    </label>
                  ))}
                  {builderTargetType === 'shelf' && targetOptions?.shelves.map((shelf) => (
                    <label
                      key={shelf.id}
                      className="flex items-center gap-2 p-2 bg-gray-700/50 rounded hover:bg-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={builderTargetIds.includes(shelf.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setBuilderTargetIds([...builderTargetIds, shelf.id])
                          } else {
                            setBuilderTargetIds(builderTargetIds.filter(id => id !== shelf.id))
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm text-white">{shelf.name}</span>
                    </label>
                  ))}
                  {builderTargetType === 'sku' && targetOptions?.skus.slice(0, 50).map((sku) => (
                    <label
                      key={sku.id}
                      className="flex items-center gap-2 p-2 bg-gray-700/50 rounded hover:bg-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={builderTargetIds.includes(sku.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setBuilderTargetIds([...builderTargetIds, sku.id])
                          } else {
                            setBuilderTargetIds(builderTargetIds.filter(id => id !== sku.id))
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm text-white">{sku.name}</span>
                      <span className="text-xs text-gray-400">{sku.brand}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowBuilder(false)
                  setEditingCampaign(null)
                  setBuilderName('')
                  setBuilderScreenIds([])
                  setBuilderTargetIds([])
                }}
                className="px-4 py-2 text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={saveCampaign}
                disabled={!builderName || builderScreenIds.length === 0 || builderTargetIds.length === 0}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:cursor-not-allowed text-white rounded-lg"
              >
                {editingCampaign ? 'Update Campaign' : 'Create Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
