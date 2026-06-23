import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Radio, LayoutDashboard, Zap } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { useTracking } from '../../context/TrackingContext'
import { useProfitRadar } from '../../context/ProfitRadarContext'
import WireframeFloorMap from './WireframeFloorMap'
import PulseStoryPanel from './PulseStoryPanel'
import PulseInsightQueue from './PulseInsightQueue'
import PulseValueLedger from './PulseValueLedger'
import PulseExecutivePanel from './PulseExecutivePanel'
import {
  insightRoiId,
  latentDailyTotal,
  rankInsights,
  valueByRoi,
} from './pulseUtils'
import type { ProfitRadarInsight } from '../../types'

interface HyperspacePulseOverlayProps {
  onOpenTelegram?: () => void
}

type PulseMode = 'ops' | 'executive'

const ROTATE_MS = 14_000

export default function HyperspacePulseOverlay({ onOpenTelegram }: HyperspacePulseOverlayProps) {
  const { venue } = useVenue()
  const { tracks, mqttReplayActive, storyReplayActive } = useTracking()
  const { insights, zoneField, clusters, trackAxes } = useProfitRadar()

  const [pulseMode, setPulseMode] = useState<PulseMode>('ops')

  const ranked = useMemo(() => rankInsights(insights), [insights])
  const [activeInsight, setActiveInsight] = useState<ProfitRadarInsight | null>(null)
  const [manualLockUntil, setManualLockUntil] = useState(0)
  const [ledgerRefresh, setLedgerRefresh] = useState(0)

  const bumpLedger = useCallback(() => setLedgerRefresh(k => k + 1), [])

  useEffect(() => {
    if (pulseMode !== 'ops') return
    if (ranked.length === 0) {
      setActiveInsight(null)
      return
    }
    setActiveInsight(prev => {
      if (prev && ranked.some(i => i.id === prev.id)) return prev
      return ranked[0]
    })
  }, [ranked, pulseMode])

  useEffect(() => {
    if (pulseMode !== 'ops' || ranked.length <= 1) return
    const iv = window.setInterval(() => {
      if (Date.now() < manualLockUntil) return
      setActiveInsight(prev => {
        if (!prev || ranked.length === 0) return ranked[0] ?? null
        const idx = ranked.findIndex(i => i.id === prev.id)
        return ranked[(idx + 1) % ranked.length]
      })
    }, ROTATE_MS)
    return () => window.clearInterval(iv)
  }, [ranked, manualLockUntil, pulseMode])

  const selectInsight = useCallback((ins: ProfitRadarInsight) => {
    setActiveInsight(ins)
    setManualLockUntil(Date.now() + 45_000)
  }, [])

  const selectZone = useCallback((roiId: string) => {
    const match = ranked.find(i => insightRoiId(i) === roiId)
    if (match) selectInsight(match)
  }, [ranked, selectInsight])

  const focusRoiId = activeInsight ? insightRoiId(activeInsight) : null
  const roiValues = useMemo(() => valueByRoi(ranked), [ranked])
  const zoneEntry = focusRoiId ? zoneField.find(z => z.roiId === focusRoiId) ?? null : null

  const isReplay = mqttReplayActive || storyReplayActive
  const latent = latentDailyTotal(ranked)
  const cur = ranked[0]?.impact.currency === 'EUR' ? '€' : (ranked[0]?.impact.currency || '€')
  const semanticsTracks = trackAxes?.length ?? 0

  if (!venue?.id) return null

  return (
    <div className="fixed inset-0 bottom-12 z-40 flex flex-col bg-[#050810]">
      <header className="shrink-0 h-9 flex items-center justify-between px-4 border-b border-gray-800/80 bg-[#050810]">
        <div className="flex items-center gap-2.5 min-w-0">
          <Activity className="w-3.5 h-3.5 text-cyan-400/90 shrink-0" />
          <span className="text-xs font-medium tracking-wide text-gray-100">hyperspace</span>
          <span className="text-[8px] text-gray-600 uppercase tracking-[0.25em]">pulse</span>
          {pulseMode === 'ops' && (
            <span className="text-[9px] font-mono text-gray-600 truncate hidden sm:inline">
              · {tracks.size} kinetics · {semanticsTracks || clusters.length} intent · {ranked.length} signals
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex bg-gray-800/80 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setPulseMode('ops')}
              title="Ops dispatch"
              className={`flex items-center gap-1 px-2 py-0.5 text-[9px] rounded ${pulseMode === 'ops' ? 'bg-cyan-600/80 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            >
              <Zap className="w-2.5 h-2.5" /> Ops
            </button>
            <button
              type="button"
              onClick={() => setPulseMode('executive')}
              title="Store director KPIs"
              className={`flex items-center gap-1 px-2 py-0.5 text-[9px] rounded ${pulseMode === 'executive' ? 'bg-indigo-600/80 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            >
              <LayoutDashboard className="w-2.5 h-2.5" /> Director
            </button>
          </div>
          <span className={`text-[8px] font-mono px-2 py-0.5 rounded-full ${isReplay ? 'text-amber-400/90 bg-amber-500/10' : 'text-green-400/90 bg-green-500/10'}`}>
            <Radio className="w-2.5 h-2.5 inline mr-1 -mt-px" />
            {isReplay ? 'replay' : 'live'}
          </span>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 min-h-0 relative bg-[#040608]">
          <WireframeFloorMap
            venueId={venue.id}
            focusRoiId={pulseMode === 'ops' ? focusRoiId : null}
            valueByRoiId={pulseMode === 'ops' ? roiValues : undefined}
            dimOutside={pulseMode === 'ops' && !!focusRoiId}
            maxDots={48}
            trailMaxLen={10}
            onZoneClick={pulseMode === 'ops' ? selectZone : undefined}
            className="absolute inset-0"
          />
          <div className="absolute bottom-2 left-2 text-[8px] font-mono text-gray-600 pointer-events-none">
            {pulseMode === 'ops' ? 'hatch → €/m² · click zone' : 'director mode · live journey KPIs'}
          </div>
        </div>

        <aside className="hidden md:flex w-[min(100%,300px)] shrink-0 min-h-0 flex-col border-l border-gray-800/80 bg-[#060a12]/95">
          {pulseMode === 'executive' ? (
            <PulseExecutivePanel venueId={venue.id} className="flex-1 min-h-0" />
          ) : (
            <>
              <PulseValueLedger
                venueId={venue.id}
                liveUnveiledDaily={latent}
                currency={cur}
                refreshKey={ledgerRefresh}
                layout="sidebar"
              />
              <PulseInsightQueue
                insights={ranked}
                activeId={activeInsight?.id ?? null}
                onSelect={selectInsight}
                className="shrink-0 max-h-[38%] border-t border-gray-800/60"
              />
            </>
          )}
        </aside>
      </div>

      {pulseMode === 'ops' && activeInsight ? (
        <PulseStoryPanel
          insight={activeInsight}
          venueId={venue.id}
          zoneField={zoneEntry}
          liveTrackCount={tracks.size}
          onOpenTelegram={onOpenTelegram}
          onDeployed={bumpLedger}
          compact
        />
      ) : pulseMode === 'ops' ? (
        <div className="shrink-0 border-t border-gray-800/80 px-4 py-2 text-[10px] font-mono text-gray-600">
          sensing floor · value signals pending
        </div>
      ) : null}
    </div>
  )
}
