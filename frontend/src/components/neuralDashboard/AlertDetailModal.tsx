import { useEffect, useRef, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRoi } from '../../context/RoiContext'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'
import {
  NEURAL_MODAL_SECTION_BG,
  neuralModalBackdropStyle,
  neuralModalPanelStyle,
} from './neuralModalStyles'
import FloorPlanMiniMap from '../shared/FloorPlanMiniMap'
import { normalizeFloorVertex, type MapRegion } from '../../utils/venueFloorPlanMap'

interface AlertData {
  id: string
  type: 'queue_risk' | 'low_engagement' | 'bottleneck' | 'media_roi' | 'sku_best' | 'sku_worst'
  severity: 'high' | 'medium' | 'low'
  title: string
  message: string
  action: string
  timestamp: number
  firstSeen: number
  zoneId?: string
  zoneIds?: string[]
  categories?: string[]
  shelfName?: string
  skuItemId?: string
  skuCode?: string
  skuName?: string
  brand?: string
  imageUrl?: string | null
  shelfId?: string
  levelIndex?: number
  slotIndex?: number
  attractionIndex?: number
  attentionIndex?: number
  compositeScore?: number
  viewers?: number
  audience?: number
  rank?: 'best' | 'worst'
}

const TYPE_META: Record<string, { label: string; color: string; accent: string; description: string }> = {
  queue_risk:     { label: 'Queue Risk',     color: '#ff5050', accent: 'rgba(255,80,80,0.25)',   description: 'Elevated wait-time detected at checkout zones. High queue length can indicate understaffing or layout bottleneck.' },
  low_engagement: { label: 'Low Engagement', color: '#ffb432', accent: 'rgba(255,180,50,0.25)',  description: 'Product zones with below-average dwell rates. Visitors pass through without stopping, suggesting low product appeal or poor placement.' },
  bottleneck:     { label: 'Friction Zone',  color: '#ff7832', accent: 'rgba(255,120,50,0.25)',  description: 'Zone with slow pedestrian flow and high occupancy. Could indicate an obstruction, narrow aisle, or confusing layout.' },
  media_roi:      { label: 'Media ROI',      color: '#b464ff', accent: 'rgba(180,100,255,0.25)', description: 'Digital out-of-home campaign under-performing conversion targets. Review creative, placement, or audience targeting.' },
  sku_best:       { label: 'Top SKU',        color: '#4ade80', accent: 'rgba(74,222,128,0.2)',   description: 'Highest combined Attraction and Attention index in the last 30 seconds. Shoppers are stopping and looking at this product on the shelf.' },
  sku_worst:      { label: 'Underperforming SKU', color: '#fb923c', accent: 'rgba(251,146,60,0.2)', description: 'Lowest shopper interest at this shelf slot in the last 30 seconds. Consider repositioning, signage, or facing changes.' },
}

const SEV_BADGE: Record<string, { bg: string; text: string }> = {
  high:   { bg: 'rgba(239,68,68,0.2)', text: '#f87171' },
  medium: { bg: 'rgba(251,191,36,0.2)', text: '#fbbf24' },
  low:    { bg: 'rgba(255,255,255,0.08)', text: 'rgba(255,255,255,0.5)' },
}

interface Props {
  alert: AlertData
  onClose: () => void
}

