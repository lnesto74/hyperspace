import { useState, useEffect, useCallback } from 'react'
import { X, Settings, Save, Building2, Users, Clock, Activity, DoorOpen, Route, Target } from 'lucide-react'
import { API_BASE } from '../../config/api'

interface VisitSessionConfig {
  maxVisitDurationMs: number
  reidMaxGapMs: number
  reidMaxDistanceM: number
  entranceMinDurationMs: number
  minInStoreDurationSec: number
  trackKeyMode: string
  calibrationConversionRate: number | null
}

const DEFAULT_VISIT_SESSION: VisitSessionConfig = {
  maxVisitDurationMs: 90 * 60 * 1000,
  reidMaxGapMs: 10_000,
  reidMaxDistanceM: 4.5,
  entranceMinDurationMs: 5_000,
  minInStoreDurationSec: 30,
  trackKeyMode: 'reid_chain',
  calibrationConversionRate: null,
}

const TRACK_KEY_MODES: { value: VisitSessionConfig['trackKeyMode']; label: string; hint: string }[] = [
  {
    value: 'reid_chain',
    label: 'Time + position (recommended)',
    hint: 'Link fragments if the gap and distance match — best for grocery.',
  },
  {
    value: 'suffix_alias',
    label: 'Same perception ID suffix',
    hint: 'Only merge when the device reuses the same short track id.',
  },
  {
    value: 'exact',
    label: 'Exact track key only',
    hint: 'No stitching — each fragment stays separate (debug / strict).',
  },
]

interface CategoryPresenceConfig {
  categoryDwellRadiusM: number
  engagementRadiusM: number
  dwellGapS: number
  dwellStitchS: number
  engagementGapS: number
  dwellMinDurationS: number
  engagementMinDurationS: number
  identityMode: 'raw' | 'track_key'
}

const DEFAULT_CATEGORY_PRESENCE: CategoryPresenceConfig = {
  categoryDwellRadiusM: 2.0,
  engagementRadiusM: 0.5,
  dwellGapS: 3,
  dwellStitchS: 8,
  engagementGapS: 1,
  dwellMinDurationS: 2,
  engagementMinDurationS: 0.5,
  identityMode: 'raw',
}

const IDENTITY_MODES: { value: CategoryPresenceConfig['identityMode']; label: string; hint: string }[] = [
  {
    value: 'raw',
    label: 'Raw perception ID (recommended)',
    hint: 'Safer while live reconciler over-merges. Engagement and category dwell use original_perception_id.',
  },
  {
    value: 'track_key',
    label: 'Reconciled track key',
    hint: 'Uses live luca / track_key. Can inflate clocks if identities glue across the store.',
  },
]


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
  openingHour: number
  closingHour: number
  footfallRoiId: string | null
}

interface RoiOption {
  id: string
  name: string
}

