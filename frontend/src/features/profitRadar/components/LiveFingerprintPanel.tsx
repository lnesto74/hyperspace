import { useMemo } from 'react'
import { Activity } from 'lucide-react'
import { INTENT_AXIS_NAMES, type IntentAxes, type IntentAxisName, type ZoneFieldEntry } from '../../../types'
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

interface LiveFingerprintPanelProps {
  zoneField: ZoneFieldEntry[]
  roiId: string | null
  color: string
  barItems: BenchmarkBarItem[]
}

export default function LiveFingerprintPanel({ zoneField, roiId, color, barItems }: LiveFingerprintPanelProps) {
  const live = useMemo(() => {
    if (!roiId || zoneField.length === 0) return null
    const zf = zoneField.find(z => z.roiId === roiId)
    if (!zf) return null
    const avg = {} as IntentAxes
    for (const axis of INTENT_AXIS_NAMES) {
      avg[axis] = zoneField.reduce((s, z) => s + (z.means[axis] ?? 0), 0) / zoneField.length
    }
    return { means: zf.means, avg, dominant: zf.dominant, trackCount: zf.trackCount }
  }, [roiId, zoneField])

  return (
    <div className="flex-1 min-h-0 flex flex-col border-b border-gray-700/60 bg-gray-900/40">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-700/50 shrink-0">
        <Activity className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-medium text-white">Behavioral fingerprint</span>
        {live && (
          <span className="ml-auto text-[10px] text-gray-500 tabular-nums">
            {live.trackCount} path{live.trackCount === 1 ? '' : 's'} live
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {live ? (
          <>
            <p className="text-[10px] text-gray-500 text-center mb-2">
              Building from live movement in this zone
              <span className="mx-1.5 text-gray-600">·</span>
              <span style={{ color }} className="font-medium">
                Dominant: {AXIS_LABELS[live.dominant]}
              </span>
            </p>
            <IntentRadar means={live.means} avg={live.avg} dominant={live.dominant} color={color} size={220} live />
            {barItems.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-700/50">
                <BenchmarkBars items={barItems} />
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-500 text-center py-8">
            Waiting for live behavioral data in this zone…
          </p>
        )}
      </div>
    </div>
  )
}
