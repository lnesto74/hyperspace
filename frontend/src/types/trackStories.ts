export interface TrackStoryKpis {
  rawPerceptionIds: number
  rawMeanLifetimeS: number
  rawTotalPathM: number
  reconLifetimeS: number
  reconPathM: number
  reconShopperGrade?: boolean
}

export interface TrackStoryMergeEvent {
  fromFragmentId: string
  toFragmentId: string
  t: number | null
  x: number | null
  z: number | null
  gapMs?: number | null
}

export interface TrackStoryRawFragment {
  forwardFragmentId: string
  perceptionIds: string[]
  tStart: number
  tEnd: number
  lifetimeS: number
  pathM: number
  samples: { t: number; x: number; z: number }[]
}

export interface TrackStory {
  id: string
  rank: number
  stableId: string
  label: string
  kind: 'hero_merge' | 'long_path' | string
  tStart: number
  tEnd: number
  rawFragmentCount: number
  rawPerceptionIdCount: number
  rawFragments: TrackStoryRawFragment[]
  reconSamples: { t: number; x: number; z: number }[]
  mergeEvents: TrackStoryMergeEvent[]
  kpis: TrackStoryKpis
  anchor?: { x: number; z: number } | null
}

export interface TrackStoriesDocument {
  schema_version?: number
  jobId?: string
  sourceFile?: string
  presetId?: string
  presetLabel?: string
  venueId?: string
  firstTs?: number
  lastTs?: number
  story_count?: number
  stories: TrackStory[]
}

export const TRACK_STORIES_LAUNCH_KEY = 'hyperspace:launch-track-stories'

export interface TrackStoriesLaunch {
  sourceFile?: string
  jobId?: string
  storyId?: string
  openStoriesMode?: boolean
}

export function fmtStory(n: number | null | undefined, d = 1) {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toFixed(d)
}
