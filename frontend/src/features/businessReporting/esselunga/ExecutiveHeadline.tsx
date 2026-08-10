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

/**
 * The verdict and the numbers behind it share one frame. Split across two
 * blocks they read as unrelated, and the gap between them was the single
 * biggest band of empty space at the top of the page.
 */
export function ExecutiveHeader({
  headline,
  venueName,
  rangeLabel,
  generatedAtLabel,
  kpis,
}: {
  headline?: ExecutiveHeadline;
  venueName: string;
  rangeLabel: string;
  generatedAtLabel: string;
  kpis: HeadlineKpi[];
}) {
  const tone = TONE_STYLE[headline?.tone ?? 'info'];

  return (
    <section className={`relative rounded-2xl border ${tone.ring} bg-gray-800/40 overflow-hidden`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} aria-hidden />
      <div className="pl-6 pr-5 py-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold text-white tracking-tight">{venueName}</h1>
          <span className="text-[13px] text-gray-400">{rangeLabel}</span>
          <span className="text-[13px] text-gray-500">· updated {generatedAtLabel}</span>
          <span className={`ml-auto text-xs uppercase tracking-wider font-medium ${tone.label}`}>
            {tone.text}
          </span>
        </div>
        <p className="text-[17px] text-gray-100 leading-relaxed max-w-5xl">
          {headline?.text ?? 'Not enough data in this window to summarise the period.'}
        </p>
      </div>

      {kpis.length > 0 && (
        <div
          className="grid border-t border-gray-700/50 divide-x divide-y sm:divide-y-0 divide-gray-700/50"
          style={{ gridTemplateColumns: `repeat(auto-fit, minmax(190px, 1fr))` }}
        >
          {kpis.map(kpi => (
            <div key={kpi.id} className="px-5 py-4 flex flex-col gap-1.5 min-w-0">
              <span className="text-xs uppercase tracking-wider text-gray-400 truncate">
                {kpi.label}
              </span>
              <span className="text-3xl font-semibold text-white tabular-nums leading-none">
                {kpi.display}
              </span>
              <DeltaChip kpi={kpi} />
              <span className="text-[13px] text-gray-400 leading-snug">{kpi.hint}</span>
            </div>
          ))}
        </div>
      )}
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
      <span className="text-gray-400 font-normal ml-1">vs {kpi.compareLabel || 'last week'}</span>
    </span>
  );
}
