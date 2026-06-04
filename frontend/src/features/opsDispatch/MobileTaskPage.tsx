import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '../../config/api'
import {
  fetchTaskSnapshot,
  ackTask,
  resolveTaskPublic,
  submitProof,
  type TaskSnapshot,
  type OpsTaskPayload,
} from './api'
import {
  computeFloorPlanBounds,
  boundsToViewBox,
  polygonPath,
  venueObjectsToFixtures,
  getDrawableFixtureOutline,
  normalizeFloorVertex,
  type MapRegion,
} from '../../utils/venueFloorPlanMap'

function tokenFromPath(): string {
  const m = window.location.pathname.match(/\/m\/task\/([^/?#]+)/)
  return m ? m[1] : ''
}

function resolveProductImage(p: { imageUrl?: string | null; skuCode?: string }): string | null {
  if (p.imageUrl && /^https?:\/\//i.test(p.imageUrl) && !/\/displayable\/.*\.webp/i.test(p.imageUrl)) {
    return p.imageUrl
  }
  if (p.skuCode && /^\d{5,7}$/.test(p.skuCode)) {
    return `https://images.services.esselunga.it/html/img_prodotti/esselunga/big/${p.skuCode}.jpg`
  }
  return null
}

function impactText(impact?: OpsTaskPayload['impact']): string | null {
  if (!impact) return null
  const cur = impact.currency === 'EUR' ? '€' : (impact.currency || '€')
  return `${cur}${Math.round(impact.min).toLocaleString()}–${Math.round(impact.max).toLocaleString()} / day`
}

function TaskMap({ snap }: { snap: TaskSnapshot }) {
  const [pulse, setPulse] = useState(0)
  const raf = useRef<number>()

  useEffect(() => {
    const loop = () => {
      setPulse((Date.now() % 1600) / 1600)
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [])

  const { objects, regions, targetRoiId } = snap.map
  const normRegions: MapRegion[] = useMemo(
    () => (regions || []).map(r => ({ id: r.id, vertices: (r.vertices || []).map(normalizeFloorVertex) })),
    [regions],
  )
  const bounds = useMemo(() => computeFloorPlanBounds(objects as any, normRegions), [objects, normRegions])
  const viewBox = boundsToViewBox(bounds)
  const fixtures = useMemo(() => venueObjectsToFixtures(objects as any), [objects])
  const pulseWave = 0.5 + 0.5 * Math.sin(pulse * Math.PI * 2)

  return (
    <svg viewBox={viewBox} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <rect x={bounds.minX} y={bounds.minZ} width={bounds.maxX - bounds.minX} height={bounds.maxZ - bounds.minZ} fill="#05070d" />
      {fixtures.map((f, i) => {
        const outline = getDrawableFixtureOutline(f)
        if (outline.length < 3) return null
        return (
          <path key={`f-${i}`} d={polygonPath(outline)} fill="rgba(0,210,255,0.06)" stroke="rgba(0,210,255,0.5)" strokeWidth={0.05} strokeLinejoin="round" />
        )
      })}
      {normRegions.map(r => {
        const isTarget = r.id === targetRoiId
        if (isTarget) return null
        if (r.vertices.length < 3) return null
        return (
          <path key={`r-${r.id}`} d={polygonPath(r.vertices)} fill="rgba(139,92,246,0.05)" stroke="rgba(139,92,246,0.22)" strokeWidth={0.04} strokeLinejoin="round" />
        )
      })}
      {normRegions.filter(r => r.id === targetRoiId && r.vertices.length >= 3).map(r => {
        const cx = r.vertices.reduce((a, p) => a + p.x, 0) / r.vertices.length
        const cz = r.vertices.reduce((a, p) => a + p.z, 0) / r.vertices.length
        return (
          <g key={`t-${r.id}`}>
            <path
              d={polygonPath(r.vertices)}
              fill={`rgba(255,40,40,${0.18 + pulseWave * 0.24})`}
              stroke={`rgba(255,70,70,${0.7 + pulseWave * 0.3})`}
              strokeWidth={0.1 + pulseWave * 0.06}
              strokeLinejoin="round"
            />
            <circle cx={cx} cy={cz} r={0.18 + pulseWave * 0.1} fill="#ffffff" />
            <circle cx={cx} cy={cz} r={0.09} fill="#ff2d2d" />
          </g>
        )
      })}
    </svg>
  )
}

export default function MobileTaskPage() {
  const token = useMemo(tokenFromPath, [])
  const [snap, setSnap] = useState<TaskSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [proofOpen, setProofOpen] = useState(false)
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const load = async () => {
    try {
      setSnap(await fetchTaskSnapshot(token))
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Task not found')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) { setError('Invalid task link'); setLoading(false); return }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const doAck = async () => { setBusy(true); try { await ackTask(token); await load() } finally { setBusy(false) } }
  const submitDone = async () => {
    setBusy(true)
    try {
      if (file || note.trim()) await submitProof(token, { note: note.trim() || undefined, file })
      else await resolveTaskPublic(token)
      setProofOpen(false); setNote(''); setFile(null)
      await load()
    } finally { setBusy(false) }
  }

  if (loading) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400 text-sm">Loading task…</div>
  }
  if (error || !snap) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-400 text-sm">{error || 'Task not found'}</p>
          <p className="text-gray-600 text-xs mt-2">This task link may have expired.</p>
        </div>
      </div>
    )
  }

  const t = snap.task
  const p = t.payload || {}
  const isCashier = t.role === 'cashier'
  const products = (p.products || []).filter(Boolean)
  const status = t.status
  const done = status === 'completed' || status === 'verified'
  const acked = status === 'acknowledged' || done
  const ver = t.verification

  const accent = isCashier ? '#f59e0b' : '#34d399'

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-gray-800" style={{ background: 'linear-gradient(160deg, rgba(17,20,28,0.9), rgba(9,11,17,0.9))' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded" style={{ background: `${accent}22`, color: accent }}>
            {t.roleLabel}
          </span>
          <span className="text-[11px] text-gray-500 ml-auto">{snap.venue.name}</span>
        </div>
        <h1 className="mt-2 text-lg font-semibold leading-tight">
          {isCashier ? 'Go to checkout' : 'Reposition this shelf'}
        </h1>
        {p.zoneName && <p className="text-sm text-gray-300 mt-0.5">{p.zoneName}</p>}
        {p.coordinates && (
          <p className="text-[11px] text-gray-500 mt-1 font-mono">📍 x {p.coordinates.x}m · z {p.coordinates.z}m</p>
        )}
      </div>

      {/* Map */}
      <div className="relative bg-[#05070d]" style={{ height: '38vh' }}>
        <TaskMap snap={snap} />
        <div className="absolute bottom-2 left-3 text-[10px] text-gray-500 bg-black/40 px-2 py-1 rounded">
          {isCashier ? 'Head to the highlighted counter' : 'Highlighted shelf needs attention'}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-5 py-4 space-y-4">
        {(p.impact) && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Estimated impact</div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: accent }}>{impactText(p.impact)}</div>
          </div>
        )}

        {p.suggestedFix && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">What to do</div>
            <p className="text-sm text-gray-200 leading-relaxed">{p.suggestedFix}</p>
          </div>
        )}
        {p.instruction && !p.suggestedFix && (
          <p className="text-sm text-gray-200 leading-relaxed">{p.instruction}</p>
        )}

        {/* Products to reposition (merchandiser) */}
        {!isCashier && products.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Products on this shelf</div>
            <div className="grid grid-cols-3 gap-2">
              {products.slice(0, 9).map((prod, i) => {
                const img = resolveProductImage(prod)
                return (
                  <div key={i} className="rounded-lg border border-gray-800 bg-gray-900/60 overflow-hidden">
                    <div className="aspect-square bg-white/95 flex items-center justify-center">
                      {img ? (
                        <img src={img} alt={prod.name || ''} className="w-full h-full object-contain" loading="lazy"
                          onError={(e) => { (e.currentTarget.style.display = 'none') }} />
                      ) : (
                        <span className="text-gray-400 text-[10px] px-1 text-center">{prod.name || prod.skuCode}</span>
                      )}
                    </div>
                    <div className="px-1.5 py-1">
                      <p className="text-[10px] text-gray-200 truncate" title={prod.name}>{prod.name || prod.skuCode}</p>
                      {prod.brand && <p className="text-[9px] text-gray-500 truncate">{prod.brand}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="sticky bottom-0 px-5 py-4 border-t border-gray-800 bg-gray-950/95 backdrop-blur space-y-2">
        {done ? (
          <div className="space-y-2">
            <div className="text-center py-2 text-emerald-400 text-sm font-medium">✓ Task completed — thank you</div>
            {t.proof?.photoUrl && (
              <img src={`${API_BASE}${t.proof.photoUrl}`} alt="proof" className="w-full max-h-40 object-cover rounded-lg border border-gray-800" />
            )}
            {t.proof?.note && <p className="text-center text-xs text-gray-400 italic">“{t.proof.note}”</p>}
            {ver ? (
              <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/10 px-3 py-2 text-center">
                <span className="text-[10px] uppercase tracking-wide text-emerald-500">
                  {ver.source === 'measured' ? 'Outcome confirmed' : 'Projected outcome'}
                </span>
                <p className="text-sm text-emerald-300 mt-0.5">{ver.summary}</p>
              </div>
            ) : (
              <p className="text-center text-[10px] text-gray-600">Hyperspace is measuring the outcome…</p>
            )}
          </div>
        ) : proofOpen ? (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Add proof (optional)</div>
            <label className="flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-gray-700 text-sm text-gray-300 cursor-pointer">
              {file ? `📷 ${file.name.slice(0, 24)}` : (isCashier ? '📷 Photo of the open lane' : '📷 Photo of the fixed shelf')}
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={isCashier ? 'e.g. Lane 4 opened' : 'Optional note…'}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white placeholder-gray-600" />
            <div className="flex gap-2">
              <button onClick={() => { setProofOpen(false); setFile(null); setNote('') }} disabled={busy}
                className="flex-1 py-3 rounded-xl font-semibold text-sm bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submitDone} disabled={busy}
                className="flex-1 py-3 rounded-xl font-semibold text-sm text-white disabled:opacity-50" style={{ background: accent }}>
                {busy ? 'Submitting…' : (file || note.trim() ? 'Submit & done' : 'Mark done')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            {!acked && (
              <button onClick={doAck} disabled={busy}
                className="flex-1 py-3 rounded-xl font-semibold text-sm bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50">
                On it
              </button>
            )}
            <button onClick={() => setProofOpen(true)} disabled={busy}
              className="flex-1 py-3 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
              style={{ background: accent }}>
              Mark done
            </button>
          </div>
        )}
        {t.assignedName && <p className="text-center text-[10px] text-gray-600">Assigned to {t.assignedName}</p>}
      </div>
    </div>
  )
}
