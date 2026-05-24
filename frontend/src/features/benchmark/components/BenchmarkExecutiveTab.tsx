import { useRef } from 'react'
import { Download, MapPin, ShieldAlert, TrendingDown, Users } from 'lucide-react'
import { jsPDF } from 'jspdf'
import type { BenchmarkRunDetail, BenchmarkRunSummary } from '../types'
import { computeDataConfidenceScore } from '../benchmarkMapUtils'

interface Props {
  detail: BenchmarkRunDetail
  baseline?: BenchmarkRunSummary | null
  compareEnabled?: boolean
  onOpenCoverage?: () => void
}

function fmt(n: number | undefined | null, d = 1) {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toFixed(d)
}

export default function BenchmarkExecutiveTab({
  detail,
  baseline,
  compareEnabled,
  onOpenCoverage,
}: Props) {
  const reportRef = useRef<HTMLDivElement>(null)
  const sc = detail.scorecard
  const p = sc?.layers?.perception
  const s = sc?.layers?.structural
  const gb = sc?.layers?.reconciler?.GROCERY_BALANCED
  const fc = s?.fragmentation_cause_pct
  const confidence = computeDataConfidenceScore(p, s, gb)

  const estShoppers = p?.estimated_real_shoppers ?? null
  const rawIds = p?.unique_perception_ids ?? null
  const frag = p?.fragmentation_factor ?? null
  const gbFrag = gb?.fragmentation_x ?? null

  const findings: string[] = []
  if (rawIds && estShoppers) {
    findings.push(
      `Raw perception counted ${rawIds.toLocaleString()} track IDs — estimated real shoppers ~${estShoppers.toLocaleString()} (${fmt(frag, 1)}× fragmentation).`,
    )
  }
  if (fc?.occlusion != null && fc.occlusion > 40) {
    findings.push(`${fmt(fc.occlusion, 0)}% of track breaks look like shelf occlusion — reconciler can merge many of these.`)
  }
  if (fc?.blindspot != null && fc.blindspot > 20) {
    findings.push(`${fmt(fc.blindspot, 0)}% of breaks occur across LiDAR blindspots — site / sensor layout issue, not software alone.`)
  }
  if (s?.significant_blindspot_m2 != null && s.significant_blindspot_m2 > 500) {
    findings.push(`${fmt(s.significant_blindspot_m2, 0)} m² of significant blindspots on the floor — structural coverage gap.`)
  }
  if (gbFrag != null && frag != null && gbFrag < frag) {
    findings.push(
      `Grocery Balanced reconciler reduces fragmentation ${fmt(frag, 1)}× → ${fmt(gbFrag, 1)}× without re-recording.`,
    )
  }
  if (!findings.length) {
    findings.push('Run completed — open the Coverage map for physical problem zones on the floorplan.')
  }

  const exportPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const margin = 48
    let y = margin
    const line = (text: string, size = 11, bold = false) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(size)
      const lines = doc.splitTextToSize(text, 500)
      doc.text(lines, margin, y)
      y += lines.length * (size + 4)
    }

    line('Hyperspace — Data Confidence Report', 16, true)
    y += 4
    line(`Capture: ${sc?.capture_id ?? detail.id}`, 10)
    line(`Generated: ${sc?.generated_at ? new Date(sc.generated_at).toLocaleString() : '—'}`, 10)
    line(`Source: ${sc?.source_file ?? '—'}`, 10)
    y += 8
    line(`Data Confidence Score: ${confidence} / 100`, 14, true)
    y += 10

    line('Executive summary', 12, true)
    y += 4
    for (const f of findings) {
      line(`• ${f}`, 10)
      y += 2
    }
    y += 8

    line('Key metrics', 12, true)
    y += 4
    line(`Raw perception IDs: ${p?.unique_perception_ids?.toLocaleString() ?? '—'}`, 10)
    line(`Est. real shoppers: ${estShoppers?.toLocaleString() ?? '—'}`, 10)
    line(`Fragmentation factor: ${fmt(frag, 1)}×`, 10)
    line(`Grocery Balanced fragmentation: ${fmt(gbFrag, 1)}×`, 10)
    line(`Significant blindspots: ${fmt(s?.significant_blindspot_m2, 0)} m²`, 10)
    line(`Shelf occlusion (fragmentation): ${fmt(fc?.occlusion, 0)}%`, 10)
    line(`Blindspot gaps (fragmentation): ${fmt(fc?.blindspot, 0)}%`, 10)
    y += 8

    if (compareEnabled && baseline && baseline.id !== detail.id) {
      line(`Compared to baseline: ${baseline.capture_id}`, 11, true)
      y += 4
      line(`Baseline fragmentation: ${fmt(baseline.fragmentation_factor, 1)}×`, 10)
      line(`Current fragmentation: ${fmt(frag, 1)}×`, 10)
    }

    y += 12
    line(
      'Without measuring fragmentation on your actual floorplan, footfall and dwell KPIs remain unreliable. '
      + 'Hyperspace shows where data breaks, what software fixes, and what requires a site change.',
      9,
    )

    doc.save(`hyperspace-confidence-${sc?.capture_id ?? detail.id}.pdf`)
  }

  const confColor = confidence >= 70 ? 'text-emerald-400' : confidence >= 45 ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="space-y-4" ref={reportRef}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Data Confidence Report</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Customer-facing summary — where perception data breaks on the floor, and what Hyperspace improves.
          </p>
        </div>
        <button
          type="button"
          onClick={exportPdf}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm"
        >
          <Download className="w-4 h-4" />
          Export PDF
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4 md:col-span-1">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Confidence score</p>
          <p className={`text-4xl font-bold ${confColor}`}>{confidence}</p>
          <p className="text-xs text-gray-500 mt-1">/ 100</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
          <div className="flex items-center gap-2 text-gray-500 text-[11px] uppercase mb-1">
            <Users className="w-3.5 h-3.5" /> Counting gap
          </div>
          <p className="text-xl font-semibold text-white">{rawIds?.toLocaleString() ?? '—'} IDs</p>
          <p className="text-xs text-gray-500">→ ~{estShoppers?.toLocaleString() ?? '—'} shoppers</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
          <div className="flex items-center gap-2 text-gray-500 text-[11px] uppercase mb-1">
            <TrendingDown className="w-3.5 h-3.5" /> Fragmentation
          </div>
          <p className="text-xl font-semibold text-orange-300">{fmt(frag, 1)}× raw</p>
          <p className="text-xs text-gray-500">→ {fmt(gbFrag, 1)}× reconciled</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
          <div className="flex items-center gap-2 text-gray-500 text-[11px] uppercase mb-1">
            <ShieldAlert className="w-3.5 h-3.5" /> Structural
          </div>
          <p className="text-xl font-semibold text-yellow-300">{fmt(s?.significant_blindspot_m2, 0)} m²</p>
          <p className="text-xs text-gray-500">blindspots ≥1 m²</p>
        </div>
      </div>

      <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4">
        <h3 className="text-sm font-medium text-amber-200 mb-2">What this means for the customer</h3>
        <ul className="space-y-2 text-sm text-gray-300">
          {findings.map((f, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-amber-500 shrink-0">•</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      {compareEnabled && baseline && baseline.id !== detail.id && (
        <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 p-4">
          <h3 className="text-sm font-medium text-blue-200 mb-2">Before / after (baseline compare)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-gray-500 text-xs">Baseline frag</p>
              <p className="text-white font-medium">{fmt(baseline.fragmentation_factor, 1)}×</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Current frag</p>
              <p className="text-white font-medium">{fmt(frag, 1)}×</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Baseline LT (GB)</p>
              <p className="text-white font-medium">{fmt(baseline.grocery_balanced_lt_mean)}s</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Current LT (GB)</p>
              <p className="text-white font-medium">{fmt(gb?.mean_lifetime_s)}s</p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <MapPin className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-white font-medium">Venue diagnostic map</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Ranked problem zones on the DWG floorplan — where track breaks and blindspots cluster physically.
            </p>
          </div>
        </div>
        {onOpenCoverage && (
          <button
            type="button"
            onClick={onOpenCoverage}
            className="px-3 py-1.5 rounded-lg border border-gray-600 text-sm text-gray-200 hover:bg-gray-700"
          >
            Open map
          </button>
        )}
      </div>

      <p className="text-[11px] text-gray-600 italic">
        Software fixes (reconciler) vs site fixes (LiDAR / layout) — zones that stay hot after reconciler tuning need commissioning, not more sliders.
      </p>
    </div>
  )
}
