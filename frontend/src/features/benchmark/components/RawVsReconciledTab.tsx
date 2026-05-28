import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Film, MapPin, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import { API_BASE } from '../../../config/api'
import type { BenchmarkRunDetail, ReconciledSpatial, TrackViewMode } from '../types'
import {
  RECONCILER_CONFIG_OPTIONS,
  buildRawVsReconciledRows,
  formatDelta,
  formatDeltaPct,
  summarizeComparison,
  type ReconcilerConfigId,
} from '../rawVsReconciledUtils'
import { computeDataConfidenceScore } from '../benchmarkMapUtils'
import { TRACK_STORIES_LAUNCH_KEY } from '../../../types/trackStories'

interface Props {
  detail: BenchmarkRunDetail
  onOpenCoverage?: (trackView: TrackViewMode) => void
  onOpenTrackStories?: () => void
}

function overlayForConfig(config: ReconcilerConfigId): TrackViewMode {
  if (config.startsWith('GROCERY_') || config.startsWith('RAJ_')) {
    return `overlay_${config}` as TrackViewMode
  }
  return 'overlay_GROCERY_BALANCED'
}

function formatMetricValue(value: number | null, unit: string) {
  if (value == null || Number.isNaN(value)) return '—'
  const n = unit === 'count' ? value.toLocaleString() : value.toFixed(unit === '×' || unit === '/1k' ? 2 : 1)
  if (unit === '×') return `${n}×`
  if (unit === '/1k') return `${n}/1k`
  if (unit === 's' || unit === 'm') return `${n}${unit}`
  if (unit === '%') return `${n}%`
  return n
}

function fmt(n: number | null | undefined, d = 1) {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: d })
}

function HeroStat({
  label,
  raw,
  reconciled,
  suffix = '',
  accent,
}: {
  label: string
  raw: string
  reconciled: string
  suffix?: string
  accent?: string
}) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
      <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">{label}</p>
      <div className="flex items-end gap-2 flex-wrap">
        <span className="text-lg text-blue-300 font-mono">{raw}{suffix}</span>
        <ArrowRight className="w-4 h-4 text-gray-600 mb-0.5 shrink-0" />
        <span className={`text-2xl font-semibold font-mono ${accent ?? 'text-emerald-300'}`}>
          {reconciled}{suffix}
        </span>
      </div>
    </div>
  )
}

