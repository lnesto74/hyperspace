import { useCallback, useEffect, useRef, useState } from 'react'
import { Compass, Eye, EyeOff, RefreshCw, X, ChevronDown, ChevronUp, Loader2, Check, FlipHorizontal2, FlipVertical2, RotateCcw } from 'lucide-react'
import { API_BASE } from '../../config/api'
import { useTrackingActions } from '../../context/TrackingContext'
import { PerceptionTransform, IDENTITY_PERCEPTION_TRANSFORM } from '../../types/perceptionTransform'

interface MatchingTunerPanelProps {
  venueId: string
  onClose: () => void
}

/**
 * Floating live-tuner that sits on top of the 3D venue. Sliders for origin
 * X/Y and rotation; numeric inputs for fine grain. Saves are debounced so
 * the user gets immediate visual feedback as they drag without spamming the
 * server.
 */
export default function MatchingTunerPanel({ venueId, onClose }: MatchingTunerPanelProps) {
  const { setTrackVisibility } = useTrackingActions()
  const [transform, setTransform] = useState<PerceptionTransform>(IDENTITY_PERCEPTION_TRANSFORM)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [tracksVisible, setTracksVisible] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load current transform once when venueId changes
  useEffect(() => {
    if (!venueId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}/api/venues/${venueId}/perception-transform`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => {
        if (cancelled) return
        setTransform(data?.perceptionTransform || IDENTITY_PERCEPTION_TRANSFORM)
      })
      .catch(err => { if (!cancelled) setError(String(err.message || err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [venueId])

  // Debounced save — fires 250ms after the last change
  const scheduleSave = useCallback((next: PerceptionTransform) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(`${API_BASE}/api/venues/${venueId}/perception-transform`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ perceptionTransform: next }),
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

  // Cleanup pending save on unmount
  useEffect(() => () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current) }, [])

  const update = useCallback((patch: Partial<PerceptionTransform>) => {
    setTransform(prev => {
      const next = { ...prev, ...patch }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/venues/${venueId}/perception-transform`)
      const data = await res.json()
      setTransform(data?.perceptionTransform || IDENTITY_PERCEPTION_TRANSFORM)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [venueId])

  const reset = useCallback(() => {
    if (!window.confirm('Reset perception matching to identity (no transform)?')) return
    update({ ...IDENTITY_PERCEPTION_TRANSFORM })
  }, [update])

  const toggleTracks = useCallback(() => {
    const next = !tracksVisible
    setTracksVisible(next)
    setTrackVisibility(next)
  }, [tracksVisible, setTrackVisibility])

  return (
    <div className="absolute top-4 left-16 z-30 w-80 bg-gray-900/95 backdrop-blur border border-cyan-700/60 rounded-xl shadow-2xl text-gray-200 text-xs">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/80">
        <Compass className="w-4 h-4 text-cyan-400" />
        <span className="font-semibold text-white">Perception Matching · Live Tuner</span>
        <div className="flex-1" />
        <button
          onClick={toggleTracks}
          className="p-1 rounded hover:bg-gray-700/60 transition-colors"
          title={tracksVisible ? 'Hide live tracks' : 'Show live tracks'}
        >
          {tracksVisible
            ? <Eye className="w-4 h-4 text-green-400" />
            : <EyeOff className="w-4 h-4 text-gray-500" />}
        </button>
        <button
          onClick={reload}
          disabled={loading}
          className="p-1 rounded hover:bg-gray-700/60 transition-colors disabled:opacity-50"
          title="Reload from server"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="p-1 rounded hover:bg-gray-700/60 transition-colors"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-700/60 transition-colors"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-4">
          {/* Quick flips toolbar — single-click 180° transforms. Use these to align
              orientation before fine-tuning origin/rotation with the sliders. */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase text-gray-500 tracking-wide">Quick flips</div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => update({ axis_sign: { ...transform.axis_sign, x: (transform.axis_sign.x === -1 ? 1 : -1) as 1 | -1 } })}
                className={`px-2 py-2 rounded text-xs font-medium flex flex-col items-center gap-1 transition-colors ${
                  transform.axis_sign.x === -1 ? 'bg-cyan-600 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
                }`}
                title="Flip horizontally (mirror left ↔ right)"
              >
                <FlipHorizontal2 className="w-4 h-4" />
                <span>Flip ↔</span>
              </button>
              <button
                onClick={() => update({ axis_sign: { ...transform.axis_sign, z: (transform.axis_sign.z === -1 ? 1 : -1) as 1 | -1 } })}
                className={`px-2 py-2 rounded text-xs font-medium flex flex-col items-center gap-1 transition-colors ${
                  transform.axis_sign.z === -1 ? 'bg-cyan-600 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
                }`}
                title="Flip vertically (mirror top ↔ bottom)"
              >
                <FlipVertical2 className="w-4 h-4" />
                <span>Flip ↕</span>
              </button>
              <button
                onClick={() => {
                  let next = transform.rotation_deg + 180
                  if (next > 180) next -= 360
                  update({ rotation_deg: next })
                }}
                className="px-2 py-2 rounded text-xs font-medium flex flex-col items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"
                title="Rotate 180° around the vertical (Z) axis"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Rotate 180°</span>
              </button>
            </div>
            <div className="text-[10px] text-gray-500">
              Current: rotation {transform.rotation_deg.toFixed(0)}° · mirror X {transform.axis_sign.x === -1 ? 'on' : 'off'} · mirror Y {transform.axis_sign.z === -1 ? 'on' : 'off'}
            </div>
          </div>

          {/* Origin X */}
          <SliderRow
            label="Origin X (m)"
            value={transform.origin_m.x}
            min={-100}
            max={100}
            step={0.1}
            onChange={v => update({ origin_m: { ...transform.origin_m, x: v } })}
          />
          {/* Origin Y (stored as venue Z internally) */}
          <SliderRow
            label="Origin Y (m)"
            value={transform.origin_m.z}
            min={-100}
            max={100}
            step={0.1}
            onChange={v => update({ origin_m: { ...transform.origin_m, z: v } })}
          />
          {/* Rotation */}
          <SliderRow
            label="Rotation (°)"
            value={transform.rotation_deg}
            min={-180}
            max={180}
            step={1}
            onChange={v => update({ rotation_deg: v })}
          />
          {/* Rotation quick buttons */}
          <div className="grid grid-cols-4 gap-1">
            {[-90, 90, 180, 0].map(deg => (
              <button
                key={deg}
                onClick={() => update({ rotation_deg: ((deg + 540) % 360) - 180 })}
                className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[11px]"
              >
                {deg === 0 ? '0°' : `${deg > 0 ? '+' : ''}${deg}°`}
              </button>
            ))}
          </div>

          {/* Mirror + scale row */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-800">
            <label className="flex items-center gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={transform.axis_sign.x === -1}
                onChange={e => update({ axis_sign: { ...transform.axis_sign, x: e.target.checked ? -1 : 1 } })}
              />
              Mirror X
            </label>
            <label className="flex items-center gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={transform.axis_sign.z === -1}
                onChange={e => update({ axis_sign: { ...transform.axis_sign, z: e.target.checked ? -1 : 1 } })}
              />
              Mirror Y
            </label>
            <label className="col-span-2 text-[11px]">
              <span className="block text-gray-500 mb-0.5">Scale</span>
              <input
                type="number"
                step={0.001}
                value={transform.scale}
                onChange={e => update({ scale: Number(e.target.value) || 1 })}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
              />
            </label>
          </div>

          {/* Status bar */}
          <div className="flex items-center gap-2 text-[11px] pt-1 border-t border-gray-800">
            {saving && <span className="text-blue-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>}
            {!saving && savedAt && Date.now() - savedAt < 2000 && (
              <span className="text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> Applied live</span>
            )}
            {error && <span className="text-red-400 truncate">{error}</span>}
            <div className="flex-1" />
            <button onClick={reset} className="text-gray-500 hover:text-red-300 transition-colors">Reset</button>
          </div>
        </div>
      )}
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
}

function SliderRow({ label, value, min, max, step, onChange }: SliderRowProps) {
  return (
    <div>
      <div className="text-gray-400 mb-1">{label}</div>
      <input
        type="number"
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono mb-1.5"
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-cyan-500"
      />
      <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