function hourOptions() {
  return Array.from({ length: 24 }, (_, i) => ({
    value: i,
    label: `${String(i).padStart(2, '0')}:00`,
  }))
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
    openingHour: 8,
    closingHour: 20,
    footfallRoiId: null,
  })
  const [roiOptions, setRoiOptions] = useState<RoiOption[]>([])
  const [visitSession, setVisitSession] = useState<VisitSessionConfig>(DEFAULT_VISIT_SESSION)
  const [categoryPresence, setCategoryPresence] = useState<CategoryPresenceConfig>(DEFAULT_CATEGORY_PRESENCE)
  const [calibrationPct, setCalibrationPct] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    try {
      const [venueRes, roiRes, sessionRes, presenceRes] = await Promise.all([
        fetch(`${API_BASE}/api/venues/${venueId}`),
        fetch(`${API_BASE}/api/venues/${venueId}/roi?all=true`),
        fetch(`${API_BASE}/api/venues/${venueId}/visit-session-config`),
        fetch(`${API_BASE}/api/venues/${venueId}/category-presence-config`),
      ])
      if (venueRes.ok) {
        const data = await venueRes.json()
        setSettings({
          maxCapacity: data.venue.maxCapacity || 300,
          defaultDwellThresholdSec: data.venue.defaultDwellThresholdSec || 60,
          defaultEngagementThresholdSec: data.venue.defaultEngagementThresholdSec || 120,
          openingHour: data.venue.openingHour ?? 8,
          closingHour: data.venue.closingHour ?? 20,
          footfallRoiId: data.venue.footfallRoiId || null,
        })
      }
      if (roiRes.ok) {
        const rois = await roiRes.json()
        const traffic = (rois as RoiOption[]).filter(r =>
          /entrance|entry|traffic|ingress|ingresso|gate|door/i.test(r.name),
        )
        setRoiOptions(traffic.length > 0 ? traffic : (rois as RoiOption[]))
      }
      if (sessionRes.ok) {
        const data = await sessionRes.json()
        const vs = { ...DEFAULT_VISIT_SESSION, ...(data.visitSession || {}) }
        setVisitSession(vs)
        setCalibrationPct(
          vs.calibrationConversionRate != null
            ? String(Math.round(vs.calibrationConversionRate * 100))
            : ''
        )
      }
      if (presenceRes.ok) {
        const data = await presenceRes.json()
        setCategoryPresence({ ...DEFAULT_CATEGORY_PRESENCE, ...(data.categoryPresence || {}) })
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
      const calibration = calibrationPct.trim() === ''
        ? null
        : Math.max(0, Math.min(100, parseFloat(calibrationPct) || 0)) / 100

      await Promise.all([
        fetch(`${API_BASE}/api/venues/${venueId}/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        }),
        fetch(`${API_BASE}/api/venues/${venueId}/visit-session-config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            visitSession: {
              ...visitSession,
              calibrationConversionRate: calibration,
            },
          }),
        }),
        fetch(`${API_BASE}/api/venues/${venueId}/category-presence-config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoryPresence }),
        }),
      ])
      onSaved?.()
      onClose()
    } catch (err) {
      console.error('Failed to save venue settings:', err)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const hours = hourOptions()

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
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
        <div className="p-4 space-y-5 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
            </div>
          ) : (
            <>
              {/* Store hours + footfall */}
              <div className="space-y-3 p-3 bg-indigo-900/20 border border-indigo-700/40 rounded-lg">
                <div className="flex items-center gap-2">
                  <DoorOpen className="w-4 h-4 text-indigo-400" />
                  <label className="text-sm font-medium text-white">Store hours & footfall</label>
                </div>
                <p className="text-xs text-gray-500">
                  Used to compute visits per open hour on your entrance / traffic zone.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Opens</label>
                    <select
                      value={settings.openingHour}
                      onChange={(e) => setSettings(s => ({ ...s, openingHour: parseInt(e.target.value, 10) }))}
                      className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                    >
                      {hours.map(h => (
                        <option key={`open-${h.value}`} value={h.value}>{h.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Closes</label>
                    <select
                      value={settings.closingHour}
                      onChange={(e) => setSettings(s => ({ ...s, closingHour: parseInt(e.target.value, 10) }))}
                      className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                    >
                      {hours.map(h => (
                        <option key={`close-${h.value}`} value={h.value}>{h.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 block mb-1">Footfall zone</label>
                  <select
                    value={settings.footfallRoiId || ''}
                    onChange={(e) => setSettings(s => ({
                      ...s,
                      footfallRoiId: e.target.value || null,
                    }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    <option value="">Auto (name contains entrance / traffic)</option>
                    {roiOptions.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              </div>

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

              {/* Journey session stitching */}
              <div className="space-y-3 p-3 bg-violet-900/20 border border-violet-700/40 rounded-lg">
                <div className="flex items-center gap-2">
                  <Route className="w-4 h-4 text-violet-400" />
                  <label className="text-sm font-medium text-white">Journey stitching</label>
                </div>
                <p className="text-xs text-gray-500">
                  How the Neural Dashboard glues broken LiDAR tracks into one shopping trip (entrance → aisles → checkout).
                </p>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400">Fragment gap (seconds)</label>
                  <p className="text-[10px] text-gray-600 mb-1">
                    Max pause before we treat the next blip as the same person. Your site: usually 5–10 s.
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={2}
                      max={30}
                      step={1}
                      value={Math.round(visitSession.reidMaxGapMs / 1000)}
                      onChange={(e) => setVisitSession(v => ({
                        ...v,
                        reidMaxGapMs: parseInt(e.target.value, 10) * 1000,
                      }))}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                    />
                    <span className="w-12 text-sm text-white text-center tabular-nums">
                      {Math.round(visitSession.reidMaxGapMs / 1000)}s
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400">Re-link distance (meters)</label>
                  <p className="text-[10px] text-gray-600 mb-1">
                    How far the person can move between fragments and still count as one trip.
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={15}
                      step={0.5}
                      value={visitSession.reidMaxDistanceM}
                      onChange={(e) => setVisitSession(v => ({
                        ...v,
                        reidMaxDistanceM: parseFloat(e.target.value),
                      }))}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                    />
                    <span className="w-12 text-sm text-white text-center tabular-nums">
                      {visitSession.reidMaxDistanceM}m
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400">Door stopwatch (seconds)</label>
                  <p className="text-[10px] text-gray-600 mb-1">
                    Like a bouncer with a stopwatch: how long someone must be at the entrance before we start
                    one shopping trip. Too short = people just walking past count as shoppers. Too long = fast
                    walk-ins are missed. (This is separate from the footfall counter on the KPI rail.)
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={60}
                      step={1}
                      value={Math.round(visitSession.entranceMinDurationMs / 1000)}
                      onChange={(e) => setVisitSession(v => ({
                        ...v,
                        entranceMinDurationMs: parseInt(e.target.value, 10) * 1000,
                      }))}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                    />
                    <span className="w-12 text-sm text-white text-center tabular-nums">
                      {Math.round(visitSession.entranceMinDurationMs / 1000)}s
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400">Max trip length (minutes)</label>
                  <p className="text-[10px] text-gray-600 mb-1">
                    After someone enters, we keep stitching fragments for this long. Typical supermarket
                    shops are 10–15 min — a 30–45 min limit is plenty; 90 min is a safe default ceiling.
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={15}
                      max={120}
                      step={5}
                      value={Math.round(visitSession.maxVisitDurationMs / 60_000)}
                      onChange={(e) => setVisitSession(v => ({
                        ...v,
                        maxVisitDurationMs: parseInt(e.target.value, 10) * 60_000,
                      }))}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                    />
                    <span className="w-14 text-sm text-white text-center tabular-nums">
                      {Math.round(visitSession.maxVisitDurationMs / 60_000)}m
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400">Min in-store time for “browse” (seconds)</label>
                  <p className="text-[10px] text-gray-600 mb-1">
                    Shorter trips are classified as bounce / quick visit instead of in-store browse.
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={10}
                      max={180}
                      step={5}
                      value={visitSession.minInStoreDurationSec}
                      onChange={(e) => setVisitSession(v => ({
                        ...v,
                        minInStoreDurationSec: parseInt(e.target.value, 10),
                      }))}
                      className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                    />
                    <span className="w-12 text-sm text-white text-center tabular-nums">
                      {visitSession.minInStoreDurationSec}s
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400">Fragment linking mode</label>
                  <select
                    value={visitSession.trackKeyMode}
                    onChange={(e) => setVisitSession(v => ({
                      ...v,
                      trackKeyMode: e.target.value,
                    }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    {TRACK_KEY_MODES.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-600">
                    {TRACK_KEY_MODES.find(m => m.value === visitSession.trackKeyMode)?.hint}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400">Expected checkout rate (%)</label>
                  <p className="text-[10px] text-gray-600 mb-1">
                    Optional. Your best guess of what % of real shoppers buy (e.g. 70). Dashboard shows measured vs this.
                    Leave empty to hide.
                  </p>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="e.g. 70"
                    value={calibrationPct}
                    onChange={(e) => setCalibrationPct(e.target.value)}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  />
                </div>
              </div>

              {/* Category dwell / shelf engagement */}
              <div className="space-y-3 p-3 bg-amber-900/20 border border-amber-700/40 rounded-lg">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-amber-400" />
                  <label className="text-sm font-medium text-white">Category dwell & engagement</label>
                </div>
                <p className="text-xs text-gray-500">
                  Geometry clocks for fresco and aisle category KPIs. Category dwell = time within a halo of the ROI;
                  engagement = time at the shelf face (inside ROI or very close).
                </p>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400">Category dwell radius (m)</label>
                  <p className="text-[10px] text-gray-600 mb-1">
                    How far from the painted category ROI still counts as browsing that category.
                  </p>
                  <select
                    value={String(categoryPresence.categoryDwellRadiusM)}
                    onChange={(e) => setCategoryPresence(c => ({
                      ...c,
                      categoryDwellRadiusM: parseFloat(e.target.value),
                    }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    {[1.5, 2.0, 2.5].map((v) => (
                      <option key={v} value={String(v)}>{v.toFixed(1)} m</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400">Engagement radius (m)</label>
                  <p className="text-[10px] text-gray-600 mb-1">
                    Shelf-face distance (also counts when inside the ROI). 0 = painted polygon only.
                  </p>
                  <select
                    value={String(categoryPresence.engagementRadiusM)}
                    onChange={(e) => setCategoryPresence(c => ({
                      ...c,
                      engagementRadiusM: parseFloat(e.target.value),
                    }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    {[0, 0.5, 1.0].map((v) => (
                      <option key={v} value={String(v)}>{v.toFixed(1)} m</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400">Dwell gap (seconds)</label>
                  <p className="text-[10px] text-gray-600 mb-1">
                    Must stay outside the dwell halo this long before an episode closes.
                  </p>
                  <select
                    value={String(categoryPresence.dwellGapS)}
                    onChange={(e) => setCategoryPresence(c => ({
                      ...c,
                      dwellGapS: parseInt(e.target.value, 10),
                    }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    {[2, 3, 5].map((v) => (
                      <option key={v} value={String(v)}>{v} s</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400">Dwell stitch (seconds)</label>
                  <p className="text-[10px] text-gray-600 mb-1">
                    Merge back-to-back dwell episodes if the gap is shorter.
                  </p>
                  <select
                    value={String(categoryPresence.dwellStitchS)}
                    onChange={(e) => setCategoryPresence(c => ({
                      ...c,
                      dwellStitchS: parseInt(e.target.value, 10),
                    }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    {[
                      { v: 0, label: 'Off' },
                      { v: 5, label: '5 s' },
                      { v: 8, label: '8 s (default)' },
                      { v: 12, label: '12 s' },
                    ].map(({ v, label }) => (
                      <option key={v} value={String(v)}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400">Identity for KPIs</label>
                  <select
                    value={categoryPresence.identityMode}
                    onChange={(e) => setCategoryPresence(c => ({
                      ...c,
                      identityMode: e.target.value as CategoryPresenceConfig['identityMode'],
                    }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  >
                    {IDENTITY_MODES.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-600">
                    {IDENTITY_MODES.find(m => m.value === categoryPresence.identityMode)?.hint}
                  </p>
                </div>
              </div>

              <div className="p-3 bg-blue-900/20 border border-blue-800/50 rounded-lg">
                <p className="text-xs text-blue-300">
                  <strong>Zone settings</strong> (per ROI) override dwell defaults. <strong>Store hours</strong> filter footfall KPIs on your traffic zone.
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
