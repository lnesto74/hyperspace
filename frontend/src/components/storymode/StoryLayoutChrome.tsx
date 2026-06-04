import { ChevronLeft, ChevronRight, Film, Pause, Play, X } from 'lucide-react'
import StoryNarrativePanel from './StoryNarrativePanel'
import { STORY_BEATS, STORY_RUNG_COLOR } from './storyBeats'
import { useStoryModeLayoutOptional } from './StoryModeLayoutContext'

/** Right column + transport — lives in the app flex row (resizes content like KPI rail). */
export function StoryLayoutRail() {
  const ctx = useStoryModeLayoutOptional()
  if (!ctx) return null
  const { snapshot, narrativeCollapsed, toggleNarrativeCollapsed, handlers } = ctx
  if (!snapshot.active || snapshot.introPlaying) return null

  const beat = STORY_BEATS[snapshot.beatIndex]
  if (!beat || !handlers) return null

  return (
    <StoryNarrativePanel
      beat={beat}
      index={snapshot.beatIndex}
      total={snapshot.beatTotal}
      color={STORY_RUNG_COLOR[beat.rung]}
      replayLive={snapshot.replayLive}
      collapsed={narrativeCollapsed}
      onToggleCollapsed={toggleNarrativeCollapsed}
      onGoto={handlers.goto}
    />
  )
}

export function StoryTransportRail() {
  const ctx = useStoryModeLayoutOptional()
  if (!ctx?.handlers) return null
  const { snapshot, handlers } = ctx
  if (!snapshot.active || snapshot.introPlaying) return null

  return (
    <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-30 pointer-events-auto max-w-[min(640px,calc(100%-2rem))]">
      <div className="flex items-center gap-3 px-3 py-2 rounded-full bg-gray-900/95 backdrop-blur-md border border-gray-700 shadow-2xl">
        <div className="flex items-center gap-1.5 pr-1">
          <Film className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-[10px] font-semibold text-gray-300 tracking-wide">STORY MODE</span>
        </div>

        <div className="w-px h-5 bg-gray-700" />

        <button
          type="button"
          onClick={handlers.prev}
          disabled={snapshot.beatIndex === 0}
          className="p-1.5 text-gray-300 hover:text-white disabled:text-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
          title="Previous"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1.5 px-1">
          {STORY_BEATS.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => handlers.goto(i)}
              title={`${b.time} · ${b.title}`}
              className="group relative"
            >
              <span
                className="block rounded-full transition-all"
                style={{
                  width: i === snapshot.beatIndex ? 10 : 7,
                  height: i === snapshot.beatIndex ? 10 : 7,
                  backgroundColor: i === snapshot.beatIndex ? STORY_RUNG_COLOR[b.rung] : '#4b5563',
                }}
              />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handlers.next}
          disabled={snapshot.beatIndex >= snapshot.beatTotal - 1}
          className="p-1.5 text-gray-300 hover:text-white disabled:text-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
          title="Next"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handlers.togglePlaying}
          className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          title={snapshot.playing ? 'Pause auto-advance' : 'Auto-advance'}
        >
          {snapshot.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>

        <span className="text-[10px] text-gray-500 w-9 text-center tabular-nums">
          {snapshot.beatIndex + 1} / {snapshot.beatTotal}
        </span>

        <button
          type="button"
          onClick={handlers.exit}
          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          title="Exit Story Mode (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