export default function RawVsReconciledTab({ detail, onOpenCoverage, onOpenTrackStories }: Props) {
  const perception = detail.scorecard?.layers?.perception
  const reconcilerLayer = detail.scorecard?.layers?.reconciler
  const structural = detail.scorecard?.layers?.structural

  const availableConfigs = useMemo(
    () => RECONCILER_CONFIG_OPTIONS.filter(c => reconcilerLayer?.[c.id]),
    [reconcilerLayer],
  )

  const [config, setConfig] = useState<ReconcilerConfigId>('GROCERY_BALANCED')
  const [spatialRaw, setSpatialRaw] = useState<{ births: number; deaths: number; ghosts: number } | null>(null)
  const [spatialRecon, setSpatialRecon] = useState<ReconciledSpatial | null>(null)
  const [floorLinkBusy, setFloorLinkBusy] = useState(false)
  const [floorLinkError, setFloorLinkError] = useState<string | null>(null)

  useEffect(() => {
    if (availableConfigs.length && !reconcilerLayer?.[config]) {
      setConfig(availableConfigs[0].id)
    }
  }, [availableConfigs, config, reconcilerLayer])

  const reconciled = reconcilerLayer?.[config]
  const rows = useMemo(
    () => buildRawVsReconciledRows(perception, reconciled),
    [perception, reconciled],
  )
  const summary = useMemo(() => summarizeComparison(rows), [rows])

  const rawConfidence = computeDataConfidenceScore(perception, structural, null)
  const reconConfidence = computeDataConfidenceScore(perception, structural, reconciled)

  useEffect(() => {
    let cancelled = false
    const runId = detail.id
    async function loadSpatial() {
      try {
        const [rawRes, reconRes] = await Promise.all([
          fetch(`${API_BASE}/api/benchmark/runs/${encodeURIComponent(runId)}/coverage/spatial`),
          fetch(`${API_BASE}/api/benchmark/runs/${encodeURIComponent(runId)}/coverage/reconciled/${encodeURIComponent(config)}`),
        ])
        if (cancelled) return
        if (rawRes.ok) {
          const raw = await rawRes.json()
          setSpatialRaw(raw.counts ? {
            births: raw.counts.births ?? 0,
            deaths: raw.counts.deaths ?? 0,
            ghosts: raw.counts.ghosts ?? 0,
          } : null)
        }
        if (reconRes.ok) {
          setSpatialRecon(await reconRes.json())
        }
      } catch { /* ignore */ }
    }
    void loadSpatial()
    return () => { cancelled = true }
  }, [detail.id, config])

  if (!perception) {
    return (
      <div className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-gray-500 text-sm">
        No Layer 1 (raw perception) data — run the full benchmark pipeline on this capture first.
      </div>
    )
  }

  if (!reconcilerLayer || !Object.keys(reconcilerLayer).length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-gray-500 text-sm space-y-2">
        <p>No Layer 2 (reconciler) data — stage <code className="text-gray-400">06_verify</code> did not run or failed.</p>
        <p className="text-xs">Use <strong className="text-gray-400">Run benchmark</strong> above on the same JSONL capture.</p>
      </div>
    )
  }

  const overlayMode = overlayForConfig(config)
  const sourceFile = detail.scorecard?.source_file

  const openTrackStoriesOnFloor = async () => {
    if (!sourceFile) {
      setFloorLinkError('No source capture file on this benchmark run')
      return
    }
    setFloorLinkBusy(true)
    setFloorLinkError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/reconcile/jobs?sourceFile=${encodeURIComponent(sourceFile)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const jobs: { id: string; status: string; presetId?: string }[] = data.jobs || []
      const job = jobs.find(j => j.status === 'complete' && j.presetId === config)
        || jobs.find(j => j.status === 'complete')
      if (!job) {
        throw new Error('No completed post-process job for this capture — run post-process in MQTT Replay first')
      }
      sessionStorage.setItem(TRACK_STORIES_LAUNCH_KEY, JSON.stringify({
        sourceFile,
        jobId: job.id,
        openStoriesMode: true,
      }))
      window.dispatchEvent(new CustomEvent('hyperspace:open-track-stories'))
      onOpenTrackStories?.()
    } catch (err: unknown) {
      setFloorLinkError(err instanceof Error ? err.message : String(err))
    } finally {
      setFloorLinkBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Protocol explainer */}
      <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/90">
        <div className="flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-amber-200">Same capture — real numbers, not eyeballing replay</p>
            <p className="text-xs text-amber-100/70 leading-relaxed">
              Layer 1 stats come from the raw MQTT JSONL ({detail.scorecard?.source_file ?? 'capture file'}).
              Layer 2 re-streams that <em>identical file</em> through the production reconciler ({config}).
              This is the quantitative proof behind what you see in reconciled MQTT replay.
              Offline post-process artifacts use a separate path-merge step — compare preset names (e.g. Grocery Balanced).
            </p>
          </div>
        </div>
      </div>

      {/* Config picker */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Reconciler preset</div>
          <select
            value={config}
            onChange={e => setConfig(e.target.value as ReconcilerConfigId)}
            className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white min-w-[220px]"
          >
            {availableConfigs.map(c => (
              <option key={c.id} value={c.id}>
                {c.label}{'recommended' in c && c.recommended ? ' ★' : ''}
              </option>
            ))}
          </select>
        </div>
        {onOpenCoverage && (
          <button
            type="button"
            onClick={() => onOpenCoverage(overlayMode)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500"
          >
            <MapPin className="w-4 h-4" />
            Open before/after map
          </button>
        )}
        <button
          type="button"
          disabled={floorLinkBusy || !sourceFile}
          onClick={() => void openTrackStoriesOnFloor()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-violet-700/60 text-violet-200 hover:text-white hover:border-violet-500 disabled:opacity-50"
        >
          <Film className="w-4 h-4" />
          {floorLinkBusy ? 'Loading…' : 'See on floor'}
        </button>
      </div>
      {floorLinkError && (
        <p className="text-xs text-amber-300/90">{floorLinkError}</p>
      )}

      {/* Hero KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <HeroStat
          label="Fragmentation factor"
          raw={fmt(summary.frag?.raw, 1)}
          reconciled={fmt(summary.frag?.reconciled, 1)}
          suffix="×"
          accent="text-purple-300"
        />
        <HeroStat
          label="Track identities"
          raw={fmt(summary.ids?.raw, 0)}
          reconciled={fmt(summary.ids?.reconciled, 0)}
        />
        <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">Confidence score</p>
          <div className="flex items-end gap-2">
            <span className="text-lg text-blue-300 font-mono">{rawConfidence}</span>
            <ArrowRight className="w-4 h-4 text-gray-600 mb-0.5" />
            <span className="text-2xl font-semibold text-emerald-300 font-mono">{reconConfidence}</span>
            <span className="text-xs text-gray-500 mb-1">/100</span>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-4">
          <p className="text-[10px] uppercase tracking-wide text-emerald-400/80 mb-2">Reconciler win</p>
          <div className="space-y-1">
            {summary.fragReduction != null && (
              <div className="flex items-center gap-1.5 text-emerald-300">
                <TrendingDown className="w-4 h-4" />
                <span className="text-lg font-semibold">{summary.fragReduction.toFixed(0)}%</span>
                <span className="text-xs text-emerald-400/80">less fragmentation</span>
              </div>
            )}
            {summary.idReduction != null && (
              <div className="flex items-center gap-1.5 text-emerald-300/90 text-sm">
                <TrendingDown className="w-3.5 h-3.5" />
                <span>{summary.idReduction.toFixed(0)}% fewer track IDs</span>
              </div>
            )}
            {summary.shopper?.delta != null && summary.shopper.delta > 0 && (
              <div className="flex items-center gap-1.5 text-emerald-300/90 text-sm">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>+{summary.shopper.delta} shopper-grade tracks</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delta table */}
      <div className="overflow-x-auto rounded-xl border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800 text-gray-400 text-left">
              <th className="px-4 py-2.5 font-medium">KPI</th>
              <th className="px-4 py-2.5 font-medium text-right text-blue-300">Raw capture</th>
              <th className="px-4 py-2.5 font-medium text-right text-purple-300">Reconciled</th>
              <th className="px-4 py-2.5 font-medium text-right">Δ</th>
              <th className="px-4 py-2.5 font-medium text-right">Δ%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const d = formatDelta(row.delta, row.direction, row.unit)
              const dp = formatDeltaPct(row.deltaPct, row.direction)
              return (
                <tr
                  key={row.id}
                  className={`border-t border-gray-700/80 ${row.highlight ? 'bg-gray-900/60' : 'bg-gray-900/30'}`}
                >
                  <td className="px-4 py-2.5">
                    <div className="text-gray-200">{row.label}</div>
                    {row.note && (
                      <div className="text-[10px] text-gray-500 mt-0.5 max-w-md">{row.note}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-blue-200">
                    {formatMetricValue(row.raw, row.unit)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-purple-200">
                    {formatMetricValue(row.reconciled, row.unit)}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono ${
                    d.tone === 'good' ? 'text-emerald-400' : d.tone === 'bad' ? 'text-red-400' : 'text-gray-400'
                  }`}>
                    {d.text}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono ${
                    dp.tone === 'good' ? 'text-emerald-400' : dp.tone === 'bad' ? 'text-red-400' : 'text-gray-400'
                  }`}>
                    {dp.text}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Spatial forensics strip */}
      {(spatialRaw || spatialRecon?.available) && (
        <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-4 space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-gray-400">Spatial forensics (same capture)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-[10px] text-gray-500">Raw births / deaths</p>
              <p className="font-mono text-blue-300">
                {spatialRaw ? `${spatialRaw.births} / ${spatialRaw.deaths}` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500">Raw ghost links</p>
              <p className="font-mono text-blue-300">{spatialRaw?.ghosts ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500">Reconciled stable tracks</p>
              <p className="font-mono text-purple-300">{spatialRecon?.counts?.stable_tracks ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500">Reconciled births / deaths</p>
              <p className="font-mono text-purple-300">
                {spatialRecon?.counts
                  ? `${spatialRecon.counts.births} / ${spatialRecon.counts.deaths}`
                  : '—'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Narrative */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/30 px-4 py-3 text-sm text-gray-300 space-y-2">
        <p className="font-medium text-white">How to read this</p>
        <ul className="list-disc pl-5 space-y-1 text-xs text-gray-400 leading-relaxed">
          <li>
            <strong className="text-gray-300">Raw</strong> = what the edge LiDAR published — high ID churn is normal in grocery aisles.
          </li>
          <li>
            <strong className="text-gray-300">Reconciled</strong> = same messages re-played through Hyperspace reconciler — this matches live canvas behaviour.
          </li>
          <li>
            A strong result: fragmentation drops sharply, mean lifetime rises, shopper-grade count rises, teleports fall.
          </li>
          <li>
            MQTT reconciled replay (Replay panel) is visual confirmation; <strong className="text-gray-300">this tab is the audit trail</strong>.
          </li>
        </ul>
      </div>
    </div>
  )
}
