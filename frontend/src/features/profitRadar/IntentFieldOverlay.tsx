import { useMemo, useState } from 'react'
import { useProfitRadar } from '../../context/ProfitRadarContext'
import type { IntentAxisName, ZoneFieldEntry, BehaviorCluster } from '../../types'

const AXIS_COLORS: Record<IntentAxisName, string> = {
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

function ZoneGlow({ zone }: { zone: ZoneFieldEntry }) {
  const color = AXIS_COLORS[zone.dominant] || '#888'
  const label = AXIS_LABELS[zone.dominant] || zone.dominant

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-900/80 border border-gray-700/50">
      <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
      <div className="min-w-0">
        <div className="text-[10px] text-gray-400 truncate">{zone.roiName}</div>
        <div className="text-xs font-medium" style={{ color }}>
          {label} <span className="text-gray-500 font-normal">({(zone.dominantScore * 100).toFixed(0)}%)</span>
        </div>
      </div>
      <div className="text-[10px] text-gray-500 ml-auto">{zone.trackCount}p</div>
    </div>
  )
}

function ClusterBadge({ cluster, isHovered, onHover, onLeave }: { cluster: BehaviorCluster; isHovered: boolean; onHover: (c: BehaviorCluster) => void; onLeave: () => void }) {
  const color = AXIS_COLORS[cluster.dominant] || '#888'
  const label = AXIS_LABELS[cluster.dominant] || cluster.dominant
  const traj = cluster.trajectory

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-md border cursor-pointer transition-all duration-150 ${isHovered ? 'bg-gray-800/95 border-white/40 ring-1 ring-white/20' : 'bg-gray-900/80 border-gray-700/50 hover:border-gray-500/60'}`}
      onMouseEnter={() => onHover(cluster)}
      onMouseLeave={onLeave}
    >
      <div className="mt-1 flex-shrink-0">
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: color }}>
          {cluster.memberCount}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium" style={{ color }}>{label} cluster</div>
        <div className="text-[10px] text-gray-400 mt-0.5">
          {traj.journeyType} · {traj.avgStops} stops · {traj.avgDwellSec}s dwell
        </div>
        {cluster.anchorZoneName && (
          <div className="text-[10px] text-gray-500 mt-0.5">📍 {cluster.anchorZoneName}</div>
        )}
        {traj.zonesVisited.length > 0 && (
          <div className="text-[10px] text-gray-500 mt-0.5 truncate">
            {traj.zonesVisited.slice(0, 3).join(' → ')}
          </div>
        )}
      </div>
    </div>
  )
}

export default function IntentFieldOverlay() {
  const { intentFieldEnabled, zoneField, clusters, trackAxes, hoveredCluster, setHoveredCluster } = useProfitRadar()
  const [frozenClusters, setFrozenClusters] = useState<BehaviorCluster[] | null>(null)

  const sortedZones = useMemo(() =>
    [...zoneField]
      .filter(z => z.roiName !== 'Zone 1' && z.roiName !== 'LiDAR Coverage') // Hide auto-generated zones
      .sort((a, b) => b.dominantScore - a.dominantScore),
    [zoneField]
  )

  // Use frozen clusters while hovering, live clusters otherwise
  const displayClusters = frozenClusters ?? clusters
  const sortedClusters = useMemo(() =>
    [...displayClusters].sort((a, b) => b.memberCount - a.memberCount),
    [displayClusters]
  )

  const handleHover = (c: BehaviorCluster) => {
    setFrozenClusters([...clusters]) // Freeze current list
    setHoveredCluster(c)             // Store full frozen cluster
  }
  const handleLeave = () => {
    setFrozenClusters(null)           // Unfreeze
    setHoveredCluster(null)
  }

  if (!intentFieldEnabled) return null

  return (
    <div className="absolute top-3 right-3 z-20 w-64 space-y-2 pointer-events-auto">
      {/* Header */}
      <div className="px-3 py-2 rounded-md bg-gray-900/90 border border-gray-700/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-semibold text-white">Intent Field</span>
          <span className="text-[10px] text-gray-500 ml-auto">{trackAxes.length} tracks</span>
        </div>
      </div>

      {/* Zone Glows */}
      {sortedZones.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1 font-semibold">Zones</div>
          {sortedZones.slice(0, 6).map(z => (
            <ZoneGlow key={z.roiId} zone={z} />
          ))}
        </div>
      )}

      {/* Behavior Clusters */}
      {sortedClusters.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1 font-semibold">Clusters</div>
          {sortedClusters.slice(0, 4).map(c => (
            <ClusterBadge
              key={c.id}
              cluster={c}
              isHovered={hoveredCluster?.id === c.id}
              onHover={handleHover}
              onLeave={handleLeave}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {sortedZones.length === 0 && sortedClusters.length === 0 && (
        <div className="px-3 py-4 rounded-md bg-gray-900/80 border border-gray-700/50 text-center">
          <p className="text-xs text-gray-500">Waiting for track data…</p>
        </div>
      )}
    </div>
  )
}
