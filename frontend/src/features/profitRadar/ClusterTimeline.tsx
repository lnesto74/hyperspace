import { useProfitRadar } from '../../context/ProfitRadarContext'
import type { BehaviorCluster } from '../../types'

const AXIS_COLORS: Record<string, string> = {
  exploration: '#3b82f6',
  goal_directedness: '#22c55e',
  urgency: '#ef4444',
  commitment: '#10b981',
  hesitation: '#f59e0b',
  confusion: '#f97316',
  social_groupness: '#8b5cf6',
  avoidance: '#6b7280',
  waiting_queueing: '#06b6d4',
  engagement_with_POI: '#14b8a6',
  churn_exit_intent: '#dc2626',
  friction: '#e11d48',
}

const AXIS_LABELS: Record<string, string> = {
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

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export default function ClusterTimeline() {
  const { hoveredCluster } = useProfitRadar()

  if (!hoveredCluster) return null

  const cluster: BehaviorCluster = hoveredCluster
  const traj = cluster.trajectory
  const color = AXIS_COLORS[cluster.dominant] || '#888'
  const label = AXIS_LABELS[cluster.dominant] || cluster.dominant

  // Build stops: prefer zoneStops, fallback to zonesVisited, then synthesize from journey metrics
  let stops: { zoneName: string; dwellSec: number }[]

  if (traj.zoneStops && traj.zoneStops.length > 0) {
    stops = traj.zoneStops
  } else if (traj.zonesVisited && traj.zonesVisited.length > 0) {
    stops = traj.zonesVisited.map(name => ({
      zoneName: name,
      dwellSec: traj.avgDwellSec || 2,
    }))
  } else {
    // Synthesize phases from journey type + behavioral metrics
    const avgStops = traj.avgStops || 1
    const avgDwell = traj.avgDwellSec || 1.5
    const phases: { zoneName: string; dwellSec: number }[] = []
    const jt = traj.journeyType || 'quick-run'
    if (jt === 'full-shop') {
      phases.push({ zoneName: 'Browse', dwellSec: avgDwell * 0.4 })
      phases.push({ zoneName: 'Select', dwellSec: avgDwell * 0.35 })
      phases.push({ zoneName: 'Queue', dwellSec: avgDwell * 0.25 })
    } else if (jt === 'category-specialist') {
      phases.push({ zoneName: 'Navigate', dwellSec: avgDwell * 0.2 })
      phases.push({ zoneName: 'Focus zone', dwellSec: avgDwell * 0.6 })
      phases.push({ zoneName: 'Decide', dwellSec: avgDwell * 0.2 })
    } else if (jt === 'browse-and-bail') {
      phases.push({ zoneName: 'Browse', dwellSec: avgDwell * 0.7 })
      phases.push({ zoneName: 'Turn back', dwellSec: avgDwell * 0.3 })
    } else {
      // quick-run or unknown
      const n = Math.max(1, Math.min(avgStops, 4))
      for (let i = 0; i < n; i++) {
        phases.push({ zoneName: n === 1 ? 'Transit' : `Stop ${i + 1}`, dwellSec: avgDwell / n })
      }
    }
    stops = phases
  }

  // Compute total duration: prefer backend value, fallback from stops + travel estimate
  const totalDur = traj.totalDurationSec && traj.totalDurationSec > 0
    ? traj.totalDurationSec
    : stops.reduce((s, st) => s + st.dwellSec, 0) + stops.length * 3

  // Positions: distribute stops evenly along the timeline
  // Entry at 0%, Exit at 100%, stops in between
  const nodeCount = stops.length + 2 // entry + stops + exit
  const spacing = 100 / (nodeCount - 1)

  return (
    <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
      <div className="mx-auto max-w-4xl px-8 pt-4 pb-2">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
            <span className="text-xs font-semibold text-white/90">
              {label} cluster · {cluster.memberCount} people
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-white/50 uppercase tracking-wider">{traj.journeyType}</span>
            <span className="text-xs font-mono text-white/80">
              T+ {formatDuration(totalDur)}
            </span>
          </div>
        </div>

        {/* Timeline bar */}
        <div className="relative h-16">
          {/* Main horizontal line */}
          <div className="absolute top-6 left-0 right-0 h-[2px] bg-white/30" />
          <div
            className="absolute top-6 left-0 h-[2px]"
            style={{ width: '100%', background: `linear-gradient(90deg, ${color}44, white, ${color}44)` }}
          />

          {/* Entry node */}
          <div
            className="absolute flex flex-col items-center"
            style={{ left: '0%', transform: 'translateX(-50%)' }}
          >
            <div className="text-[9px] text-white/40 mb-1 whitespace-nowrap">ENTRY</div>
            <div className="w-3 h-3 rounded-full bg-white border-2 border-white shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
            <div className="text-[9px] text-white/50 mt-1 font-mono">0s</div>
          </div>

          {/* Zone stop nodes */}
          {stops.map((stop, i) => {
            const pct = spacing * (i + 1)
            const radius = Math.min(Math.max(stop.dwellSec / 5, 0.6), 2.5)
            const size = 8 + radius * 4 // 8px min, 18px max

            return (
              <div
                key={`${stop.zoneName}-${i}`}
                className="absolute flex flex-col items-center"
                style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
              >
                <div className="text-[9px] text-white/60 mb-1 whitespace-nowrap max-w-[80px] truncate text-center">
                  {stop.zoneName}
                </div>
                <div
                  className="rounded-full border-2 border-white flex items-center justify-center"
                  style={{
                    width: `${size}px`,
                    height: `${size}px`,
                    backgroundColor: 'rgba(255,255,255,0.15)',
                    boxShadow: '0 0 10px rgba(255,255,255,0.4)',
                  }}
                >
                  {size >= 14 && (
                    <span className="text-[7px] font-bold text-white">{Math.round(stop.dwellSec)}</span>
                  )}
                </div>
                <div className="text-[9px] text-white/70 mt-1 font-mono font-medium">
                  {formatDuration(stop.dwellSec)}
                </div>
              </div>
            )
          })}

          {/* Exit node */}
          <div
            className="absolute flex flex-col items-center"
            style={{ left: '100%', transform: 'translateX(-50%)' }}
          >
            <div className="text-[9px] text-white/40 mb-1 whitespace-nowrap">EXIT</div>
            <div className="w-3 h-3 rounded-full bg-white/40 border-2 border-white/60" />
            <div className="text-[9px] text-white/50 mt-1 font-mono">{formatDuration(totalDur)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
