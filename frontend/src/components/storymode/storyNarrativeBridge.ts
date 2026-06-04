/** Display fields for the story narrative rail (no stage callbacks). */
export interface StoryNarrativeBeatDisplay {
  time: string
  period: string
  rung: string
  title: string
  floor: string
  hyperspace: string
  outcome: string
  component: string
}

export interface StoryBeatMeta {
  id: string
  rung: string
  time: string
  title: string
}

export interface StoryNarrativeSyncPayload {
  active: boolean
  introPlaying: boolean
  index: number
  total: number
  collapsed: boolean
  replayLive: boolean
  beat: StoryNarrativeBeatDisplay
  rungColor: string
}

export const STORY_NARRATIVE_SYNC = 'hyperspace:story-narrative-sync'
export const STORY_NARRATIVE_GOTO = 'hyperspace:story-narrative-goto'
export const STORY_NARRATIVE_TOGGLE_COLLAPSED = 'hyperspace:story-narrative-toggle-collapsed'

export function dispatchStoryNarrativeSync(payload: StoryNarrativeSyncPayload) {
  window.dispatchEvent(new CustomEvent(STORY_NARRATIVE_SYNC, { detail: payload }))
}
