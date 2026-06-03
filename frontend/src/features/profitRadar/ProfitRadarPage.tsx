import { useState, useEffect, useRef, useMemo } from 'react'
import { AlertTriangle, TrendingDown, Users, LayoutDashboard, ChevronDown, ChevronUp, Eye, Lightbulb, Wrench, BarChart3, Package } from 'lucide-react'
import { getCategoryVisual } from '../businessReporting/operationsConsole/categoryVisuals'
import { useProfitRadar } from '../../context/ProfitRadarContext'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'
import ZonePerformanceViewport, { type ZonePerformanceItem } from '../businessReporting/components/ZonePerformanceViewport'
import type { ProfitRadarInsight, InsightType } from '../../types'

const TYPE_CONFIG: Record<InsightType, { icon: typeof AlertTriangle; color: string; bgColor: string; label: string }> = {
  lost_sales: { icon: AlertTriangle, color: 'text-red-400', bgColor: 'bg-red-500/10 border-red-500/30', label: 'Lost Sales' },
  underperforming_zone: { icon: TrendingDown, color: 'text-amber-400', bgColor: 'bg-amber-500/10 border-amber-500/30', label: 'Underperforming Zone' },
  staff_misallocation: { icon: Users, color: 'text-blue-400', bgColor: 'bg-blue-500/10 border-blue-500/30', label: 'Staff Misallocation' },
  layout_friction: { icon: LayoutDashboard, color: 'text-purple-400', bgColor: 'bg-purple-500/10 border-purple-500/30', label: 'Layout Friction' },
}

const SEVERITY_BADGE: Record<string, string> = {
  high: 'bg-red-600 text-white',
  medium: 'bg-amber-600 text-white',
  low: 'bg-gray-600 text-gray-200',
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

function DetailPanel({ insight }: { insight: ProfitRadarInsight }) {
  const [showWhy, setShowWhy] = useState(true)
  const [showFix, setShowFix] = useState(true)
  const [showData, setShowData] = useState(false)

  return (
    <div className="space-y-3">
      {/* Why Panel */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/60 overflow-hidden">
        <button onClick={() => setShowWhy(!showWhy)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-700/30">
          <Eye className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-white flex-1">Why is this happening?</span>
          {showWhy ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {showWhy && (
          <div className="px-4 pb-3 text-xs text-gray-300 leading-relaxed border-t border-gray-700/50 pt-3">
            {insight.why}
          </div>
        )}
      </div>

      {/* Suggested Fix Panel */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/60 overflow-hidden">
        <button onClick={() => setShowFix(!showFix)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-700/30">
          <Wrench className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-white flex-1">Suggested Fix</span>
          {showFix ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {showFix && (
          <div className="px-4 pb-3 text-xs text-gray-300 leading-relaxed border-t border-gray-700/50 pt-3">
            {insight.suggestedFix}
          </div>
        )}
      </div>

      {/* Data Basis Panel */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/60 overflow-hidden">
        <button onClick={() => setShowData(!showData)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-700/30">
          <BarChart3 className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-medium text-white flex-1">Data Basis</span>
          {showData ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {showData && (
          <div className="px-4 pb-3 border-t border-gray-700/50 pt-3">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(insight.dataBasis).map(([key, value]) => (
                <div key={key} className="text-xs">
                  <span className="text-gray-500">{key}: </span>
                  <span className="text-gray-300">{typeof value === 'number' ? value.toFixed(2) : Array.isArray(value) ? value.join(', ') : String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Impact */}
      <div className="rounded-lg border border-green-800/50 bg-green-900/20 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Lightbulb className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-green-300">Estimated Impact</span>
        </div>
        <p className="text-lg font-bold text-green-400">
          {insight.impact.currency}{insight.impact.min} – {insight.impact.currency}{insight.impact.max}
          <span className="text-xs text-green-500 font-normal ml-1">per day</span>
        </p>
      </div>
    </div>
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

  // Resolve the selected zone insight to a real ROI id (insights only carry the
  // zone name) so the detail can look up the shelf's category + products.
  const selectedRoiId = useMemo(() => {
    if (!selectedInsight) return null
    const zoneName = (selectedInsight.dataBasis?.zone as string)
      || selectedInsight.title.replace(/\s+underperforming$/i, '').trim()
    const zf = zoneField.find(z => z.roiName === zoneName)
    if (zf) return zf.roiId
    const dz = deadZones.find(d => d.name === zoneName)
    return dz?.id ?? null
  }, [selectedInsight, zoneField, deadZones])

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
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
        </div>
      </div>

      {/* Body */}
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
            <div className="max-w-2xl mx-auto p-6">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">{selectedInsight.title}</h2>
                <p className="text-sm text-gray-400">{selectedInsight.summary}</p>
              </div>
              <DetailPanel insight={selectedInsight} />

              {/* What's on this shelf — category chips + planogram products with images */}
              {selectedInsight.type === 'underperforming_zone' && (
                <div className="mt-4">
                  <ShelfContentsCard roiId={selectedRoiId} />
                </div>
              )}

              {/* Zone Performance Map — reused from Business Reporting; shows the
                  underperforming zones pulsing red on the real floor plan. */}
              {selectedInsight.type === 'underperforming_zone' && venue?.id && (
                <div className="mt-6">
                  <ZonePerformanceViewport
                    venueId={venue.id}
                    deadZones={deadZones}
                    topZones={topZones}
                    zoneUtilThresholdPct={zoneThresholdPct}
                    initialTab="underperforming"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Lightbulb className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm">Select an insight to see details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
