import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Eye, Lightbulb, Wrench, BarChart3, Package, Activity, Euro, Film } from 'lucide-react'
import { getCategoryVisual } from '../businessReporting/operationsConsole/categoryVisuals'
import { useProfitRadar } from '../../context/ProfitRadarContext'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'
import ZonePerformanceViewport, { type ZonePerformanceItem } from '../businessReporting/components/ZonePerformanceViewport'
import IntentRadar from './components/IntentRadar'
import BenchmarkBars from './components/BenchmarkBars'
import ZoneEventReplay from './components/ZoneEventReplay'
import ImpactSimulator from './components/ImpactSimulator'
import VenueEconomicsModal from './components/VenueEconomicsModal'
import DiscoveryTheater from './components/DiscoveryTheater'
import { TYPE_CONFIG, SEVERITY_BADGE, buildBenchmarkBars } from './insightConfig'
import { INTENT_AXIS_NAMES, type IntentAxes, type IntentAxisName } from '../../types'
import type { ProfitRadarInsight } from '../../types'

function CollapsibleCard({
  icon: Icon,
  iconColor,
  title,
  defaultOpen = true,
  children,
}: {
  icon: typeof Eye
  iconColor: string
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/60 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-700/30">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <span className="text-sm font-medium text-white flex-1">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-700/50 pt-3">{children}</div>}
    </div>
  )
}

function InsightCard({ insight, isSelected, onSelect }: { insight: ProfitRadarInsight; isSelected: boolean; onSelect: () => void }) {
  const config = TYPE_CONFIG[insight.type] || TYPE_CONFIG.lost_sales
  const Icon = config.icon

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-lg border p-4 transition-all ${
        isSelected ? 'ring-2 ring-highlight ' + config.bgColor : 'bg-gray-800/50 border-gray-700 hover:border-gray-500'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${config.color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEVERITY_BADGE[insight.severity]}`}>
              {insight.severity}
            </span>
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">{config.label}</span>
          </div>
          <h3 className="text-sm font-medium text-white truncate">{insight.title}</h3>
          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{insight.summary}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[10px] text-gray-500">
              Confidence: {(insight.confidence * 100).toFixed(0)}%
            </span>
            <span className="text-[10px] text-green-400 font-medium">
              {insight.impact.currency}{insight.impact.min}–{insight.impact.max}/day
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

interface ShelfProduct {
  id: string
  name: string
  brand?: string
  price?: number
  category?: string
  skuCode?: string
  imageUrl?: string
}

// Mirror of the backend resolveSkuDisplayImage fallback: prefer a real image
// URL, else infer the Esselunga product CDN from a numeric SKU code.
function resolveProductImage(p: ShelfProduct): string | null {
  if (p.imageUrl && /^https?:\/\//i.test(p.imageUrl) && !/\/displayable\/.*\.webp/i.test(p.imageUrl)) {
    return p.imageUrl
  }
  if (p.skuCode && /^\d{5,7}$/.test(p.skuCode)) {
    return `https://images.services.esselunga.it/html/img_prodotti/esselunga/big/${p.skuCode}.jpg`
  }
  return null
}

