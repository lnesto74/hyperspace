import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Sliders, Loader2, RotateCcw, Check, AlertCircle, ChevronDown, ChevronRight, Plus, Trash2,
} from 'lucide-react'
import { API_BASE } from '../../config/api'

// ─── Types ─────────────────────────────────────────────────────────

export interface PrefilterPattern {
  pattern: string
  flags?: string
}

export interface PrefilterDefaults {
  import_id: string
  unit_scale_to_m: number
  has_original_fixtures: boolean
  original_fixture_count: number
  defaults: {
    maxFixtureSizeM: number
    maxPolylineSingletonSizeM: number
    relativeSizePercentile: number
    relativeSizeMultiplier: number
    relativeSizeMaxDropFraction: number
    madSpreads: number[]
    madMaxDropFraction: number
    clusterWindowM: number
    clusterMarginM: number
    clusterMinKeepFraction: number
    minFixtureSizeM: number
    layerBlocklist: PrefilterPattern[]
  }
  suggestedBlocklist?: Array<PrefilterPattern & { label: string }>
  layer_totals: Record<string, number>
}

export interface PrefilterDryRunResult {
  fixture_count: number
  group_count: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  prefilter: {
    input: number
    droppedByLayer: number
    droppedByDegenerate: number
    droppedBySize: number
    droppedByRelativeSize: number
    droppedByPolylineSingleton: number
    droppedByCoordinateOutlier: number
    droppedByCluster: number
    kept: number
    boundsM: { width: number; depth: number }
    layerHits?: Record<string, Record<string, number>>
    layerTotals?: Record<string, number>
    relativeSize?: {
      percentile: number
      p_m: number
      multiplier: number
      threshold_m: number
      candidates: number
      dropFraction: number
      skipped: boolean
    } | null
    madPasses?: Array<{ pass: number; spread: number; dropped?: number; kept?: number; skipped?: boolean }>
    cluster?: {
      windowM: number
      marginM: number
      window_x_m: { lo: number; hi: number }
      window_y_m: { lo: number; hi: number }
      keepFraction: number
      skipped?: boolean
    }
  }
  kept_fixture_ids: string[] | null
}

// Settings used for each dry-run / apply call. Mirrors the backend API.
export interface PrefilterSettings {
  enableLayerBlock: boolean
  enableDegenerate: boolean
  enableSizeCap: boolean
  enableRelativeSizeOutlier: boolean
  enablePolylineSingleton: boolean
  enableMadOutlier: boolean
  enableClusterPicker: boolean
  maxFixtureSizeM: number
  maxPolylineSingletonSizeM: number
  minFixtureSizeM: number
  relativeSizePercentile: number
  relativeSizeMultiplier: number
  relativeSizeMaxDropFraction: number
  madSpreads: number[]
  madMaxDropFraction: number
  clusterWindowM: number
  clusterMarginM: number
  clusterMinKeepFraction: number
  layerBlocklist: PrefilterPattern[]
}

interface PrefilterStudioProps {
  importId: string
  /** Current bounds for display (before applying). */
  currentFixtureCount: number
  /**
   * Called with dry-run result whenever the settings change. The canvas uses
   * the returned `kept_fixture_ids` to render a visual diff.
   */
  onPreview?: (result: PrefilterDryRunResult | null, settings: PrefilterSettings) => void
  /** Called after a successful Apply, so the parent can reload the import. */
  onApplied: () => void
  onClose: () => void
}

// ─── Constants ─────────────────────────────────────────────────────

const STEP_LABELS = {
  enableLayerBlock: 'Layer name blocklist',
  enableDegenerate: 'Zero-size / degenerate fixtures',
  enableSizeCap: 'Oversized fixtures (absolute cap)',
  enableRelativeSizeOutlier: 'Massive outliers (relative size)',
  enablePolylineSingleton: 'Polyline singletons',
  enableMadOutlier: 'Coordinate outliers (MAD)',
  enableClusterPicker: 'Primary cluster (densest window)',
} as const

// ─── Component ─────────────────────────────────────────────────────

