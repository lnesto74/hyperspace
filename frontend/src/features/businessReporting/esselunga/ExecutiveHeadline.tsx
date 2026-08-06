import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ExecutiveHeadline, HeadlineKpi } from './types';

/**
 * The top of the executive report: a verdict sentence, then the numbers it is
 * based on. Everything else on the tab is detail behind these two blocks.
 */

const TONE_STYLE: Record<ExecutiveHeadline['tone'], { bar: string; ring: string; label: string; text: string }> = {
  good: { bar: 'bg-emerald-400', ring: 'border-emerald-500/30', label: 'text-emerald-300', text: 'On track' },
  warn: { bar: 'bg-amber-400', ring: 'border-amber-500/30', label: 'text-amber-300', text: 'Watch' },
  bad: { bar: 'bg-rose-400', ring: 'border-rose-500/30', label: 'text-rose-300', text: 'Action needed' },
  info: { bar: 'bg-sky-400', ring: 'border-sky-500/30', label: 'text-sky-300', text: 'No comparison' },
};

export function VerdictBanner({
  headline,
  venueName,
  rangeLabel,
  generatedAtLabel,
}: {
  headline?: ExecutiveHeadline;
  venueName: string;
  rangeLabel: string;
  generatedAtLabel: string;
}) {
  const tone = TONE_STYLE[headline?.tone ?? 'info'];

  return (
    <section className={`relative rounded-2xl border ${tone.ring} bg-gray-800/40 overflow-hidden`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} aria-hidden />
      <div className="pl-6 pr-5 py-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold text-white tracking-tight">{venueName}</h1>
          <span className="text-[13px] text-gray-400">{rangeLabel}</span>
          <span
            className={`ml-auto text-xs uppercase tracking-wider font-medium ${tone.label}`}
          >
            {tone.text}
          </span>
        </div>
        <p className="text-[17px] text-gray-100 leading-relaxed max-w-4xl">
          {headline?.text ?? 'Not enough data in this window to summarise the period.'}
        </p>
        <p className="text-xs text-gray-400">Updated {generatedAtLabel}</p>
      </div>
    </section>
  );
}

function DeltaChip({ kpi }: { kpi: HeadlineKpi }) {
  if (kpi.deltaPct == null) {
    // A withheld comparison and an absent one look the same on screen, so say
    // which it is: "not comparable" is a statement about our measurement, and
    // an executive who is told a number moved and then told it did not will
    // stop believing the rest of the page.
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-gray-400"
        title={kpi.noCompareReason ?? undefined}
      >
        <Minus className="w-3 h-3" />
        {kpi.noCompareReason ? 'not comparable' : 'no comparison'}
      </span>
    );
  }

  const Icon = kpi.direction === 'up' ? ArrowUpRight : kpi.direction === 'down' ? ArrowDownRight : Minus;
  const colour = kpi.good === null
    ? 'text-gray-400'
    : kpi.good
      ? 'text-emerald-400'
      : 'text-rose-400';

  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${colour}`}>
      <Icon className="w-3.5 h-3.5" />
      {Math.abs(kpi.deltaPct)}%
      <span className="text-gray-400 font-normal ml-1">vs last week</span>
    </span>
  );
}

export function HeadlineKpiGrid({ items }: { items: HeadlineKpi[] }) {
  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map(kpi => (
        <div
          key={kpi.id}
          className="rounded-xl border border-gray-700/60 bg-gray-800/40 px-5 py-5 flex flex-col gap-2"
        >
          <span className="text-xs uppercase tracking-wider text-gray-400">{kpi.label}</span>
          <span className="text-4xl font-semibold text-white tabular-nums leading-none">
            {kpi.display}
          </span>
          <DeltaChip kpi={kpi} />
          <span className="text-[13px] text-gray-400 leading-snug mt-0.5">{kpi.hint}</span>
        </div>
      ))}
    </div>
  );
}
