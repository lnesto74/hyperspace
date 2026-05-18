import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, RefreshCw, X, ChevronDown, ChevronUp, Loader2, Check, Activity, Filter, Layers } from 'lucide-react'
import { API_BASE } from '../../config/api'

interface TrajectoryQualityPanelProps {
  venueId: string
  onClose: () => void
}

interface ReconcilerConfig {
  enabled: boolean
  ghost_max_speed_m_s: number
  ghost_min_promotion_lifetime_ms: number
  ghost_min_promotion_displacement_m: number
  ghost_static_timeout_s: number
  ghost_static_displacement_m: number
  reid_max_gap_s: number
  reid_max_distance_m: number
  reid_max_implied_speed_m_s: number
  reid_velocity_cosine_min: number
  reid_weight_distance: number
  reid_weight_velocity: number
  reid_weight_time: number
  smoothing_alpha: number
  active_to_lost_timeout_ms: number
  trail_max_length: number
}

interface ReconcilerStats {
  activeCount: number
  lostCount: number
  candidateCount: number
  raw_total: number
  ghost_dropped: number
  ghost_drop_reasons: Record<string, number>
  reid_count: number
  new_stable_ids: number
  ghost_rejection_rate: number
  reid_success_rate: number
  mean_active_lifetime_s: number
}

const DEFAULT_CONFIG: ReconcilerConfig = {
  enabled: true,
  ghost_max_speed_m_s: 3.5,
  ghost_min_promotion_lifetime_ms: 500,
  ghost_min_promotion_displacement_m: 0.4,
  ghost_static_timeout_s: 30,
  ghost_static_displacement_m: 0.2,
  reid_max_gap_s: 10,
  reid_max_distance_m: 3.0,
  reid_max_implied_speed_m_s: 2.5,
  reid_velocity_cosine_min: -0.2,
  reid_weight_distance: 1.0,
  reid_weight_velocity: 0.5,
  reid_weight_time: 0.1,
  smoothing_alpha: 0.6,
  active_to_lost_timeout_ms: 1000,
  trail_max_length: 32,
}

/**
 * Floating panel for tuning the TrajectoryReconciler in real time. Live stats
 * + sliders for every knob. Debounced PATCH so dragging is responsive.
 */
