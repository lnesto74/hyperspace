import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Radio } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { useTracking } from '../../context/TrackingContext'
import { useProfitRadar } from '../../context/ProfitRadarContext'
import WireframeFloorMap from './WireframeFloorMap'
import PulseStoryPanel from './PulseStoryPanel'
import PulseInsightQueue from './PulseInsightQueue'
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

const ROTATE_MS = 14_000

export default function HyperspacePulseOverlay({ onOpenTelegram }: HyperspacePulseOverlayProps) {
  const { venue } = useVenue()
  const { tracks, mqttReplayActive, storyReplayActive } = useTracking()
  const { insights, zoneField, clusters, trackAxes } = useProfitRadar()

  const ranked = useMemo(() => rankInsights(insights), [insights])
  const [activeInsight, setActiveInsight] = useState<ProfitRadarInsight | null>(null)
  const [manualLockUntil, setManualLockUntil] = useState(0)

  useEffect(() => {
    if (ranked.length === 0) {
      setActiveInsight(null)
      return
    }
    setActiveInsight(prev => {
      if (prev && ranked.some(i => i.id === prev.id)) return prev
      return ranked[0]
    })
  }, [ranked])

  useEffect(() => {
    if (ranked.length <= 1) return
    const iv = window.setInterval(() => {
      if (Date.now() < manualLockUntil) return
      setActiveInsight(prev => {
        if (!prev || ranked.length === 0) return ranked[0] ?? null
        const idx = ranked.findIndex(i => i.id === prev.id)
        return ranked[(idx + 1) % ranked.length]
      })
    }, ROTATE_MS)
    return () => window.clearInterval(iv)
  }, [ranked, manualLockUntil])

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

  const ticker = ranked.slice(0, 5).map(i => i.title.split(' — ')[0]).join('   ·   ')

  const semanticsTracks = trackAxes?.length ?? 0

  if (!venue?.id) return null

  return (
    <div className="fixed inset-0 bottom-12 z-40 flex flex-col bg-[#050810]">
      <header className="shrink-0 border-b border-gray-800/80">
        <div className="flex items-center justify-between px-5 py-2.5">
          <div className="flex items-center gap-3">
            <Activity className="w-4 h-4 text-cyan-400/90" />
            <span className="text-sm font-medium tracking-wide text-gray-100">hyperspace</span>
            <span className="text-[9px] text-gray-600 uppercase tracking-[0.3em]">pulse</span>
          </div>
          <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${isReplay ? 'text-amber-400/90 bg-amber-500/10' : 'text-green-400/90 bg-green-500/10'}`}>
            <Radio className="w-3 h-3 inline mr-1 -mt-px" />
            {isReplay ? 'replay' : 'live'}
          </span>
        </div>

        <div className="px-5 pb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-gray-500">
          <span><span className="text-cyan-500/90">{tracks.size}</span> kinetics</span>
          <span><span className="text-cyan-500/90">{semanticsTracks || clusters.length}</span> intent vectors</span>
          <span><span className="text-cyan-500/90">{clusters.length}</span> patterns</span>
          <span><span className="text-cyan-500/90">{ranked.length}</span> value signals</span>
          <span className="text-gray-400">
            <span className="text-gray-200">{cur}{Math.round(latent)}</span>/day latent
          </span>
        </div>

        {ticker && (
          <div className="overflow-hidden border-t border-gray-800/50 py-1">
            <p className="text-[9px] text-gray-600 font-mono whitespace-nowrap animate-pulse px-5 truncate">
              {ticker}
            </p>
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 relative">
          <WireframeFloorMap
            venueId={venue.id}
            focusRoiId={focusRoiId}
            valueByRoiId={roiValues}
            dimOutside={!!focusRoiId}
            maxDots={48}
            trailMaxLen={10}
            onZoneClick={selectZone}
          />
          <div className="absolute bottom-3 left-3 text-[8px] font-mono text-gray-600 pointer-events-none space-y-0.5">
            <p>hatch density → €/m² at risk</p>
            <p>click zone · auto-rotates every {ROTATE_MS / 1000}s</p>
          </div>
        </div>
        <PulseInsightQueue
          insights={ranked}
          activeId={activeInsight?.id ?? null}
          onSelect={selectInsight}
        />
      </div>

      {activeInsight ? (
        <PulseStoryPanel
          insight={activeInsight}
          venueId={venue.id}
          zoneField={zoneEntry}
          liveTrackCount={tracks.size}
          onOpenTelegram={onOpenTelegram}
        />
      ) : (
        <div className="shrink-0 border-t border-gray-800/80 px-5 py-4 text-[10px] font-mono text-gray-600">
          sensing floor · building behavioral field · value signals pending
        </div>
      )}
    </div>
  )
}
