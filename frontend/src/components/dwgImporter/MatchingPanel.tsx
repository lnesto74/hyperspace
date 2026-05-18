import { useCallback, useEffect, useMemo, useState } from 'react'
import { Crosshair, RotateCw, Compass, ArrowLeftRight, Loader2, RefreshCw, Check, X, FlaskConical, AlertTriangle } from 'lucide-react'
import { API_BASE } from '../../config/api'
import { PerceptionTransform, IDENTITY_PERCEPTION_TRANSFORM, solveTwoPointCalibration } from '../../types/perceptionTransform'

interface MatchingPanelProps {
  venueId: string | null
  /** Click on the 2D canvas to set the perception origin. Caller wires the canvas click. */
  onRequestPickOrigin: () => void
  /** Click on the 2D canvas to set point A / B for two-point calibration. */
  onRequestPickVenuePoint: (which: 'A' | 'B') => void
  /** Capture the current perception position averaged over ~10 samples (operator stands still). */
  onCapturePerceptionPoint: (which: 'A' | 'B') => Promise<{ x: number; z: number } | null>
  /** Pending venue-side click target if the parent is currently capturing one. */
  pendingPick: null | 'origin' | 'A' | 'B'
  /** Latest venue picks coming back from the canvas. */
  venuePickA?: { x: number; z: number } | null
  venuePickB?: { x: number; z: number } | null
  originPickResult?: { x: number; z: number } | null
  /** Called whenever the local transform changes so the parent can update the canvas overlay. */
  onTransformChange?: (origin: { x: number; z: number }, rotationDeg: number) => void
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function MatchingPanel({
  venueId,
  onRequestPickOrigin,
  onRequestPickVenuePoint,
  onCapturePerceptionPoint,
  pendingPick,
  venuePickA,
  venuePickB,
  originPickResult,
  onTransformChange,
}: MatchingPanelProps) {
  const [transform, setTransform] = useState<PerceptionTransform>(IDENTITY_PERCEPTION_TRANSFORM)
  const [loading, setLoading] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Two-point calibration state
  const [percA, setPercA] = useState<{ x: number; z: number } | null>(null)
  const [percB, setPercB] = useState<{ x: number; z: number } | null>(null)
  const [capturing, setCapturing] = useState<null | 'A' | 'B'>(null)

  // Load existing transform when venue changes
  useEffect(() => {
    if (!venueId) return
    let cancelled = false
    setLoading(true)
    setErrorMsg(null)
    fetch(`${API_BASE}/api/venues/${venueId}/perception-transform`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => {
        if (cancelled) return
        setTransform(data?.perceptionTransform || IDENTITY_PERCEPTION_TRANSFORM)
      })
      .catch(err => {
        if (cancelled) return
        console.error('[Matching] Load failed:', err)
        setErrorMsg('Failed to load existing transform.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [venueId])

  // Reflect origin pick coming back from canvas
  useEffect(() => {
    if (!originPickResult) return
    setTransform(t => ({ ...t, origin_m: { x: originPickResult.x, z: originPickResult.z } }))
  }, [originPickResult])

  // Push live origin/rotation to parent so the canvas crosshair updates immediately
  useEffect(() => {
    onTransformChange?.(transform.origin_m, transform.rotation_deg)
  }, [transform.origin_m, transform.rotation_deg, onTransformChange])

  const updateField = useCallback(<K extends keyof PerceptionTransform>(key: K, value: PerceptionTransform[K]) => {
    setTransform(t => ({ ...t, [key]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    if (!venueId) return
    setSaveState('saving')
    setErrorMsg(null)
    try {
      const res = await fetch(`${API_BASE}/api/venues/${venueId}/perception-transform`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perceptionTransform: transform }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data?.perceptionTransform) setTransform(data.perceptionTransform)
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 1500)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Matching] Save failed:', err)
      setErrorMsg(msg)
      setSaveState('error')
    }
  }, [venueId, transform])

  const handleReset = useCallback(async () => {
    if (!venueId) return
    if (!window.confirm('Clear the matching for this venue? Tracks will revert to raw perception coordinates.')) return
    setSaveState('saving')
    try {
      const res = await fetch(`${API_BASE}/api/venues/${venueId}/perception-transform`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perceptionTransform: null }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setTransform(IDENTITY_PERCEPTION_TRANSFORM)
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 1500)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Matching] Reset failed:', err)
      setErrorMsg(msg)
      setSaveState('error')
    }
  }, [venueId])

  const handleCapturePerception = useCallback(async (which: 'A' | 'B') => {
    setCapturing(which)
    try {
      const p = await onCapturePerceptionPoint(which)
      if (p) {
        if (which === 'A') setPercA(p)
        else setPercB(p)
      }
    } finally {
      setCapturing(null)
    }
  }, [onCapturePerceptionPoint])

  const calibrationReady = !!(percA && percB && venuePickA && venuePickB)

  const handleSolve = useCallback(() => {
    if (!percA || !percB || !venuePickA || !venuePickB) return
    const solved = solveTwoPointCalibration(percA, venuePickA, percB, venuePickB)
    if (!solved) {
      setErrorMsg('Calibration failed — the two perception points are too close. Move further apart.')
      return
    }
    setTransform(t => ({ ...t, origin_m: solved.origin_m, rotation_deg: solved.rotation_deg, scale: solved.scale }))
    setErrorMsg(null)
  }, [percA, percB, venuePickA, venuePickB])

  const formattedRotation = useMemo(() => transform.rotation_deg.toFixed(1), [transform.rotation_deg])

  if (!venueId) {
    return (
      <div className="p-4 text-sm text-gray-500 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        Generate the layout first — a venue is required for matching.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-panel-bg text-gray-200">
      <div className="p-4 border-b border-border-dark">
        <h2 className="text-sm font-medium text-white flex items-center gap-2">
          <Compass className="w-4 h-4 text-cyan-400" />
          Perception ↔ Venue Matching
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Align the perception software reference frame to this venue. Saved transforms apply to every
          MQTT track in real time.
        </p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-5 text-xs">
          {/* Step 1 — Origin */}
          <section className="space-y-2">
            <div className="text-xs font-semibold text-white flex items-center gap-2">
              <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
              Step 1 · Perception origin (in venue meters)
            </div>
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="block text-[10px] text-gray-500 uppercase">X</span>
                <input
                  type="number"
                  step={0.01}
                  value={transform.origin_m.x}
                  onChange={e => updateField('origin_m', { ...transform.origin_m, x: Number(e.target.value) })}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                />
              </label>
              <label className="flex-1">
                <span className="block text-[10px] text-gray-500 uppercase">Z</span>
                <input
                  type="number"
                  step={0.01}
                  value={transform.origin_m.z}
                  onChange={e => updateField('origin_m', { ...transform.origin_m, z: Number(e.target.value) })}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                />
              </label>
            </div>
            <button
              onClick={onRequestPickOrigin}
              className={`w-full px-2 py-1.5 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                pendingPick === 'origin' ? 'bg-cyan-600 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              {pendingPick === 'origin' ? 'Click on the 2D canvas…' : 'Pick on floorplan'}
            </button>
          </section>

          {/* Step 2 — Rotation */}
          <section className="space-y-2">
            <div className="text-xs font-semibold text-white flex items-center gap-2">
              <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
              Step 2 · Rotation (degrees, perception +X → venue +X)
            </div>
            <input
              type="number"
              step={0.5}
              value={transform.rotation_deg}
              onChange={e => updateField('rotation_deg', Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
            />
            <div className="grid grid-cols-4 gap-1">
              {[-90, 90, 180, 0].map(deg => (
                <button
                  key={deg}
                  onClick={() => updateField('rotation_deg', ((deg + 360) % 360))}
                  className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[11px]"
                >
                  {deg === 0 ? 'Reset' : `${deg > 0 ? '+' : ''}${deg}°`}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-gray-500">Current: {formattedRotation}°</div>
          </section>

          {/* Step 3 — Axes */}
          <section className="space-y-2">
            <div className="text-xs font-semibold text-white flex items-center gap-2">
              <ArrowLeftRight className="w-3.5 h-3.5 text-cyan-400" />
              Step 3 · Axis configuration
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px]">
                <span className="block text-gray-500 mb-0.5">Perception X →</span>
                <select
                  value={transform.axis_map.px}
                  onChange={e => updateField('axis_map', { ...transform.axis_map, px: e.target.value as 'x' | 'z' })}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                >
                  <option value="x">Venue X</option>
                  <option value="z">Venue Z</option>
                </select>
              </label>
              <label className="text-[11px]">
                <span className="block text-gray-500 mb-0.5">Perception Z →</span>
                <select
                  value={transform.axis_map.pz}
                  onChange={e => updateField('axis_map', { ...transform.axis_map, pz: e.target.value as 'x' | 'z' })}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                >
                  <option value="z">Venue Z</option>
                  <option value="x">Venue X</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <label className="text-[11px] flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={transform.axis_sign.x === -1}
                  onChange={e => updateField('axis_sign', { ...transform.axis_sign, x: e.target.checked ? -1 : 1 })}
                />
                Mirror X
              </label>
              <label className="text-[11px] flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={transform.axis_sign.z === -1}
                  onChange={e => updateField('axis_sign', { ...transform.axis_sign, z: e.target.checked ? -1 : 1 })}
                />
                Mirror Z
              </label>
            </div>
            <label className="block text-[11px] mt-1">
              <span className="block text-gray-500 mb-0.5">Scale (1.0 = perception in meters)</span>
              <input
                type="number"
                step={0.001}
                value={transform.scale}
                onChange={e => updateField('scale', Number(e.target.value) || 1)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
              />
            </label>
          </section>

          {/* Two-point calibration */}
          <section className="space-y-2 pt-3 border-t border-border-dark">
            <div className="text-xs font-semibold text-white flex items-center gap-2">
              <FlaskConical className="w-3.5 h-3.5 text-cyan-400" />
              Two-point auto-solve (recommended)
            </div>
            <p className="text-[11px] text-gray-500">
              Pick two reference points on the floorplan and ask an operator to stand at each spot.
              The system solves origin + rotation + scale automatically.
            </p>

            <div className="space-y-2">
              {(['A', 'B'] as const).map(label => {
                const venuePt = label === 'A' ? venuePickA : venuePickB
                const percPt = label === 'A' ? percA : percB
                return (
                  <div key={label} className="border border-gray-800 rounded p-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-cyan-300">Point {label}</span>
                      <span className="text-[10px] text-gray-500">
                        {venuePt ? `floor (${venuePt.x.toFixed(2)}, ${venuePt.z.toFixed(2)})` : 'no floor pick'}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => onRequestPickVenuePoint(label)}
                        className={`flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                          pendingPick === label ? 'bg-cyan-600 text-white' : 'bg-gray-800 hover:bg-gray-700'
                        }`}
                      >
                        {pendingPick === label ? 'Click floorplan…' : 'Pick floorplan'}
                      </button>
                      <button
                        onClick={() => handleCapturePerception(label)}
                        disabled={capturing !== null}
                        className="flex-1 px-2 py-1 rounded text-[11px] font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-50 flex items-center justify-center gap-1"
                      >
                        {capturing === label ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        Capture operator
                      </button>
                    </div>
                    {percPt && (
                      <div className="text-[10px] text-gray-500 font-mono">
                        perception ({percPt.x.toFixed(2)}, {percPt.z.toFixed(2)})
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <button
              onClick={handleSolve}
              disabled={!calibrationReady}
              className="w-full px-2 py-1.5 rounded text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              Solve transform
            </button>
          </section>

          {errorMsg && (
            <div className="text-[11px] text-red-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div className="p-3 border-t border-border-dark flex items-center gap-2 bg-gray-900/60">
        <button
          onClick={handleReset}
          className="px-2 py-1.5 rounded text-xs text-gray-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
          title="Clear matching, revert to raw perception coordinates"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1 text-[11px] text-gray-500">
          {saveState === 'saved' && <span className="text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> Applied live</span>}
          {saveState === 'error' && <span className="text-red-400 flex items-center gap-1"><X className="w-3 h-3" /> Save failed</span>}
        </div>
        <button
          onClick={handleSave}
          disabled={saveState === 'saving'}
          className="px-3 py-1.5 rounded text-xs font-medium bg-highlight hover:bg-highlight/80 text-white disabled:opacity-50 flex items-center gap-1.5"
        >
          {saveState === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Apply matching
        </button>
      </div>
    </div>
  )
}