export default function TrajectoryQualityPanel({ venueId, onClose }: TrajectoryQualityPanelProps) {
  const [config, setConfig] = useState<ReconcilerConfig>(DEFAULT_CONFIG)
  const [stats, setStats] = useState<ReconcilerStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [activeSection, setActiveSection] = useState<'stats' | 'ghost' | 'reid' | 'smoothing'>('stats')
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load config
  useEffect(() => {
    if (!venueId) return
    let cancelled = false
    setLoading(true)
    fetch(`${API_BASE}/api/venues/${venueId}/reconciler-config`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => { if (!cancelled) setConfig({ ...DEFAULT_CONFIG, ...(data?.reconciler || {}) }) })
      .catch(err => { if (!cancelled) setError(String(err.message || err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [venueId])

  // Poll stats every 1s
  useEffect(() => {
    if (!venueId) return
    let stop = false
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/venues/${venueId}/reconciler-stats`)
        if (!res.ok) return
        const data = await res.json()
        if (!stop) setStats(data?.stats || null)
      } catch { /* swallow */ }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { stop = true; clearInterval(id) }
  }, [venueId])

  const scheduleSave = useCallback((next: ReconcilerConfig) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(`${API_BASE}/api/venues/${venueId}/reconciler-config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reconciler: next }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setSavedAt(Date.now())
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
    }, 250)
  }, [venueId])

  useEffect(() => () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current) }, [])

  const update = useCallback(<K extends keyof ReconcilerConfig>(key: K, value: ReconcilerConfig[K]) => {
    setConfig(prev => {
      const next = { ...prev, [key]: value }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const reset = useCallback(() => {
    if (!window.confirm('Reset reconciler config to defaults?')) return
    setConfig(DEFAULT_CONFIG)
    scheduleSave(DEFAULT_CONFIG)
  }, [scheduleSave])

  return (
    <div className="absolute top-4 left-16 z-30 w-[26rem] bg-gray-900/95 backdrop-blur border border-emerald-700/60 rounded-xl shadow-2xl text-gray-200 text-xs">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/80">
        <Sparkles className="w-4 h-4 text-emerald-400" />
        <span className="font-semibold text-white">Trajectory Quality</span>
        <label className="ml-2 flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={e => update('enabled', e.target.checked)}
          />
          <span className="text-[11px] text-gray-400">{config.enabled ? 'On' : 'Bypass'}</span>
        </label>
        <div className="flex-1" />
        <button onClick={() => setCollapsed(c => !c)} className="p-1 rounded hover:bg-gray-700/60" title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-700/60" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Section tabs */}
          <div className="flex border-b border-gray-800">
            {[
              { id: 'stats', label: 'Stats', icon: Activity },
              { id: 'ghost', label: 'Ghost filter', icon: Filter },
              { id: 'reid', label: 'Re-ID', icon: RefreshCw },
              { id: 'smoothing', label: 'Smoothing', icon: Layers },
            ].map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id as typeof activeSection)}
                className={`flex-1 px-2 py-1.5 text-[11px] flex items-center justify-center gap-1 transition-colors ${
                  activeSection === s.id ? 'bg-gray-800 text-white border-b border-emerald-400' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <s.icon className="w-3 h-3" />
                {s.label}
              </button>
            ))}
          </div>

          <div className="p-3 space-y-3 max-h-[60vh] overflow-y-auto">
            {activeSection === 'stats' && (
              <StatsSection stats={stats} loading={loading} />
            )}

            {activeSection === 'ghost' && (
              <>
                <SliderRow
                  label="Max plausible speed (m/s)"
                  value={config.ghost_max_speed_m_s}
                  min={0.5} max={8} step={0.1}
                  onChange={v => update('ghost_max_speed_m_s', v)}
                  hint="Drop tracks faster than walking + jogging"
                />
                <SliderRow
                  label="Min lifetime to promote (ms)"
                  value={config.ghost_min_promotion_lifetime_ms}
                  min={0} max={3000} step={50}
                  onChange={v => update('ghost_min_promotion_lifetime_ms', v)}
                  hint="Hold new perception IDs this long before assigning a stable ID"
                />
                <SliderRow
                  label="Min displacement to promote (m)"
                  value={config.ghost_min_promotion_displacement_m}
                  min={0} max={3} step={0.05}
                  onChange={v => update('ghost_min_promotion_displacement_m', v)}
                  hint="Tracks that don't move this much get filtered as jitter"
                />
                <SliderRow
                  label="Static fixture timeout (s)"
                  value={config.ghost_static_timeout_s}
                  min={0} max={120} step={1}
                  onChange={v => update('ghost_static_timeout_s', v)}
                  hint="Drop stable tracks stationary for this long"
                />
                <SliderRow
                  label="Static displacement gate (m)"
                  value={config.ghost_static_displacement_m}
                  min={0} max={2} step={0.05}
                  onChange={v => update('ghost_static_displacement_m', v)}
                />
              </>
            )}

            {activeSection === 'reid' && (
              <>
                <SliderRow
                  label="Max gap to reconnect (s)"
                  value={config.reid_max_gap_s}
                  min={0} max={60} step={1}
                  onChange={v => update('reid_max_gap_s', v)}
                  hint="Lost tracks expire after this. Higher = more reconnects but more confusion"
                />
                <SliderRow
                  label="Max reconnect distance (m)"
                  value={config.reid_max_distance_m}
                  min={0.5} max={20} step={0.1}
                  onChange={v => update('reid_max_distance_m', v)}
                  hint="A new ID must appear within this radius of the predicted lost position"
                />
                <SliderRow
                  label="Max implied speed (m/s)"
                  value={config.reid_max_implied_speed_m_s}
                  min={0.5} max={6} step={0.1}
                  onChange={v => update('reid_max_implied_speed_m_s', v)}
                  hint="Prevents teleports — distance/dt must be a plausible walking speed"
                />
                <SliderRow
                  label="Velocity cosine gate"
                  value={config.reid_velocity_cosine_min}
                  min={-1} max={1} step={0.05}
                  onChange={v => update('reid_velocity_cosine_min', v)}
                  hint="−1 = allow anything; 0 = same general direction; 1 = exact same direction"
                />
                <div className="pt-2 border-t border-gray-800 space-y-3">
                  <div className="text-[10px] uppercase text-gray-500">Cost weights</div>
                  <SliderRow label="w · distance" value={config.reid_weight_distance} min={0} max={5} step={0.1} onChange={v => update('reid_weight_distance', v)} />
                  <SliderRow label="w · velocity"  value={config.reid_weight_velocity}  min={0} max={5} step={0.1} onChange={v => update('reid_weight_velocity', v)} />
                  <SliderRow label="w · time gap"  value={config.reid_weight_time}      min={0} max={5} step={0.1} onChange={v => update('reid_weight_time', v)} />
                </div>
              </>
            )}

            {activeSection === 'smoothing' && (
              <>
                <SliderRow
                  label="Smoothing α (0=hold, 1=raw)"
                  value={config.smoothing_alpha}
                  min={0} max={1} step={0.05}
                  onChange={v => update('smoothing_alpha', v)}
                  hint="Lower = smoother but laggy; higher = responsive but jittery"
                />
                <SliderRow
                  label="Active → Lost timeout (ms)"
                  value={config.active_to_lost_timeout_ms}
                  min={200} max={5000} step={50}
                  onChange={v => update('active_to_lost_timeout_ms', v)}
                />
                <SliderRow
                  label="Trail length (samples)"
                  value={config.trail_max_length}
                  min={0} max={128} step={1}
                  onChange={v => update('trail_max_length', v)}
                />
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-800 bg-gray-900/60">
            {saving && <span className="text-blue-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>}
            {!saving && savedAt && Date.now() - savedAt < 2000 && (
              <span className="text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> Applied live</span>
            )}
            {error && <span className="text-red-400 truncate">{error}</span>}
            <div className="flex-1" />
            <button onClick={reset} className="text-gray-500 hover:text-red-300">Reset defaults</button>
          </div>
        </>
      )}
    </div>
  )
}

interface StatsSectionProps {
  stats: ReconcilerStats | null
  loading: boolean
}

function StatsSection({ stats, loading }: StatsSectionProps) {
  if (loading && !stats) return <div className="text-gray-500 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
  if (!stats) return <div className="text-gray-500">No data yet — waiting for tracks.</div>
  const fmt = (n: number, d = 1) => Number.isFinite(n) ? n.toFixed(d) : '—'
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Active" value={stats.activeCount.toString()} accent="text-emerald-400" />
        <Stat label="Lost pool" value={stats.lostCount.toString()} accent="text-amber-400" />
        <Stat label="Candidates" value={stats.candidateCount.toString()} accent="text-gray-300" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Avg lifetime" value={`${fmt(stats.mean_active_lifetime_s)}s`} />
        <Stat label="Re-IDs" value={stats.reid_count.toString()} accent="text-cyan-400" />
        <Stat label="New stable IDs" value={stats.new_stable_ids.toString()} />
        <Stat label="Re-ID success" value={`${fmt(stats.reid_success_rate * 100)}%`} accent="text-cyan-400" />
        <Stat label="Ghosts filtered" value={stats.ghost_dropped.toString()} accent="text-red-400" />
        <Stat label="Ghost rate" value={`${fmt(stats.ghost_rejection_rate * 100)}%`} accent="text-red-400" />
      </div>
      {Object.keys(stats.ghost_drop_reasons || {}).length > 0 && (
        <div className="pt-2 border-t border-gray-800">
          <div className="text-[10px] uppercase text-gray-500 mb-1">Ghost reasons</div>
          <div className="space-y-0.5 font-mono text-[11px]">
            {Object.entries(stats.ghost_drop_reasons).map(([reason, count]) => (
              <div key={reason} className="flex justify-between text-gray-400">
                <span>{reason}</span>
                <span className="text-red-300">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="text-[10px] text-gray-600 pt-1">Stats refresh every 1s. Tracks emitted to the 3D venue use the stable IDs.</div>
    </div>
  )
}

function Stat({ label, value, accent = 'text-white' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-gray-800/60 border border-gray-800 rounded px-2 py-1.5">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-base font-semibold ${accent}`}>{value}</div>
    </div>
  )
}

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  hint?: string
}

function SliderRow({ label, value, min, max, step, onChange, hint }: SliderRowProps) {
  return (
    <div>
      <div className="text-gray-400 mb-1 flex items-center justify-between">
        <span>{label}</span>
        <input
          type="number"
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-24 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-white font-mono text-right"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
      {hint && <div className="text-[10px] text-gray-600 mt-0.5">{hint}</div>}
    </div>
  )
}
