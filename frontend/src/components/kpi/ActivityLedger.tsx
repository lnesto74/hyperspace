import { useState, useEffect, useCallback } from 'react'
import { 
  X, Bell, AlertTriangle, AlertCircle, Info, CheckCircle, 
  Filter, RefreshCw, ChevronDown, Clock, MapPin
} from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface LedgerEntry {
  id: number
  venueId: string
  roiId: string | null
  roiName: string | null
  roiColor: string | null
  ruleId: number | null
  eventType: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string | null
  metricName: string | null
  metricValue: number | null
  thresholdValue: number | null
  acknowledged: boolean
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  timestamp: number
  createdAt: string
}

interface ActivityLedgerProps {
  venueId: string
  isOpen: boolean
  onClose: () => void
}

const severityIcons = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
}

const severityColors = {
  info: 'text-blue-400 bg-blue-500/20 border-blue-500/30',
  warning: 'text-amber-400 bg-amber-500/20 border-amber-500/30',
  critical: 'text-red-400 bg-red-500/20 border-red-500/30',
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  })
}

export default function ActivityLedger({ venueId, isOpen, onClose }: ActivityLedgerProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'warning' | 'critical' | 'unread'>('all')
  const [total, setTotal] = useState(0)

  const fetchEntries = useCallback(async () => {
    if (!venueId) return
    
    setLoading(true)
    try {
      let url = `${API_BASE}/api/venues/${venueId}/ledger?limit=50`
      
      if (filter === 'warning') {
        url += '&severity=warning'
      } else if (filter === 'critical') {
        url += '&severity=critical'
      } else if (filter === 'unread') {
        url += '&acknowledged=false'
      }
      
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setEntries(data.entries)
        setTotal(data.total)
      }
    } catch (err) {
      console.error('Failed to fetch ledger entries:', err)
    } finally {
      setLoading(false)
    }
  }, [venueId, filter])

  useEffect(() => {
    if (isOpen) {
      fetchEntries()
      // Auto-refresh every 10 seconds
      const interval = setInterval(fetchEntries, 10000)
      return () => clearInterval(interval)
    }
  }, [isOpen, fetchEntries])

  const handleAcknowledge = async (entryId: number) => {
    try {
      await fetch(`${API_BASE}/api/ledger/${entryId}/acknowledge`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledgedBy: 'user' }),
      })
      
      // Update local state
      setEntries(prev => prev.map(e => 
        e.id === entryId ? { ...e, acknowledged: true, acknowledgedAt: new Date().toISOString() } : e
      ))
    } catch (err) {
      console.error('Failed to acknowledge entry:', err)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">Activity Ledger</h2>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  LIVE
                </span>
                <span>•</span>
                <span>Zone Event Stream</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
          <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
            {(['all', 'warning', 'critical', 'unread'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  filter === f 
                    ? 'bg-amber-600 text-white' 
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          
          <div className="flex-1" />
          
          <button 
            onClick={fetchEntries}
            className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          
          <span className="text-xs text-gray-500">{total} events</span>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-[80px_1fr_120px_100px_60px] gap-2 px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-700/50 bg-gray-800/30">
          <div>Time</div>
          <div>Event</div>
          <div>Zone</div>
          <div>Severity</div>
          <div></div>
        </div>

        {/* Entries List */}
        <div className="flex-1 overflow-y-auto">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-500">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading events...
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Bell className="w-8 h-8 mb-2 opacity-50" />
              <p>No events recorded yet</p>
              <p className="text-xs text-gray-600 mt-1">Events will appear when alert rules are triggered</p>
            </div>
          ) : (
            entries.map((entry) => {
              const SeverityIcon = severityIcons[entry.severity]
              return (
                <div 
                  key={entry.id}
                  className={`grid grid-cols-[80px_1fr_120px_100px_60px] gap-2 px-4 py-3 border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${
                    !entry.acknowledged ? 'bg-gray-800/30' : ''
                  }`}
                >
                  {/* Time */}
                  <div className="text-xs">
                    <div className="text-gray-300">{formatTime(entry.timestamp)}</div>
                    <div className="text-gray-500">{formatRelativeTime(entry.timestamp)}</div>
                  </div>
                  
                  {/* Event */}
                  <div>
                    <div className="text-sm text-white font-medium">{entry.title}</div>
                    {entry.message && (
                      <div className="text-xs text-gray-400 mt-0.5">{entry.message}</div>
                    )}
                    {entry.metricValue !== null && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        {entry.metricName}: <span className="text-amber-400">{entry.metricValue}</span>
                        {entry.thresholdValue !== null && (
                          <span className="text-gray-600"> / threshold: {entry.thresholdValue}</span>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Zone */}
                  <div className="flex items-center gap-1.5">
                    {entry.roiColor && (
                      <div 
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: entry.roiColor }}
                      />
                    )}
                    <span className="text-xs text-gray-300 truncate">
                      {entry.roiName || 'Global'}
                    </span>
                  </div>
                  
                  {/* Severity */}
                  <div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${severityColors[entry.severity]}`}>
                      <SeverityIcon className="w-3 h-3" />
                      {entry.severity}
                    </span>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex items-center justify-end">
                    {!entry.acknowledged ? (
                      <button
                        onClick={() => handleAcknowledge(entry.id)}
                        className="p-1 text-gray-500 hover:text-green-400 rounded transition-colors"
                        title="Acknowledge"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                    ) : (
                      <CheckCircle className="w-4 h-4 text-green-500/50" title="Acknowledged" />
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
