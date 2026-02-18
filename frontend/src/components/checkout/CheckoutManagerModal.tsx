import { useState, useEffect, useCallback } from 'react'
import { 
  X, ShoppingCart, ToggleLeft, ToggleRight, AlertTriangle, RefreshCw, 
  Wifi, WifiOff, Settings, Bell, BellOff, CheckCircle, Eye, EyeOff,
  Clock, Users, Gauge, ChevronRight, Plus, Trash2, Save, Lightbulb
} from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { QueueCircles } from '../settings/QueueCircles'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Types
interface QueuedPerson {
  id: string
  waitTimeSec: number
}

interface LaneStatus {
  laneId: number
  name?: string
  queueZoneId?: string
  desiredState: 'open' | 'closed'
  status: 'OPEN' | 'CLOSED' | 'OPENING' | 'CLOSING'
  queueCount: number
  queuedPeople?: QueuedPerson[]
  avgWaitTimeSec?: number
  occupancyRate?: number
  cashierAgentId?: string | null
}

interface QueuePressure {
  totalQueueCount: number
  openLaneCount: number
  closedLaneCount: number
  avgQueuePerLane: number
  pressureThreshold: number
  shouldOpenMore: boolean
  suggestedLaneToOpen: number | null
}

interface CheckoutStatus {
  lanes: LaneStatus[]
  pressure: QueuePressure
  thresholds: {
    queuePressureThreshold: number
    inflowRateThreshold: number
  }
  source: 'simulation' | 'live'
}

interface CheckoutAlert {
  id: string
  laneId?: number
  type: 'wait_time' | 'queue_length' | 'occupancy'
  severity: 'warning' | 'critical'
  message: string
  value: number
  threshold: number
  timestamp: string
  acknowledged: boolean
  acknowledgedAt?: string
  dismissed: boolean
  dismissedAt?: string
}

interface CheckoutAlertRule {
  id: string
  name: string
  type: 'wait_time' | 'queue_length' | 'occupancy'
  operator: '>' | '<' | '>=' | '<='
  threshold: number
  severity: 'warning' | 'critical'
  enabled: boolean
}

interface ThresholdSettings {
  waitTimeWarningMin: number
  waitTimeCriticalMin: number
  queueLengthWarning: number
  queueLengthCritical: number
  occupancyWarning: number
  occupancyCritical: number
}

interface KpiSnapshot {
  timestamp: string
  period: string
  kpis: {
    totalSessions: number
    completedSessions: number
    abandonedSessions: number
    abandonmentRate: number
    avgWaitSec: number
    maxWaitSec: number
    throughputPerHour: number
    lanesUsed: number
  }
  perLane: { laneId: string; sessions: number; completed: number; avgWaitSec: number }[]
  recentSessions: { personId: string; entryTime: string; exitTime: string; dwellSec: number; abandoned: number; laneId: string }[]
}

interface ActiveSession {
  personId: string
  queueZoneId: string
  queueZoneShort: string
  entryTime: number
  entryTimeStr: string
  currentDwellMs: number
  currentDwellSec: number
  inService: boolean
  serviceEntryTime: number | null
  laneNumber: number | null
  laneName: string
}

interface ActiveSessionsResponse {
  timestamp: number
  timestampStr: string
  activeCount: number
  sessions: ActiveSession[]
}

interface CheckoutManagerModalProps {
  isOpen: boolean
  onClose: () => void
}

// Default thresholds
const DEFAULT_THRESHOLDS: ThresholdSettings = {
  waitTimeWarningMin: 2,
  waitTimeCriticalMin: 5,
  queueLengthWarning: 5,
  queueLengthCritical: 10,
  occupancyWarning: 70,
  occupancyCritical: 90,
}

// Default alert rules
const DEFAULT_RULES: CheckoutAlertRule[] = [
  { id: '1', name: 'Wait Time Warning', type: 'wait_time', operator: '>', threshold: 2, severity: 'warning', enabled: true },
  { id: '2', name: 'Wait Time Critical', type: 'wait_time', operator: '>', threshold: 5, severity: 'critical', enabled: true },
  { id: '3', name: 'Queue Length Warning', type: 'queue_length', operator: '>', threshold: 2, severity: 'warning', enabled: true },
  { id: '4', name: 'Queue Length Critical', type: 'queue_length', operator: '>', threshold: 5, severity: 'critical', enabled: true },
]

