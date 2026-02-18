import { useState, useEffect, useCallback } from 'react'
import { X, Settings, Save, RotateCcw, TrendingUp, TrendingDown, Minus } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Default thresholds from PersonaStepRegistry (fallback values)
const DEFAULT_THRESHOLDS: Record<string, ThresholdConfig> = {
  totalInStore: { green: 50, amber: 20, direction: 'higher', label: 'In Store Now', unit: 'people', hint: 'People currently in store' },
  avgDwellTime: { green: 2, amber: 0.5, direction: 'higher', label: 'Avg Dwell Time', unit: 'min', hint: 'Average time per zone visit' },
  avgStoreVisit: { green: 30, amber: 10, direction: 'higher', label: 'Avg Store Visit', unit: 'min', hint: 'Average total time per customer' },
  occupancyRate: { green: 70, amber: 90, direction: 'lower', label: 'Occupancy Rate', unit: '%', hint: 'Percentage of venue capacity' },
  queueWaitTime: { green: 2, amber: 5, direction: 'lower', label: 'Queue Wait Time', unit: 'min', hint: 'Average queue waiting time' },
  cashierOpenCount: { green: 4, amber: 2, direction: 'higher', label: 'Open Lanes', unit: 'lanes', hint: 'Active checkout lanes' },
  passByTraffic: { green: 500, amber: 200, direction: 'higher', label: 'Pass-By Traffic', unit: 'visitors', hint: 'Total visitors' },
  conversionRate: { green: 30, amber: 15, direction: 'higher', label: 'Conversion Rate', unit: '%', hint: 'Visitor to buyer' },
  engagementRate: { green: 60, amber: 30, direction: 'higher', label: 'Engagement Rate', unit: '%', hint: 'Meaningful interactions' },
  browsingRate: { green: 60, amber: 30, direction: 'higher', label: 'Browsing Rate', unit: '%', hint: 'Visitors who browsed' },
  bounceRate: { green: 20, amber: 50, direction: 'lower', label: 'Bounce Rate', unit: '%', hint: 'Left quickly without engagement' },
}

interface ThresholdConfig {
  green: number
  amber: number
  direction: 'higher' | 'lower'
  label?: string
  unit?: string
  hint?: string
  updatedAt?: string
}

interface VenueKPIThresholdsPanelProps {
  venueId: string
  venueName: string
  isOpen: boolean
  onClose: () => void
}

