import { useEffect, useState } from 'react'
import {
  STORY_NARRATIVE_SYNC,
  type StoryNarrativeSyncPayload,
} from './storyNarrativeBridge'

export const STORY_RAIL_WIDTH_EXPANDED = 320
export const STORY_RAIL_WIDTH_COLLAPSED = 44

export function useStoryNarrativeRail() {
  const [storyNarrative, setStoryNarrative] = useState<StoryNarrativeSyncPayload | null>(null)

  useEffect(() => {
    const onSync = (e: Event) => {
      setStoryNarrative((e as CustomEvent<StoryNarrativeSyncPayload>).detail ?? null)
    }
    window.addEventListener(STORY_NARRATIVE_SYNC, onSync)
    return () => window.removeEventListener(STORY_NARRATIVE_SYNC, onSync)
  }, [])

  const showStoryRail = Boolean(storyNarrative?.active && !storyNarrative.introPlaying)
  const railWidthPx = showStoryRail
    ? storyNarrative?.collapsed
      ? STORY_RAIL_WIDTH_COLLAPSED
      : STORY_RAIL_WIDTH_EXPANDED
    : 0

  return { storyNarrative, showStoryRail, railWidthPx }
}
