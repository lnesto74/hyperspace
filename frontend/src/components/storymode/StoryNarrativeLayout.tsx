import { createContext, useContext, useEffect, type ReactNode } from 'react'
import StoryNarrativeRail from './StoryNarrativeRail'
import { STORY_BEAT_META } from './storyBeatMeta'
import {
  STORY_NARRATIVE_GOTO,
  STORY_NARRATIVE_TOGGLE_COLLAPSED,
} from './storyNarrativeBridge'
import { useStoryNarrativeRail } from './useStoryNarrativeRail'

const StoryRailInsetContext = createContext(0)

/** Right inset (px) for fixed overlays while the story rail is docked. */
export function useStoryRailInsetPx() {
  return useContext(StoryRailInsetContext)
}

/**
 * MainApp flex shell: all view modes share the center column; the story rail
 * stays mounted when Story Mode switches away from `main` (PEBLE, Profit Radar, etc.).
 */
export default function StoryNarrativeLayout({ children }: { children: ReactNode }) {
  const { storyNarrative, showStoryRail, railWidthPx } = useStoryNarrativeRail()

  useEffect(() => {
    const t = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
    return () => window.clearTimeout(t)
  }, [showStoryRail, railWidthPx, storyNarrative?.collapsed])

  return (
    <StoryRailInsetContext.Provider value={railWidthPx}>
      <div className="flex flex-row h-screen w-screen overflow-hidden bg-gray-900">
        <div className="flex-1 min-w-0 min-h-0 relative overflow-hidden">
          {children}
        </div>
        {showStoryRail && storyNarrative && (
          <StoryNarrativeRail
            beat={storyNarrative.beat}
            index={storyNarrative.index}
            total={storyNarrative.total}
            color={storyNarrative.rungColor}
            replayLive={storyNarrative.replayLive}
            collapsed={storyNarrative.collapsed}
            beatMeta={STORY_BEAT_META}
            onToggleCollapsed={() =>
              window.dispatchEvent(new CustomEvent(STORY_NARRATIVE_TOGGLE_COLLAPSED))
            }
            onGoto={(i) =>
              window.dispatchEvent(new CustomEvent(STORY_NARRATIVE_GOTO, { detail: { index: i } }))
            }
          />
        )}
      </div>
    </StoryRailInsetContext.Provider>
  )
}