function ThresholdSlider({
  kpiId,
  config,
  defaultConfig,
  onChange,
  onReset,
}: {
  kpiId: string
  config: ThresholdConfig
  defaultConfig: ThresholdConfig
  onChange: (kpiId: string, field: 'green' | 'amber', value: number) => void
  onReset: (kpiId: string) => void
}) {
  const isModified = config.green !== defaultConfig.green || config.amber !== defaultConfig.amber
  const isHigherBetter = config.direction === 'higher'

  // Determine slider range based on unit
  const getRange = () => {
    if (config.unit === '%') return { min: 0, max: 100, step: 5 }
    if (config.unit === 'min') return { min: 0, max: 60, step: 1 }
    if (config.unit === 'lanes') return { min: 1, max: 20, step: 1 }
    if (config.unit === 'visitors') return { min: 0, max: 2000, step: 50 }
    return { min: 0, max: 100, step: 1 }
  }

  const range = getRange()

  return (
    <div className={`p-3 rounded-lg border transition-colors ${
      isModified ? 'bg-amber-500/10 border-amber-500/30' : 'bg-gray-800/50 border-gray-700'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isHigherBetter ? (
            <TrendingUp className="w-4 h-4 text-green-400" />
          ) : (
            <TrendingDown className="w-4 h-4 text-green-400" />
          )}
          <span className="text-sm font-medium text-white">{config.label || kpiId}</span>
          {isModified && (
            <span className="px-1.5 py-0.5 text-[10px] bg-amber-600 text-white rounded">Modified</span>
          )}
        </div>
        {isModified && (
          <button
            onClick={() => onReset(kpiId)}
            className="p-1 text-gray-400 hover:text-amber-400 transition-colors"
            title="Reset to default"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <p className="text-[10px] text-gray-500 mb-3">{config.hint}</p>

      <div className="space-y-3">
        {/* Green threshold */}
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-xs text-green-400 flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              Green {isHigherBetter ? '≥' : '≤'}
            </span>
            <span className="text-xs font-medium text-green-400">
              {config.green}{config.unit}
            </span>
          </div>
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={config.green}
            onChange={(e) => onChange(kpiId, 'green', parseFloat(e.target.value))}
            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
          />
        </div>

        {/* Amber threshold */}
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              Amber {isHigherBetter ? '≥' : '≤'}
            </span>
            <span className="text-xs font-medium text-amber-400">
              {config.amber}{config.unit}
            </span>
          </div>
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={config.amber}
            onChange={(e) => onChange(kpiId, 'amber', parseFloat(e.target.value))}
            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
          />
        </div>

        {/* Status preview */}
        <div className="flex items-center gap-2 pt-1 border-t border-gray-700">
          <span className="text-[10px] text-gray-500">Status: </span>
          {isHigherBetter ? (
            <>
              <span className="text-[10px] text-red-400">{'<'}{config.amber}</span>
              <Minus className="w-3 h-3 text-gray-600" />
              <span className="text-[10px] text-amber-400">{config.amber}-{config.green}</span>
              <Minus className="w-3 h-3 text-gray-600" />
              <span className="text-[10px] text-green-400">{'≥'}{config.green}</span>
            </>
          ) : (
            <>
              <span className="text-[10px] text-green-400">{'≤'}{config.green}</span>
              <Minus className="w-3 h-3 text-gray-600" />
              <span className="text-[10px] text-amber-400">{config.green}-{config.amber}</span>
              <Minus className="w-3 h-3 text-gray-600" />
              <span className="text-[10px] text-red-400">{'>'}{config.amber}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function VenueKPIThresholdsPanel({ venueId, venueName, isOpen, onClose }: VenueKPIThresholdsPanelProps) {
  const [thresholds, setThresholds] = useState<Record<string, ThresholdConfig>>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchThresholds = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/venues/${venueId}/kpi-thresholds`)
      if (res.ok) {
        const data = await res.json()
        // Merge with defaults
        const merged: Record<string, ThresholdConfig> = {}
        for (const [kpiId, defaultConfig] of Object.entries(DEFAULT_THRESHOLDS)) {
          merged[kpiId] = {
            ...defaultConfig,
            ...(data.thresholds[kpiId] || {}),
          }
        }
        setThresholds(merged)
      }
    } catch (err) {
      console.error('Failed to fetch KPI thresholds:', err)
      // Use defaults on error
      setThresholds({ ...DEFAULT_THRESHOLDS })
    } finally {
      setLoading(false)
    }
  }, [venueId])

  useEffect(() => {
    if (isOpen) {
      fetchThresholds()
    }
  }, [isOpen, fetchThresholds])

  const handleChange = (kpiId: string, field: 'green' | 'amber', value: number) => {
    setThresholds(prev => ({
      ...prev,
      [kpiId]: {
        ...prev[kpiId],
        [field]: value,
      },
    }))
  }

  const handleReset = (kpiId: string) => {
    if (DEFAULT_THRESHOLDS[kpiId]) {
      setThresholds(prev => ({
        ...prev,
        [kpiId]: { ...DEFAULT_THRESHOLDS[kpiId] },
      }))
    }
  }

  const handleResetAll = () => {
    setThresholds({ ...DEFAULT_THRESHOLDS })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // Only save modified thresholds
      const toSave: Record<string, { green: number; amber: number; direction: string }> = {}
      for (const [kpiId, config] of Object.entries(thresholds)) {
        const defaultConfig = DEFAULT_THRESHOLDS[kpiId]
        if (!defaultConfig || config.green !== defaultConfig.green || config.amber !== defaultConfig.amber) {
          toSave[kpiId] = {
            green: config.green,
            amber: config.amber,
            direction: config.direction,
          }
        }
      }

      await fetch(`${API_BASE}/api/venues/${venueId}/kpi-thresholds`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thresholds: toSave }),
      })

      onClose()
    } catch (err) {
      console.error('Failed to save KPI thresholds:', err)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">AI Narrator Thresholds</h2>
              <p className="text-xs text-gray-400">{venueName} - Configure green/amber/red status colors</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(thresholds).map(([kpiId, config]) => (
                <ThresholdSlider
                  key={kpiId}
                  kpiId={kpiId}
                  config={config}
                  defaultConfig={DEFAULT_THRESHOLDS[kpiId] || config}
                  onChange={handleChange}
                  onReset={handleReset}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 bg-gray-800">
          <button
            onClick={handleResetAll}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset All to Defaults
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Thresholds'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
