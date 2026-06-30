import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, RefreshCw, X, ChevronDown, ChevronUp, Loader2, Check, Activity, Filter, Layers, Wand2, GripVertical } from 'lucide-react'
import { API_BASE } from '../../config/api'
import { useDraggablePanel } from '../../hooks/useDraggablePanel'
import { useTrackingActions } from '../../context/TrackingContext'

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
  reid_slow_speed_m_s: number
  reid_static_max_distance_m: number
  reid_static_max_implied_speed_m_s: number
  reid_aligned_cosine_min: number
  reid_aligned_distance_boost: number
  reid_isolation_radius_m: number
  reid_occlusion_bypass_promotion: boolean
  reid_stale_active_ms: number
  reid_churn_active_ms: number
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
  reid_slow_speed_m_s: 0.35,
  reid_static_max_distance_m: 3.5,
  reid_static_max_implied_speed_m_s: 1.2,
  reid_aligned_cosine_min: 0.45,
  reid_aligned_distance_boost: 1.25,
  reid_isolation_radius_m: 2.5,
  reid_occlusion_bypass_promotion: true,
  reid_stale_active_ms: 1000,
  reid_churn_active_ms: 80,
  smoothing_alpha: 0.6,
  active_to_lost_timeout_ms: 1000,
  trail_max_length: 32,
}

// Presets derived from the 884K-sample backtest (analysis/out/FINAL_REPORT.md).
// One-click application; the panel below stays available for fine tuning.
interface ReconcilerPreset {
  id: string
  label: string
  description: string
  metrics: {
    stable: number
    fragX: number
    lifetime_s: number
    displacement_m: number
    teleports_per_1k: number
  }
  config: ReconcilerConfig
}

const LUCA_LIVE_CONFIG: ReconcilerConfig = {
  enabled: true,
  ghost_max_speed_m_s: 3.5,
  ghost_min_promotion_lifetime_ms: 0,
  ghost_min_promotion_displacement_m: 0,
  ghost_static_timeout_s: 90,
  ghost_static_displacement_m: 1.6,
  reid_max_gap_s: 12,
  reid_max_distance_m: 12.7,
  reid_max_implied_speed_m_s: 2.6,
  reid_velocity_cosine_min: 0.2,
  reid_weight_distance: 4,
  reid_weight_velocity: 0.5,
  reid_weight_time: 3.1,
  reid_slow_speed_m_s: 0.35,
  reid_static_max_distance_m: 3.5,
  reid_static_max_implied_speed_m_s: 1.2,
  reid_aligned_cosine_min: 0.45,
  reid_aligned_distance_boost: 1.25,
  reid_isolation_radius_m: 2.5,
  reid_occlusion_bypass_promotion: true,
  reid_stale_active_ms: 200,
  reid_churn_active_ms: 80,
  smoothing_alpha: 0.12,
  active_to_lost_timeout_ms: 6000,
  trail_max_length: 100,
}

