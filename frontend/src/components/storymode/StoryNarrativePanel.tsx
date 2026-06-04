import { ChevronLeft, PanelRightClose } from 'lucide-react'
import { STORY_BEATS, STORY_RUNG_COLOR, type StoryBeat } from './storyBeats'

/** In-layout narrative column (same pattern as ZoneKPIOverlayPanel — shrinks the stage). */
export default function StoryNarrativePanel({
  beat,
  index,
  total,
  color,
  replayLive,
  collapsed,
  onToggleCollapsed,
  onGoto,
}: {
  beat: StoryBeat
  index: number
  total: number
  color: string
  replayLive: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
  onGoto: (i: number) => void
}) {
  if (collapsed) {
    return (
      <aside
        className="shrink-0 flex flex-col items-center w-11 h-full border-l border-white/10 bg-gray-950/30 backdrop-blur-xl z-10"
        aria-label="Story narrative (collapsed)"
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="mt-3 p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          title="Show story panel"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 flex flex-col items-center gap-2 py-4 min-h-0">
          {STORY_BEATS.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onGoto(i)}
              title={`${b.time} · ${b.title}`}
              className="rounded-full transition-all"
              style={{
                width: i === index ? 8 : 6,
                height: i === index ? 8 : 6,
                backgroundColor: i === index ? STORY_RUNG_COLOR[b.rung] : 'rgba(255,255,255,0.2)',
              }}
            />
          ))}
        </div>
        <span
          className="pb-4 text-[9px] font-medium tabular-nums text-white/35"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          {index + 1}/{total}
        </span>
      </aside>
    )
  }

  return (
    <aside
      className="shrink-0 flex flex-col w-[320px] h-full border-l border-white/10 bg-gray-950/30 backdrop-blur-xl z-10"
      aria-label="Story narrative"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] tracking-wider text-white/75 shrink-0">{beat.time}</span>
          <span className="text-[9px] uppercase tracking-[0.18em] text-white/40 truncate">{beat.period}</span>
          {replayLive && (
            <span className="flex items-center gap-1 text-[9px] tracking-wide text-emerald-400/90 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              REPLAY
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] font-medium uppercase tracking-[0.18em]" style={{ color }}>{beat.rung}</span>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            title="Hide story panel"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 min-h-0">
        <h3
          className="text-white mb-3"
          style={{ fontFamily: "'Noto Serif Display', Georgia, serif", fontSize: '1.25rem', lineHeight: 1.25, fontWeight: 500, letterSpacing: '-0.01em' }}
        >
          {beat.title}
        </h3>

        <div className="space-y-3">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/35 mb-1">On the floor</div>
            <p className="text-[12px] leading-relaxed text-white/55">{beat.floor}</p>
          </div>
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/35 mb-1">What Hyperspace does</div>
            <p className="text-[12px] leading-relaxed text-white/88">{beat.hyperspace}</p>
          </div>
        </div>

        <div className="mt-4 pt-3 flex items-end justify-between gap-3 border-t border-white/10">
          <span style={{ fontFamily: "'Noto Serif Display', Georgia, serif", color, fontSize: '1rem', fontWeight: 500, lineHeight: 1.15 }}>
            {beat.outcome}
          </span>
          <span className="text-[9px] uppercase tracking-[0.12em] text-white/40 text-right leading-snug max-w-[46%]">
            {beat.component}
          </span>
        </div>
      </div>

      <div className="shrink-0 px-4 py-2.5 border-t border-white/10 flex items-center gap-1.5">
        {STORY_BEATS.map((b, i) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onGoto(i)}
            title={`${b.time} · ${b.title}`}
            className="flex-1 min-w-0 h-1 rounded-full transition-all"
            style={{
              backgroundColor: i === index ? STORY_RUNG_COLOR[b.rung] : 'rgba(255,255,255,0.12)',
              opacity: i === index ? 1 : 0.7,
            }}
          />
        ))}
      </div>
    </aside>
  )
}
