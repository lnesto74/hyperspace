import type { BenchmarkRunSummary } from '../types'

function fmt(n: number | null | undefined, d = 1) {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toFixed(d)
}

function delta(a: number | null | undefined, b: number | null | undefined, lowerIsBetter = false) {
  if (a == null || b == null) return null
  const diff = b - a
  const pct = a !== 0 ? (diff / Math.abs(a)) * 100 : 0
  const good = lowerIsBetter ? diff < 0 : diff > 0
  return { diff, pct, good }
}

interface Props {
  baseline: BenchmarkRunSummary
  current: BenchmarkRunSummary
}

export default function RunComparePanel({ baseline, current }: Props) {
  const rows = [
    {
      label: 'Messages',
      a: baseline.messages,
      b: current.messages,
      format: (n: number | null) => (n != null ? n.toLocaleString() : '—'),
    },
    {
      label: 'Unique perception IDs',
      a: baseline.unique_perception_ids,
      b: current.unique_perception_ids,
      format: (n: number | null) => (n != null ? n.toLocaleString() : '—'),
      lowerBetter: true,
    },
    {
      label: 'Raw frag factor',
      a: baseline.fragmentation_factor,
      b: current.fragmentation_factor,
      format: (n: number | null) => fmt(n, 2),
      lowerBetter: true,
    },
    {
      label: 'Grocery Balanced lifetime (s)',
      a: baseline.grocery_balanced_lt_mean,
      b: current.grocery_balanced_lt_mean,
      format: (n: number | null) => fmt(n, 1),
    },
    {
      label: 'Grocery Balanced tp/1k',
      a: baseline.grocery_balanced_tp_per_1k,
      b: current.grocery_balanced_tp_per_1k,
      format: (n: number | null) => fmt(n, 2),
      lowerBetter: true,
    },
  ]

  return (
    <div className="rounded-xl border border-gray-700 overflow-hidden">
      <div className="px-4 py-2 bg-gray-800 border-b border-gray-700 text-sm text-gray-300">
        Improvement vs <span className="font-mono text-amber-300">{baseline.capture_id}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-left">
            <th className="px-4 py-2 font-medium">Metric</th>
            <th className="px-4 py-2 font-medium text-right">Baseline</th>
            <th className="px-4 py-2 font-medium text-right">Current</th>
            <th className="px-4 py-2 font-medium text-right">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const d = delta(row.a ?? undefined, row.b ?? undefined, row.lowerBetter)
            return (
              <tr key={row.label} className="border-t border-gray-700/60">
                <td className="px-4 py-2 text-gray-300">{row.label}</td>
                <td className="px-4 py-2 text-right text-gray-400 font-mono text-xs">
                  {row.format(row.a ?? null)}
                </td>
                <td className="px-4 py-2 text-right text-white font-mono text-xs">
                  {row.format(row.b ?? null)}
                </td>
                <td className={`px-4 py-2 text-right font-mono text-xs ${
                  d == null ? 'text-gray-600' : d.good ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {d == null ? '—' : `${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(0)}%`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