const PRESETS: ReconcilerPreset[] = [
  {
    id: 'treviglio_luca_live',
    label: 'Treviglio — Luca Live ★ (your tuning)',
    description: 'Owner-tuned live reconciler from Jun 30 afternoon — dense trails, occlusion re-ID, 12s/12.7m gates. Select this to restore your settings.',
    metrics: { stable: 0, fragX: 0, lifetime_s: 0, displacement_m: 0, teleports_per_1k: 0 },
    config: { ...LUCA_LIVE_CONFIG },
  },
  {
    id: 'default',
    label: 'Default',
    description: 'Production defaults — conservative ghost filter, modest re-ID gates.',
    metrics: { stable: 1796, fragX: 2.4, lifetime_s: 56.5, displacement_m: 10.2, teleports_per_1k: 1.11 },
    config: { ...DEFAULT_CONFIG },
  },
  {
    id: 'grocery_balanced',
    label: 'Grocery — Balanced',
    description: 'Aggressive merge — inflates dwell on paper but creates shelf-crossing artifacts on Treviglio (Jun 29 capture). Do NOT use live.',
    metrics: { stable: 4580, fragX: 5.0, lifetime_s: 47, displacement_m: 28.4, teleports_per_1k: 9.54 },
    config: {
      enabled: true,
      ghost_max_speed_m_s: 3.5,
      ghost_min_promotion_lifetime_ms: 200,
      ghost_min_promotion_displacement_m: 0.05,
      ghost_static_timeout_s: 90,
      ghost_static_displacement_m: 0.3,
      reid_max_gap_s: 15,
      reid_max_distance_m: 8.0,
      reid_max_implied_speed_m_s: 2.5,
      reid_velocity_cosine_min: -0.3,
      reid_weight_distance: 1.0,
      reid_weight_velocity: 0.5,
      reid_weight_time: 0.1,
      smoothing_alpha: 0.7,
      active_to_lost_timeout_ms: 1500,
      trail_max_length: 32,
    },
  },
  {
    id: 'grocery_aggressive',
    label: 'Grocery — Aggressive',
    description: 'Pushes merging close to the estimated true shopper count. Best continuity; small risk of cross-person merges in dense areas (queues).',
    metrics: { stable: 1066, fragX: 4.1, lifetime_s: 115.6, displacement_m: 25.0, teleports_per_1k: 2.37 },
    config: {
      enabled: true,
      ghost_max_speed_m_s: 3.5,
      ghost_min_promotion_lifetime_ms: 150,
      ghost_min_promotion_displacement_m: 0.05,
      ghost_static_timeout_s: 120,
      ghost_static_displacement_m: 0.3,
      reid_max_gap_s: 20,
      reid_max_distance_m: 10.0,
      reid_max_implied_speed_m_s: 2.5,
      reid_velocity_cosine_min: -0.5,
      reid_weight_distance: 0.8,
      reid_weight_velocity: 0.6,
      reid_weight_time: 0.1,
      smoothing_alpha: 0.7,
      active_to_lost_timeout_ms: 2000,
      trail_max_length: 48,
    },
  },
  {
    id: 'grocery_conservative',
    label: 'Grocery — Conservative',
    description: 'Tighter gates than the default. Use when false-merges are unacceptable and a shorter mean trajectory is OK.',
    metrics: { stable: 1900, fragX: 2.3, lifetime_s: 57.5, displacement_m: 11.3, teleports_per_1k: 1.23 },
    config: {
      enabled: true,
      ghost_max_speed_m_s: 3.5,
      ghost_min_promotion_lifetime_ms: 300,
      ghost_min_promotion_displacement_m: 0.1,
      ghost_static_timeout_s: 90,
      ghost_static_displacement_m: 0.3,
      reid_max_gap_s: 10,
      reid_max_distance_m: 5.0,
      reid_max_implied_speed_m_s: 2.0,
      reid_velocity_cosine_min: 0.0,
      reid_weight_distance: 1.0,
      reid_weight_velocity: 0.5,
      reid_weight_time: 0.1,
      smoothing_alpha: 0.7,
      active_to_lost_timeout_ms: 1200,
      trail_max_length: 32,
    },
  },
  {
    id: 'raj_v1_live',
    label: 'Raj v1.0.1 — Live Visual (recommended)',
    description: 'Raw perception speed + ghost filter + re-ID (8s / 4m). Saved on Treviglio — best live v1 balance from Jun 29 sweep (66 frag/shopper, lt_p95 64s).',
    metrics: { stable: 12070, fragX: 1.9, lifetime_s: 18.5, displacement_m: 7.1, teleports_per_1k: 4.56 },
    config: {
      enabled: true,
      ghost_max_speed_m_s: 3.5,
      ghost_min_promotion_lifetime_ms: 200,
      ghost_min_promotion_displacement_m: 0.05,
      ghost_static_timeout_s: 90,
      ghost_static_displacement_m: 0.3,
      reid_max_gap_s: 8,
      reid_max_distance_m: 4.0,
      reid_max_implied_speed_m_s: 2.0,
      reid_velocity_cosine_min: 0.0,
      reid_weight_distance: 1.0,
      reid_weight_velocity: 0.5,
      reid_weight_time: 0.1,
      smoothing_alpha: 0.12,
      active_to_lost_timeout_ms: 6000,
      trail_max_length: 100,
    },
  },
  {
    id: 'raj_v1_conservative',
    label: 'Raj v1.0.1 — Conservative',
    description: 'Tighter re-ID for Raj perception. Prefer Live Visual for the canvas.',
    metrics: { stable: 8529, fragX: 1.7, lifetime_s: 25.6, displacement_m: 7.9, teleports_per_1k: 4.51 },
    config: {
      enabled: true,
      ghost_max_speed_m_s: 3.5,
      ghost_min_promotion_lifetime_ms: 200,
      ghost_min_promotion_displacement_m: 0.05,
      ghost_static_timeout_s: 90,
      ghost_static_displacement_m: 0.3,
      reid_max_gap_s: 8,
      reid_max_distance_m: 4.0,
      reid_max_implied_speed_m_s: 2.0,
      reid_velocity_cosine_min: 0.0,
      reid_weight_distance: 1.0,
      reid_weight_velocity: 0.5,
      reid_weight_time: 0.1,
      smoothing_alpha: 0.7,
      active_to_lost_timeout_ms: 1500,
      trail_max_length: 32,
    },
  },
  {
    id: 'treviglio_dwell_v1',
    label: 'Treviglio — Dwell v1 (29/06 sweep)',
    description: 'Tight-grid winner for live dwell without Balanced artifacts: 5s gap, 4m Euclidean (77 frag/shopper, lt_p95 53s, tp/1k 4.1 on afternoon capture).',
    metrics: { stable: 14115, fragX: 1.6, lifetime_s: 15.0, displacement_m: 5.6, teleports_per_1k: 4.14 },
    config: {
      enabled: true,
      ghost_max_speed_m_s: 3.5,
      ghost_min_promotion_lifetime_ms: 200,
      ghost_min_promotion_displacement_m: 0.05,
      ghost_static_timeout_s: 90,
      ghost_static_displacement_m: 0.3,
      reid_max_gap_s: 5,
      reid_max_distance_m: 4.0,
      reid_max_implied_speed_m_s: 2.0,
      reid_velocity_cosine_min: 0.0,
      reid_weight_distance: 1.0,
      reid_weight_velocity: 0.5,
      reid_weight_time: 0.1,
      smoothing_alpha: 0.12,
      active_to_lost_timeout_ms: 6000,
      trail_max_length: 100,
    },
  },
  {
    id: 'treviglio_occlusion',
    label: 'Treviglio — Occlusion re-ID',
    description: 'Your tuned gates + slow/static path: raw distance when slowing/stopping, isolation gate for safe 2–3 m merges after shelf dropout.',
    metrics: { stable: 0, fragX: 0, lifetime_s: 0, displacement_m: 0, teleports_per_1k: 0 },
    config: {
      enabled: true,
      ghost_max_speed_m_s: 3.5,
      ghost_min_promotion_lifetime_ms: 0,
      ghost_min_promotion_displacement_m: 0,
      ghost_static_timeout_s: 90,
      ghost_static_displacement_m: 1.6,
      reid_max_gap_s: 12,
      reid_max_distance_m: 12.7,
      reid_max_implied_speed_m_s: 2.6,
      reid_velocity_cosine_min: 0.2,
      reid_weight_distance: 4.0,
      reid_weight_velocity: 0.5,
      reid_weight_time: 3.1,
      reid_slow_speed_m_s: 0.35,
      reid_static_max_distance_m: 3.5,
      reid_static_max_implied_speed_m_s: 1.2,
      reid_aligned_cosine_min: 0.45,
      reid_aligned_distance_boost: 1.25,
      reid_isolation_radius_m: 2.5,
      reid_occlusion_bypass_promotion: true,
      smoothing_alpha: 0.12,
      active_to_lost_timeout_ms: 6000,
      trail_max_length: 100,
    },
  },
  {
    id: 'raj_v1_balanced',
    label: 'Raj v1.0.1 — Balanced',
    description: 'More re-ID merge than Raj Conservative — longer trajectories (~34 s mean). Use when tp/1k headroom allows.',
    metrics: { stable: 6714, fragX: 2.2, lifetime_s: 34.3, displacement_m: 11.1, teleports_per_1k: 5.95 },
    config: {
      enabled: true,
      ghost_max_speed_m_s: 3.5,
      ghost_min_promotion_lifetime_ms: 200,
      ghost_min_promotion_displacement_m: 0.05,
      ghost_static_timeout_s: 90,
      ghost_static_displacement_m: 0.3,
      reid_max_gap_s: 10,
      reid_max_distance_m: 5.0,
      reid_max_implied_speed_m_s: 2.2,
      reid_velocity_cosine_min: -0.2,
      reid_weight_distance: 1.0,
      reid_weight_velocity: 0.5,
      reid_weight_time: 0.1,
      smoothing_alpha: 0.7,
      active_to_lost_timeout_ms: 1500,
      trail_max_length: 32,
    },
  },
]

