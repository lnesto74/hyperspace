import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Film } from 'lucide-react'
import { INTENT_AXIS_NAMES, type IntentAxes, type ProfitRadarInsight } from '../../../types'
import { TYPE_CONFIG, SEVERITY_BADGE, buildBenchmarkBars } from '../insightConfig'
import ZoneEventReplay from './ZoneEventReplay'
import TrajectoryMicroscope from './TrajectoryMicroscope'
import LiveFingerprintPanel from './LiveFingerprintPanel'
import ImpactSimulator from './ImpactSimulator'
import { useProfitRadar } from '../../../context/ProfitRadarContext'

interface DiscoveryTheaterProps {
  insight: ProfitRadarInsight
  venueId: string
  selectedRoiId: string | null
  zoneName: string
  onExitTheater: () => void
  onPrevInsight: () => void
  onNextInsight: () => void
  insightIndex: number
  insightCount: number
  onShowEconomics: () => void
}

export default function DiscoveryTheater({
  insight,
  venueId,
  selectedRoiId,
  zoneName,
  onExitTheater,
  onPrevInsight,
  onNextInsight,
  insightIndex,
  insightCount,
  onShowEconomics,
}: DiscoveryTheaterProps) {
  const { zoneField } = useProfitRadar()
  const [focusTrackKey, setFocusTrackKey] = useState<string | null>(null)
  const [sessionLeak, setSessionLeak] = useState(0)
  const leakTimerRef = useRef<number | null>(null)

  const cfg = TYPE_CONFIG[insight.type] || TYPE_CONFIG.lost_sales
  const storeAvg = useStoreAvg(zoneField)
  const barItems = buildBenchmarkBars(insight, storeAvg)

  useEffect(() => {
    setFocusTrackKey(null)
    setSessionLeak(0)
  }, [insight.id])

  useEffect(() => {
    leakTimerRef.current = window.setInterval(() => {
      const zf = selectedRoiId ? zoneField.find(z => z.roiId === selectedRoiId) : null
      if (!zf || zf.trackCount === 0) return
      const engage = zf.means.engagement_with_POI ?? 0
      const avoid = zf.means.avoidance ?? 0
      if (engage < 0.35 || avoid > 0.4) {
        const tick = (insight.impact.min + insight.impact.max) / 2 / 120
        setSessionLeak(v => v + tick)
      }
    }, 2000)
    return () => {
      if (leakTimerRef.current) window.clearInterval(leakTimerRef.current)
    }
  }, [insight.id, insight.impact, selectedRoiId, zoneField])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExitTheater()
      if (e.key === 'ArrowLeft') onPrevInsight()
      if (e.key === 'ArrowRight') onNextInsight()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExitTheater, onPrevInsight, onNextInsight])

  const cur = insight.impact.currency === 'EUR' ? '€' : insight.impact.currency

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-gray-950">
      <div className="h-11 shrink-0 border-b border-gray-700/80 flex items-center justify-between px-4 bg-gray-900/90">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onExitTheater} className="text-xs text-gray-400 hover:text-white shrink-0">
            ← Analysis
          </button>
          <div className="w-px h-4 bg-gray-700 shrink-0" />
          <Film className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="text-xs font-medium text-indigo-300 shrink-0">Discovery Theater</span>
          <div className="w-px h-4 bg-gray-700 shrink-0 hidden sm:block" />
          <div className="min-w-0 hidden sm:block">
            <div className="flex items-center gap-1.5">
              <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded ${SEVERITY_BADGE[insight.severity]}`}>
                {insight.severity}
              </span>
              <span className={`text-[9px] uppercase ${cfg.color}`}>{cfg.label}</span>
            </div>
            <h2 className="text-sm font-semibold text-white truncate">{insight.title}</h2>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onPrevInsight}
            disabled={insightCount <= 1}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700/50 disabled:opacity-30"
            title="Previous insight"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[10px] text-gray-500 tabular-nums min-w-[3rem] text-center">
            {insightIndex + 1} / {insightCount}
          </span>
          <button
            onClick={onNextInsight}
            disabled={insightCount <= 1}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700/50 disabled:opacity-30"
            title="Next insight"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-[62] flex flex-col min-w-0 min-h-0 border-r border-gray-700/60">
          <div className="flex-1 min-h-0 flex flex-col">
            <ZoneEventReplay
              venueId={venueId}
              roiId={selectedRoiId}
              zoneName={zoneName}
              variant="stage"
              dimOutside
              focusTrackKey={focusTrackKey}
              onTrackSelect={setFocusTrackKey}
            />
          </div>
          <TrajectoryMicroscope
            venueId={venueId}
            roiId={selectedRoiId}
            zoneName={zoneName}
            focusTrackKey={focusTrackKey}
          />
        </div>

        <div className="flex-[38] flex flex-col min-w-0 min-h-0 max-w-md">
          <LiveFingerprintPanel
            zoneField={zoneField}
            roiId={selectedRoiId}
            color={cfg.hex}
            barItems={barItems}
          />

          <div className="shrink-0 overflow-y-auto">
            <div className="px-4 py-2 border-b border-gray-700/50 bg-emerald-950/20">
              <div className="text-[10px] uppercase tracking-wide text-emerald-300/70">Hidden value discovered</div>
              <div className="text-2xl font-bold text-emerald-400 tabular-nums leading-tight mt-0.5">
                {cur}{insight.impact.min.toLocaleString()}–{insight.impact.max.toLocaleString()}
                <span className="text-xs font-normal text-emerald-500/70 ml-1">/ day</span>
              </div>
              {sessionLeak > 0 && (
                <p className="text-[10px] text-amber-400/90 mt-1 tabular-nums">
                  Session leak estimate: +{cur}{sessionLeak.toFixed(2)}
                </p>
              )}
              <button onClick={onShowEconomics} className="text-[10px] text-gray-500 hover:text-emerald-300 mt-1">
                {(insight.confidence * 100).toFixed(0)}% confidence · set economics →
              </button>
            </div>

            <ImpactSimulator
              insight={insight}
              venueId={venueId}
              roiId={selectedRoiId}
              zoneName={zoneName}
              variant="theater"
            />

            <div className="px-4 pb-4">
              <div className="rounded-lg border border-gray-700/60 bg-gray-800/40 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Suggested fix</div>
                <p className="text-xs text-gray-300 leading-relaxed">{insight.suggestedFix}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function useStoreAvg(zoneField: ReturnType<typeof useProfitRadar>['zoneField']) {
  return useMemo(() => {
    if (zoneField.length === 0) return null
    const avg = {} as IntentAxes
    for (const axis of INTENT_AXIS_NAMES) {
      avg[axis] = zoneField.reduce((s, z) => s + (z.means[axis] ?? 0), 0) / zoneField.length
    }
    return avg
  }, [zoneField])
}
