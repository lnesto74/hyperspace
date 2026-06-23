import { useMemo, useState } from 'react';
import {
  Users,
  Clock,
  Euro,
  TrendingUp,
  Store,
  ShoppingBag,
  CreditCard,
  MonitorPlay,
  Lightbulb,
  Download,
  Radio,
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { EsselungaJourneyPayload, JourneyTab, ExecutiveVariant } from './types';
import ErpCsvUploadPanel from './ErpCsvUploadPanel';
import { exportWeeklyExecutivePdf } from './exportWeeklyPdf';
import {
  RingGauge,
  HorizontalBarChart,
  DonutSplit,
  JourneyFunnel,
  KpiTile,
  ChannelCompareChart,
} from './EsselungaCharts';
import { getCategoryVisual } from '../operationsConsole/categoryVisuals';

interface EsselungaExecutiveViewportProps {
  journey: EsselungaJourneyPayload;
  venueId: string;
  venueName: string;
  variant: ExecutiveVariant;
  onVariantChange: (v: ExecutiveVariant) => void;
  onRefresh: () => void;
}

const TABS: { id: JourneyTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'fresco', label: 'Piazza del Fresco' },
  { id: 'aisles', label: 'Aisles' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'media', label: 'Media' },
];

const CHANNEL_COLORS: Record<string, string> = {
  traditional: '#22c55e',
  selfCheckout: '#8b5cf6',
  selfScan: '#06b6d4',
};

const INSIGHT_COLOR = {
  good: 'border-green-500/40 bg-green-500/10',
  warn: 'border-amber-500/40 bg-amber-500/10',
  bad: 'border-red-500/40 bg-red-500/10',
  info: 'border-blue-500/40 bg-blue-500/10',
};

