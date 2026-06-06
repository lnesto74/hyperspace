import { useMemo } from 'react'
import { Activity } from 'lucide-react'
import { INTENT_AXIS_NAMES, type IntentAxes, type IntentAxisName, type ZoneFieldEntry } from '../../../types'
import { trackKeyMatchesMoment, type BehaviorShowcaseMoment } from '../behaviorShowcaseCatalog'
import IntentRadar from './IntentRadar'
import BenchmarkBars, { type BenchmarkBarItem } from './BenchmarkBars'

const AXIS_LABELS: Record<IntentAxisName, string> = {
  exploration: 'Exploring',
  goal_directedness: 'Goal-directed',
  urgency: 'Urgent',
  commitment: 'Committed',
  hesitation: 'Hesitating',
  confusion: 'Confused',
  social_groupness: 'Group',
  avoidance: 'Avoiding',
  waiting_queueing: 'Queueing',
  engagement_with_POI: 'Engaged',
  churn_exit_intent: 'Leaving',
  friction: 'Friction',
}

interface TrackAxesEntry {
  trackKey: string
  axes: IntentAxes
}

interface LiveFingerprintPanelProps {
  zoneField: ZoneFieldEntry[]
  roiId: string | null
  color: string
  barItems: BenchmarkBarItem[]
  focusTrackKey?: string | null
  trackAxes?: TrackAxesEntry[]
  showcaseMoment?: BehaviorShowcaseMoment | null
}

function storeAvg(zoneField: ZoneFieldEntry[]): IntentAxes | null {
  if (zoneField.length === 0) return null
  const avg = {} as IntentAxes
  for (const axis of INTENT_AXIS_NAMES) {
    avg[axis] = zoneField.reduce((s, z) => s + (z.means[axis] ?? 0), 0) / zoneField.length
  }
  return avg
}

function dominantFromAxes(axes: IntentAxes): IntentAxisName {
  return (INTENT_AXIS_NAMES as IntentAxisName[]).reduce((best, axis) =>
    (axes[axis] ?? 0) > (axes[best] ?? 0) ? axis : best,
  )
}

export default function LiveFingerprintPanel({
  zoneField,
  roiId,
  color,
  barItems,
  focusTrackKey = null,
  trackAxes = [],
  showcaseMoment = null,
}: LiveFingerprintPanelProps) {
  const live = useMemo(() => {
    const avg = storeAvg(zoneField)

    if (showcaseMoment) {
      const focusMatches = !!focusTrackKey && trackKeyMatchesMoment(focusTrackKey, showcaseMoment)
      if (focusMatches && focusTrackKey) {
        const trackEntry = trackAxes.find(t => t.trackKey === focusTrackKey)
        if (trackEntry) {
          return {
            mode: 'track' as const,
            means: trackEntry.axes,
            avg,
            dominant: dominantFromAxes(trackEntry.axes),
            subtitle: 'Live fingerprint for this shopper',
          }
        }
      }
      return {
        mode: focusMatches ? ('track-estimated' as const) : ('showcase-catalog' as const),
        means: showcaseMoment.catalogAxes,
        avg,
        dominant: showcaseMoment.axis,
        subtitle: focusMatches
          ? 'Pattern preview — refines as replay builds their trail'
          : 'Curated demo moment — replay is seeking this shopper',
      }
    }

    if (focusTrackKey) {
      const trackEntry = trackAxes.find(t => t.trackKey === focusTrackKey)
      if (trackEntry) {
        return {
          mode: 'track' as const,
          means: trackEntry.axes,
          avg,
          dominant: dominantFromAxes(trackEntry.axes),
          subtitle: 'Live fingerprint for this shopper',
        }
      }
    }

    if (!roiId || zoneField.length === 0) return null
    const zf = zoneField.find(z => z.roiId === roiId)
    if (!zf) return null
    return {
      mode: 'zone' as const,
      means: zf.means,
      avg,
      dominant: zf.dominant,
      trackCount: zf.trackCount,
      subtitle: 'Building from live movement in this zone',
    }
  }, [focusTrackKey, trackAxes, showcaseMoment, roiId, zoneField])

  return (
    <div className="flex-1 min-h-0 flex flex-col border-b border-gray-700/60 bg-gray-900/40">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-700/50 shrink-0">
        <Activity className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-medium text-white">Behavioral fingerprint</span>
        {live?.mode === 'zone' && (
          <span className="ml-auto text-[10px] text-gray-500 tabular-nums">
            {live.trackCount} path{live.trackCount === 1 ? '' : 's'} live
          </span>
        )}
        {live?.mode === 'track' && (
          <span className="ml-auto text-[10px] text-emerald-500/80">This shopper</span>
        )}
        {(live?.mode === 'track-estimated' || live?.mode === 'showcase-catalog') && (
          <span className="ml-auto text-[10px] text-amber-500/80">Demo pattern</span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {live ? (
          <>
            <p className="text-[10px] text-gray-500 text-center mb-2">
              {live.subtitle}
              <span className="mx-1.5 text-gray-600">·</span>
              <span style={{ color }} className="font-medium">
                Dominant: {AXIS_LABELS[live.dominant]}
              </span>
            </p>
            {live.mode !== 'zone' && (
              <p className="text-[10px] text-gray-600 text-center mb-2 px-2">
                This demo follows one shopper anywhere on the floor — not only inside the red insight zone.
              </p>
            )}
            <IntentRadar
              means={live.means}
              avg={live.avg ?? undefined}
              dominant={live.dominant}
              color={color}
              size={220}
              live={live.mode === 'track' || live.mode === 'zone'}
            />
            {barItems.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-700/50">
                <BenchmarkBars items={barItems} />
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-500 text-center py-8 px-4 leading-relaxed">
            {focusTrackKey || showcaseMoment
              ? 'Building this shopper’s fingerprint as their trail grows in replay…'
              : 'Select a pattern pill or click a shopper on the map — or wait for movement inside the insight zone.'}
          </p>
        )}
      </div>
    </div>
  )
}