/** Match a saved config against a preset; returns 'custom' when nothing fits. */
function detectActivePresetId(cfg: ReconcilerConfig): string {
  if (!cfg.enabled) return 'bypass'
  const close = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol
  for (const p of PRESETS) {
    const c = p.config
    if (close(cfg.ghost_min_promotion_lifetime_ms, c.ghost_min_promotion_lifetime_ms, 1)
        && close(cfg.ghost_static_timeout_s, c.ghost_static_timeout_s)
        && close(cfg.ghost_static_displacement_m, c.ghost_static_displacement_m)
        && close(cfg.reid_max_gap_s, c.reid_max_gap_s)
        && close(cfg.reid_max_distance_m, c.reid_max_distance_m)
        && close(cfg.reid_max_implied_speed_m_s, c.reid_max_implied_speed_m_s)
        && close(cfg.reid_velocity_cosine_min, c.reid_velocity_cosine_min)
        && close(cfg.reid_weight_distance, c.reid_weight_distance)
        && close(cfg.reid_weight_time, c.reid_weight_time)
        && close(cfg.reid_static_max_distance_m, c.reid_static_max_distance_m)
        && close(cfg.smoothing_alpha, c.smoothing_alpha)
        && close(cfg.active_to_lost_timeout_ms, c.active_to_lost_timeout_ms, 50)
        && close(cfg.trail_max_length, c.trail_max_length, 1)) {
      return p.id
    }
  }
  return 'custom'
}

