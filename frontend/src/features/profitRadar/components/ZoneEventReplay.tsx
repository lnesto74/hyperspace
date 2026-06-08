import { useState } from 'react'
import { Maximize2, Minimize2, Radio, Users } from 'lucide-react'
import { useTracking } from '../../../context/TrackingContext'
import { useZoneMapData, pointInPolygon } from '../hooks/useZoneMapData'
import WireframeFloorMap from '../../pulse/WireframeFloorMap'

interface ZoneEventReplayProps {
  venueId: string
  roiId: string | null
  zoneName: string
  variant?: 'card' | 'stage'
  dimOutside?: boolean
  focusTrackKey?: string | null
  onTrackSelect?: (trackKey: string | null) => void
}

/**
 * Focused live/replay view of the insight's zone. Reuses WireframeFloorMap and
 * the real tracking stream (live, or recorded MQTT replay when active).
 */
export default function ZoneEventReplay({
  venueId,
  roiId,
  zoneName,
  variant = 'card',
  dimOutside = false,
  focusTrackKey = null,
  onTrackSelect,
}: ZoneEventReplayProps) {
  const { tracks, mqttReplayActive, storyReplayActive } = useTracking()
  const { zoneVerts } = useZoneMapData(venueId, roiId)

  const [expanded, setExpanded] = useState(false)
  const isStage = variant === 'stage'
  const isReplay = mqttReplayActive || storyReplayActive

  let inZoneCount = 0
  tracks.forEach(t => {
    const p = t.venuePosition ?? t.position
    if (!p || zoneVerts.length < 3) return
    if (pointInPolygon({ x: p.x, z: p.z }, zoneVerts)) inZoneCount++
  })

  const mapHeight = isStage ? undefined : (expanded ? 560 : 240)

  const map = (
    <WireframeFloorMap
      venueId={venueId}
      focusRoiId={roiId}
      dimOutside={dimOutside}
      focusTrackKey={focusTrackKey}
      onTrackSelect={onTrackSelect}
      trailMaxLen={isStage ? 24 : 12}
      style={isStage ? { minHeight: 0 } : { height: mapHeight }}
    />
  )

  if (isStage) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800/80 bg-gray-900/50 shrink-0">
          <div className="flex items-center gap-2">
            <Radio className={`w-3.5 h-3.5 ${isReplay ? 'text-amber-400' : 'text-green-400'}`} />
            <div>
              <span className="text-xs font-medium text-gray-200">Event Replay</span>
              <p className="text-[10px] text-gray-500">{zoneName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-400 hidden md:inline">
              Click a dot to focus trajectory
            </span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${isReplay ? 'bg-amber-500/15 text-amber-300' : 'bg-green-500/15 text-green-300'}`}>
              {isReplay ? '● REPLAY' : '● LIVE'}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-300">
              <Users className="w-3 h-3" /> {inZoneCount} in zone
            </span>
          </div>
        </div>
        <div className="flex-1 min-h-0 relative">{map}</div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/60">
        <div className="flex items-center gap-2">
          <Radio className={`w-3.5 h-3.5 ${isReplay ? 'text-amber-400' : 'text-green-400'}`} />
          <div>
            <span className="text-xs font-medium text-gray-200">Event Replay</span>
            <p className="text-[10px] text-gray-500">{zoneName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${isReplay ? 'bg-amber-500/15 text-amber-300' : 'bg-green-500/15 text-green-300'}`}>
            {isReplay ? '● REPLAY' : '● LIVE'}
          </span>
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700/50"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="rounded-b-md overflow-hidden">{map}</div>

      <div className="flex items-center gap-3 px-3 py-2 text-[10px] text-gray-500 border-t border-gray-700/60">
        <span className="flex items-center gap-1 text-gray-300">
          <Users className="w-3 h-3" /> {inZoneCount} in zone
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-400" /> in zone
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-400" /> elsewhere
        </span>
        <span className="ml-auto">{tracks.size} shoppers tracked</span>
      </div>
    </div>
  )
}
