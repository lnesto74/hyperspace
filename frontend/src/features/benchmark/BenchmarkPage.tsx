import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  RefreshCw,
  FlaskConical,
  FileText,
  GitCompare,
} from 'lucide-react'
import { API_BASE } from '../../config/api'
import type { BenchmarkRunDetail, BenchmarkRunSummary, BenchmarkRunsResponse } from './types'
import ProtocolGuide from './components/ProtocolGuide'
import ReconcilerCompareTable from './components/ReconcilerCompareTable'
import ArtifactPanel from './components/ArtifactPanel'
import RunComparePanel from './components/RunComparePanel'
import BenchmarkCoverageMap from './components/BenchmarkCoverageMap'
import BenchmarkExecutiveTab from './components/BenchmarkExecutiveTab'
import RunBenchmarkPanel from './components/RunBenchmarkPanel'
import RawVsReconciledTab from './components/RawVsReconciledTab'
import type { TrackViewMode } from './types'

interface BenchmarkPageProps {
  onClose: () => void
}

type Tab = 'executive' | 'raw_vs' | 'overview' | 'reconciler' | 'coverage' | 'spatial' | 'artifacts'

function fmt(n: number | undefined | null, d = 1) {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toFixed(d)
}

function MetricCard({
  label,
  value,
  sub,
  accent = 'text-white',
}: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
      <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${accent}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

export default function BenchmarkPage({ onClose }: BenchmarkPageProps) {
  const [runs, setRuns] = useState<BenchmarkRunSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [baselineId, setBaselineId] = useState<string | null>(null)
  const [detail, setDetail] = useState<BenchmarkRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('raw_vs')
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [showCompare, setShowCompare] = useState(false)
  const [coverageTrackView, setCoverageTrackView] = useState<TrackViewMode | undefined>()

  const fetchRuns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/runs`)
      if (!res.ok) throw new Error(await res.text())
      const data: BenchmarkRunsResponse = await res.json()
      setRuns(data.runs)
      if (data.runs.length) {
        setSelectedId((prev) => prev ?? data.runs[0].id)
        setBaselineId((prev) => prev ?? data.runs[data.runs.length - 1]?.id ?? data.runs[0].id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load runs')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/runs/${encodeURIComponent(id)}`)
      if (!res.ok) throw new Error(await res.text())
      const data: BenchmarkRunDetail = await res.json()
      setDetail(data)
      const firstImg = data.artifacts.find((a) => a.is_image)?.name ?? null
      setSelectedImage(firstImg)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load run detail')
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRuns()
  }, [fetchRuns])

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId)
  }, [selectedId, fetchDetail])

  const baselineRun = useMemo(
    () => runs.find((r) => r.id === baselineId) ?? null,
    [runs, baselineId],
  )
  const currentRun = useMemo(
    () => runs.find((r) => r.id === selectedId) ?? null,
    [runs, selectedId],
  )

  const p = detail?.scorecard?.layers?.perception
  const s = detail?.scorecard?.layers?.structural
  const fc = s?.fragmentation_cause_pct

  const tabs: { id: Tab; label: string }[] = [
    { id: 'raw_vs', label: 'Raw vs reconciled' },
    { id: 'executive', label: 'Executive' },
    { id: 'overview', label: 'Overview' },
    { id: 'coverage', label: 'Venue map' },
    { id: 'reconciler', label: 'Reconciler sweep' },
    { id: 'spatial', label: 'Spatial stats' },
    { id: 'artifacts', label: 'Artifacts' },
  ]

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-gray-700 flex items-center justify-between px-4 bg-gray-800 flex-shrink-0">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </button>
          <div className="h-6 w-px bg-gray-700" />
          <div className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-amber-400" />
            <h1 className="text-white font-semibold">Trajectory Benchmark</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowCompare((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              showCompare
                ? 'border-amber-500/60 bg-amber-950/40 text-amber-200'
                : 'border-gray-600 text-gray-400 hover:text-white'
            }`}
          >
            <GitCompare className="w-4 h-4" />
            Compare
          </button>
          <button
            type="button"
            onClick={fetchRuns}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Run list sidebar */}
        <aside className="w-72 border-r border-gray-700 bg-gray-900 flex flex-col flex-shrink-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-700 text-xs text-gray-500 uppercase tracking-wide">
            Capture runs
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading && !runs.length && (
              <p className="text-sm text-gray-500 p-3">Loading…</p>
            )}
            {!loading && !runs.length && (
              <div className="p-3 text-sm text-gray-500">
                No benchmark runs yet. Run{' '}
                <code className="text-gray-400 text-xs">run_benchmark.mjs</code> on DO.
              </div>
            )}
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelectedId(run.id)}
                className={`w-full text-left rounded-lg px-3 py-2.5 border transition-colors ${
                  selectedId === run.id
                    ? 'border-amber-500/50 bg-amber-950/30'
                    : 'border-transparent hover:bg-gray-800'
                }`}
              >
                <p className="text-sm text-white font-medium truncate">{run.capture_id}</p>
                <p className="text-[11px] text-gray-500 font-mono truncate mt-0.5">
                  {run.source_file || run.id}
                </p>
                <div className="flex items-center gap-2 mt-1.5 text-[10px]">
                  <span className={
                    run.run_status === 'completed' || run.has_scorecard ? 'text-emerald-500'
                      : run.run_status === 'running' ? 'text-amber-400'
                        : run.run_status === 'failed' ? 'text-red-400'
                          : 'text-gray-600'
                  }>
                    {run.run_status === 'running' ? 'running…'
                      : run.has_scorecard ? 'scorecard'
                        : run.run_status === 'failed' ? 'failed'
                          : 'pending'}
                  </span>
                  {run.generated_at && (
                    <span className="text-gray-600">
                      {new Date(run.generated_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
          {showCompare && runs.length > 1 && (
            <div className="border-t border-gray-700 p-3">
              <p className="text-[10px] uppercase text-gray-500 mb-1">Baseline for compare</p>
              <select
                value={baselineId || ''}
                onChange={(e) => setBaselineId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-xs text-white"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>{r.capture_id}</option>
                ))}
              </select>
            </div>
          )}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <ProtocolGuide />

          <RunBenchmarkPanel onStarted={fetchRuns} />

          {showCompare && baselineRun && currentRun && baselineRun.id !== currentRun.id && (
            <RunComparePanel baseline={baselineRun} current={currentRun} />
          )}

          {!selectedId && !loading && (
            <p className="text-gray-500 text-center py-12">Select a run from the sidebar.</p>
          )}

          {selectedId && detailLoading && !detail && (
            <p className="text-gray-500 text-center py-12">Loading run detail…</p>
          )}

          {detail && (
            <>
              {/* Meta strip */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                <span className="font-mono text-amber-300">{detail.scorecard?.capture_id ?? detail.id}</span>
                {detail.meta?.perception_version != null && (
                  <span>Perception: {String(detail.meta.perception_version)}</span>
                )}
                {detail.meta?.reconciler_at_capture != null && (
                  <span>At capture: {String(detail.meta.reconciler_at_capture)}</span>
                )}
                {detail.scorecard?.scope && <span>Scope: {detail.scorecard.scope}</span>}
                {detail.scorecard?.notes && (
                  <span className="italic text-gray-500">{detail.scorecard.notes}</span>
                )}
              </div>

              {/* Tabs */}
              <div className="flex gap-1 bg-gray-800 rounded-lg p-1 w-fit">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`px-4 py-1.5 rounded-md text-sm transition-colors ${
                      tab === t.id ? 'bg-amber-600 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === 'raw_vs' && detail && (
                <RawVsReconciledTab
                  detail={detail}
                  onOpenCoverage={(trackView) => {
                    setCoverageTrackView(trackView)
                    setTab('coverage')
                  }}
                />
              )}

              {tab === 'executive' && detail && (
                <BenchmarkExecutiveTab
                  detail={detail}
                  baseline={showCompare ? baselineRun : null}
                  compareEnabled={showCompare && !!baselineRun && baselineRun.id !== selectedId}
                  onOpenCoverage={() => setTab('coverage')}
                />
              )}

              {tab === 'overview' && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xs uppercase tracking-wide text-blue-400 mb-2">Layer 1 — Raw perception</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      <MetricCard label="Messages" value={p?.messages?.toLocaleString() ?? '—'} />
                      <MetricCard label="Unique IDs" value={p?.unique_perception_ids?.toLocaleString() ?? '—'} accent="text-blue-300" />
                      <MetricCard label="Frag factor" value={fmt(p?.fragmentation_factor, 2)} sub="IDs / est. shoppers" accent="text-orange-300" />
                      <MetricCard label="Mean lifetime" value={`${fmt(p?.mean_lifetime_s)}s`} />
                      <MetricCard label="Teleports / 1k" value={fmt(p?.teleports_per_1k, 2)} accent="text-red-300" />
                      <MetricCard label="Shopper-grade ≥30m" value={String(p?.shopper_grade_ge_30m ?? '—')} accent="text-emerald-300" />
                    </div>
                  </div>
                  {detail.scorecard?.layers?.reconciler?.GROCERY_BALANCED && (
                    <div>
                      <h2 className="text-xs uppercase tracking-wide text-purple-400 mb-2">Layer 2 — Grocery Balanced highlight</h2>
                      <ReconcilerCompareTable reconciler={detail.scorecard.layers.reconciler} />
                    </div>
                  )}
                </div>
              )}

              {tab === 'coverage' && selectedId && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">
                    Venue diagnostic map — ranked problem zones on the DWG floorplan (same transform as Live Tuner).
                    Scroll to zoom, drag to pan, click a zone for details. Enable <strong className="text-gray-400">Compare</strong> for before/after zone outlines.
                  </p>
                  <BenchmarkCoverageMap
                    runId={selectedId}
                    compareRunId={showCompare && baselineId !== selectedId ? baselineId : null}
                    compareLabel={baselineRun?.capture_id}
                    initialTrackView={coverageTrackView}
                  />
                </div>
              )}

              {tab === 'reconciler' && (
                <ReconcilerCompareTable reconciler={detail.scorecard?.layers?.reconciler} />
              )}

              {tab === 'spatial' && (
                <div className="space-y-4">
                  <h2 className="text-xs uppercase tracking-wide text-emerald-400">Layer 3 — Structural</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard label="Walkable area" value={`${fmt(s?.walkable_area_m2, 0)} m²`} />
                    <MetricCard label="Blindspots ≥1m²" value={`${fmt(s?.significant_blindspot_m2, 0)} m²`} accent="text-yellow-300" />
                    <MetricCard label="Shelf occlusion %" value={`${fmt(fc?.occlusion, 1)}%`} sub="fragmentation cause" />
                    <MetricCard label="Blindspot gap %" value={`${fmt(fc?.blindspot, 1)}%`} sub="fragmentation cause" />
                  </div>
                  <ArtifactPanel
                    runId={detail.id}
                    artifacts={detail.artifacts.filter((a) =>
                      ['05_blindspots.png', '05_forensic.png', '02_spatial_motion.png'].includes(a.name),
                    )}
                    selectedImage={selectedImage}
                    onSelectImage={setSelectedImage}
                  />
                </div>
              )}

              {tab === 'artifacts' && (
                <ArtifactPanel
                  runId={detail.id}
                  artifacts={detail.artifacts}
                  selectedImage={selectedImage}
                  onSelectImage={setSelectedImage}
                />
              )}

              {detail.report_md && tab === 'overview' && (
                <details className="rounded-xl border border-gray-700 bg-gray-800/40">
                  <summary className="px-4 py-3 cursor-pointer text-sm text-gray-300 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Full REPORT.md
                  </summary>
                  <pre className="px-4 pb-4 text-xs text-gray-400 whitespace-pre-wrap font-mono overflow-x-auto max-h-96">
                    {detail.report_md}
                  </pre>
                </details>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
