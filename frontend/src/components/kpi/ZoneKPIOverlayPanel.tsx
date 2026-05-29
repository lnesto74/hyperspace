import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Search, BarChart3, ArrowDownAZ, TrendingUp, Users } from 'lucide-react'
import { useRoi } from '../../context/RoiContext'
import { useVenue } from '../../context/VenueContext'
import ZoneKPIIndicator from './ZoneKPIIndicator'
import { API_BASE } from '../../config/api'
import { fetchRoiCategoryLabel, resolveRoiCategorySync } from '../../utils/roiCategoryUtils'

type ZoneCategory = 'queue' | 'shelf' | 'entrance' | 'cashier' | 'custom'
type SortMode = 'traffic' | 'peak' | 'name'

const CATEGORY_CONFIG: Record<ZoneCategory, { label: string; color: string }> = {
  queue: { label: 'Queue', color: '#f59e0b' },
  shelf: { label: 'Shelf', color: '#22c55e' },
  entrance: { label: 'Entrance', color: '#3b82f6' },
  cashier: { label: 'Cashier', color: '#8b5cf6' },
  custom: { label: 'Custom', color: '#6b7280' },
}

const CHECKOUT_CATS = new Set<ZoneCategory>(['queue', 'cashier'])

function getZoneCategory(name: string): ZoneCategory {
  const lower = name.toLowerCase()
  if (lower.includes('queue')) return 'queue'
  if (lower.includes('shelf') || lower.includes('engagement')) return 'shelf'
  if (lower.includes('entrance') || lower.includes('entry') || lower.includes('exit')) return 'entrance'
  if (lower.includes('cashier') || lower.includes('checkout')) return 'cashier'
  return 'custom'
}