function ShelfProductImage({ p }: { p: ShelfProduct }) {
  const [failed, setFailed] = useState(false)
  const src = failed ? null : resolveProductImage(p)
  if (!src) {
    return (
      <div className="w-full aspect-square rounded-md bg-gray-800 border border-gray-700 flex items-center justify-center">
        <Package className="w-6 h-6 text-gray-600" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={p.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-full aspect-square rounded-md object-contain bg-white/95 border border-gray-700"
    />
  )
}

// "What's on this shelf" — resolves the underperforming zone to a real shelf,
// shows its product category chips, and an expandable grid of planogram
// products with images. All via existing APIs; renders nothing if unresolved.
function ShelfContentsCard({ roiId }: { roiId: string | null }) {
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const [products, setProducts] = useState<ShelfProduct[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!roiId) { setCategories([]); setProducts([]); return }
    let cancelled = false
    setLoading(true)
    setOpen(false)
    ;(async () => {
      try {
        const infoRes = await fetch(`${API_BASE}/api/roi/${roiId}/shelf-info`)
        const info = infoRes.ok ? await infoRes.json() : null
        if (cancelled) return
        const cats: string[] = Array.isArray(info?.categories) && info.categories.length
          ? info.categories
          : info?.businessCategory ? [info.businessCategory] : []
        setCategories(cats)
        if (info?.shelfId && info?.planogramId) {
          const expRes = await fetch(`${API_BASE}/api/planogram/planograms/${info.planogramId}/export`)
          const exp = expRes.ok ? await expRes.json() : null
          if (cancelled) return
          const shelf = (exp?.shelves || []).find((s: { shelfId?: string }) => s.shelfId === info.shelfId)
          const skuDetails = exp?.skuDetails || {}
          const seen = new Set<string>()
          const list: ShelfProduct[] = []
          shelf?.slots?.levels?.forEach((lvl: { slots?: { skuItemId?: string }[] }) => {
            lvl?.slots?.forEach((slot) => {
              const id = slot?.skuItemId
              if (!id || seen.has(id)) return
              seen.add(id)
              const sku = skuDetails[id]
              if (!sku) return
              list.push({
                id,
                name: sku.name,
                brand: sku.brand,
                price: sku.price,
                category: sku.category,
                skuCode: sku.skuCode || sku.sku_code,
                imageUrl: sku.imageUrl || sku.image_url,
              })
            })
          })
          setProducts(list)
        } else {
          setProducts([])
        }
      } catch {
        if (!cancelled) setProducts([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [roiId])

  if (!roiId) return null
  if (!loading && categories.length === 0 && products.length === 0) return null

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/60 overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
        <Package className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium text-white">What&apos;s on this shelf</span>
        <div className="flex items-center gap-1.5 flex-wrap ml-1">
          {categories.map(cat => {
            const { Icon, color } = getCategoryVisual(cat)
            return (
              <span
                key={cat}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ color, backgroundColor: `${color}1f`, border: `1px solid ${color}55` }}
              >
                <Icon className="w-3 h-3" strokeWidth={2.25} />
                {cat}
              </span>
            )
          })}
        </div>
      </div>

      {loading ? (
        <div className="px-4 pb-4 flex items-center gap-2 text-xs text-gray-500">
          <span className="w-3.5 h-3.5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          Loading shelf contents…
        </div>
      ) : products.length > 0 ? (
        <div className="border-t border-gray-700/50">
          <button
            onClick={() => setOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-700/30"
          >
            <span className="text-xs font-medium text-gray-300 flex-1">Products on this shelf ({products.length})</span>
            {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {open && (
            <div className="px-4 pb-4 grid grid-cols-3 sm:grid-cols-4 gap-3">
              {products.map(p => (
                <div key={p.id} className="rounded-md border border-gray-700 bg-gray-900/50 p-2">
                  <ShelfProductImage p={p} />
                  <div className="mt-1.5 text-[11px] text-white leading-tight line-clamp-2" title={p.name}>{p.name}</div>
                  {p.brand && <div className="text-[10px] text-gray-500 truncate">{p.brand}</div>}
                  {typeof p.price === 'number' && (
                    <div className="text-[10px] text-green-400 font-medium mt-0.5">€{p.price.toFixed(2)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 pb-3 pt-2 text-[11px] text-gray-500 border-t border-gray-700/50">
          No planogram products assigned to this shelf yet.
        </div>
      )}
    </div>
  )
}

interface ProfitRadarPageProps {
  onClose: () => void
}

export default function ProfitRadarPage({ onClose }: ProfitRadarPageProps) {
  const { insights, zoneField, clusters, selectedInsight, setSelectedInsight } = useProfitRadar()
  const { venue } = useVenue()
  const [showEconomics, setShowEconomics] = useState(false)
  const [layoutMode, setLayoutMode] = useState<'operational' | 'theater'>('operational')

  // Zone performance (dead/top zones) — same source as the Business Reporting
  // "Zone Performance Map", so the underperforming-zone detail can reuse it.
  const [deadZones, setDeadZones] = useState<ZonePerformanceItem[]>([])
  const [topZones, setTopZones] = useState<ZonePerformanceItem[]>([])
  const [zoneThresholdPct, setZoneThresholdPct] = useState<number>(5)

  useEffect(() => {
    if (!venue?.id) return
    let cancelled = false
    const endTs = Date.now()
    const startTs = endTs - 24 * 60 * 60 * 1000
    const params = new URLSearchParams({
      personaId: 'merchandising',
      venueId: venue.id,
      startTs: String(startTs),
      endTs: String(endTs),
    })
    fetch(`${API_BASE}/api/reporting/summary?${params}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return
        const s = data.supporting || {}
        setDeadZones((s.deadZones as ZonePerformanceItem[]) || [])
        setTopZones((s.topZones as ZonePerformanceItem[]) || [])
        if (typeof s.zoneUtilThresholdPct === 'number') setZoneThresholdPct(s.zoneUtilThresholdPct)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [venue?.id])

  // Story Mode hook (Profit Radar beat): preselect an underperforming-zone
  // insight so the detail — including the zone map — is populated on cue.
  const insightsRef = useRef<ProfitRadarInsight[]>([])
  useEffect(() => { insightsRef.current = insights }, [insights])
  useEffect(() => {
    const handler = () => {
      if (selectedInsight) return
      const list = insightsRef.current
      const zone = list.find(i => i.type === 'underperforming_zone')
      const pick = zone ?? list[0]
      if (pick) setSelectedInsight(pick)
    }
    window.addEventListener('hyperspace:profit-radar-select-zone', handler)
    return () => window.removeEventListener('hyperspace:profit-radar-select-zone', handler)
  }, [selectedInsight, setSelectedInsight])

  useEffect(() => {
    const handler = () => {
      const list = insightsRef.current
      const zone = list.find(i => i.type === 'underperforming_zone')
      const pick = zone ?? list[0]
      if (pick) setSelectedInsight(pick)
      setLayoutMode('theater')
    }
    window.addEventListener('hyperspace:profit-radar-theater', handler)
    return () => window.removeEventListener('hyperspace:profit-radar-theater', handler)
  }, [setSelectedInsight])

  const insightIndex = selectedInsight ? insights.findIndex(i => i.id === selectedInsight.id) : -1
  const cycleInsight = useCallback((dir: -1 | 1) => {
    if (insights.length === 0) return
    const idx = insightIndex >= 0 ? insightIndex : 0
    const next = (idx + dir + insights.length) % insights.length
    setSelectedInsight(insights[next])
  }, [insights, insightIndex, setSelectedInsight])

  const enterTheater = useCallback(() => {
    if (!selectedInsight && insights.length > 0) {
      const zone = insights.find(i => i.type === 'underperforming_zone')
      setSelectedInsight(zone ?? insights[0])
    }
    setLayoutMode('theater')
  }, [selectedInsight, insights, setSelectedInsight])

  // zoneField is rewritten on every live socket tick and only contains zones
  // that currently have tracks, so a zone's id appears/disappears as shoppers
  // move. Accumulate a stable name -> roiId map that only ever grows, so the
  // resolved zone never flickers back to "unknown" while an insight is selected.
  const [zoneIdByName, setZoneIdByName] = useState<Record<string, string>>({})
  useEffect(() => {
    setZoneIdByName(prev => {
      let changed = false
      const next = { ...prev }
      const add = (name?: string | null, id?: string | null) => {
        if (name && id && next[name] !== id) { next[name] = id; changed = true }
      }
      for (const z of zoneField) add(z.roiName, z.roiId)
      for (const z of deadZones) add(z.name, z.id)
      for (const z of topZones) add(z.name, z.id)
      return changed ? next : prev
    })
  }, [zoneField, deadZones, topZones])

  // Stable metadata (utilization + category) for zones we have reporting data on.
  const zoneMetaByName = useMemo(() => {
    const map = new Map<string, ZonePerformanceItem>()
    for (const z of [...topZones, ...deadZones]) {
      if (z?.name) map.set(z.name, z)
    }
    return map
  }, [topZones, deadZones])

  // The zone name(s) tied to the selected insight — a single zone for most
  // types, or the cluster's visited zones for layout friction.
  const selectedZoneNames = useMemo(() => {
    if (!selectedInsight) return [] as string[]
    const db = selectedInsight.dataBasis || {}
    const names: string[] = []
    if (typeof db.zone === 'string') names.push(db.zone)
    if (Array.isArray(db.zones)) for (const n of db.zones) if (typeof n === 'string') names.push(n)
    if (names.length === 0) names.push(selectedInsight.title.replace(/\s+underperforming$/i, '').trim())
    return Array.from(new Set(names.filter(Boolean)))
  }, [selectedInsight])

  // Stable roiId for the primary zone (drives the shelf-contents lookup).
  // Prefer the roiId carried on the insight (always present, even for zones not
  // currently streaming), falling back to the accumulated name → id map.
  const selectedRoiId = (selectedInsight?.dataBasis?.roiId as string | undefined)
    ?? (selectedZoneNames.length > 0 ? (zoneIdByName[selectedZoneNames[0]] ?? null) : null)

  // Stable focus list for the floor-plan map (pulses the insight's own zones).
  const focusZones = useMemo(() => {
    const out: ZonePerformanceItem[] = []
    const insightRoiId = selectedInsight?.dataBasis?.roiId as string | undefined
    selectedZoneNames.forEach((n, i) => {
      // The primary zone always resolves via the insight's own roiId.
      const id = (i === 0 ? insightRoiId : undefined) ?? zoneIdByName[n]
      if (!id) return
      out.push(zoneMetaByName.get(n) ?? { id, name: n, utilization: 0 })
    })
    return out
  }, [selectedZoneNames, zoneIdByName, zoneMetaByName, selectedInsight])

  // Snapshot the selected zone's behavioral fingerprint + store average once.
  // means stream live, so we freeze them to keep the radar from churning.
  const [fingerprint, setFingerprint] = useState<{ means: IntentAxes; avg: IntentAxes; dominant: IntentAxisName } | null>(null)
  useEffect(() => { setFingerprint(null) }, [selectedRoiId, selectedInsight?.id])
  useEffect(() => {
    if (!selectedRoiId || fingerprint || zoneField.length === 0) return
    const zf = zoneField.find(z => z.roiId === selectedRoiId)
    if (!zf) return
    const avg = {} as IntentAxes
    for (const axis of INTENT_AXIS_NAMES) {
      avg[axis] = zoneField.reduce((s, z) => s + (z.means[axis] ?? 0), 0) / zoneField.length
    }
    setFingerprint({ means: zf.means, avg, dominant: zf.dominant })
  }, [selectedRoiId, fingerprint, zoneField])

  return (
    <div className="absolute inset-0 z-50 bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="h-12 border-b border-gray-700 flex items-center justify-between px-4 bg-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">← Back to Main</button>
          <div className="w-px h-5 bg-gray-700" />
          <h1 className="text-white font-medium text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Profit Radar
          </h1>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span>{insights.length} active insights</span>
          <span>•</span>
          <span>{zoneField.length} zones</span>
          <span>•</span>
          <span>{clusters.length} clusters</span>
          <div className="w-px h-5 bg-gray-700" />
          <button
            onClick={() => setShowEconomics(true)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-gray-300 hover:text-white hover:bg-gray-700/60"
            title="Venue economics — ground € impact in your real numbers"
          >
            <Euro className="w-3.5 h-3.5" /> Economics
          </button>
          <button
            onClick={() => layoutMode === 'theater' ? setLayoutMode('operational') : enterTheater()}
            disabled={insights.length === 0}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-40 ${
              layoutMode === 'theater'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:text-white hover:bg-gray-700/60'
            }`}
            title="Discovery Theater — full-screen demo stage"
          >
            <Film className="w-3.5 h-3.5" /> Theater
          </button>
        </div>
      </div>
      {venue?.id && (
        <VenueEconomicsModal venueId={venue.id} open={showEconomics} onClose={() => setShowEconomics(false)} />
      )}

      {/* Body */}
      {layoutMode === 'theater' && selectedInsight && venue?.id ? (
        <DiscoveryTheater
          insight={selectedInsight}
          venueId={venue.id}
          selectedRoiId={selectedRoiId}
          zoneName={selectedZoneNames[0] || selectedInsight.title}
          onExitTheater={() => setLayoutMode('operational')}
          onPrevInsight={() => cycleInsight(-1)}
          onNextInsight={() => cycleInsight(1)}
          insightIndex={Math.max(0, insightIndex)}
          insightCount={insights.length}
          onShowEconomics={() => setShowEconomics(true)}
        />
      ) : (
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Insight List */}
        <div className="w-[400px] border-r border-gray-700 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
            <h2 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Active Insights</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {insights.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <BarChart3 className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">Waiting for data…</p>
                <p className="text-xs mt-1">Insights appear as shoppers move through zones</p>
              </div>
            ) : (
              insights.map(insight => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  isSelected={selectedInsight?.id === insight.id}
                  onSelect={() => setSelectedInsight(selectedInsight?.id === insight.id ? null : insight)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: Detail Panel */}
        <div className="flex-1 overflow-y-auto">
          {selectedInsight ? (
            (() => {
              const cfg = TYPE_CONFIG[selectedInsight.type] || TYPE_CONFIG.lost_sales
              const cur = selectedInsight.impact.currency === 'EUR' ? '€' : selectedInsight.impact.currency
              const weeklyMin = selectedInsight.impact.min * 7
              const weeklyMax = selectedInsight.impact.max * 7
              const barItems = buildBenchmarkBars(selectedInsight, fingerprint?.avg ?? null)
              return (
            <div className="max-w-5xl mx-auto p-6">
              {/* HERO — title + estimated impact KPI */}
              <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEVERITY_BADGE[selectedInsight.severity]}`}>
                      {selectedInsight.severity}
                    </span>
                    <span className={`text-[10px] uppercase tracking-wider ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  <h2 className="text-xl font-semibold text-white mb-1.5">{selectedInsight.title}</h2>
                  <p className="text-sm text-gray-400">{selectedInsight.summary}</p>
                  {venue?.id && (
                    <button
                      onClick={enterTheater}
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white"
                    >
                      <Film className="w-3.5 h-3.5" /> Present in Discovery Theater
                    </button>
                  )}
                </div>
                <div className="shrink-0 rounded-lg border border-emerald-700/50 bg-emerald-900/20 px-4 py-3 sm:text-right">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-300/80">Estimated impact</div>
                  <div className="text-2xl font-bold text-emerald-400 tabular-nums leading-tight">
                    {cur}{selectedInsight.impact.min.toLocaleString()}–{selectedInsight.impact.max.toLocaleString()}
                    <span className="text-xs font-normal text-emerald-500/80 ml-1">/ day</span>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    ≈ {cur}{Math.round(weeklyMin).toLocaleString()}–{Math.round(weeklyMax).toLocaleString()} / wk · {(selectedInsight.confidence * 100).toFixed(0)}% confidence
                  </div>
                  <div className="mt-1.5 h-1 w-full rounded-full bg-gray-700 overflow-hidden sm:w-40 sm:ml-auto">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${selectedInsight.confidence * 100}%` }} />
                  </div>
                  <button
                    onClick={() => setShowEconomics(true)}
                    className="mt-1.5 text-[10px] text-gray-500 hover:text-emerald-300 sm:ml-auto block"
                    title="How the € is calculated"
                  >
                    {selectedInsight.impact.basis === 'economics' ? 'Based on your store economics ·' : 'Reference estimate ·'} set economics →
                  </button>
                </div>
              </div>

              {/* ZONE PERFORMANCE MAP — full width at top */}
              {venue?.id && (
                <div className="mb-5">
                  <ZonePerformanceViewport
                    venueId={venue.id}
                    deadZones={deadZones}
                    topZones={topZones}
                    zoneUtilThresholdPct={zoneThresholdPct}
                    initialTab="underperforming"
                    focusZones={focusZones.length > 0 ? focusZones : undefined}
                    focusLabel={cfg.label}
                  />
                </div>
              )}

              {/* TWO COLUMNS */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                {/* LEFT — diagnosis */}
                <div className="space-y-4">
                  <CollapsibleCard icon={Eye} iconColor="text-cyan-400" title="Why is this happening?">
                    <p className="text-xs text-gray-300 leading-relaxed">{selectedInsight.why}</p>
                  </CollapsibleCard>

                  <CollapsibleCard icon={Activity} iconColor="text-amber-400" title="Behavioral fingerprint">
                    {fingerprint ? (
                      <IntentRadar means={fingerprint.means} avg={fingerprint.avg} dominant={fingerprint.dominant} color={cfg.hex} />
                    ) : (
                      <p className="text-xs text-gray-500 text-center py-4">Live behavioral data for this zone isn't streaming right now.</p>
                    )}
                    {barItems.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-gray-700/50">
                        <BenchmarkBars items={barItems} />
                        <p className="text-[10px] text-gray-500 mt-2">Bars show this zone; the tick marks the store average.</p>
                      </div>
                    )}
                  </CollapsibleCard>

                  {selectedInsight.type === 'underperforming_zone' && (
                    <ShelfContentsCard roiId={selectedRoiId} />
                  )}
                </div>

                {/* RIGHT — evidence + action */}
                <div className="space-y-4">
                  {venue?.id && (
                    <ZoneEventReplay venueId={venue.id} roiId={selectedRoiId} zoneName={selectedZoneNames[0] || selectedInsight.title} />
                  )}

                  <CollapsibleCard icon={Wrench} iconColor="text-green-400" title="Suggested Fix">
                    <p className="text-xs text-gray-300 leading-relaxed">{selectedInsight.suggestedFix}</p>
                  </CollapsibleCard>

                  <ImpactSimulator insight={selectedInsight} venueId={venue?.id} roiId={selectedRoiId} zoneName={selectedZoneNames[0] || selectedInsight.title} />
                </div>
              </div>
            </div>
              )
            })()
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Lightbulb className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm">Select an insight to see details</p>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}