export default function AlertDetailModal({ alert, onClose }: Props) {
  const { regions: contextRegions } = useRoi()
  const { objects, venue } = useVenue()
  const pulseRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const [, setPulseTick] = useState(0)
  const [fetchedRegions, setFetchedRegions] = useState<MapRegion[]>([])

  const highlightIds = useMemo(() => {
    const ids = new Set<string>()
    if (alert.zoneId) ids.add(alert.zoneId)
    if (alert.zoneIds) {
      for (const id of alert.zoneIds) ids.add(id)
    }
    return ids
  }, [alert.zoneId, alert.zoneIds])

  useEffect(() => {
    if (!venue?.id) return
    let cancelled = false
    fetch(`${API_BASE}/api/venues/${venue.id}/roi?all=true`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => {
        if (cancelled || !Array.isArray(data)) return
        setFetchedRegions(data.map((r: { id: string; vertices: { x: number; z?: number; y?: number }[] }) => ({
          id: r.id,
          vertices: r.vertices.map(normalizeFloorVertex),
        })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [venue?.id])

  const mapRegions: MapRegion[] = useMemo(() => {
    const source = fetchedRegions.length > 0
      ? fetchedRegions
      : contextRegions.map(r => ({
          id: r.id,
          vertices: r.vertices.map(normalizeFloorVertex),
        }))
    return source
  }, [fetchedRegions, contextRegions])

  const hasMapData = objects.length > 0 || mapRegions.length > 0

  useEffect(() => {
    if (!hasMapData) return
    const tick = (ts: number) => {
      pulseRef.current = (ts % 2000) / 2000
      setPulseTick(t => t + 1)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [hasMapData])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const meta = TYPE_META[alert.type] || TYPE_META.bottleneck
  const sev = SEV_BADGE[alert.severity] || SEV_BADGE.low

  const timeAgo = (ts: number) => {
    const sec = Math.floor((Date.now() - ts) / 1000)
    if (sec < 60) return `${sec}s ago`
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
    return `${Math.floor(sec / 3600)}h ago`
  }

  const highlightCount = highlightIds.size

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      onClick={onClose}
      style={neuralModalBackdropStyle}
    >
      <div
        className="relative rounded-lg border font-mono"
        style={{
          width: Math.min(720, window.innerWidth - 40),
          maxHeight: window.innerHeight - 60,
          ...neuralModalPanelStyle,
          borderColor: `${meta.color}44`,
        }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded text-white/45 hover:text-white/75 hover:bg-white/[0.08] transition-colors text-lg z-10"
        >
          ×
        </button>

        <div className="p-6 overflow-y-auto" style={{ maxHeight: window.innerHeight - 60 }}>
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-xl"
              style={{ background: meta.accent, color: meta.color }}
            >
              {alert.type === 'queue_risk' ? '⏱' : alert.type === 'low_engagement' ? '◇' : alert.type === 'bottleneck' ? '⬡' : alert.type === 'sku_best' ? '★' : alert.type === 'sku_worst' ? '▼' : '◈'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-bold tracking-wider" style={{ color: meta.color }}>
                  {alert.title}
                </span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider"
                  style={{ background: sev.bg, color: sev.text }}
                >
                  {alert.severity}
                </span>
              </div>
              <div className="text-[10px] text-white/55 mt-0.5">
                {meta.label} · {timeAgo(alert.firstSeen)}
              </div>
            </div>
          </div>

          {(alert.type === 'sku_best' || alert.type === 'sku_worst') && (
            <div className="rounded-md p-4 mb-4 flex gap-4" style={{ background: NEURAL_MODAL_SECTION_BG, border: '1px solid rgba(255,255,255,0.10)' }}>
              <div className="w-20 h-20 rounded-lg border border-white/10 bg-white/[0.04] overflow-hidden flex-shrink-0 flex items-center justify-center">
                {alert.imageUrl ? (
                  <img src={alert.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[9px] text-white/30 text-center px-1">No image</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] text-white/95 font-semibold leading-snug mb-1">{alert.skuName}</div>
                {alert.skuCode && <div className="text-[11px] text-amber-400/90 font-mono mb-1">{alert.skuCode}</div>}
                {alert.brand && <div className="text-[10px] text-white/50 mb-2">{alert.brand}</div>}
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded px-2 py-1.5 bg-white/[0.04]">
                    <div className="text-white/40 uppercase tracking-wider text-[8px]">Attraction</div>
                    <div className="text-white/90">{((alert.attractionIndex ?? 0) * 100).toFixed(0)}%</div>
                  </div>
                  <div className="rounded px-2 py-1.5 bg-white/[0.04]">
                    <div className="text-white/40 uppercase tracking-wider text-[8px]">Attention</div>
                    <div className="text-white/90">{(alert.attentionIndex ?? 0).toFixed(1)}</div>
                  </div>
                  <div className="rounded px-2 py-1.5 bg-white/[0.04]">
                    <div className="text-white/40 uppercase tracking-wider text-[8px]">Viewers</div>
                    <div className="text-white/90">{alert.viewers ?? 0} / {alert.audience ?? 0}</div>
                  </div>
                  <div className="rounded px-2 py-1.5 bg-white/[0.04]">
                    <div className="text-white/40 uppercase tracking-wider text-[8px]">Slot</div>
                    <div className="text-white/90">
                      {alert.shelfName || 'Shelf'}
                      {alert.levelIndex != null && alert.slotIndex != null && (
                        <> · L{alert.levelIndex + 1} S{alert.slotIndex + 1}</>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-md p-4 mb-4" style={{ background: NEURAL_MODAL_SECTION_BG, borderLeft: `3px solid ${meta.color}55` }}>
            <div className="text-[13px] text-white/90 leading-relaxed">
              {alert.message}
            </div>
          </div>

          {alert.categories && alert.categories.length > 0 && (
            <div className="rounded-md p-3 mb-4" style={{ background: NEURAL_MODAL_SECTION_BG, border: '1px solid rgba(255,255,255,0.10)' }}>
              <div className="text-[9px] text-white/50 uppercase tracking-wider mb-2">
                Affected Product Categories{alert.shelfName ? ` · ${alert.shelfName}` : ''}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {alert.categories.map(cat => (
                  <span
                    key={cat}
                    className="text-[11px] px-2.5 py-1 rounded-md font-medium"
                    style={{ background: `${meta.color}18`, color: `${meta.color}cc`, border: `1px solid ${meta.color}22` }}
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="text-[11px] text-white/60 leading-relaxed mb-4">
            {meta.description}
          </div>

          <div className="flex items-center gap-2 mb-5">
            <span className="text-[11px] text-white/45">RECOMMENDED →</span>
            <span className="text-[12px] italic" style={{ color: `${meta.color}cc` }}>
              {alert.action}
            </span>
          </div>

          {hasMapData && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[9px] text-white/45 uppercase tracking-wider">Zone Map</div>
                <div className="text-[8px] text-white/40">
                  {objects.length} fixtures · {mapRegions.length} zones
                  {highlightCount > 0 ? ` · ${highlightCount} highlighted` : ''}
                </div>
              </div>
              <div
                className="rounded-md border overflow-hidden"
                style={{ background: 'rgba(12, 24, 36, 0.95)', borderColor: 'rgba(34, 211, 238, 0.15)' }}
              >
                <FloorPlanMiniMap
                  objects={objects}
                  regions={mapRegions}
                  venueSize={venue ? { width: venue.width, depth: venue.depth } : undefined}
                  mode="alert"
                  highlightIds={highlightIds}
                  pulse={pulseRef.current}
                  height={320}
                />
              </div>
              <div className="flex items-center gap-4 mt-2 text-[8px] text-white/50">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm border border-cyan-200/70 bg-cyan-400/25" />
                  DWG fixtures
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm border border-violet-300/60 bg-violet-400/20" />
                  Zones
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm border border-red-400 bg-red-400/40" />
                  Alert ROI (pulsing)
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
