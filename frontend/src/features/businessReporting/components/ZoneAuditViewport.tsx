/**
 * Measurement audit — the tab for deciding whether a number that looks wrong is
 * the store's behaviour, our processing, or the perception vendor's tracking.
 *
 * Nothing here is a business KPI. It is built to be read by someone holding the
 * supplier to account, so every figure names the identity it was measured
 * against and every limit of the method is stated on screen rather than
 * smoothed over.
 *
 * Two sources, deliberately not blended:
 *
 *   Raw feed      the vendor's archived 10 Hz messages, replayed offline. This
 *                 is the only place a true walked distance exists, and it is
 *                 produced by a nightly job because a trading day is tens of
 *                 millions of messages.
 *
 *   Stored data   the 3-second position samples the database keeps, for any
 *                 window you like, computed on request.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Download, Info, RefreshCw, Search } from 'lucide-react';
import { API_BASE } from '../../../config/api';
import { useAuth } from '../../../context/AuthContext';

interface IdentitySummary {
  tracks: number;
  meanPathM: number | null;
  medianPathM: number | null;
  p90PathM: number | null;
  meanSampledPathM: number | null;
  totalPathM: number | null;
  meanDurationSec: number | null;
  medianDurationSec: number | null;
  p90DurationSec: number | null;
  ghostPct: number | null;
  teleports?: number;
  teleportPctOfSteps?: number | null;
  coverageGaps?: number;
  gapSecTotal?: number | null;
  gapShareOfLifetimePct?: number | null;
}

interface RawTruthZone {
  id: string;
  name: string;
  category: string | null;
  role: string | null;
  areaM2: number | null;
  spanM: number | null;
  raw: { visits: number; meanPathM: number | null; meanDwellSec: number | null; meanSamplesPerVisit: number | null };
  reconciled: { visits: number; people: number; meanPathM: number | null; meanDwellSec: number | null };
  sampled: { meanPathM: number | null; pathRetainedPct: number | null };
  pathVsSpan: number | null;
  fragmentsPerVisit: number | null;
}

interface RawTruthPayload {
  available: boolean;
  reason?: string;
  date?: string;
  runs?: string[];
  venueName?: string;
  window?: { firstTs: number | null; lastTs: number | null; durationSec: number | null };
  generatedAt?: string;
  method?: Record<string, unknown>;
  ingest?: { linesRead: number; messagesUsed: number; medianFrameIntervalMs: number | null; elapsedSec: number };
  totals?: {
    raw: IdentitySummary;
    reconciled: IdentitySummary;
    distinctVendorIds: number;
    vendorFragmentsPerPerson: number | null;
    peopleAffectedByFragmentationPct: number | null;
    journeyHeldByVendorIdentityPct: number | null;
    journeyHeldByVendorIdentitySec: number | null;
    bridgesPerPerson: number | null;
    meanBridgedDistanceM: number | null;
    meanBridgedSec: number | null;
    fragmentsDroppedAsGhosts: number;
    conservationErrorPct: number | null;
    pathRetainedBySamplingPct: number | null;
  };
  zones?: RawTruthZone[];
}

interface StoredAuditZone {
  id: string;
  name: string;
  category: string | null;
  areaM2: number | null;
  spanM: number | null;
  visits: number;
  tracks: number;
  sessions: number;
  meanDwellSec: number | null;
  medianDwellSec: number | null;
  distinctDurations: number;
  durationResolution: number | null;
  zeroLengthPct: number | null;
  meanPathM: number | null;
  pathVsSpan: number | null;
  samplesPerRun: number | null;
  singleSamplePct: number | null;
  rawPerceptionIds: number;
  reconciledTracks: number;
  fragmentsPerTrack: number | null;
}

interface StoredAuditPayload {
  totals: {
    visits: number;
    zones: number;
    venueRawPerceptionIds: number;
    venueReconciledTracks: number;
    venueFragmentsPerTrack: number | null;
    positionSamples: number;
  };
  method?: { note?: string };
  zones: StoredAuditZone[];
}

interface Props {
  venueId: string;
  startTs: number;
  endTs: number;
}

const nf = (v: number | null | undefined, dp = 1) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(dp).replace(/\.0$/, '');

const secs = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v < 60) return `${v.toFixed(1).replace(/\.0$/, '')}s`;
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
};

/** A judgement, not a decoration: green only where the measurement is sound. */
function verdictColor(good: boolean, warn: boolean) {
  if (good) return 'text-emerald-400';
  if (warn) return 'text-amber-400';
  return 'text-red-400';
}

