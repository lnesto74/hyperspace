import type { ReconcilerConfigMetrics } from '../types'

const CONFIGS = [
  'BYPASS_RAW',
  'BASELINE_DEFAULT',
  'GROCERY_BALANCED',
  'GROCERY_AGGRESSIVE',
  'GROCERY_CONSERVATIVE',
  'RAJ_v1_CONSERVATIVE',
  'RAJ_v1_BALANCED',
  'GROCERY_V2_MAP',
] as const

function fmt(n: number | undefined | null, d = 1) {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toFixed(d)
}

interface Props {
  reconciler: Record<string, ReconcilerConfigMetrics> | null | undefined
  highlight?: string
}

export default function ReconcilerCompareTable({ reconciler, highlight = 'RAJ_v1_CONSERVATIVE' }: Props) {
  if (!reconciler || !Object.keys(reconciler).length) {
    return (
      <div className="text-sm text-gray-500 py-8 text-center border border-dashed border-gray-700 rounded-xl">
        No reconciler sweep data — run benchmark stage 4 (06_verify).
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-800 text-gray-400 text-left">
            <th className="px-3 py-2 font-medium">Config</th>
            <th className="px-3 py-2 font-medium text-right">Stable</th>
            <th className="px-3 py-2 font-medium text-right">Frag ×</th>
            <th className="px-3 py-2 font-medium text-right">Lifetime</th>
            <th className="px-3 py-2 font-medium text-right">Disp (m)</th>
            <th className="px-3 py-2 font-medium text-right">tp/1k</th>
            <th className="px-3 py-2 font-medium text-right">Ghost %</th>
            <th className="px-3 py-2 font-medium text-right">≥30m</th>
          </tr>
        </thead>
        <tbody>
          {CONFIGS.filter((c) => reconciler[c]).map((name) => {
            const r = reconciler[name]!
            const isRec = name === highlight
            return (
              <tr
                key={name}
                className={`border-t border-gray-700/80 ${isRec ? 'bg-purple-950/40' : 'bg-gray-900/40'}`}
              >
                <td className="px-3 py-2 text-gray-200 font-mono text-xs">
                  {name}
                  {isRec && <span className="ml-2 text-[10px] text-purple-300 uppercase">recommended</span>}
                </td>
                <td className="px-3 py-2 text-right text-gray-300">{r.stable_tracks ?? '—'}</td>
                <td className="px-3 py-2 text-right text-gray-300">{fmt(r.fragmentation_x, 2)}</td>
                <td className="px-3 py-2 text-right text-gray-300">{fmt(r.mean_lifetime_s)}s</td>
                <td className="px-3 py-2 text-right text-gray-300">{fmt(r.mean_displacement_m)}</td>
                <td className="px-3 py-2 text-right text-gray-300">{fmt(r.teleports_per_1k, 2)}</td>
                <td className="px-3 py-2 text-right text-gray-300">{fmt(r.ghost_pct, 1)}</td>
                <td className="px-3 py-2 text-right text-gray-300">{r.shopper_grade_ge_30m ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
