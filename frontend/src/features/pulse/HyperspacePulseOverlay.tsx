import { useMemo } from 'react'
import { Activity, ArrowUpRight, Radio, Send } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { useTracking } from '../../context/TrackingContext'
import { useProfitRadar } from '../../context/ProfitRadarContext'
import { useViewMode } from '../../App'
import { TYPE_CONFIG } from '../profitRadar/insightConfig'
import WireframeFloorMap from './WireframeFloorMap'
import type { ProfitRadarInsight } from '../../types'

interface HyperspacePulseOverlayProps {
  onOpenTelegram?: () => void
}

function pickTopInsight(insights: ProfitRadarInsight[]): ProfitRadarInsight | null {
  if (insights.length === 0) return null
  return [...insights].sort((a, b) => {
    const scoreA = a.impact.max * a.confidence
    const scoreB = b.impact.max * b.confidence
    return scoreB - scoreA
  })[0]
}

function shortZoneName(title: string): string {
  const dash = title.indexOf(' — ')
  if (dash > 0) return title.slice(0, dash).trim()
  if (title.length > 42) return `${title.slice(0, 39)}…`
  return title
}

function patternLabel(insight: ProfitRadarInsight): string {
  const lever = insight.economics?.recommendedLeverLabel
  if (lever) return lever.toLowerCase()
  return (TYPE_CONFIG[insight.type]?.label || insight.type).toLowerCase()
}

export default function HyperspacePulseOverlay({ onOpenTelegram }: HyperspacePulseOverlayProps) {
  const { venue } = useVenue()
  const { mqttReplayActive, storyReplayActive } = useTracking()
  const { insights, setSelectedInsight } = useProfitRadar()
  const { setMode } = useViewMode()

  const topInsight = useMemo(() => pickTopInsight(insights), [insights])
  const focusRoiId = (topInsight?.dataBasis?.roiId as string | undefined) ?? null
  const isReplay = mqttReplayActive || storyReplayActive

  const openProfitRadar = (insight: ProfitRadarInsight | null) => {
    if (insight) setSelectedInsight(insight)
    setMode('profitRadar')
  }

  if (!venue?.id) return null

  return (
    <div className="fixed inset-0 bottom-12 z-40 flex flex-col bg-[#050810]">
      <header className="flex items-center justify-between px-5 py-3 border-b border-gray-800/80 shrink-0">
        <div className="flex items-center gap-3">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium tracking-wide text-gray-100">hyperspace</span>
          <span className="text-[10px] text-gray-600 uppercase tracking-widest hidden sm:inline">pulse</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${isReplay ? 'bg-amber-500/15 text-amber-300' : 'bg-green-500/15 text-green-300'}`}>
            <Radio className="w-3 h-3 inline mr-1 -mt-px" />
            {isReplay ? 'replay' : 'live'}
          </span>
          <button
            type="button"
            onClick={() => openProfitRadar(topInsight)}
            className="text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-1"
          >
            expand <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 relative">
        <WireframeFloorMap
          venueId={venue.id}
          focusRoiId={focusRoiId}
          dimOutside={!!focusRoiId}
          maxDots={40}
          trailMaxLen={10}
        />
      </div>

      <footer className="shrink-0 border-t border-gray-800/80 px-5 py-3 flex items-center gap-4 min-h-[52px]">
        {topInsight ? (
          <>
            <p className="text-xs text-gray-300 truncate flex-1 min-w-0 font-mono">
              <span className="text-gray-500">{patternLabel(topInsight)}</span>
              <span className="text-gray-600 mx-2">·</span>
              <span>{shortZoneName(topInsight.title)}</span>
            </p>
            <span className="text-xs text-gray-400 font-mono tabular-nums shrink-0 hidden sm:inline">
              {topInsight.impact.currency}{topInsight.impact.min}–{topInsight.impact.max}/day
            </span>
            <button
              type="button"
              onClick={() => openProfitRadar(topInsight)}
              className="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border border-gray-600 text-gray-200 hover:bg-gray-800 hover:border-gray-500 shrink-0"
            >
              deploy
            </button>
            {onOpenTelegram && (
              <button
                type="button"
                onClick={onOpenTelegram}
                className="p-1.5 rounded text-gray-500 hover:text-sky-400 hover:bg-gray-800 shrink-0"
                title="Team dispatch"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-500 font-mono flex-1">
            live floor · awaiting pattern signal
          </p>
        )}
      </footer>
    </div>
  )
}
