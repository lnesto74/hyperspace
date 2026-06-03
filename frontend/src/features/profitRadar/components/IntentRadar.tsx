import { INTENT_AXIS_NAMES, type IntentAxes, type IntentAxisName } from '../../../types'

const AXIS_SHORT: Record<IntentAxisName, string> = {
  exploration: 'Explore',
  goal_directedness: 'Goal',
  urgency: 'Urgency',
  commitment: 'Commit',
  hesitation: 'Hesitate',
  confusion: 'Confused',
  social_groupness: 'Social',
  avoidance: 'Avoid',
  waiting_queueing: 'Queue',
  engagement_with_POI: 'Engage',
  churn_exit_intent: 'Exit',
  friction: 'Friction',
}

interface IntentRadarProps {
  means: IntentAxes
  avg?: IntentAxes | null
  dominant?: IntentAxisName
  color?: string
  size?: number
}

/**
 * 12-axis behavioral fingerprint (spider chart). Custom SVG — the codebase has
 * no charting lib (sparklines elsewhere are hand-drawn SVG too).
 */
export default function IntentRadar({ means, avg, dominant, color = '#f59e0b', size = 240 }: IntentRadarProps) {
  const cx = size / 2
  const cy = size / 2
  const R = size / 2 - 30
  const n = INTENT_AXIS_NAMES.length
  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const point = (i: number, val: number): [number, number] => {
    const a = angleFor(i)
    const r = R * Math.max(0, Math.min(1, val))
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  const polyFor = (vals: IntentAxes) =>
    INTENT_AXIS_NAMES.map((ax, i) => point(i, vals[ax] ?? 0).join(',')).join(' ')

  const rings = [0.25, 0.5, 0.75, 1]

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[260px] mx-auto block">
      {/* grid rings */}
      {rings.map(r => (
        <circle key={r} cx={cx} cy={cy} r={R * r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      ))}
      {/* spokes + labels */}
      {INTENT_AXIS_NAMES.map((ax, i) => {
        const [ex, ey] = point(i, 1)
        const [lx, ly] = point(i, 1.18)
        const isDom = ax === dominant
        return (
          <g key={ax}>
            <line x1={cx} y1={cy} x2={ex} y2={ey} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text
              x={lx}
              y={ly}
              textAnchor={Math.abs(lx - cx) < 6 ? 'middle' : lx > cx ? 'start' : 'end'}
              dominantBaseline="middle"
              fontSize={9}
              fill={isDom ? color : 'rgba(148,163,184,0.85)'}
              fontWeight={isDom ? 700 : 500}
            >
              {AXIS_SHORT[ax]}
            </text>
          </g>
        )
      })}
      {/* store-average overlay */}
      {avg && (
        <polygon
          points={polyFor(avg)}
          fill="rgba(148,163,184,0.10)"
          stroke="rgba(148,163,184,0.5)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
      {/* zone fingerprint */}
      <polygon points={polyFor(means)} fill={`${color}33`} stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {/* dominant axis marker */}
      {dominant && (() => {
        const i = INTENT_AXIS_NAMES.indexOf(dominant)
        const [px, py] = point(i, means[dominant] ?? 0)
        return <circle cx={px} cy={py} r={3.5} fill={color} stroke="#0b0f17" strokeWidth={1.5} />
      })()}
    </svg>
  )
}