/**
 * Trajectory quality — offline post-process presets live in Replay panel.
 * Live canvas preset application is experimental only (hidden by default).
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
  const [experimentalLive, setExperimentalLive] = useState(() => {
    try { return localStorage.getItem('hyperspace-experimental-live-reconciler') === '1' } catch { return false }
  })
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { setVisualizationMode } = useTrackingActions()

  const { panelRef, panelStyle, dragging, headerProps } = useDraggablePanel({
    storageKey: 'hyperspace.panel.trajectory-quality.position',
    defaultX: 64,
    defaultY: 420,
  })

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
    if (experimentalLive) {
      setVisualizationMode(next.enabled ? 'vtl' : 'raw', { forceClear: true })
    }
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
  }, [venueId, setVisualizationMode, experimentalLive])

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

  const applyPreset = useCallback((preset: ReconcilerPreset) => {
    const next = { ...DEFAULT_CONFIG, ...preset.config }
    setConfig(next)
    scheduleSave(next)
  }, [scheduleSave])

  const activePresetId = detectActivePresetId(config)

  return (
    <div
      ref={panelRef}
      className="absolute z-30 w-[26rem] bg-gray-900/95 backdrop-blur border border-emerald-700/60 rounded-xl shadow-2xl text-gray-200 text-xs"
      style={panelStyle}
    >
      {/* Header */}
      <div
        {...headerProps}
        className={`flex items-center gap-2 px-3 py-2 border-b border-gray-700/80 select-none touch-none ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        title="Drag to move"
      >
        <GripVertical className="w-3.5 h-3.5 text-gray-500 shrink-0" />
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
          <div className="px-3 py-2 border-b border-gray-800 bg-emerald-950/40 text-[11px] text-emerald-100/90">
            <strong className="text-emerald-300">Live reconciler (v1):</strong> presets below tune MQTT ingest + zone_visit <code className="text-emerald-200">track_key</code> stability.
            Map-aware v2/v3 is <strong>offline only</strong> (Replay → Post-process). For dwell KPIs without shelf-crossing artifacts, use{' '}
            <strong className="text-emerald-300">Raj Live Visual</strong> or <strong className="text-emerald-300">Treviglio Dwell v1</strong> — not Grocery Balanced.
          </div>

          <div className="px-3 py-2 border-b border-gray-800">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={experimentalLive}
                onChange={e => {
                  const on = e.target.checked
                  setExperimentalLive(on)
                  try { localStorage.setItem('hyperspace-experimental-live-reconciler', on ? '1' : '0') } catch { /* ignore */ }
                  if (!on) setVisualizationMode('raw', { forceClear: false })
                  else setVisualizationMode(config.enabled ? 'vtl' : 'raw', { forceClear: true })
                }}
                className="mt-0.5"
              />
              <span>
                <span className="text-amber-300 font-medium">Experimental:</span>{' '}
                apply preset to live canvas (may blank tracks — not recommended)
              </span>
            </label>
          </div>

          {!experimentalLive && (
            <div className="px-3 py-2 border-b border-gray-800 text-[10px] text-gray-500">
              Sliders save to venue config and apply to live MQTT ingest (zone_visit track_key + ghost/re-ID).
              Canvas trails stay raw unless you enable experimental live canvas above.
            </div>
          )}

          {/* Preset picker — one-click backtest-derived configurations.
              Selecting a preset writes its full ReconcilerConfig to the panel
              state and persists via the existing debounced save. The user can
              then fine-tune individual sliders below. */}
          <div className="px-3 py-2 border-b border-gray-800 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Wand2 className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] uppercase text-gray-500 tracking-wide">Preset</span>
              <div className="flex-1" />
              {activePresetId === 'custom' && (
                <span className="text-[10px] text-amber-400">custom (modified)</span>
              )}
              {activePresetId === 'bypass' && (
                <span className="text-[10px] text-gray-400">bypass — no reconciliation</span>
              )}
            </div>
            <select
              value={activePresetId === 'custom' || activePresetId === 'bypass' ? '' : activePresetId}
              onChange={e => {
                const p = PRESETS.find(p => p.id === e.target.value)
                if (p) applyPreset(p)
              }}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs"
            >
              <option value="" disabled>{activePresetId === 'custom' ? '— custom —' : 'Choose a preset…'}</option>
              {PRESETS.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            {(() => {
              const active = PRESETS.find(p => p.id === activePresetId)
              if (!active) return null
              const m = active.metrics
              return (
                <div className="grid grid-cols-5 gap-1 pt-1">
                  <Stat label="Stable" value={m.stable.toString()} />
                  <Stat label="Frag×" value={m.fragX.toFixed(1)} />
                  <Stat label="Lifetime" value={`${m.lifetime_s.toFixed(0)}s`} />
                  <Stat label="Disp" value={`${m.displacement_m.toFixed(1)}m`} />
                  <Stat label="TP/1k" value={m.teleports_per_1k.toFixed(2)} />
                </div>
              )
            })()}
          </div>

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
                  hint="Moving re-ID: min(raw, predicted) distance gate; boosted when heading aligned"
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
                  <div className="text-[10px] uppercase text-amber-600/90">Active-track re-ID (zig-zag)</div>
                  <p className="text-[10px] text-gray-500 leading-snug">
                    How long an active track must be silent before it can be matched by a new perception ID.
                    Low churn (80ms) causes wrong merges in crowds — raise to reduce zig-zag.
                  </p>
                  <SliderRow
                    label="Churn quiet window (ms)"
                    value={config.reid_churn_active_ms}
                    min={0} max={2000} step={20}
                    onChange={v => update('reid_churn_active_ms', v)}
                    hint="Min silence before an active track is a re-ID target (default 80). Try 400–600."
                  />
                  <SliderRow
                    label="Stale active window (ms)"
                    value={config.reid_stale_active_ms}
                    min={0} max={3000} step={50}
                    onChange={v => update('reid_stale_active_ms', v)}
                    hint="Also match quiet active tracks (default 200). Keep ≥ churn window."
                  />
                </div>
                <div className="pt-2 border-t border-gray-800 space-y-3">
                  <div className="text-[10px] uppercase text-gray-500">Cost weights</div>
                  <SliderRow label="w · distance" value={config.reid_weight_distance} min={0} max={5} step={0.1} onChange={v => update('reid_weight_distance', v)} />
                  <SliderRow label="w · velocity"  value={config.reid_weight_velocity}  min={0} max={5} step={0.1} onChange={v => update('reid_weight_velocity', v)} />
                  <SliderRow label="w · time gap"  value={config.reid_weight_time}      min={0} max={5} step={0.1} onChange={v => update('reid_weight_time', v)} />
                </div>
                <div className="pt-2 border-t border-gray-800 space-y-3">
                  <div className="text-[10px] uppercase text-emerald-600/80">Slow / occlusion re-ID</div>
                  <p className="text-[10px] text-gray-500 leading-snug">
                    When someone slows, stops, or vanishes behind a shelf, velocity prediction overshoots.
                    These rules merge on raw distance instead — only when alone nearby.
                  </p>
                  <SliderRow
                    label="Slow speed threshold (m/s)"
                    value={config.reid_slow_speed_m_s}
                    min={0.05} max={1.5} step={0.05}
                    onChange={v => update('reid_slow_speed_m_s', v)}
                    hint="Lost or new track below this speed → occlusion rules"
                  />
                  <SliderRow
                    label="Static max distance (m)"
                    value={config.reid_static_max_distance_m}
                    min={0.5} max={8} step={0.1}
                    onChange={v => update('reid_static_max_distance_m', v)}
                    hint="Raw distance from last position (not velocity-predicted)"
                  />
                  <SliderRow
                    label="Static max implied speed (m/s)"
                    value={config.reid_static_max_implied_speed_m_s}
                    min={0.3} max={3} step={0.1}
                    onChange={v => update('reid_static_max_implied_speed_m_s', v)}
                    hint="Teleport guard in occlusion mode"
                  />
                  <SliderRow
                    label="Isolation radius (m)"
                    value={config.reid_isolation_radius_m}
                    min={0} max={6} step={0.1}
                    onChange={v => update('reid_isolation_radius_m', v)}
                    hint="0 = off. Occlusion merge only if no other track within this radius"
                  />
                  <SliderRow
                    label="Aligned cosine min"
                    value={config.reid_aligned_cosine_min}
                    min={-1} max={1} step={0.05}
                    onChange={v => update('reid_aligned_cosine_min', v)}
                    hint="Same-direction walking boost when cos ≥ this (moving mode only)"
                  />
                  <SliderRow
                    label="Aligned distance boost"
                    value={config.reid_aligned_distance_boost}
                    min={1} max={2} step={0.05}
                    onChange={v => update('reid_aligned_distance_boost', v)}
                    hint="Multiply max reconnect distance when heading matches"
                  />
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.reid_occlusion_bypass_promotion}
                      onChange={e => update('reid_occlusion_bypass_promotion', e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="text-[11px] text-gray-400">
                      Bypass promotion for occlusion re-ID (merge before probation ends)
                    </span>
                  </label>
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