export default function PrefilterStudio({
  importId,
  currentFixtureCount,
  onPreview,
  onApplied,
  onClose,
}: PrefilterStudioProps) {
  const [defaults, setDefaults] = useState<PrefilterDefaults | null>(null)
  const [settings, setSettings] = useState<PrefilterSettings | null>(null)
  const [dryRun, setDryRun] = useState<PrefilterDryRunResult | null>(null)
  const [dryRunLoading, setDryRunLoading] = useState(false)
  const [applyLoading, setApplyLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [layersExpanded, setLayersExpanded] = useState(false)
  const [newPattern, setNewPattern] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Fetch defaults + layer totals ──
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setError(null)
        const res = await fetch(`${API_BASE}/api/dwg/import/${importId}/prefilter-defaults`)
        if (!res.ok) throw new Error(`Failed to load prefilter defaults: ${res.status}`)
        const data: PrefilterDefaults = await res.json()
        if (cancelled) return
        setDefaults(data)
        setSettings({
          enableLayerBlock: true,
          enableDegenerate: true,
          enableSizeCap: true,
          enableRelativeSizeOutlier: true,
          enablePolylineSingleton: true,
          enableMadOutlier: true,
          enableClusterPicker: true,
          maxFixtureSizeM: data.defaults.maxFixtureSizeM,
          maxPolylineSingletonSizeM: data.defaults.maxPolylineSingletonSizeM,
          minFixtureSizeM: data.defaults.minFixtureSizeM,
          relativeSizePercentile: data.defaults.relativeSizePercentile,
          relativeSizeMultiplier: data.defaults.relativeSizeMultiplier,
          relativeSizeMaxDropFraction: data.defaults.relativeSizeMaxDropFraction,
          madSpreads: data.defaults.madSpreads.slice(),
          madMaxDropFraction: data.defaults.madMaxDropFraction,
          clusterWindowM: data.defaults.clusterWindowM,
          clusterMarginM: data.defaults.clusterMarginM,
          clusterMinKeepFraction: data.defaults.clusterMinKeepFraction,
          layerBlocklist: data.defaults.layerBlocklist.map(p => ({ ...p })),
        })
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load defaults')
      }
    }
    load()
    return () => { cancelled = true }
  }, [importId])

  // ── Debounced dry-run when settings change ──
  const runDryRun = useCallback(async (s: PrefilterSettings) => {
    try {
      setDryRunLoading(true)
      setError(null)
      const res = await fetch(`${API_BASE}/api/dwg/import/${importId}/reprefilter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true, ...s }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Dry-run failed: ${res.status}`)
      }
      const data: PrefilterDryRunResult = await res.json()
      setDryRun(data)
      onPreview?.(data, s)
    } catch (e: any) {
      setError(e.message || 'Dry-run failed')
      onPreview?.(null, s)
    } finally {
      setDryRunLoading(false)
    }
  }, [importId, onPreview])

  useEffect(() => {
    if (!settings) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { runDryRun(settings) }, 280)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [settings, runDryRun])

  // Notify parent to clear the overlay when the studio closes.
  useEffect(() => () => { onPreview?.(null, settings!) }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──
  const patch = useCallback(<K extends keyof PrefilterSettings>(key: K, value: PrefilterSettings[K]) => {
    setSettings(prev => (prev ? { ...prev, [key]: value } : prev))
  }, [])

  const toggleLayerPattern = useCallback((pattern: string) => {
    setSettings(prev => {
      if (!prev) return prev
      const exists = prev.layerBlocklist.some(p => p.pattern === pattern)
      const next = exists
        ? prev.layerBlocklist.filter(p => p.pattern !== pattern)
        : [...prev.layerBlocklist, { pattern, flags: 'i' }]
      return { ...prev, layerBlocklist: next }
    })
  }, [])

  const addPattern = useCallback(() => {
    const p = newPattern.trim()
    if (!p) return
    try { new RegExp(p, 'i') } catch { setError(`Invalid regex: ${p}`); return }
    setSettings(prev => {
      if (!prev) return prev
      if (prev.layerBlocklist.some(x => x.pattern === p)) return prev
      return { ...prev, layerBlocklist: [...prev.layerBlocklist, { pattern: p, flags: 'i' }] }
    })
    setNewPattern('')
  }, [newPattern])

  const removePattern = useCallback((pattern: string) => {
    setSettings(prev => prev ? ({ ...prev, layerBlocklist: prev.layerBlocklist.filter(p => p.pattern !== pattern) }) : prev)
  }, [])

  const apply = useCallback(async () => {
    if (!settings) return
    try {
      setApplyLoading(true)
      setError(null)
      const res = await fetch(`${API_BASE}/api/dwg/import/${importId}/reprefilter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, ...settings }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Apply failed: ${res.status}`)
      }
      onPreview?.(null, settings)
      onApplied()
    } catch (e: any) {
      setError(e.message || 'Apply failed')
    } finally {
      setApplyLoading(false)
    }
  }, [importId, onApplied, onPreview, settings])

  // "Revert" resets all Studio settings back to their defaults and
  // immediately re-applies the default prefilter. This way you always
  // get a usable scene (no giant rectangles) — not raw unfiltered data.
  const resetToDefaults = useCallback(async () => {
    if (!defaults) return
    const defaultSettings: PrefilterSettings = {
      enableLayerBlock: true,
      enableDegenerate: true,
      enableSizeCap: true,
      enableRelativeSizeOutlier: true,
      enablePolylineSingleton: true,
      enableMadOutlier: true,
      enableClusterPicker: true,
      maxFixtureSizeM: defaults.defaults.maxFixtureSizeM,
      maxPolylineSingletonSizeM: defaults.defaults.maxPolylineSingletonSizeM,
      minFixtureSizeM: defaults.defaults.minFixtureSizeM,
      relativeSizePercentile: defaults.defaults.relativeSizePercentile,
      relativeSizeMultiplier: defaults.defaults.relativeSizeMultiplier,
      relativeSizeMaxDropFraction: defaults.defaults.relativeSizeMaxDropFraction,
      madSpreads: defaults.defaults.madSpreads.slice(),
      madMaxDropFraction: defaults.defaults.madMaxDropFraction,
      clusterWindowM: defaults.defaults.clusterWindowM,
      clusterMarginM: defaults.defaults.clusterMarginM,
      clusterMinKeepFraction: defaults.defaults.clusterMinKeepFraction,
      layerBlocklist: defaults.defaults.layerBlocklist.map(p => ({ ...p })),
    }
    try {
      setApplyLoading(true)
      setError(null)
      const res = await fetch(`${API_BASE}/api/dwg/import/${importId}/reprefilter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, ...defaultSettings }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Reset failed: ${res.status}`)
      }
      setSettings(defaultSettings)
      onPreview?.(null, defaultSettings)
      onApplied()
    } catch (e: any) {
      setError(e.message || 'Reset to defaults failed')
    } finally {
      setApplyLoading(false)
    }
  }, [defaults, importId, onApplied, onPreview])

  // ── Derived — layer blocklist view with hit counts ──
  const layerRows = useMemo(() => {
    if (!settings || !defaults) return []
    const hits = dryRun?.prefilter.layerHits || {}
    return settings.layerBlocklist.map(p => {
      const byLayer = hits[p.pattern] || {}
      const totalHit = Object.values(byLayer).reduce((s, n) => s + n, 0)
      const layers = Object.entries(byLayer).sort((a, b) => b[1] - a[1])
      return { pattern: p.pattern, flags: p.flags, totalHit, layers }
    })
  }, [settings, defaults, dryRun])

  // Suggest patterns for layers that aren't currently matched but are heavy hitters
  const suggestions = useMemo(() => {
    if (!defaults || !settings) return []
    const matched = new Set<string>()
    for (const [, byLayer] of Object.entries(dryRun?.prefilter.layerHits || {})) {
      for (const layer of Object.keys(byLayer)) matched.add(layer)
    }
    return Object.entries(defaults.layer_totals)
      .filter(([layer]) => !matched.has(layer))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
  }, [defaults, settings, dryRun])

  if (!defaults || !settings) {
    return (
      <div className="h-full flex flex-col bg-panel-bg">
        <Header onClose={onClose} />
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          {error ? (
            <div className="flex items-center gap-2 text-red-400"><AlertCircle className="w-4 h-4" /> {error}</div>
          ) : (
            <div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading prefilter…</div>
          )}
        </div>
      </div>
    )
  }

  const stats = dryRun?.prefilter
  const keepPct = stats ? Math.round(100 * stats.kept / Math.max(1, stats.input)) : 0

  return (
    <div className="h-full flex flex-col bg-panel-bg text-white text-sm">
      <Header onClose={onClose} />

      {/* Summary */}
      <div className="px-4 py-3 border-b border-border-dark bg-gray-900/40">
        <div className="flex items-center justify-between text-xs">
          <div>
            <div className="text-gray-400">ORIGINAL</div>
            <div className="text-white font-mono">{defaults.original_fixture_count.toLocaleString()} fixtures</div>
          </div>
          <div className="text-gray-500">→</div>
          <div className="text-right">
            <div className="text-gray-400 flex items-center gap-1 justify-end">
              PREVIEW {dryRunLoading && <Loader2 className="w-3 h-3 animate-spin" />}
            </div>
            <div className="text-highlight font-mono">
              {stats ? `${stats.kept.toLocaleString()} (${keepPct}%)` : '—'}
            </div>
          </div>
        </div>
        {stats && (
          <div className="mt-2 text-[11px] text-gray-500 font-mono">
            bounds: {stats.boundsM.width.toFixed(1)} m × {stats.boundsM.depth.toFixed(1)} m
            &nbsp;·&nbsp;{dryRun?.group_count.toLocaleString()} groups
          </div>
        )}
        {!defaults.has_original_fixtures && (
          <div className="mt-2 text-[11px] text-amber-400 flex items-start gap-1">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>This import was parsed before the studio existed — the "original" set is actually the already-filtered result. Re-upload the DWG to get the true original.</span>
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <section className="p-4 border-b border-border-dark">
          <StepRow
            label={STEP_LABELS.enableLayerBlock}
            enabled={settings.enableLayerBlock}
            onToggle={v => patch('enableLayerBlock', v)}
            dropped={stats?.droppedByLayer}
            detail={`${settings.layerBlocklist.length} patterns active`}
          />
          <button
            onClick={() => setLayersExpanded(v => !v)}
            className="mt-2 text-xs text-gray-400 hover:text-white flex items-center gap-1"
          >
            {layersExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {layersExpanded ? 'Hide' : 'Edit'} layer patterns
          </button>
          {layersExpanded && (
            <div className="mt-3 space-y-2">
              {layerRows.map(row => (
                <div key={row.pattern} className="bg-gray-800/60 rounded-lg p-2 border border-gray-700/60">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[11px] font-mono text-amber-300 truncate">/{row.pattern}/{row.flags}</code>
                    <span className={`text-[11px] font-mono ${row.totalHit > 0 ? 'text-highlight' : 'text-gray-500'}`}>
                      {row.totalHit > 0 ? `drops ${row.totalHit}` : 'no hits'}
                    </span>
                    <button
                      onClick={() => removePattern(row.pattern)}
                      className="text-gray-500 hover:text-red-400"
                      title="Remove pattern"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {row.layers.length > 0 && (
                    <div className="mt-1.5 text-[10px] text-gray-400 space-y-0.5 pl-1">
                      {row.layers.slice(0, 4).map(([layer, count]) => (
                        <div key={layer} className="flex justify-between">
                          <span className="truncate mr-2">↳ {layer}</span>
                          <span className="font-mono text-gray-500 shrink-0">{count}</span>
                        </div>
                      ))}
                      {row.layers.length > 4 && (
                        <div className="text-gray-600">+ {row.layers.length - 4} more layers</div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Suggestions */}
              {suggestions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-700/60">
                  <div className="text-[11px] text-gray-500 mb-1.5">Top unmatched layers — click to add as pattern:</div>
                  <div className="flex flex-wrap gap-1">
                    {suggestions.map(([layer, count]) => (
                      <button
                        key={layer}
                        onClick={() => toggleLayerPattern(`^${escapeRegex(layer)}$`)}
                        className="px-2 py-1 text-[10px] font-mono bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 text-gray-300 hover:text-white transition-colors"
                        title={`Add /^${layer}$/i (${count} items)`}
                      >
                        {layer.length > 24 ? layer.slice(0, 22) + '…' : layer}
                        <span className="ml-1.5 text-gray-500">({count})</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested architectural filters — NOT active by default */}
              {defaults.suggestedBlocklist && defaults.suggestedBlocklist.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-700/60">
                  <div className="text-[11px] text-gray-500 mb-1.5">Quick-add architectural filters (click to toggle):</div>
                  <div className="flex flex-wrap gap-1">
                    {defaults.suggestedBlocklist.map(sp => {
                      const isActive = settings.layerBlocklist.some(p => p.pattern === sp.pattern)
                      return (
                        <button
                          key={sp.pattern}
                          onClick={() => toggleLayerPattern(sp.pattern)}
                          className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                            isActive
                              ? 'bg-amber-900/40 border-amber-600 text-amber-300'
                              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700'
                          }`}
                          title={isActive ? `Remove /${sp.pattern}/i` : `Add /${sp.pattern}/i`}
                        >
                          {sp.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Add custom pattern */}
              <div className="mt-3 flex items-center gap-1">
                <input
                  value={newPattern}
                  onChange={e => setNewPattern(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addPattern() }}
                  placeholder="custom regex (e.g. ^A-simboli$)"
                  className="flex-1 px-2 py-1.5 text-[11px] font-mono bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600 focus:border-highlight focus:outline-none"
                />
                <button
                  onClick={addPattern}
                  disabled={!newPattern.trim()}
                  className="px-2 py-1.5 bg-highlight hover:bg-highlight/80 disabled:bg-gray-700 rounded text-[11px] flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="p-4 border-b border-border-dark">
          <StepRow
            label={STEP_LABELS.enableSizeCap}
            enabled={settings.enableSizeCap}
            onToggle={v => patch('enableSizeCap', v)}
            dropped={stats?.droppedBySize}
            detail="Absolute ceiling — drop anything larger than"
          />
          <Slider
            value={settings.maxFixtureSizeM}
            min={2} max={200} step={1}
            unit="m"
            disabled={!settings.enableSizeCap}
            onChange={v => patch('maxFixtureSizeM', v)}
          />
        </section>

        <section className="p-4 border-b border-border-dark bg-highlight/5">
          <StepRow
            label={STEP_LABELS.enableRelativeSizeOutlier}
            enabled={settings.enableRelativeSizeOutlier}
            onToggle={v => patch('enableRelativeSizeOutlier', v)}
            dropped={stats?.droppedByRelativeSize}
            detail="Scale-adaptive — drops sheet borders & site-plans without touching legitimate large shelves"
          />
          <div className={`mt-2 space-y-2 ${settings.enableRelativeSizeOutlier ? '' : 'opacity-40'}`}>
            <div>
              <div className="text-[11px] text-gray-400">
                Multiplier (× P{settings.relativeSizePercentile} size)
              </div>
              <Slider
                value={settings.relativeSizeMultiplier}
                min={2} max={30} step={0.5}
                unit="×"
                disabled={!settings.enableRelativeSizeOutlier}
                onChange={v => patch('relativeSizeMultiplier', v)}
              />
            </div>
            <div>
              <div className="text-[11px] text-gray-400">
                Reference percentile
              </div>
              <Slider
                value={settings.relativeSizePercentile}
                min={75} max={99} step={1}
                unit="%"
                disabled={!settings.enableRelativeSizeOutlier}
                onChange={v => patch('relativeSizePercentile', v)}
              />
            </div>
            {stats?.relativeSize && !stats.relativeSize.skipped && (
              <div className="mt-2 text-[10px] font-mono text-gray-500">
                P{stats.relativeSize.percentile} fixture size: <span className="text-gray-300">{stats.relativeSize.p_m.toFixed(2)} m</span>
                {' · '}threshold: <span className="text-amber-300">{stats.relativeSize.threshold_m.toFixed(1)} m</span>
              </div>
            )}
            {stats?.relativeSize?.skipped && (
              <div className="mt-2 text-[10px] text-amber-400">
                Skipped — would drop {(stats.relativeSize.dropFraction * 100).toFixed(0)}% of the fixtures (&gt; {(settings.relativeSizeMaxDropFraction * 100).toFixed(0)}% safety limit). Lower the multiplier or raise the percentile.
              </div>
            )}
          </div>
        </section>

        <section className="p-4 border-b border-border-dark">
          <StepRow
            label={STEP_LABELS.enablePolylineSingleton}
            enabled={settings.enablePolylineSingleton}
            onToggle={v => patch('enablePolylineSingleton', v)}
            dropped={stats?.droppedByPolylineSingleton}
            detail="Lone big closed polylines (no block, count = 1) exceeding"
          />
          <Slider
            value={settings.maxPolylineSingletonSizeM}
            min={1} max={100} step={1}
            unit="m"
            disabled={!settings.enablePolylineSingleton}
            onChange={v => patch('maxPolylineSingletonSizeM', v)}
          />
        </section>

        <section className="p-4 border-b border-border-dark">
          <StepRow
            label={STEP_LABELS.enableMadOutlier}
            enabled={settings.enableMadOutlier}
            onToggle={v => patch('enableMadOutlier', v)}
            dropped={stats?.droppedByCoordinateOutlier}
            detail={`${settings.madSpreads.length} passes — removes entities placed far from the main cluster`}
          />
          <div className={`mt-2 flex items-center gap-2 text-[11px] ${settings.enableMadOutlier ? '' : 'opacity-40'}`}>
            <span className="text-gray-400 w-20">Spreads</span>
            {settings.madSpreads.map((s, i) => (
              <input
                key={i}
                type="number"
                value={s}
                min={2} max={30} step={1}
                disabled={!settings.enableMadOutlier}
                onChange={e => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  const next = settings.madSpreads.slice()
                  next[i] = n
                  patch('madSpreads', next)
                }}
                className="w-14 px-1.5 py-1 bg-gray-900 border border-gray-700 rounded font-mono text-center focus:border-highlight focus:outline-none"
              />
            ))}
          </div>
        </section>

        <section className="p-4 border-b border-border-dark">
          <StepRow
            label={STEP_LABELS.enableClusterPicker}
            enabled={settings.enableClusterPicker}
            onToggle={v => patch('enableClusterPicker', v)}
            dropped={stats?.droppedByCluster}
            detail="Keep only fixtures inside the densest window"
          />
          <div className="mt-1 text-[11px] text-gray-400">Window size</div>
          <Slider
            value={settings.clusterWindowM}
            min={100} max={2000} step={50}
            unit="m"
            disabled={!settings.enableClusterPicker}
            onChange={v => patch('clusterWindowM', v)}
          />
          <div className="mt-2 text-[11px] text-gray-400">Margin around window</div>
          <Slider
            value={settings.clusterMarginM}
            min={0} max={500} step={10}
            unit="m"
            disabled={!settings.enableClusterPicker}
            onChange={v => patch('clusterMarginM', v)}
          />
          {stats?.cluster && !stats.cluster.skipped && (
            <div className="mt-2 text-[10px] text-gray-500 font-mono">
              window X: [{stats.cluster.window_x_m.lo.toFixed(0)}, {stats.cluster.window_x_m.hi.toFixed(0)}] m
              &nbsp;·&nbsp;Y: [{stats.cluster.window_y_m.lo.toFixed(0)}, {stats.cluster.window_y_m.hi.toFixed(0)}] m
            </div>
          )}
          {stats?.cluster?.skipped && (
            <div className="mt-2 text-[10px] text-amber-400">
              Skipped: densest window contained too few fixtures ({(stats.cluster.keepFraction * 100).toFixed(0)}%).
            </div>
          )}
        </section>
      </div>

      {/* Footer — actions */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 text-red-400 text-xs flex items-center gap-2 border-t border-red-500/30">
          <AlertCircle className="w-3 h-3" /> {error}
        </div>
      )}
      <div className="border-t border-border-dark p-3 flex items-center gap-2">
        <button
          onClick={resetToDefaults}
          disabled={applyLoading}
          className="px-3 py-2 text-xs bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
          title="Reset all settings to defaults and re-apply"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset defaults
        </button>
        <div className="flex-1" />
        <span className="text-[11px] text-gray-500">
          {currentFixtureCount.toLocaleString()} currently stored
        </span>
        <button
          onClick={apply}
          disabled={applyLoading || !stats}
          className="px-4 py-2 text-xs bg-highlight hover:bg-highlight/80 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
        >
          {applyLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Apply
        </button>
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="h-12 px-4 border-b border-border-dark flex items-center gap-2">
      <Sliders className="w-4 h-4 text-highlight" />
      <div className="text-sm font-medium">Prefilter Studio</div>
      <div className="flex-1" />
      <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
    </div>
  )
}

function StepRow({
  label, enabled, onToggle, dropped, detail,
}: {
  label: string
  enabled: boolean
  onToggle: (v: boolean) => void
  dropped: number | undefined
  detail: string
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={enabled}
        onChange={e => onToggle(e.target.checked)}
        className="mt-0.5 accent-highlight w-4 h-4 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className={`text-sm font-medium ${enabled ? 'text-white' : 'text-gray-500'}`}>{label}</div>
          <span className={`text-[11px] font-mono ${dropped && dropped > 0 ? 'text-amber-300' : 'text-gray-500'}`}>
            {typeof dropped === 'number' ? `drops ${dropped.toLocaleString()}` : '—'}
          </span>
        </div>
        <div className="text-[11px] text-gray-400">{detail}</div>
      </div>
    </div>
  )
}

function Slider({
  value, min, max, step, unit, disabled, onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  unit: string
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className={`mt-2 flex items-center gap-3 ${disabled ? 'opacity-40' : ''}`}>
      <input
        type="range"
        value={value}
        min={min} max={max} step={step}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-highlight"
      />
      <input
        type="number"
        value={value}
        min={min} max={max} step={step}
        disabled={disabled}
        onChange={e => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
        className="w-20 px-1.5 py-1 bg-gray-900 border border-gray-700 rounded text-xs font-mono text-center focus:border-highlight focus:outline-none"
      />
      <span className="text-[11px] text-gray-500 w-4">{unit}</span>
    </div>
  )
}

// ─── Helpers ──

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
