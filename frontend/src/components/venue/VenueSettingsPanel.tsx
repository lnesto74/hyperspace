import { useState, useEffect, useCallback } from 'react'
import { X, Settings, Save, Building2, Users, Clock, Activity } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface VenueSettingsPanelProps {
  venueId: string
  venueName: string
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

interface VenueSettings {
  maxCapacity: number
  defaultDwellThresholdSec: number
  defaultEngagementThresholdSec: number
}

export default function VenueSettingsPanel({ 
  venueId, 
  venueName, 
  isOpen, 
  onClose,
  onSaved 
}: VenueSettingsPanelProps) {
  const [settings, setSettings] = useState<VenueSettings>({
    maxCapacity: 300,
    defaultDwellThresholdSec: 60,
    defaultEngagementThresholdSec: 120,
  })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/venues/${venueId}`)
      if (res.ok) {
        const data = await res.json()
        setSettings({
          maxCapacity: data.venue.maxCapacity || 300,
          defaultDwellThresholdSec: data.venue.defaultDwellThresholdSec || 60,
          defaultEngagementThresholdSec: data.venue.defaultEngagementThresholdSec || 120,
        })
      }
    } catch (err) {
      console.error('Failed to fetch venue settings:', err)
    } finally {
      setLoading(false)
    }
  }, [venueId])

  useEffect(() => {
    if (isOpen) {
      fetchSettings()
    }
  }, [isOpen, fetchSettings])

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch(`${API_BASE}/api/venues/${venueId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      onSaved?.()
      onClose()
    } catch (err) {
      console.error('Failed to save venue settings:', err)
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
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-blue-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">Venue Settings</h2>
              <p className="text-xs text-gray-400">{venueName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
            </div>
          ) : (
            <>
              {/* Max Capacity */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-400" />
                  <label className="text-sm font-medium text-white">Max Capacity</label>
                </div>
                <p className="text-xs text-gray-500">Maximum people allowed in the venue (for occupancy rate calculation)</p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={50}
                    max={1000}
                    step={10}
                    value={settings.maxCapacity}
                    onChange={(e) => setSettings(s => ({ ...s, maxCapacity: parseInt(e.target.value) }))}
                    className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <input
                    type="number"
                    min={10}
                    max={5000}
                    value={settings.maxCapacity}
                    onChange={(e) => setSettings(s => ({ ...s, maxCapacity: parseInt(e.target.value) || 300 }))}
                    className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm text-center"
                  />
                  <span className="text-xs text-gray-500">people</span>
                </div>
              </div>

              {/* Dwell Threshold */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <label className="text-sm font-medium text-white">Default Dwell Threshold</label>
                </div>
                <p className="text-xs text-gray-500">Minimum time in zone to count as a "dwell" (browsing)</p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={5}
                    max={300}
                    step={5}
                    value={settings.defaultDwellThresholdSec}
                    onChange={(e) => setSettings(s => ({ ...s, defaultDwellThresholdSec: parseInt(e.target.value) }))}
                    className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={settings.defaultDwellThresholdSec}
                    onChange={(e) => setSettings(s => ({ ...s, defaultDwellThresholdSec: parseInt(e.target.value) || 60 }))}
                    className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm text-center"
                  />
                  <span className="text-xs text-gray-500">seconds</span>
                </div>
              </div>

              {/* Engagement Threshold */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-green-400" />
                  <label className="text-sm font-medium text-white">Default Engagement Threshold</label>
                </div>
                <p className="text-xs text-gray-500">Minimum time in zone to count as "engaged" (meaningful interaction)</p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={30}
                    max={600}
                    step={10}
                    value={settings.defaultEngagementThresholdSec}
                    onChange={(e) => setSettings(s => ({ ...s, defaultEngagementThresholdSec: parseInt(e.target.value) }))}
                    className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                  />
                  <input
                    type="number"
                    min={10}
                    max={1200}
                    value={settings.defaultEngagementThresholdSec}
                    onChange={(e) => setSettings(s => ({ ...s, defaultEngagementThresholdSec: parseInt(e.target.value) || 120 }))}
                    className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm text-center"
                  />
                  <span className="text-xs text-gray-500">seconds</span>
                </div>
              </div>

              {/* Info Box */}
              <div className="p-3 bg-blue-900/20 border border-blue-800/50 rounded-lg">
                <p className="text-xs text-blue-300">
                  <strong>Note:</strong> These are venue-wide defaults. Individual zones can override these values in their zone settings.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-700 bg-gray-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