export default function CheckoutManagerModal({ isOpen, onClose }: CheckoutManagerModalProps) {
  const { venue } = useVenue()
  const [status, setStatus] = useState<CheckoutStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<'auto' | 'simulation' | 'live'>('auto')
  
  // KPI Snapshot State (auto-refresh every 15 sec)
  const [kpiSnapshot, setKpiSnapshot] = useState<KpiSnapshot | null>(null)
  const [kpiPeriod, setKpiPeriod] = useState<'hour' | 'day' | 'week'>('hour')
  const [kpiLastUpdate, setKpiLastUpdate] = useState<Date | null>(null)
  
  // Active Sessions State (live debug - refresh every 1 sec)
  const [activeSessions, setActiveSessions] = useState<ActiveSessionsResponse | null>(null)
  const [localTimers, setLocalTimers] = useState<Map<string, number>>(new Map())
  
  // UI State
  const [activeTab, setActiveTab] = useState<'lanes' | 'rules' | 'settings' | 'kpi'>('lanes')
  const [showLedger, setShowLedger] = useState(true)
  const [ledgerFilter, setLedgerFilter] = useState<'active' | 'dismissed'>('active')
  
  // Alert State
  const [alerts, setAlerts] = useState<CheckoutAlert[]>([])
  const [rules, setRules] = useState<CheckoutAlertRule[]>(DEFAULT_RULES)
  const [thresholds, setThresholds] = useState<ThresholdSettings>(DEFAULT_THRESHOLDS)
  const [editingRule, setEditingRule] = useState<CheckoutAlertRule | null>(null)

  // Check lanes against rules and generate alerts
  const checkAndGenerateAlerts = useCallback((lanes: LaneStatus[]) => {
    const now = new Date().toISOString()
    const enabledRules = rules.filter(r => r.enabled)
    console.log('[AlertCheck] Checking', lanes.length, 'lanes against', enabledRules.length, 'enabled rules')
    
    lanes.forEach(lane => {
      if (lane.status !== 'OPEN') return
      
      enabledRules.forEach(rule => {
        let value = 0
        let triggered = false
        
        if (rule.type === 'wait_time' && lane.avgWaitTimeSec !== undefined) {
          value = lane.avgWaitTimeSec / 60
          triggered = rule.operator === '>' ? value > rule.threshold : value < rule.threshold
        } else if (rule.type === 'queue_length') {
          value = lane.queueCount
          triggered = rule.operator === '>' ? value > rule.threshold : value < rule.threshold
          console.log('[AlertCheck] Lane', lane.laneId, 'queueCount:', value, 'threshold:', rule.threshold, 'triggered:', triggered)
        } else if (rule.type === 'occupancy' && lane.occupancyRate !== undefined) {
          value = lane.occupancyRate
          triggered = rule.operator === '>' ? value > rule.threshold : value < rule.threshold
        }
        
        if (triggered) {
          console.log('[AlertCheck] TRIGGERED! Lane', lane.laneId, rule.name)
          const alertId = `${lane.laneId}-${rule.id}-${Math.floor(Date.now() / 60000)}`
          // Use functional update pattern to check against current alerts
          setAlerts(prev => {
            const existingAlert = prev.find(a => a.id === alertId)
            if (existingAlert) return prev
            
            const newAlert: CheckoutAlert = {
              id: alertId,
              laneId: lane.laneId,
              type: rule.type,
              severity: rule.severity,
              message: `Lane ${lane.laneId}: ${rule.name}`,
              value,
              threshold: rule.threshold,
              timestamp: now,
              acknowledged: false,
              dismissed: false,
            }
            return [newAlert, ...prev].slice(0, 100)
          })
        }
      })
    })
  }, [rules])

  const fetchStatus = useCallback(async () => {
    if (!venue?.id) return
    
    setLoading(true)
    setError(null)
    
    try {
      if (dataSource === 'auto' || dataSource === 'simulation') {
        const simRes = await fetch(`${API_BASE}/api/edge-simulator/checkout/status`)
        if (simRes.ok) {
          const data = await simRes.json()
          setStatus({ ...data, source: 'simulation' })
          checkAndGenerateAlerts(data.lanes)
          setLoading(false)
          return
        }
      }
      
      if (dataSource === 'auto' || dataSource === 'live') {
        const liveRes = await fetch(`${API_BASE}/api/venues/${venue.id}/checkout/live-status`)
        if (liveRes.ok) {
          const data = await liveRes.json()
          setStatus({ ...data, source: 'live' })
          checkAndGenerateAlerts(data.lanes)
          setLoading(false)
          return
        }
      }
      
      setError('No checkout data available')
    } catch (err) {
      setError('Failed to fetch checkout status')
    }
    setLoading(false)
  }, [venue?.id, dataSource, checkAndGenerateAlerts])

  useEffect(() => {
    if (!isOpen) return
    
    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)
    return () => clearInterval(interval)
  }, [isOpen, fetchStatus])

  // Fetch KPI snapshot (auto-refresh every 15 sec)
  const fetchKpiSnapshot = useCallback(async () => {
    if (!venue?.id) return
    try {
      const res = await fetch(`${API_BASE}/api/venues/${venue.id}/checkout/kpi-snapshot?period=${kpiPeriod}`)
      if (res.ok) {
        const data = await res.json()
        setKpiSnapshot(data)
        setKpiLastUpdate(new Date())
      }
    } catch (err) {
      console.error('Failed to fetch KPI snapshot:', err)
    }
  }, [venue?.id, kpiPeriod])

  useEffect(() => {
    if (!isOpen || activeTab !== 'kpi') return
    
    fetchKpiSnapshot()
    const interval = setInterval(fetchKpiSnapshot, 15000) // 15 sec refresh
    return () => clearInterval(interval)
  }, [isOpen, activeTab, fetchKpiSnapshot])

  // Fetch active sessions (live debug - 1 sec refresh)
  const fetchActiveSessions = useCallback(async () => {
    if (!venue?.id) return
    try {
      const res = await fetch(`${API_BASE}/api/venues/${venue.id}/checkout/active-sessions`)
      if (res.ok) {
        const data = await res.json()
        setActiveSessions(data)
        // Update local timers based on server data
        const newTimers = new Map<string, number>()
        data.sessions.forEach((s: ActiveSession) => {
          newTimers.set(s.personId + ':' + s.queueZoneId, s.currentDwellSec)
        })
        setLocalTimers(newTimers)
      }
    } catch (err) {
      console.error('Failed to fetch active sessions:', err)
    }
  }, [venue?.id])

  useEffect(() => {
    if (!isOpen || activeTab !== 'kpi') return
    
    fetchActiveSessions()
    const interval = setInterval(fetchActiveSessions, 1000) // 1 sec refresh for live timers
    return () => clearInterval(interval)
  }, [isOpen, activeTab, fetchActiveSessions])

  // Auto-dismiss acknowledged alerts after 10 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setAlerts(prev => prev.map(alert => {
        if (alert.acknowledged && !alert.dismissed && alert.acknowledgedAt) {
          const ackTime = new Date(alert.acknowledgedAt).getTime()
          if (Date.now() - ackTime > 10000) {
            return { ...alert, dismissed: true, dismissedAt: new Date().toISOString() }
          }
        }
        return alert
      }))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const handleSetLaneState = async (laneId: number, state: 'open' | 'closed') => {
    try {
      const endpoint = status?.source === 'simulation' 
        ? `${API_BASE}/api/edge-simulator/checkout/set_lane_state`
        : `${API_BASE}/api/venues/${venue?.id}/checkout/set_lane_state`
      
      // Get queueZoneId for this lane to sync with queue tracking
      const lane = status?.lanes?.find(l => l.laneId === laneId)
      const queueZoneId = lane?.queueZoneId
      
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ laneId, state, queueZoneId })
      })
      fetchStatus()
    } catch (err) {
      console.error('Failed to set lane state:', err)
    }
  }

  const handleAcknowledge = (alertId: string) => {
    setAlerts(prev => prev.map(a => 
      a.id === alertId ? { ...a, acknowledged: true, acknowledgedAt: new Date().toISOString() } : a
    ))
  }

  const handleDismiss = (alertId: string) => {
    setAlerts(prev => prev.map(a => 
      a.id === alertId ? { ...a, dismissed: true, dismissedAt: new Date().toISOString() } : a
    ))
  }

  const handleSaveRule = (rule: CheckoutAlertRule) => {
    if (rule.id && rules.find(r => r.id === rule.id)) {
      setRules(prev => prev.map(r => r.id === rule.id ? rule : r))
    } else {
      setRules(prev => [...prev, { ...rule, id: Date.now().toString() }])
    }
    setEditingRule(null)
  }

  const handleDeleteRule = (ruleId: string) => {
    setRules(prev => prev.filter(r => r.id !== ruleId))
  }

  const activeAlerts = alerts.filter(a => !a.dismissed)
  const dismissedAlerts = alerts.filter(a => a.dismissed)
  const criticalCount = activeAlerts.filter(a => a.severity === 'critical' && !a.acknowledged).length
  const warningCount = activeAlerts.filter(a => a.severity === 'warning' && !a.acknowledged).length

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-5xl mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-600/20 flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Checkout Operations Center</h2>
              <div className="flex items-center gap-2 text-xs">
                {status?.source === 'simulation' ? (
                  <span className="text-purple-400 flex items-center gap-1">
                    <Wifi className="w-3 h-3" /> Simulation
                  </span>
                ) : status?.source === 'live' ? (
                  <span className="text-green-400 flex items-center gap-1">
                    <Wifi className="w-3 h-3" /> Live Data
                  </span>
                ) : (
                  <span className="text-gray-500 flex items-center gap-1">
                    <WifiOff className="w-3 h-3" /> Disconnected
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Alert Badge */}
            <button
              onClick={() => setShowLedger(!showLedger)}
              className={`relative p-2 rounded-lg transition-colors ${
                showLedger ? 'bg-amber-500/20 text-amber-400' : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Toggle Alerts Ledger"
            >
              <Bell className="w-5 h-5" />
              {(criticalCount + warningCount) > 0 && (
                <span className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-xs flex items-center justify-center ${
                  criticalCount > 0 ? 'bg-red-500' : 'bg-amber-500'
                } text-white font-medium`}>
                  {criticalCount + warningCount}
                </span>
              )}
            </button>
            <button
              onClick={fetchStatus}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-700/50 bg-gray-800/30">
          {(['lanes', 'kpi', 'rules', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === tab
                  ? 'bg-green-600/20 text-green-400'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {tab === 'lanes' && 'Lane Overview'}
              {tab === 'kpi' && 'Live KPIs'}
              {tab === 'rules' && 'Alert Rules'}
              {tab === 'settings' && 'Thresholds'}
            </button>
          ))}
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel - Main Content */}
          <div className={`flex-1 overflow-y-auto p-4 ${showLedger ? 'border-r border-gray-700' : ''}`}>
            {/* KPI Tab - Works independently of live status, shown first */}
            {activeTab === 'kpi' && (
              <div className="space-y-4">
                {/* Period Selector + Last Update */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {(['hour', 'day', 'week'] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => setKpiPeriod(p)}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                          kpiPeriod === p 
                            ? 'bg-blue-600/20 text-blue-400' 
                            : 'text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        {p === 'hour' ? 'Last Hour' : p === 'day' ? 'Last 24h' : 'Last Week'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <RefreshCw className="w-3 h-3" />
                    {kpiLastUpdate ? `Updated ${kpiLastUpdate.toLocaleTimeString()}` : 'Loading...'}
                    <span className="text-gray-600">• 15s refresh</span>
                  </div>
                </div>

                {kpiSnapshot ? (
                  <>
                    {/* KPI Summary Cards */}
                    <div className="grid grid-cols-4 gap-3">
                      <div className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-blue-400">{kpiSnapshot.kpis.totalSessions}</div>
                        <div className="text-xs text-gray-500">Total Sessions</div>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-green-400">{kpiSnapshot.kpis.completedSessions}</div>
                        <div className="text-xs text-gray-500">Completed</div>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-amber-400">{kpiSnapshot.kpis.avgWaitSec}s</div>
                        <div className="text-xs text-gray-500">Avg Wait</div>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className={`text-2xl font-bold ${kpiSnapshot.kpis.abandonmentRate > 50 ? 'text-red-400' : 'text-gray-400'}`}>
                          {kpiSnapshot.kpis.abandonmentRate}%
                        </div>
                        <div className="text-xs text-gray-500">Abandon Rate</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-3">
                      <div className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-purple-400">{kpiSnapshot.kpis.throughputPerHour}/hr</div>
                        <div className="text-xs text-gray-500">Throughput</div>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-cyan-400">{kpiSnapshot.kpis.lanesUsed}</div>
                        <div className="text-xs text-gray-500">Lanes Used</div>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-orange-400">{kpiSnapshot.kpis.maxWaitSec}s</div>
                        <div className="text-xs text-gray-500">Max Wait</div>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-red-400">{kpiSnapshot.kpis.abandonedSessions}</div>
                        <div className="text-xs text-gray-500">Abandoned</div>
                      </div>
                    </div>

                    {/* Recent Sessions */}
                    <div className="bg-gray-800 rounded-lg p-3">
                      <h4 className="text-sm font-medium text-white mb-2">Recent Sessions ({kpiPeriod === 'hour' ? 'last hour' : kpiPeriod === 'day' ? 'last 24h' : 'last week'})</h4>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {kpiSnapshot.recentSessions.length === 0 ? (
                          <div className="text-xs text-gray-500 text-center py-4">No recent sessions</div>
                        ) : (
                          kpiSnapshot.recentSessions.map((s, i) => (
                            <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-gray-700/50">
                              <span className="text-gray-400 font-mono">{s.personId.split(':')[1]}</span>
                              <span className="text-gray-500">{s.entryTime.split(' ')[1]}</span>
                              <span className={`font-medium ${s.abandoned ? 'text-red-400' : 'text-green-400'}`}>
                                {s.dwellSec}s {s.abandoned ? '✗' : '✓'}
                              </span>
                              <span className="text-gray-500 font-mono">{s.laneId}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Per-Lane Breakdown */}
                    <div className="bg-gray-800 rounded-lg p-3">
                      <h4 className="text-sm font-medium text-white mb-2">Per-Lane Stats</h4>
                      <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto">
                        {kpiSnapshot.perLane.slice(0, 12).map((lane, i) => (
                          <div key={i} className="bg-gray-700/50 rounded px-2 py-1 text-xs">
                            <div className="flex justify-between">
                              <span className="text-gray-400 font-mono">{lane.laneId}</span>
                              <span className="text-white">{lane.sessions} sess</span>
                            </div>
                            <div className="flex justify-between text-gray-500">
                              <span>{lane.completed} done</span>
                              <span>{lane.avgWaitSec}s avg</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin opacity-50" />
                    <p>Loading KPI data...</p>
                  </div>
                )}

                {/* LIVE DEBUG: Active Queue Sessions */}
                <div className="bg-gray-800 rounded-lg p-3 border-2 border-cyan-500/30 mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-cyan-400 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                      LIVE DEBUG: People in Queue Zones
                    </h4>
                    <span className="text-xs text-gray-500">
                      {activeSessions?.activeCount || 0} active • refreshing 1s
                    </span>
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-700">
                          <th className="text-left py-1 px-1">Person ID</th>
                          <th className="text-left py-1 px-1">Lane</th>
                          <th className="text-left py-1 px-1">Entry Time</th>
                          <th className="text-right py-1 px-1">Dwell (sec)</th>
                          <th className="text-center py-1 px-1">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!activeSessions || activeSessions.sessions.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="text-center py-4 text-gray-500">
                              No one currently in queue zones
                            </td>
                          </tr>
                        ) : (
                          activeSessions.sessions.map((s, i) => (
                            <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                              <td className="py-1.5 px-1 text-white font-mono">
                                {s.personId.split(':')[1] || s.personId}
                              </td>
                              <td className="py-1.5 px-1 text-cyan-400 font-medium">
                                {s.laneName}
                              </td>
                              <td className="py-1.5 px-1 text-gray-400">
                                {s.entryTimeStr}
                              </td>
                              <td className="py-1.5 px-1 text-right">
                                <span className={`font-bold font-mono ${
                                  s.currentDwellSec >= 5 ? 'text-green-400' : 'text-amber-400'
                                }`}>
                                  {s.currentDwellSec}s
                                </span>
                              </td>
                              <td className="py-1.5 px-1 text-center">
                                {s.inService ? (
                                  <span className="text-purple-400">🛒 Service</span>
                                ) : s.currentDwellSec >= 5 ? (
                                  <span className="text-green-400">✓ Queuing</span>
                                ) : (
                                  <span className="text-amber-400">⏳ {5 - s.currentDwellSec}s to valid</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  
                  <div className="mt-2 text-xs text-gray-500 flex items-center gap-4">
                    <span>🟢 ≥5s = Valid queue session</span>
                    <span>🟡 &lt;5s = Walk-through (will be abandoned)</span>
                    <span>🟣 In service zone</span>
                  </div>
                </div>
              </div>
            )}

            {/* Other tabs depend on live status */}
            {activeTab !== 'kpi' && error && (
              <div className="text-center py-8 text-gray-400">
                <WifiOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>{error}</p>
                <p className="text-xs mt-2">Start the simulator or configure live data source</p>
              </div>
            )}
            {activeTab !== 'kpi' && !error && !status && (
              <div className="text-center py-8 text-gray-400">
                <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin opacity-50" />
                <p>Loading...</p>
              </div>
            )}
            {activeTab !== 'kpi' && !error && status && (
              <>
                {/* Lanes Tab */}
                {activeTab === 'lanes' && (
                  <div className="space-y-4">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-4 gap-3">
                      <div className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-green-400">{status.pressure?.openLaneCount || 0}</div>
                        <div className="text-xs text-gray-500">Open</div>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-gray-500">{status.pressure?.closedLaneCount || 0}</div>
                        <div className="text-xs text-gray-500">Closed</div>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-blue-400">{status.pressure?.totalQueueCount || 0}</div>
                        <div className="text-xs text-gray-500">In Queue</div>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-gray-300">{status.pressure?.avgQueuePerLane?.toFixed(1) || '0'}</div>
                        <div className="text-xs text-gray-500">Avg/Lane</div>
                      </div>
                    </div>

                    {/* Suggestion Box */}
                    {status.pressure?.shouldOpenMore && (
                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-center gap-3">
                        <Lightbulb className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-yellow-400">Suggestion: Open Lane {status.pressure.suggestedLaneToOpen}</div>
                          <div className="text-xs text-yellow-400/70">
                            Current avg: {status.pressure.avgQueuePerLane?.toFixed(1)} → Expected: {((status.pressure.totalQueueCount || 0) / ((status.pressure.openLaneCount || 1) + 1)).toFixed(1)} per lane
                          </div>
                        </div>
                        <button
                          onClick={() => status.pressure.suggestedLaneToOpen && handleSetLaneState(status.pressure.suggestedLaneToOpen, 'open')}
                          className="px-3 py-1.5 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 text-sm font-medium rounded-lg transition-colors"
                        >
                          Open Lane
                        </button>
                      </div>
                    )}

                    {/* Lane Cards Grid */}
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                      {(!status.lanes || status.lanes.length === 0) ? (
                        <div className="col-span-full text-center py-8 text-gray-500">
                          No checkout lanes detected
                        </div>
                      ) : (
                        status.lanes.map((lane) => (
                          <LaneCard
                            key={lane.laneId}
                            lane={lane}
                            thresholds={thresholds}
                            onToggle={() => handleSetLaneState(lane.laneId, lane.desiredState === 'open' ? 'closed' : 'open')}
                          />
                        ))
                      )}
                    </div>

                    {/* Color Legend */}
                    <div className="flex items-center justify-center gap-6 pt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-green-500" />
                        &lt;{thresholds.waitTimeWarningMin}min
                      </span>
                      <span className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-amber-500" />
                        {thresholds.waitTimeWarningMin}-{thresholds.waitTimeCriticalMin}min
                      </span>
                      <span className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-red-500" />
                        &gt;{thresholds.waitTimeCriticalMin}min
                      </span>
                    </div>
                  </div>
                )}

                {/* Rules Tab */}
                {activeTab === 'rules' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-white">Alert Rules</h3>
                      <button
                        onClick={() => setEditingRule({ id: '', name: '', type: 'wait_time', operator: '>', threshold: 5, severity: 'warning', enabled: true })}
                        className="flex items-center gap-1 px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30 text-green-400 text-sm rounded-lg transition-colors"
                      >
                        <Plus className="w-4 h-4" /> Add Rule
                      </button>
                    </div>

                    {editingRule ? (
                      <RuleEditor rule={editingRule} onSave={handleSaveRule} onCancel={() => setEditingRule(null)} />
                    ) : (
                      <div className="space-y-2">
                        {rules.map(rule => (
                          <div key={rule.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))}
                                className={`p-1 rounded ${rule.enabled ? 'text-green-400' : 'text-gray-500'}`}
                              >
                                {rule.enabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                              </button>
                              <div>
                                <div className="text-sm font-medium text-white">{rule.name}</div>
                                <div className="text-xs text-gray-500">
                                  {rule.type.replace('_', ' ')} {rule.operator} {rule.threshold}
                                  {rule.type === 'wait_time' && ' min'}
                                  {rule.type === 'occupancy' && '%'}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                rule.severity === 'critical' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                              }`}>
                                {rule.severity}
                              </span>
                              <button onClick={() => setEditingRule(rule)} className="p-1 text-gray-400 hover:text-white">
                                <Settings className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDeleteRule(rule.id)} className="p-1 text-gray-400 hover:text-red-400">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Settings Tab */}
                {activeTab === 'settings' && (
                  <div className="space-y-6">
                    <h3 className="text-sm font-medium text-white">Color Thresholds</h3>
                    
                    {/* Wait Time Thresholds */}
                    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
                      <div className="flex items-center gap-2 text-sm text-gray-300">
                        <Clock className="w-4 h-4" /> Wait Time Thresholds
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Warning (amber) after</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={10}
                              value={thresholds.waitTimeWarningMin}
                              onChange={(e) => setThresholds(t => ({ ...t, waitTimeWarningMin: parseInt(e.target.value) || 2 }))}
                              className="w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                            />
                            <span className="text-sm text-gray-500">minutes</span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Critical (red) after</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={30}
                              value={thresholds.waitTimeCriticalMin}
                              onChange={(e) => setThresholds(t => ({ ...t, waitTimeCriticalMin: parseInt(e.target.value) || 5 }))}
                              className="w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                            />
                            <span className="text-sm text-gray-500">minutes</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Queue Length Thresholds */}
                    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
                      <div className="flex items-center gap-2 text-sm text-gray-300">
                        <Users className="w-4 h-4" /> Queue Length Thresholds
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Warning after</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={thresholds.queueLengthWarning}
                              onChange={(e) => setThresholds(t => ({ ...t, queueLengthWarning: parseInt(e.target.value) || 5 }))}
                              className="w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                            />
                            <span className="text-sm text-gray-500">people</span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Critical after</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={50}
                              value={thresholds.queueLengthCritical}
                              onChange={(e) => setThresholds(t => ({ ...t, queueLengthCritical: parseInt(e.target.value) || 10 }))}
                              className="w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                            />
                            <span className="text-sm text-gray-500">people</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Occupancy Thresholds */}
                    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
                      <div className="flex items-center gap-2 text-sm text-gray-300">
                        <Gauge className="w-4 h-4" /> Occupancy Rate Thresholds
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Warning after</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={10}
                              max={100}
                              value={thresholds.occupancyWarning}
                              onChange={(e) => setThresholds(t => ({ ...t, occupancyWarning: parseInt(e.target.value) || 70 }))}
                              className="w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                            />
                            <span className="text-sm text-gray-500">%</span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Critical after</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={10}
                              max={100}
                              value={thresholds.occupancyCritical}
                              onChange={(e) => setThresholds(t => ({ ...t, occupancyCritical: parseInt(e.target.value) || 90 }))}
                              className="w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                            />
                            <span className="text-sm text-gray-500">%</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Data Source */}
                    <div className="bg-gray-800 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-300">Data Source</span>
                        <select
                          value={dataSource}
                          onChange={(e) => setDataSource(e.target.value as 'auto' | 'simulation' | 'live')}
                          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-gray-300 text-sm"
                        >
                          <option value="auto">Auto</option>
                          <option value="simulation">Simulation</option>
                          <option value="live">Live</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right Panel - Alerts Ledger */}
          {showLedger && (
            <div className="w-80 flex flex-col bg-gray-850">
              <div className="p-3 border-b border-gray-700 bg-gray-800/50">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-white flex items-center gap-2">
                    <Bell className="w-4 h-4 text-amber-400" /> Live Alerts
                  </h3>
                  <span className="text-xs text-gray-500">{activeAlerts.length} active</span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setLedgerFilter('active')}
                    className={`flex-1 px-2 py-1 text-xs rounded ${
                      ledgerFilter === 'active' ? 'bg-amber-500/20 text-amber-400' : 'text-gray-500 hover:bg-gray-700'
                    }`}
                  >
                    Active ({activeAlerts.length})
                  </button>
                  <button
                    onClick={() => setLedgerFilter('dismissed')}
                    className={`flex-1 px-2 py-1 text-xs rounded ${
                      ledgerFilter === 'dismissed' ? 'bg-gray-600 text-gray-300' : 'text-gray-500 hover:bg-gray-700'
                    }`}
                  >
                    Dismissed ({dismissedAlerts.length})
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto">
                {(ledgerFilter === 'active' ? activeAlerts : dismissedAlerts).length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    {ledgerFilter === 'active' ? 'No active alerts' : 'No dismissed alerts'}
                  </div>
                ) : (
                  (ledgerFilter === 'active' ? activeAlerts : dismissedAlerts).map(alert => (
                    <AlertEntry
                      key={alert.id}
                      alert={alert}
                      onAcknowledge={() => handleAcknowledge(alert.id)}
                      onDismiss={() => handleDismiss(alert.id)}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-700 bg-gray-800/30">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{status?.lanes?.length || 0} lanes configured</span>
            <span>Last update: {new Date().toLocaleTimeString()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Lane Card Component
function LaneCard({ 
  lane, 
  thresholds, 
  onToggle 
}: { 
  lane: LaneStatus
  thresholds: ThresholdSettings
  onToggle: () => void 
}) {
  const isOpen = lane.status === 'OPEN'
  const isTransitioning = lane.status === 'OPENING' || lane.status === 'CLOSING'
  
  return (
    <div className={`bg-gray-800 rounded-lg p-3 border-2 transition-colors ${
      isOpen ? 'border-green-500/30' : 'border-gray-700'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${
            lane.status === 'OPEN' ? 'bg-green-400' :
            lane.status === 'OPENING' ? 'bg-yellow-400 animate-pulse' :
            lane.status === 'CLOSING' ? 'bg-orange-400 animate-pulse' :
            'bg-gray-600'
          }`} />
          <span className="text-sm font-medium text-white">
            {lane.name || `Lane ${lane.laneId}`}
          </span>
        </div>
        <button
          onClick={onToggle}
          className={`p-1 rounded transition-colors ${
            lane.desiredState === 'open' 
              ? 'text-green-400 hover:bg-green-500/20' 
              : 'text-gray-500 hover:bg-gray-700'
          }`}
        >
          {lane.desiredState === 'open' ? (
            <ToggleRight className="w-5 h-5" />
          ) : (
            <ToggleLeft className="w-5 h-5" />
          )}
        </button>
      </div>
      
      {isOpen ? (
        <>
          <div className="mb-2">
            <QueueCircles 
              count={lane.queueCount} 
              queuedPeople={lane.queuedPeople}
              warningMin={thresholds.waitTimeWarningMin}
              criticalMin={thresholds.waitTimeCriticalMin}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">{lane.queueCount} queued</span>
            {lane.avgWaitTimeSec !== undefined && (
              <span className="text-gray-400">
                ~{(lane.avgWaitTimeSec / 60).toFixed(1)}min avg
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="text-xs text-gray-500 py-2">
          {isTransitioning ? lane.status.toLowerCase() + '...' : 'Lane closed'}
        </div>
      )}
    </div>
  )
}

// Alert Entry Component
function AlertEntry({ 
  alert, 
  onAcknowledge, 
  onDismiss 
}: { 
  alert: CheckoutAlert
  onAcknowledge: () => void
  onDismiss: () => void 
}) {
  const formatTime = (ts: string) => {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className={`px-3 py-2 border-b border-gray-800 transition-all ${
      alert.dismissed ? 'opacity-50 bg-gray-800/30' :
      alert.acknowledged ? 'opacity-70 bg-gray-800/50' : ''
    }`}>
      <div className="flex items-start gap-2">
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
          alert.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white truncate">{alert.message}</div>
          <div className="text-xs text-gray-500">
            {alert.value.toFixed(1)} {alert.type === 'wait_time' ? 'min' : alert.type === 'occupancy' ? '%' : ''} 
            <span className="text-gray-600"> (threshold: {alert.threshold})</span>
          </div>
          <div className="text-xs text-gray-600 mt-0.5">{formatTime(alert.timestamp)}</div>
        </div>
        {!alert.dismissed && (
          <div className="flex gap-1">
            {!alert.acknowledged && (
              <button
                onClick={onAcknowledge}
                className="p-1 text-gray-500 hover:text-green-400 rounded transition-colors"
                title="Acknowledge"
              >
                <CheckCircle className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onDismiss}
              className="p-1 text-gray-500 hover:text-gray-300 rounded transition-colors"
              title="Dismiss"
            >
              <EyeOff className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Rule Editor Component
function RuleEditor({ 
  rule, 
  onSave, 
  onCancel 
}: { 
  rule: CheckoutAlertRule
  onSave: (rule: CheckoutAlertRule) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState(rule)

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Rule Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="e.g., High Wait Time Warning"
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
        />
      </div>
      
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Metric</label>
          <select
            value={form.type}
            onChange={(e) => setForm(f => ({ ...f, type: e.target.value as any }))}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
          >
            <option value="wait_time">Wait Time</option>
            <option value="queue_length">Queue Length</option>
            <option value="occupancy">Occupancy Rate</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Operator</label>
          <select
            value={form.operator}
            onChange={(e) => setForm(f => ({ ...f, operator: e.target.value as any }))}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
          >
            <option value=">">&gt; Greater than</option>
            <option value="<">&lt; Less than</option>
            <option value=">=">&gt;= Greater or equal</option>
            <option value="<=">&lt;= Less or equal</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Threshold</label>
          <input
            type="number"
            value={form.threshold}
            onChange={(e) => setForm(f => ({ ...f, threshold: parseFloat(e.target.value) || 0 }))}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Severity</label>
        <div className="flex gap-2">
          {(['warning', 'critical'] as const).map(sev => (
            <button
              key={sev}
              onClick={() => setForm(f => ({ ...f, severity: sev }))}
              className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                form.severity === sev
                  ? sev === 'critical' 
                    ? 'border-red-500 bg-red-500/20 text-red-400'
                    : 'border-amber-500 bg-amber-500/20 text-amber-400'
                  : 'border-gray-600 text-gray-400 hover:border-gray-500'
              }`}
            >
              {sev.charAt(0).toUpperCase() + sev.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} className="flex-1 px-4 py-2 border border-gray-600 text-gray-400 rounded-lg hover:bg-gray-700">
          Cancel
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={!form.name.trim()}
          className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
        >
          <Save className="w-4 h-4 inline mr-1" /> Save Rule
        </button>
      </div>
    </div>
  )
}
