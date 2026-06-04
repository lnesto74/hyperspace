import { useEffect } from 'react'
import { CalendarCheck, Film, Grid3x3 } from 'lucide-react'
import { useReplayInsight } from '../../context/ReplayInsightContext'
import { useProfitRadar } from '../../context/ProfitRadarContext'
import { useVenue } from '../../context/VenueContext'
import type { ProfitRadarInsight } from '../../types'
import DayRecapReel from './DayRecapReel'
import TomorrowsPlan from './TomorrowsPlan'

interface DailyDebriefPageProps {
  onClose: () => void
  onOpenProfitRadar?: () => void
}

export default function DailyDebriefPage({ onClose, onOpenProfitRadar }: DailyDebriefPageProps) {
  const { venue, objects } = useVenue()
  const { episodes, fetchEpisodes, selectEpisode, openStoryGrid, isLoading } = useReplayInsight()
  const { insights, setSelectedInsight } = useProfitRadar()

  useEffect(() => {
    if (venue?.id) fetchEpisodes()
  }, [venue?.id, fetchEpisodes])

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })

  const handleWatchOnFloor = (episodeId: string) => {
    onClose()
    void selectEpisode(episodeId)
  }

  const handleOpenInsight = (insight: ProfitRadarInsight) => {
    setSelectedInsight(insight)
    onOpenProfitRadar?.()
  }

  return (
    <div className="absolute inset-0 z-50 bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="h-12 border-b border-gray-700 flex items-center justify-between px-4 bg-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">← Back to Main</button>
          <div className="w-px h-5 bg-gray-700" />
          <h1 className="text-white font-medium text-sm flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-indigo-400" />
            End of Day{venue?.name ? ` · ${venue.name}` : ''}
          </h1>
          <span className="text-xs text-gray-500">{today}</span>
        </div>
        <button
          onClick={openStoryGrid}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700/60"
        >
          <Grid3x3 className="w-3.5 h-3.5" /> Browse all episodes
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-8">
          {/* ACT 1 */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Film className="w-4 h-4 text-blue-400" />
              <h2 className="text-lg font-semibold text-white">A ready-to-watch day</h2>
            </div>
            <p className="text-sm text-gray-400 mb-4">Every key moment, saved as a replayable episode — press play and the store hands back its day.</p>
            {isLoading && episodes.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                <span className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-2" />
                Rolling up the day…
              </div>
            ) : (
              <DayRecapReel
                episodes={episodes}
                objects={objects}
                venueSize={venue ? { width: venue.width, depth: venue.depth } : undefined}
                autoPlay
                onWatchOnFloor={handleWatchOnFloor}
              />
            )}
          </section>

          {/* ACT 2 */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <CalendarCheck className="w-4 h-4 text-emerald-400" />
              <h2 className="text-lg font-semibold text-white">Tomorrow's plan writes itself</h2>
            </div>
            <p className="text-sm text-gray-400 mb-4">The day's wins and misses, distilled into a ranked, money-weighted action list.</p>
            <TomorrowsPlan insights={insights} episodes={episodes} onOpenInsight={handleOpenInsight} venueId={venue?.id} />
          </section>
        </div>
      </div>
    </div>
  )
}
