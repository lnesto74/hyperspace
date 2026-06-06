import type { IntentAxisName } from '../../types'

/** Recording analyzed with analysis/find_behavior_moments.mjs */
export const BEHAVIOR_SHOWCASE_RECORDING =
  'grocery_capture_2705_1347_Raj_103_2026-05-27T09-47-46.jsonl'

export interface BehaviorShowcaseMoment {
  id: IntentAxisName | 'hesitation' | 'confusion' | 'urgency' | 'commitment' | 'goal_directedness'
  label: string
  axis: IntentAxisName
  seekPct: number
  /** Suffix match against live trackKey, e.g. lidar-edge-001:person-51813 */
  personId: string
  trackKey: string
  /** Trajectory centroid — drives microscope zoom (not full zone) */
  center: { x: number; z: number }
  /** Compact movement footprint in metres — smaller = clearer in microscope */
  spanM: number
  axisScore: number
  storyTitle: string
  storyLine: string
}

/**
 * Curated demo moments — distinct dominant behaviors, compact trajectories,
 * dwell long enough to read in Discovery Theater at 1× replay speed.
 */
export const BEHAVIOR_SHOWCASE_MOMENTS: BehaviorShowcaseMoment[] = [
  {
    id: 'confusion',
    label: 'Confused',
    axis: 'confusion',
    seekPct: 0.090,
    personId: 'person-51813',
    trackKey: 'lidar-edge-001:person-51813',
    center: { x: 22.13, z: -2.2 },
    spanM: 0.36,
    axisScore: 1,
    storyTitle: 'Lost in the aisle',
    storyLine: 'Backtracks and loops — confusion dominates before they re-orient.',
  },
  {
    id: 'urgency',
    label: 'Urgent',
    axis: 'urgency',
    seekPct: 0.357,
    personId: 'person-59866',
    trackKey: 'lidar-edge-001:person-59866',
    center: { x: -26.12, z: -2.17 },
    spanM: 0.6,
    axisScore: 1,
    storyTitle: 'Rush-through traffic',
    storyLine: 'Fast, straight movement — high urgency, minimal dwell at the shelf.',
  },
  {
    id: 'hesitation',
    label: 'Hesitating',
    axis: 'hesitation',
    seekPct: 0.359,
    personId: 'person-59538',
    trackKey: 'lidar-edge-001:person-59538',
    center: { x: 15.35, z: -2.16 },
    spanM: 1.1,
    axisScore: 0.88,
    storyTitle: 'Stop–look–leave',
    storyLine: 'Micro-movements and pauses — engaged with the shelf but unable to commit.',
  },
  {
    id: 'goal_directedness',
    label: 'Goal-directed',
    axis: 'goal_directedness',
    seekPct: 0.718,
    personId: 'person-69842',
    trackKey: 'lidar-edge-001:person-69842',
    center: { x: 37.75, z: -2.17 },
    spanM: 1.56,
    axisScore: 0.92,
    storyTitle: 'Knows where they are going',
    storyLine: 'Efficient path with high straightness — classic goal-directed shopping.',
  },
  {
    id: 'commitment',
    label: 'Committed',
    axis: 'commitment',
    seekPct: 0.980,
    personId: 'person-77038',
    trackKey: 'lidar-edge-001:person-77038',
    center: { x: 13.5, z: -1.95 },
    spanM: 3.99,
    axisScore: 0.91,
    storyTitle: 'Purchase intent building',
    storyLine: 'Sustained direction and dwell — commitment axis rises as they progress.',
  },
]

export function getShowcaseMoment(id: string): BehaviorShowcaseMoment | undefined {
  return BEHAVIOR_SHOWCASE_MOMENTS.find(m => m.id === id)
}

export function matchTrackKeyForMoment(
  tracks: { trackKey: string }[],
  moment: BehaviorShowcaseMoment,
): string | null {
  const exact = tracks.find(t => t.trackKey === moment.trackKey)
  if (exact) return exact.trackKey
  const suffix = tracks.find(t => t.trackKey.endsWith(`:${moment.personId}`) || t.trackKey.endsWith(moment.personId))
  return suffix?.trackKey ?? null
}
