import { useState } from 'react';
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
} from 'lucide-react';
import type { EsselungaJourneyPayload, JourneyTab, ExecutiveVariant } from './types';
import ErpCsvUploadPanel from './ErpCsvUploadPanel';
import { exportWeeklyExecutivePdf } from './exportWeeklyPdf';

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

const INSIGHT_COLOR = {
  good: 'border-green-500/40 bg-green-500/10',
  warn: 'border-amber-500/40 bg-amber-500/10',
  bad: 'border-red-500/40 bg-red-500/10',
  info: 'border-blue-500/40 bg-blue-500/10',
};

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Users;
}) {
  return (
    <div className="rounded-lg border border-gray-700/80 bg-gray-800/50 p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-lg font-semibold text-white">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function SplitBar({ browsingPct, waitingPct }: { browsingPct: number; waitingPct: number }) {
  return (
    <div className="h-2 rounded-full overflow-hidden flex bg-gray-700/80">
      <div className="bg-emerald-500/80" style={{ width: `${browsingPct}%` }} title={`Browsing ${browsingPct}%`} />
      <div className="bg-amber-500/80" style={{ width: `${waitingPct}%` }} title={`Waiting ${waitingPct}%`} />
    </div>
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
  const { overview, fresco, aisles, checkout, crossKpis, media, erp, insights, taxonomy } = journey;

  const spiLabel = overview.spi != null
    ? (erp.hasData ? `€${overview.spi}` : String(overview.spi))
    : '—';

  return (
    <div className="space-y-3">
      {/* Audience + ERP controls */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex bg-gray-700/80 rounded-md p-0.5">
          <button
            type="button"
            onClick={() => onVariantChange('live')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded ${variant === 'live' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            <Radio className="w-3 h-3" /> Store Director
          </button>
          <button
            type="button"
            onClick={() => onVariantChange('hq')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded ${variant === 'hq' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
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
        <span className="text-[10px] text-gray-500 ml-auto">
          {taxonomy.fresco} fresco · {taxonomy.aisles} aisles · {taxonomy.checkout} checkout ROIs
        </span>
      </div>

      <ErpCsvUploadPanel
        venueId={venueId}
        hasData={erp.hasData}
        lastUpload={erp.lastUpload}
        onUploaded={onRefresh}
        compact={variant === 'live'}
      />

      {/* Journey tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-700/60 pb-1">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1 text-xs rounded-t-md transition-colors ${
              tab === t.id
                ? 'bg-gray-800 text-white border border-b-0 border-gray-600'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <MetricCard icon={Users} label="Store visitors" value={overview.totalVisitors.toLocaleString()} sub="LiDAR ingress" />
            <MetricCard icon={Clock} label="Avg dwell" value={`${overview.avgStoreDwellMin}m`} sub="Store-wide" />
            <MetricCard
              icon={Euro}
              label="Avg ticket"
              value={overview.avgTicket != null ? `€${overview.avgTicket.toFixed(2)}` : '—'}
              sub={erp.hasData ? 'From ERP CSV' : 'Upload ERP CSV'}
            />
            <MetricCard icon={TrendingUp} label="SPI" value={spiLabel} sub={erp.hasData ? 'Revenue / dwell proxy' : 'Requires ERP'} />
          </div>
          {variant === 'live' && (
            <div className="text-xs text-gray-400 flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 text-cyan-400" />
              Live occupancy: <span className="text-white font-medium">{overview.currentOccupancy}</span> shoppers in store
            </div>
          )}
          {crossKpis.shoppingEfficiency != null && (
            <div className="rounded-lg border border-gray-700/60 bg-gray-800/30 px-3 py-2 text-xs text-gray-300">
              Shopping efficiency: <span className="text-white font-medium">€{crossKpis.shoppingEfficiency}/min</span> dwell
              {checkout.frictionScore != null && (
                <span className="text-gray-500 ml-3">Checkout friction: {checkout.frictionScore}</span>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'fresco' && (
        <div className="space-y-2">
          {fresco.departments.length === 0 ? (
            <p className="text-xs text-gray-500 py-4">No Piazza del Fresco zones tagged. Check ROI metadata (ortofrutta, macelleria, gastronomia).</p>
          ) : (
            fresco.departments.map(dept => (
              <div key={dept.id} className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{dept.label}</span>
                  <span className="text-xs text-gray-400">{dept.visits.toLocaleString()} visits · {dept.avgDwellMin}m dwell</span>
                </div>
                <SplitBar browsingPct={dept.browsingPct} waitingPct={dept.waitingPct} />
                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                  <span>Browsing {dept.browsingPct}%</span>
                  <span>Waiting {dept.waitingPct}%</span>
                  {dept.abandonPct > 0 && <span className="text-amber-400">{dept.abandonPct}% abandon</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'aisles' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <MetricCard icon={ShoppingBag} label="Penetration" value={`${aisles.penetrationPct}%`} sub="Entrants reaching aisles" />
            <MetricCard icon={Clock} label="Stopping power" value={`${aisles.stoppingPowerPct}%`} sub="Visits with dwell" />
            <MetricCard icon={TrendingUp} label="Bypass rate" value={`${aisles.bypassPct}%`} sub="Pass-through without stop" />
          </div>
          {aisles.aisleConversionPct != null && (
            <p className="text-xs text-gray-400">Aisle conversion (ERP): <span className="text-white">{aisles.aisleConversionPct}%</span></p>
          )}
          {aisles.topAisles.length > 0 && (
            <div className="rounded-lg border border-gray-700/60 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-700/60 text-xs font-medium text-white">Top aisles</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700/40">
                    <th className="text-left px-3 py-1.5 font-normal">Zone</th>
                    <th className="text-right px-3 py-1.5 font-normal">Visits</th>
                    <th className="text-right px-3 py-1.5 font-normal">Stop %</th>
                    <th className="text-right px-3 py-1.5 font-normal">Dwell</th>
                  </tr>
                </thead>
                <tbody>
                  {aisles.topAisles.map(row => (
                    <tr key={row.id} className="border-b border-gray-800/60">
                      <td className="px-3 py-1.5 text-gray-200 truncate max-w-[180px]">{row.name}</td>
                      <td className="px-3 py-1.5 text-right text-gray-300">{row.visits}</td>
                      <td className="px-3 py-1.5 text-right text-gray-300">{row.stoppingPowerPct}%</td>
                      <td className="px-3 py-1.5 text-right text-gray-300">{row.avgDwellMin}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'checkout' && (
        <div className="space-y-2">
          {checkout.channels.length === 0 ? (
            <p className="text-xs text-gray-500 py-4">No checkout zones found. Tag ROIs with checkout_channel metadata.</p>
          ) : (
            checkout.channels.map(ch => (
              <div key={ch.id} className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-medium text-white">{ch.label}</span>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                  <span>{ch.sessions} sessions</span>
                  <span>{ch.avgWaitMin}m avg wait</span>
                  <span className={ch.abandonPct > 15 ? 'text-amber-400' : ''}>{ch.abandonPct}% abandon</span>
                  {variant === 'live' && ch.currentQueue > 0 && (
                    <span className="text-cyan-400">{ch.currentQueue} in queue now</span>
                  )}
                </div>
              </div>
            ))
          )}
          {checkout.frictionScore != null && (
            <p className="text-xs text-gray-500">Checkout friction score: {checkout.frictionScore} (wait ÷ store dwell)</p>
          )}
        </div>
      )}

      {tab === 'media' && (
        <div className="grid grid-cols-2 gap-2 max-w-md">
          <MetricCard icon={MonitorPlay} label="Campaign score (CES)" value={String(media.ces)} sub="PEBLE effectiveness" />
          <MetricCard icon={TrendingUp} label="Exposure lift (EAL)" value={`${media.eal}%`} sub="Attributed visits" />
        </div>
      )}

      {/* Top 3 insights — always visible */}
      {insights.length > 0 && (
        <div className="rounded-lg border border-gray-700/80 bg-gray-800/30 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-700/60 flex items-center gap-2">
            <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-medium text-white">Top {Math.min(3, insights.length)} actionable insights</span>
          </div>
          <div className="p-2 space-y-2">
            {insights.slice(0, 3).map(ins => (
              <div key={ins.id} className={`rounded-md border p-2.5 ${INSIGHT_COLOR[ins.severity]}`}>
                <div className="text-xs font-medium text-white">{ins.title}</div>
                <p className="text-[10px] text-gray-300 mt-0.5">{ins.message}</p>
                <p className="text-[10px] text-gray-500 mt-1">→ {ins.action}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
