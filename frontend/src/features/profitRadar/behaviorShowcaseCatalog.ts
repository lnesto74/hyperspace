import { INTENT_AXIS_NAMES, type IntentAxes, type IntentAxisName } from '../../types'
import { BEHAVIOR_SHOWCASE_DEMO_TRAILS, type DemoTrailPoint } from './behaviorShowcaseDemoTrails'

export { SHOWCASE_SEEK_LEAD_PCT } from './behaviorShowcaseDemoTrails'

/** Recording analyzed with analysis/find_behavior_moments.mjs */
export const BEHAVIOR_SHOWCASE_RECORDING =
  'grocery_capture_2705_1347_Raj_103_2026-05-27T09-47-46.jsonl'

export interface BehaviorShowcaseMoment {
  id: IntentAxisName | 'hesitation' | 'confusion' | 'urgency' | 'commitment' | 'goal_directedness'
  label: string
  axis: IntentAxisName
  seekPct: number
  /** Suffix match against live trackKey, e.g. replay-lidar-edge-001:person-51813 */
  personId: string
  trackKey: string
  /** Trajectory centroid — drives microscope zoom (not full zone) */
  center: { x: number; z: number }
  /** Compact movement footprint in metres — smaller = clearer in microscope */
  spanM: number
  axisScore: number
  /** Pre-computed axes from offline analysis — instant radar while replay seeks */
  catalogAxes: IntentAxes
  /** Recorded path slice for microscope — always visible even if live track is missed */
  demoTrail: DemoTrailPoint[]
  storyTitle: string
  storyLine: string
}

function fullAxes(partial: Partial<IntentAxes>): IntentAxes {
  const axes = {} as IntentAxes
  for (const axis of INTENT_AXIS_NAMES) axes[axis] = partial[axis] ?? 0.1
  return axes
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
    seekPct: 0.09024,
    personId: 'person-51813',
    trackKey: 'lidar-edge-001:person-51813',
    center: { x: 22.13, z: -2.2 },
    spanM: 0.36,
    axisScore: 1,
    catalogAxes: fullAxes({
      exploration: 0.98,
      goal_directedness: 0.28,
      urgency: 0.68,
      commitment: 0.4,
      hesitation: 0.67,
      confusion: 1,
      avoidance: 0.28,
      engagement_with_POI: 0.11,
    }),
    storyTitle: 'Lost in the aisle',
    storyLine: 'Backtracks and loops — confusion dominates before they re-orient.',
    demoTrail: BEHAVIOR_SHOWCASE_DEMO_TRAILS.confusion,
  },
  {
    id: 'urgency',
    label: 'Urgent',
    axis: 'urgency',
    seekPct: 0.3568,
    personId: 'person-59866',
    trackKey: 'lidar-edge-001:person-59866',
    center: { x: -26.12, z: -2.17 },
    spanM: 0.6,
    axisScore: 1,
    catalogAxes: fullAxes({
      exploration: 0.99,
      goal_directedness: 0.44,
      urgency: 1,
      commitment: 0.47,
      hesitation: 0.63,
      confusion: 1,
      avoidance: 0.6,
      engagement_with_POI: 0.1,
    }),
    storyTitle: 'Rush-through traffic',
    storyLine: 'Fast, straight movement — high urgency, minimal dwell at the shelf.',
    demoTrail: BEHAVIOR_SHOWCASE_DEMO_TRAILS.urgency,
  },
  {
    id: 'hesitation',
    label: 'Hesitating',
    axis: 'hesitation',
    seekPct: 0.35904,
    personId: 'person-59538',
    trackKey: 'lidar-edge-001:person-59538',
    center: { x: 15.35, z: -2.16 },
    spanM: 1.1,
    axisScore: 0.88,
    catalogAxes: fullAxes({
      exploration: 0.91,
      goal_directedness: 0.64,
      urgency: 0.76,
      commitment: 0.7,
      hesitation: 0.88,
      confusion: 0.91,
      avoidance: 0.47,
      engagement_with_POI: 0.3,
    }),
    storyTitle: 'Stop–look–leave',
    storyLine: 'Micro-movements and pauses — engaged with the shelf but unable to commit.',
    demoTrail: BEHAVIOR_SHOWCASE_DEMO_TRAILS.hesitation,
  },
  {
    id: 'goal_directedness',
    label: 'Goal-directed',
    axis: 'goal_directedness',
    seekPct: 0.71819,
    personId: 'person-69842',
    trackKey: 'lidar-edge-001:person-69842',
    center: { x: 37.75, z: -2.17 },
    spanM: 1.56,
    axisScore: 0.92,
    catalogAxes: fullAxes({
      exploration: 0.59,
      goal_directedness: 0.92,
      urgency: 0.76,
      commitment: 0.83,
      hesitation: 0.35,
      confusion: 0.56,
      avoidance: 0.79,
      engagement_with_POI: 0.001,
    }),
    storyTitle: 'Knows where they are going',
    storyLine: 'Efficient path with high straightness — classic goal-directed shopping.',
    demoTrail: BEHAVIOR_SHOWCASE_DEMO_TRAILS.goal_directedness,
  },
  {
    id: 'commitment',
    label: 'Committed',
    axis: 'commitment',
    seekPct: 0.25184,
    personId: 'person-56450',
    trackKey: 'lidar-edge-001:person-56450',
    center: { x: -6.75, z: -2.12 },
    spanM: 2.39,
    axisScore: 0.67,
    catalogAxes: fullAxes({
      exploration: 0.55,
      goal_directedness: 0.72,
      urgency: 0.45,
      commitment: 0.67,
      hesitation: 0.55,
      confusion: 0.35,
      avoidance: 0.4,
      engagement_with_POI: 0.62,
    }),
    storyTitle: 'Stays at the shelf',
    storyLine: 'Approaches, then holds position — sustained dwell signals rising purchase commitment.',
    demoTrail: BEHAVIOR_SHOWCASE_DEMO_TRAILS.commitment,
  },
]

export function getShowcaseMoment(id: string): BehaviorShowcaseMoment | undefined {
  return BEHAVIOR_SHOWCASE_MOMENTS.find(m => m.id === id)
}

export function trackKeyMatchesMoment(trackKey: string, moment: BehaviorShowcaseMoment): boolean {
  return (
    trackKey === moment.trackKey
    || trackKey.endsWith(`:${moment.personId}`)
    || trackKey.endsWith(moment.personId)
  )
}

export function matchTrackKeyForMoment(
  tracks: { trackKey: string }[],
  moment: BehaviorShowcaseMoment,
): string | null {
  const exact = tracks.find(t => t.trackKey === moment.trackKey)
  if (exact) return exact.trackKey
  const suffix = tracks.find(t => trackKeyMatchesMoment(t.trackKey, moment))
  return suffix?.trackKey ?? null
}