function Card({
  label, value, sub, tone,
}: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="rounded-lg border border-gray-700/70 bg-gray-800/40 p-4">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-1.5 text-[11px] leading-snug text-gray-400">{sub}</div>
    </div>
  );
}

export default function ZoneAuditViewport({ venueId, startTs, endTs }: Props) {
  const { token } = useAuth();
  const [truth, setTruth] = useState<RawTruthPayload | null>(null);
  const [stored, setStored] = useState<StoredAuditPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showMethod, setShowMethod] = useState(false);

  // These endpoints are superadmin-only, so unlike the rest of the reporting
  // API they need the session token attached.
  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [truthRes, storedRes] = await Promise.all([
        fetch(`${API_BASE}/api/reporting/raw-path-truth?venueId=${encodeURIComponent(venueId)}`, {
          headers: authHeaders,
        }),
        fetch(
          `${API_BASE}/api/reporting/zone-audit?venueId=${encodeURIComponent(venueId)}&startTs=${startTs}&endTs=${endTs}`,
          { headers: authHeaders },
        ),
      ]);
      setTruth(truthRes.ok ? await truthRes.json() : { available: false, reason: 'Raw-feed run unavailable.' });
      if (storedRes.ok) setStored(await storedRes.json());
      else setError((await storedRes.json())?.error || 'Zone audit failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed');
    } finally {
      setLoading(false);
    }
  }, [venueId, startTs, endTs, authHeaders]);

  /**
   * Fetched rather than opened in a tab: the route needs an Authorization
   * header, which a plain window.open cannot carry.
   */
  const downloadPdf = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ venueId, startTs: String(startTs), endTs: String(endTs) });
      const res = await fetch(`${API_BASE}/api/reporting/measurement-audit/pdf?${params}`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error((await res.json())?.error || 'Report could not be generated');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]
        || 'measurement-audit.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }, [venueId, startTs, endTs, authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const truthZones = useMemo(() => {
    const rows = truth?.zones || [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (z) => z.name.toLowerCase().includes(q) || (z.category || '').toLowerCase().includes(q),
    );
  }, [truth, filter]);

  const storedZones = useMemo(() => {
    const rows = stored?.zones || [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (z) => z.name.toLowerCase().includes(q) || (z.category || '').toLowerCase().includes(q),
    );
  }, [stored, filter]);

  const t = truth?.totals;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Measurement audit</h2>
            <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-gray-400">
              Evidence for whether a suspicious number comes from the store, from our processing, or from the
              perception supplier. The same people are counted three ways — as the vendor's own object ids, as
              the identities our reconciler stitches together in real time, and as what the database keeps
              afterwards — so the effect of each stage is visible on its own.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => void downloadPdf()}
              disabled={downloading || loading}
              className="flex items-center gap-1.5 rounded-md bg-gray-700 px-3 py-2 text-xs text-white hover:bg-gray-600 disabled:opacity-50"
              title="Download this audit as a PDF"
            >
              <Download className="h-3.5 w-3.5" />
              {downloading ? 'Preparing…' : 'Download audit'}
            </button>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="rounded-md bg-gray-700 p-2 text-gray-300 hover:bg-gray-600 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* ---------------- Raw vendor feed ---------------- */}
      <section className="rounded-lg border border-gray-700/80 bg-gray-800/40 overflow-hidden">
        <header className="border-b border-gray-700/60 px-5 py-4">
          <h3 className="text-base font-semibold text-white">What the perception supplier delivered</h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-400">
            Measured from the archived MQTT feed at the full 10 Hz the supplier publishes, so distances here are
            true walked paths rather than the corner-cutting estimate the stored 3-second samples allow. The same
            frames are then replayed through the production reconciler, which is what makes the before-and-after
            an equal comparison.
          </p>
        </header>

        {!truth?.available ? (
          <div className="px-5 py-6 text-xs text-gray-400">
            {truth?.reason || 'No raw-feed forensic run is available yet.'}{' '}
            A run covers one trading day and is produced offline overnight.
          </div>
        ) : (
          <>
            <div className="border-b border-gray-700/60 px-5 py-3 text-[11px] text-gray-400">
              {truth.date} · {truth.ingest?.messagesUsed?.toLocaleString()} messages at{' '}
              {truth.ingest?.medianFrameIntervalMs} ms between frames ·{' '}
              {t?.raw.tracks.toLocaleString()} supplier tracks from{' '}
              {t?.distinctVendorIds?.toLocaleString()} object ids →{' '}
              {t?.reconciled.tracks.toLocaleString()} people after reconciliation
            </div>

            <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
              <Card
                label="Identities per person"
                value={nf(t?.vendorFragmentsPerPerson, 2)}
                tone={verdictColor((t?.vendorFragmentsPerPerson ?? 9) < 1.2, (t?.vendorFragmentsPerPerson ?? 9) < 1.6)}
                sub={`The supplier emitted this many separate continuous tracks for each shopper. ${nf(
                  t?.peopleAffectedByFragmentationPct,
                )}% of people were split across more than one id.`}
              />
              <Card
                label="Journey held by one id"
                value={`${nf(t?.journeyHeldByVendorIdentityPct)}%`}
                tone={verdictColor((t?.journeyHeldByVendorIdentityPct ?? 0) > 85, (t?.journeyHeldByVendorIdentityPct ?? 0) > 60)}
                sub={`A single supplier identity covers only this share of the distance one shopper actually walks — ${nf(
                  t?.raw.meanPathM,
                  2,
                )} m of ${nf(t?.reconciled.meanPathM, 2)} m.`}
              />
              <Card
                label="Median track life"
                value={secs(t?.raw.medianDurationSec)}
                tone={verdictColor((t?.raw.medianDurationSec ?? 0) > 20, (t?.raw.medianDurationSec ?? 0) > 8)}
                sub={`Half of the supplier's tracks are shorter than this. After reconciliation the median presence is ${secs(
                  t?.reconciled.medianDurationSec,
                )}.`}
              />
              <Card
                label="Tracks that never moved"
                value={`${nf(t?.raw.ghostPct)}%`}
                tone={verdictColor((t?.raw.ghostPct ?? 100) < 10, (t?.raw.ghostPct ?? 100) < 25)}
                sub="Share of supplier tracks whose entire path is under half a metre — clutter that every downstream count has to discard."
              />
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-gray-700/60 px-5 pb-5 pt-4 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 p-4">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Route we had to infer</div>
                <div className="mt-1.5 text-xl font-semibold tabular-nums text-amber-400">
                  {nf(t?.meanBridgedDistanceM, 2)} m · {secs(t?.meanBridgedSec)}
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-gray-400">
                  Per shopper, the distance and time the supplier stopped reporting them entirely, across{' '}
                  {nf(t?.bridgesPerPerson, 2)} dropouts each. Reconciliation bridges these; without it every dropout
                  starts a new person. It is counted apart from measured distance because it is inferred.
                </p>
              </div>
              <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 p-4">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Distance is conserved</div>
                <div className="mt-1.5 text-xl font-semibold tabular-nums text-gray-200">
                  {nf(t?.raw.totalPathM, 0)} m → {nf(t?.reconciled.totalPathM, 0)} m
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-gray-400">
                  Total walked distance before and after reconciliation, agreeing to{' '}
                  {nf(t?.conservationErrorPct, 3)}%. A person's distance is the sum of their own fragments, so
                  reconciliation cannot invent a metre — it only stops crediting one shopper's metres to strangers.
                </p>
              </div>
              <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 p-4">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Kept by our 3-second sampling</div>
                <div className="mt-1.5 text-xl font-semibold tabular-nums text-sky-400">
                  {nf(t?.pathRetainedBySamplingPct)}%
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-gray-400">
                  How much of the true path survives in the database once positions are stored every 3 seconds. This
                  one is ours, not the supplier's: every distance in the table below the fold is reduced by it.
                </p>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ---------------- Filter ---------------- */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter zones by name or category…"
            className="w-full rounded-md border border-gray-700 bg-gray-800/60 py-2 pl-9 pr-3 text-xs text-white placeholder:text-gray-500 focus:border-sky-500 focus:outline-none"
          />
        </div>
        <button
          onClick={() => setShowMethod((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs text-gray-300 hover:bg-gray-700/60"
        >
          <Info className="h-3.5 w-3.5" />
          How these are measured
          {showMethod ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {showMethod && truth?.method && (
        <div className="space-y-2 rounded-lg border border-gray-700/70 bg-gray-900/40 p-5 text-[11px] leading-relaxed text-gray-400">
          {Object.entries(truth.method)
            .filter(([, v]) => typeof v === 'string')
            .map(([k, v]) => (
              <p key={k}>
                <span className="text-gray-300">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}: </span>
                {v as string}
              </p>
            ))}
        </div>
      )}

      {/* ---------------- Per-zone true path ---------------- */}
      {truth?.available && (
        <section className="rounded-lg border border-gray-700/80 bg-gray-800/40 overflow-hidden">
          <header className="border-b border-gray-700/60 px-5 py-4">
            <h3 className="text-base font-semibold text-white">True path per zone, before and after reconciliation</h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-400">
              Distance walked inside each zone, measured at full frame rate. Compare it with the zone's own span —
              roughly how far a straight crossing is — to tell a zone people walk through from one they stand in.
              Where the raw and reconciled columns diverge, the supplier was splitting one visit into several.
            </p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700/60 text-left text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3 font-medium">Zone</th>
                  <th className="px-3 py-3 font-medium">Category</th>
                  <th className="px-3 py-3 text-right font-medium">Span</th>
                  <th className="px-3 py-3 text-right font-medium">Visits raw</th>
                  <th className="px-3 py-3 text-right font-medium">Visits rec.</th>
                  <th className="px-3 py-3 text-right font-medium">Path raw</th>
                  <th className="px-3 py-3 text-right font-medium">Path rec.</th>
                  <th className="px-3 py-3 text-right font-medium">Path stored</th>
                  <th className="px-3 py-3 text-right font-medium">Dwell raw</th>
                  <th className="px-3 py-3 text-right font-medium">Dwell rec.</th>
                  <th className="px-3 py-3 text-right font-medium">Frag.</th>
                </tr>
              </thead>
              <tbody>
                {truthZones.map((z) => (
                  <tr key={z.id} className="border-b border-gray-800/60 hover:bg-gray-700/20">
                    <td className="px-4 py-3 text-gray-200">{z.name}</td>
                    <td className="px-3 py-3 text-gray-400">{z.category || <span className="text-gray-600">untagged</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-400">{nf(z.spanM)} m</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-400">{z.raw.visits}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-200">{z.reconciled.visits}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-400">{nf(z.raw.meanPathM, 2)} m</td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-300">{nf(z.reconciled.meanPathM, 2)} m</td>
                    <td className="px-3 py-3 text-right tabular-nums text-sky-300/80">{nf(z.sampled.meanPathM, 2)} m</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-400">{secs(z.raw.meanDwellSec)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-300">{secs(z.reconciled.meanDwellSec)}</td>
                    <td
                      className={`px-3 py-3 text-right tabular-nums ${
                        (z.fragmentsPerVisit ?? 1) >= 1.4 ? 'text-red-400' : (z.fragmentsPerVisit ?? 1) >= 1.2 ? 'text-amber-400' : 'text-gray-400'
                      }`}
                    >
                      {nf(z.fragmentsPerVisit, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---------------- Stored-data audit ---------------- */}
      <section className="rounded-lg border border-gray-700/80 bg-gray-800/40 overflow-hidden">
        <header className="border-b border-gray-700/60 px-5 py-4">
          <h3 className="text-base font-semibold text-white">Stored data for the selected window</h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-400">
            The same zones as the dashboards read them, from the 3-second position samples the database keeps.
            Distances here are lower bounds by construction. The column worth watching is duration resolution: a
            zone with many visits sharing only a handful of distinct durations is being measured on a coarse clock,
            whatever its average happens to be.
          </p>
        </header>
        {stored?.totals && (
          <div className="border-b border-gray-700/60 px-5 py-3 text-[11px] text-gray-400">
            {stored.totals.visits.toLocaleString()} visits across {stored.totals.zones} zones ·{' '}
            {stored.totals.positionSamples.toLocaleString()} stored positions ·{' '}
            {stored.totals.venueRawPerceptionIds.toLocaleString()} vendor ids →{' '}
            {stored.totals.venueReconciledTracks.toLocaleString()} tracks
            {stored.totals.venueFragmentsPerTrack != null && ` (${nf(stored.totals.venueFragmentsPerTrack, 2)} per track)`}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700/60 text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3 font-medium">Zone</th>
                <th className="px-3 py-3 font-medium">Category</th>
                <th className="px-3 py-3 text-right font-medium">Visits</th>
                <th className="px-3 py-3 text-right font-medium">Mean dwell</th>
                <th className="px-3 py-3 text-right font-medium">Median dwell</th>
                <th className="px-3 py-3 text-right font-medium">Distinct durations</th>
                <th className="px-3 py-3 text-right font-medium">Path</th>
                <th className="px-3 py-3 text-right font-medium">Path ÷ span</th>
                <th className="px-3 py-3 text-right font-medium">Single-sample</th>
                <th className="px-3 py-3 text-right font-medium">Ids per track</th>
              </tr>
            </thead>
            <tbody>
              {storedZones.map((z) => (
                <tr key={z.id} className="border-b border-gray-800/60 hover:bg-gray-700/20">
                  <td className="px-4 py-3 text-gray-200">{z.name}</td>
                  <td className="px-3 py-3 text-gray-400">{z.category || <span className="text-gray-600">untagged</span>}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-200">{z.visits}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-300">{secs(z.meanDwellSec)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-400">{secs(z.medianDwellSec)}</td>
                  <td
                    className={`px-3 py-3 text-right tabular-nums ${
                      z.visits > 50 && z.distinctDurations < z.visits * 0.2 ? 'text-amber-400' : 'text-gray-400'
                    }`}
                  >
                    {z.distinctDurations}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-400">{nf(z.meanPathM, 2)} m</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-400">{nf(z.pathVsSpan, 2)}</td>
                  <td
                    className={`px-3 py-3 text-right tabular-nums ${
                      (z.singleSamplePct ?? 0) > 40 ? 'text-red-400' : (z.singleSamplePct ?? 0) > 20 ? 'text-amber-400' : 'text-gray-400'
                    }`}
                  >
                    {nf(z.singleSamplePct)}%
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-400">{nf(z.fragmentsPerTrack, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stored?.method?.note && (
          <p className="border-t border-gray-700/60 px-5 py-4 text-[11px] leading-relaxed text-gray-500">
            {stored.method.note}
          </p>
        )}
      </section>
    </div>
  );
}