function CategoryChip({ label }: { label: string }) {
  const v = getCategoryVisual(label);
  const Icon = v.Icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium"
      style={{ backgroundColor: v.bg, color: v.color }}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

export default function EsselungaExecutiveViewport({
  journey,
  venueId,
  venueName,
  variant,
  onVariantChange,
  onRefresh,
}: EsselungaExecutiveViewportProps) {
  const [tab, setTab] = useState<JourneyTab>('overview');
  const [erpOpen, setErpOpen] = useState(!journey.erp.hasData);
  const { overview, fresco, aisles, checkout, crossKpis, media, erp, insights, taxonomy } = journey;

  const aisleCategoryBars = useMemo(
    () => (aisles.categoryGroups || []).map(g => ({
      label: g.category,
      value: g.visits,
      sub: `${g.stoppingPowerPct}% stop · ${g.avgDwellMin}m`,
    })),
    [aisles.categoryGroups],
  );

  const checkoutChannels = useMemo(
    () => checkout.channels.map(ch => ({
      ...ch,
      color: CHANNEL_COLORS[ch.id] || '#64748b',
    })),
    [checkout.channels],
  );

  const funnelSteps = useMemo(() => [
    { label: 'Ingress', value: overview.totalVisitors, color: '#3b82f6' },
    { label: 'Aisles', value: aisles.totalAisleVisits, color: '#f59e0b' },
    {
      label: 'Checkout',
      value: checkout.channels.reduce((s, c) => s + c.sessions, 0),
      color: '#22c55e',
    },
  ], [overview.totalVisitors, aisles.totalAisleVisits, checkout.channels]);

  const spiLabel = overview.spi != null
    ? (erp.hasData ? `€${overview.spi}` : String(overview.spi))
    : '—';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex bg-gray-800/80 rounded-lg p-0.5 border border-gray-700/50">
          <button
            type="button"
            onClick={() => onVariantChange('live')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all ${
              variant === 'live' ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/30' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Radio className="w-3 h-3" /> Store Director
          </button>
          <button
            type="button"
            onClick={() => onVariantChange('hq')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all ${
              variant === 'hq' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30' : 'text-gray-400 hover:text-white'
            }`}
          >
            <FileText className="w-3 h-3" /> HQ Weekly
          </button>
        </div>
        {variant === 'hq' && (
          <button
            type="button"
            onClick={() => exportWeeklyExecutivePdf(journey, venueName)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-gray-700 hover:bg-gray-600 text-white"
          >
            <Download className="w-3 h-3" /> Export PDF
          </button>
        )}
        <div className="flex gap-2 text-[10px] text-gray-500 ml-auto">
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">{taxonomy.fresco} fresco</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{taxonomy.aisles} aisles</span>
          <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">{taxonomy.checkout} checkout</span>
        </div>
      </div>

      <div className="rounded-lg border border-gray-700/50 bg-gray-800/30 overflow-hidden">
        <button
          type="button"
          onClick={() => setErpOpen(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-800/50"
        >
          <span className="text-xs text-gray-300">ERP / POS data {erp.hasData ? '· connected' : '· upload for SPI'}</span>
          {erpOpen ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
        </button>
        {erpOpen && (
          <div className="px-3 pb-3 border-t border-gray-700/40">
            <ErpCsvUploadPanel
              venueId={venueId}
              hasData={erp.hasData}
              lastUpload={erp.lastUpload}
              onUploaded={onRefresh}
              compact
            />
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-gray-700/60">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'text-white border-cyan-500 bg-gray-800/60'
                : 'text-gray-500 border-transparent hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
          <div className="xl:col-span-8 space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <KpiTile
                icon={Users}
                label="Store visitors"
                value={overview.totalVisitors.toLocaleString()}
                sub={overview.ingressEpisodes ? `${overview.ingressEpisodes.toLocaleString()} crossings` : 'LiDAR ingress'}
                accent="#3b82f6"
              />
              <KpiTile
                icon={Clock}
                label="Avg dwell"
                value={`${overview.avgStoreDwellMin}m`}
                sub="Store-wide"
                accent="#8b5cf6"
              />
              <KpiTile
                icon={Euro}
                label="Avg ticket"
                value={overview.avgTicket != null ? `€${overview.avgTicket.toFixed(2)}` : '—'}
                sub={erp.hasData ? 'ERP' : 'Upload CSV'}
                accent="#f59e0b"
              />
              <KpiTile
                icon={TrendingUp}
                label="SPI"
                value={spiLabel}
                sub={erp.hasData ? 'Revenue / dwell' : 'Needs ERP'}
                accent="#10b981"
              />
            </div>

            <div className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-4">
              <h3 className="text-xs font-semibold text-white mb-1">Customer journey funnel</h3>
              <p className="text-[10px] text-gray-500 mb-3">Ingress → aisle engagement → checkout sessions</p>
              <JourneyFunnel steps={funnelSteps} />
            </div>

            {aisleCategoryBars.length > 0 && (
              <div className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-4">
                <h3 className="text-xs font-semibold text-white mb-3">Top categories by traffic</h3>
                <HorizontalBarChart rows={aisleCategoryBars.slice(0, 8)} />
              </div>
            )}
          </div>

          <div className="xl:col-span-4 space-y-3">
            {variant === 'live' && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 flex items-center gap-3">
                <Store className="w-8 h-8 text-cyan-400 shrink-0" />
                <div>
                  <div className="text-2xl font-bold text-white">{overview.currentOccupancy}</div>
                  <div className="text-xs text-cyan-300/80">shoppers in store now</div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-4 grid grid-cols-3 gap-2">
              <RingGauge value={aisles.penetrationPct} label="Penetration" sub="reach aisles" color="#f59e0b" />
              <RingGauge value={aisles.stoppingPowerPct} label="Stopping" sub="dwell visits" color="#a78bfa" />
              <RingGauge value={checkout.avgWaitMin} max={10} label="Avg wait" sub="minutes" color="#22c55e" />
            </div>

            {insights.length > 0 && (
              <div className="rounded-xl border border-gray-700/60 bg-gray-800/40 overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-700/50 flex items-center gap-2">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-semibold text-white">Actionable insights</span>
                </div>
                <div className="p-2 space-y-2">
                  {insights.slice(0, 3).map(ins => (
                    <div key={ins.id} className={`rounded-lg border p-2.5 ${INSIGHT_COLOR[ins.severity]}`}>
                      <div className="text-xs font-medium text-white">{ins.title}</div>
                      <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">{ins.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'fresco' && (
        <div>
          {fresco.departments.length === 0 ? (
            <div className="rounded-xl border border-gray-700/60 bg-gray-800/30 p-8 text-center">
              <p className="text-sm text-gray-400">No service counters (banco) detected.</p>
              <p className="text-xs text-gray-600 mt-1">Tag banco fixtures with categories like Pesce, Pane, Salumi in DWG mapping.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {fresco.departments.map(dept => {
                const visual = getCategoryVisual(dept.label);
                const Icon = visual.Icon;
                return (
                  <div
                    key={dept.id}
                    className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-4 flex flex-col gap-3"
                    style={{ borderLeftWidth: 3, borderLeftColor: visual.color }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: visual.bg }}
                        >
                          <Icon className="w-5 h-5" style={{ color: visual.color }} />
                        </span>
                        <div className="min-w-0">
                          <CategoryChip label={dept.label} />
                          <div className="text-[10px] text-gray-500 mt-1">{dept.visits.toLocaleString()} visits</div>
                        </div>
                      </div>
                      <DonutSplit browsingPct={dept.browsingPct} waitingPct={dept.waitingPct} size={72} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-gray-700/40">
                      <div>
                        <div className="text-sm font-semibold text-white">{dept.avgDwellMin}m</div>
                        <div className="text-[8px] text-gray-500">dwell</div>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-emerald-400">{dept.browsingPct}%</div>
                        <div className="text-[8px] text-gray-500">browsing</div>
                      </div>
                      <div>
                        <div className={`text-sm font-semibold ${dept.waitingPct > 15 ? 'text-amber-400' : 'text-gray-300'}`}>
                          {dept.waitingPct}%
                        </div>
                        <div className="text-[8px] text-gray-500">waiting</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'aisles' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
          <div className="xl:col-span-5 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <RingGauge value={aisles.penetrationPct} label="Penetration" color="#3b82f6" />
              <RingGauge value={aisles.stoppingPowerPct} label="Stopping power" color="#a78bfa" />
              <RingGauge value={aisles.bypassPct} label="Bypass" color="#64748b" />
            </div>
            <div className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-4">
              <h3 className="text-xs font-semibold text-white mb-3">Traffic by category</h3>
              <HorizontalBarChart rows={aisleCategoryBars} maxBars={14} />
            </div>
          </div>
          <div className="xl:col-span-7">
            <div className="rounded-xl border border-gray-700/60 bg-gray-800/40 overflow-hidden h-full">
              <div className="px-4 py-2.5 border-b border-gray-700/50 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white">Zone performance</h3>
                <span className="text-[10px] text-gray-500">Grouped by DWG category tag</span>
              </div>
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900/95 z-10">
                    <tr className="text-gray-500 border-b border-gray-700/40">
                      <th className="text-left px-4 py-2 font-medium">Category</th>
                      <th className="text-left px-4 py-2 font-medium">Zone</th>
                      <th className="text-right px-4 py-2 font-medium">Visits</th>
                      <th className="text-right px-4 py-2 font-medium">Stop</th>
                      <th className="text-right px-4 py-2 font-medium">Dwell</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aisles.topAisles.map(row => (
                      <tr key={row.id} className="border-b border-gray-800/50 hover:bg-white/[0.02]">
                        <td className="px-4 py-2">
                          <CategoryChip label={row.category} />
                        </td>
                        <td className="px-4 py-2 text-gray-500 truncate max-w-[140px]">{row.name}</td>
                        <td className="px-4 py-2 text-right text-gray-200 tabular-nums">{row.visits.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-gray-300 tabular-nums">{row.stoppingPowerPct}%</td>
                        <td className="px-4 py-2 text-right text-gray-300 tabular-nums">{row.avgDwellMin}m</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'checkout' && (
        <div className="space-y-3">
          {checkoutChannels.length === 0 ? (
            <p className="text-xs text-gray-500 py-8 text-center">No checkout zones found.</p>
          ) : (
            <>
              <ChannelCompareChart channels={checkoutChannels} />
              {checkout.frictionScore != null && (
                <div className="rounded-lg border border-gray-700/50 bg-gray-800/30 px-4 py-2 flex items-center justify-between text-xs">
                  <span className="text-gray-400">Checkout friction score</span>
                  <span className="text-white font-medium">{checkout.frictionScore}</span>
                  <span className="text-gray-600">wait ÷ store dwell</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'media' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
          <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-6 flex items-center gap-6">
            <RingGauge value={media.ces} max={100} label="CES" color="#a78bfa" size={96} />
            <div>
              <h3 className="text-sm font-semibold text-white">Campaign effectiveness</h3>
              <p className="text-xs text-gray-500 mt-1">PEBLE composite score across active screens</p>
            </div>
          </div>
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-6 flex items-center gap-6">
            <RingGauge value={media.eal} max={100} label="EAL" color="#38bdf8" size={96} />
            <div>
              <h3 className="text-sm font-semibold text-white">Exposure lift</h3>
              <p className="text-xs text-gray-500 mt-1">Incremental visits attributed to DOOH</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