export default function ZoneKPIOverlayPanel() {
  const { regions, openKPIPopup, hoveredRoiId, setHoveredRoiId } = useRoi()
  const { objects } = useVenue()

  const [activeFilters, setActiveFilters] = useState<Set<ZoneCategory>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('traffic')
  const [pinnedRoiId, setPinnedRoiId] = useState<string | null>(null)
  const pinnedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listContainerRef = useRef<HTMLDivElement>(null)
  const hoverFromListRef = useRef(false)
  const isListScrollingRef = useRef(false)
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const liveMetricsRef = useRef<Map<string, { currentOccupancy: number; totalEntries: number; peakOccupancy: number }>>(new Map())
  const [sortTick, setSortTick] = useState(0)

  const categoryCacheRef = useRef<Map<string, string>>(new Map())
  const [categoryTick, setCategoryTick] = useState(0)

  const handleMetricsUpdate = useCallback((roiId: string, metrics: { currentOccupancy: number; totalEntries: number; peakOccupancy?: number }) => {
    const prev = liveMetricsRef.current.get(roiId)
    liveMetricsRef.current.set(roiId, {
      currentOccupancy: metrics.currentOccupancy,
      totalEntries: metrics.totalEntries,
      peakOccupancy: metrics.peakOccupancy ?? prev?.peakOccupancy ?? metrics.currentOccupancy,
    })
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      if (!isListScrollingRef.current) setSortTick(t => t + 1)
    }, 2000)
    return () => clearInterval(id)
  }, [])

  // Track manual list scrolling so hover/scroll-into-view does not fight the user
  useEffect(() => {
    const el = listContainerRef.current
    if (!el) return

    const markScrolling = () => {
      isListScrollingRef.current = true
      if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current)
      scrollIdleTimerRef.current = setTimeout(() => {
        isListScrollingRef.current = false
      }, 450)
    }

    el.addEventListener('scroll', markScrolling, { passive: true })
    el.addEventListener('wheel', markScrolling, { passive: true })
    el.addEventListener('touchmove', markScrolling, { passive: true })

    return () => {
      el.removeEventListener('scroll', markScrolling)
      el.removeEventListener('wheel', markScrolling)
      el.removeEventListener('touchmove', markScrolling)
      if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current)
    }
  }, [])

  const scrollCardIntoViewIfNeeded = useCallback((roiId: string) => {
    const container = listContainerRef.current
    if (!container) return
    const el = container.querySelector(`[data-roi-id="${roiId}"]`) as HTMLElement | null
    if (!el) return

    const containerRect = container.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const visible = elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom
    if (!visible) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [])

  // Map hover only → pin card to top + scroll into view (not while user is scrolling the list)
  useEffect(() => {
    if (hoverFromListRef.current) {
      hoverFromListRef.current = false
      return
    }

    if (!hoveredRoiId || isListScrollingRef.current) return

    if (pinnedTimeoutRef.current) clearTimeout(pinnedTimeoutRef.current)
    setPinnedRoiId(hoveredRoiId)

    requestAnimationFrame(() => scrollCardIntoViewIfNeeded(hoveredRoiId))

    pinnedTimeoutRef.current = setTimeout(() => setPinnedRoiId(null), 12000)

    return () => {
      if (pinnedTimeoutRef.current) clearTimeout(pinnedTimeoutRef.current)
    }
  }, [hoveredRoiId, scrollCardIntoViewIfNeeded])

  const baseRegions = useMemo(
    () => regions.filter(roi => roi.name !== 'Zone 1' && roi.name !== 'LiDAR Coverage'),
    [regions],
  )

  useEffect(() => {
    baseRegions.forEach(roi => {
      const sync = resolveRoiCategorySync(roi, objects)
      if (sync) {
        categoryCacheRef.current.set(roi.id, sync)
        return
      }
      if (categoryCacheRef.current.has(roi.id)) return
      void fetchRoiCategoryLabel(roi.id, API_BASE).then(label => {
        if (!label) return
        categoryCacheRef.current.set(roi.id, label)
        setCategoryTick(t => t + 1)
      }).catch(() => {})
    })
  }, [baseRegions, objects])

  const roiCategories = useMemo(() => {
    const map = new Map<string, string>()
    baseRegions.forEach(roi => {
      const label = categoryCacheRef.current.get(roi.id) ?? resolveRoiCategorySync(roi, objects)
      if (label) map.set(roi.id, label)
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRegions, objects, categoryTick])

  const roiDisplayNames = useMemo(() => {
    const nameMap = new Map<string, string[]>()
    const displayNames = new Map<string, string>()

    regions.forEach(roi => {
      const ids = nameMap.get(roi.name) || []
      ids.push(roi.id)
      nameMap.set(roi.name, ids)
    })

    regions.forEach(roi => {
      const ids = nameMap.get(roi.name) || []
      if (ids.length > 1) {
        const centroidZ = roi.vertices.length > 0
          ? roi.vertices.reduce((sum, v) => sum + v.z, 0) / roi.vertices.length
          : 0
        displayNames.set(roi.id, `${roi.name} @Z${Math.round(centroidZ)}`)
      } else {
        displayNames.set(roi.id, roi.name)
      }
    })

    return displayNames
  }, [regions])

  const availableCategories = useMemo(() => {
    const cats = new Set<ZoneCategory>()
    baseRegions.forEach(roi => cats.add(getZoneCategory(roi.name)))
    return Array.from(cats)
  }, [baseRegions])

  const sortRegions = useCallback((list: typeof baseRegions) => {
    const sorted = [...list]
    sorted.sort((a, b) => {
      const ma = liveMetricsRef.current.get(a.id)
      const mb = liveMetricsRef.current.get(b.id)
      if (sortMode === 'name') {
        return (roiDisplayNames.get(a.id) || a.name).localeCompare(roiDisplayNames.get(b.id) || b.name)
      }
      if (sortMode === 'peak') {
        return (mb?.peakOccupancy ?? 0) - (ma?.peakOccupancy ?? 0)
      }
      const occDiff = (mb?.currentOccupancy ?? 0) - (ma?.currentOccupancy ?? 0)
      if (occDiff !== 0) return occDiff
      return (mb?.totalEntries ?? 0) - (ma?.totalEntries ?? 0)
    })
    if (pinnedRoiId) {
      const idx = sorted.findIndex(r => r.id === pinnedRoiId)
      if (idx > 0) {
        const pinned = sorted[idx]
        return [pinned, ...sorted.slice(0, idx), ...sorted.slice(idx + 1)]
      }
    }
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortMode, pinnedRoiId, roiDisplayNames, sortTick])

  const filteredRegions = useMemo(() => {
    let result = activeFilters.size === 0
      ? [...baseRegions]
      : baseRegions.filter(roi => activeFilters.has(getZoneCategory(roi.name)))

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter(roi => {
        const name = (roiDisplayNames.get(roi.id) || roi.name).toLowerCase()
        const cat = (roiCategories.get(roi.id) || '').toLowerCase()
        return name.includes(q) || cat.includes(q)
      })
    }

    return sortRegions(result)
  }, [baseRegions, activeFilters, searchQuery, roiDisplayNames, roiCategories, sortRegions])

  const pinnedRegion = useMemo(() => {
    if (!pinnedRoiId) return null
    return filteredRegions.find(r => r.id === pinnedRoiId)
      ?? baseRegions.find(r => r.id === pinnedRoiId)
      ?? null
  }, [filteredRegions, pinnedRoiId, baseRegions])

  const regionsWithoutPinned = useMemo(
    () => (pinnedRegion ? filteredRegions.filter(r => r.id !== pinnedRegion.id) : filteredRegions),
    [filteredRegions, pinnedRegion],
  )

  const checkoutRegions = useMemo(
    () => regionsWithoutPinned.filter(r => CHECKOUT_CATS.has(getZoneCategory(r.name))),
    [regionsWithoutPinned],
  )

  const floorRegions = useMemo(
    () => regionsWithoutPinned.filter(r => !CHECKOUT_CATS.has(getZoneCategory(r.name))),
    [regionsWithoutPinned],
  )

  const toggleFilter = (cat: ZoneCategory) => {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const handleZoneClick = (roiId: string) => openKPIPopup(roiId)

  const handleCardHover = (roiId: string | null) => {
    if (isListScrollingRef.current) return
    hoverFromListRef.current = true
    setHoveredRoiId(roiId)
  }

  const renderCard = (roi: typeof baseRegions[0]) => (
    <div key={roi.id} data-roi-id={roi.id}>
      <ZoneKPIIndicator
        roiId={roi.id}
        roiName={roiDisplayNames.get(roi.id) || roi.name}
        roiColor={roi.color}
        categoryLabel={roiCategories.get(roi.id) ?? null}
        highlighted={roi.id === hoveredRoiId}
        focused={roi.id === pinnedRoiId}
        compact
        onMetricsUpdate={handleMetricsUpdate}
        onClick={() => handleZoneClick(roi.id)}
        onHover={handleCardHover}
      />
    </div>
  )

  return (
    <aside className="w-[360px] shrink-0 flex flex-col h-full border-r border-white/10 bg-gray-950/30 backdrop-blur-xl z-10">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-medium text-white">Live zone KPIs</span>
          <span className="text-[10px] text-gray-500 ml-auto tabular-nums">{filteredRegions.length} zones</span>
        </div>

        <div className="relative mb-2">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search zone or category…"
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-black/30 border border-white/10 text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500/40"
          />
        </div>

        <div className="flex items-center gap-1">
          {([
            { id: 'traffic' as const, icon: Users, label: 'Traffic' },
            { id: 'peak' as const, icon: TrendingUp, label: 'Peak' },
            { id: 'name' as const, icon: ArrowDownAZ, label: 'A–Z' },
          ]).map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSortMode(opt.id)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
                sortMode === opt.id ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <opt.icon className="w-3 h-3" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Category chips — horizontal wrap */}
      {availableCategories.length > 1 && (
        <div className="px-3 py-2 flex flex-wrap gap-1 border-b border-white/5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveFilters(new Set())}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
              activeFilters.size === 0 ? 'bg-white/15 text-white' : 'bg-black/20 text-gray-500 hover:text-gray-300'
            }`}
          >
            All
          </button>
          {availableCategories.map(cat => {
            const config = CATEGORY_CONFIG[cat]
            const isActive = activeFilters.has(cat)
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleFilter(cat)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium flex items-center gap-1 transition-colors ${
                  isActive ? 'bg-white/15 text-white' : 'bg-black/20 text-gray-500 hover:text-gray-300'
                }`}
                style={{ border: `1px solid ${isActive ? config.color : 'rgba(255,255,255,0.08)'}` }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: config.color }} />
                {config.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Card grid */}
      <div ref={listContainerRef} className="flex-1 overflow-y-auto p-2 min-h-0">
        {pinnedRegion && (
          <section className="mb-2 rounded-lg p-1.5 bg-white/[0.02]">
            <h3 className="text-[10px] uppercase tracking-wide text-white/40 font-medium mb-1 px-0.5 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-amber-400/80 animate-pulse" />
              Focused zone
            </h3>
            {renderCard(pinnedRegion)}
          </section>
        )}

        {checkoutRegions.length > 0 && (
          <section className="mb-3">
            <h3 className="text-[10px] uppercase tracking-wide text-amber-400/80 font-medium mb-1.5 px-0.5">
              Checkout
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {checkoutRegions.map(renderCard)}
            </div>
          </section>
        )}

        {floorRegions.length > 0 && (
          <section>
            {checkoutRegions.length > 0 && (
              <h3 className="text-[10px] uppercase tracking-wide text-gray-500 font-medium mb-1.5 px-0.5">
                Floor zones
              </h3>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              {floorRegions.map(renderCard)}
            </div>
          </section>
        )}

        {filteredRegions.length === 0 && (
          <div className="text-gray-500 text-xs text-center py-8">
            {searchQuery || activeFilters.size > 0 ? 'No zones match filters' : 'No zones defined'}
          </div>
        )}
      </div>
    </aside>
  )
}
