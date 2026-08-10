import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, Maximize2, Wind, Map } from 'lucide-react';
import type { ActivityTimeline, ActivityTimelineSet, HeatmapCategoryRow } from './types';
import HeatmapEmbedPreview from '../../../components/heatmap/HeatmapEmbedPreview';
import FlowFieldEmbed from '../../../components/flowfield/FlowFieldEmbed';
import { SECTION_TOOLTIPS, PULSE_TOOLTIPS } from './kpiTooltips';
import { formatDwellDuration } from './formatDuration';
import { getCategoryVisual } from '../operationsConsole/categoryVisuals';
import { buildYAxisTicks } from '../operationsConsole/chartYAxis';

type FloorVizMode = 'heatmap' | 'flow';

/**
 * Floats over the heatmap while a category is hovered, so the shape lighting up
 * on the floor arrives with the numbers that explain it instead of sending the
 * reader down the page to find them.
 */
function CategoryGlassCard({
  row,
  trafficShare,
}: {
  row: HeatmapCategoryRow;
  trafficShare: number | null;
}) {
  const { Icon, color } = getCategoryVisual(row.category);

  return (
    <div
      className="absolute left-3 bottom-3 right-3 sm:right-auto sm:w-64 rounded-xl border border-white/15 bg-gray-950/60 backdrop-blur-md p-3 shadow-xl shadow-black/40 pointer-events-none"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className="w-4 h-4 shrink-0" style={{ color }} strokeWidth={2.25} />
        <span className="text-sm font-semibold text-white truncate">{row.category}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <GlassStat value={row.totalVisits.toLocaleString()} label="shoppers" />
        <GlassStat
          value={formatDwellDuration(row.avgBrowseTimeSec, row.avgBrowseTimeMin)}
          label="mean dwell"
        />
        <GlassStat value={`${Math.round(row.browsingRate)}%`} label="stopped" />
        <GlassStat
          value={trafficShare != null ? `${trafficShare}%` : '—'}
          label="of category traffic"
        />
      </div>
      <p className="text-[11px] text-gray-400 mt-2.5">
        {row.zoneCount} {row.zoneCount === 1 ? 'zone' : 'zones'} lit on the map
      </p>
    </div>
  );
}

function GlassStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="text-lg font-bold text-white tabular-nums leading-tight">{value}</div>
      <div className="text-[11px] text-gray-400 truncate">{label}</div>
    </div>
  );
}

export function KpiTooltip({ text, children }: { text: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  const updatePos = () => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
  };

  const show = () => {
    updatePos();
    setOpen(true);
  };

  const hide = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => updatePos();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <span className="relative inline-flex items-center">
      {children}
      <button
        ref={btnRef}
        type="button"
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="ml-1 p-0.5 rounded-full text-gray-400 hover:text-gray-300 focus:text-cyan-400 transition-colors"
      >
        <HelpCircle className="w-3 h-3" />
      </button>
      {open && createPortal(
        <span
          id={id}
          role="tooltip"
          className="fixed w-56 max-w-[min(16rem,calc(100vw-1.5rem))] px-2.5 py-2 text-xs leading-snug text-gray-200 bg-gray-950 border border-gray-600 rounded-lg shadow-2xl pointer-events-none"
          style={{
            zIndex: 100000,
            top: pos.top,
            left: pos.left,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}

export function AnimatedValue({
  value,
  className = '',
  durationMs = 600,
}: {
  value: number;
  className?: string;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <span className={`tabular-nums ${className}`}>{display.toLocaleString()}</span>;
}

export function Sparkline({
  points,
  color = '#38bdf8',
  height = 32,
  width = 120,
  animate = false,
  showFill = true,
  strokeWidth = 1,
  className = '',
}: {
  points: number[];
  color?: string;
  height?: number;
  width?: number;
  animate?: boolean;
  showFill?: boolean;
  strokeWidth?: number;
  className?: string;
}) {
  const gradId = useId().replace(/:/g, '');
  const safePoints = points.length > 1 ? points : points.length === 1 ? [points[0], points[0]] : [0, 0];
  const max = Math.max(...safePoints, 1);
  const min = Math.min(...safePoints, 0);
  const range = max - min || 1;
  const padY = 3;
  const coords = safePoints.map((v, i) => {
    const x = safePoints.length <= 1 ? width / 2 : (i / (safePoints.length - 1)) * width;
    const y = height - padY - ((v - min) / range) * (height - padY * 2);
    return `${x},${y}`;
  });
  const line = coords.join(' ');
  const area = `${coords[0]?.split(',')[0] ?? 0},${height} ${line} ${coords[coords.length - 1]?.split(',')[0] ?? width},${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`block w-full h-full ${className}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {showFill && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {showFill && (
        <polygon points={area} fill={`url(#${gradId})`} />
      )}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type RhythmMetric = 'entrants' | 'stops';

const RHYTHM_CHART_H = 112;

export function ActivityTimelineChart({
  timelines,
  storeHoursLabel,
  className = '',
}: {
  timelines: ActivityTimelineSet;
  storeHoursLabel?: string;
  className?: string;
}) {
  const dailyHasData = timelines.daily.visitors.some(p => p.value > 0) || timelines.daily.dwells.some(p => p.value > 0);
  // One bar is not a rhythm. On a short window the daily series collapses to a
  // single pair of bars filling the panel, which reads as a rendering fault
  // rather than as a day of trade, so the hourly shape is shown instead.
  const dailyIsUseful = timelines.daily.visitors.filter(p => p.value > 0).length > 1;
  const [view, setView] = useState<'hourly' | 'daily'>(dailyIsUseful ? 'daily' : 'hourly');
  // Separate Y-scales: entrants and shelf stops often differ by 10–50×, so a
  // shared axis flattens one series into a hairline.
  const [metric, setMetric] = useState<RhythmMetric>('stops');

  useEffect(() => {
    setView(dailyIsUseful ? 'daily' : 'hourly');
  }, [dailyIsUseful]);
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);

  const timeline = view === 'hourly' ? timelines.hourly : timelines.daily;
  const visitors = timeline.visitors;
  const dwells = timeline.dwells;
  const count = Math.max(visitors.length, dwells.length);
  const hasData = visitors.some(p => p.value > 0) || dwells.some(p => p.value > 0);

  const series = metric === 'entrants' ? visitors : dwells;
  const maxVal = Math.max(...series.map(p => p.value), 1);
  const yTicks = buildYAxisTicks(maxVal);
  const yTop = yTicks[0] || maxVal;
  const barColor = metric === 'entrants' ? '#06b6d4' : '#f59e0b';
  const ringClass = metric === 'entrants' ? 'ring-cyan-400/50' : 'ring-amber-400/50';
  const labelStep = count > 14 ? Math.ceil(count / 7) : count > 8 ? 2 : 1;
  const peak = series.reduce(
    (best, p, i) => (p.value > best.value ? { value: p.value, label: p.label, i } : best),
    { value: 0, label: '', i: -1 },
  );

  if (!hasData && !dailyHasData) {
    return (
      <div className={`flex items-center justify-center h-28 text-xs text-gray-400 ${className}`}>
        No activity timeline for this range
      </div>
    );
  }

  const hideTooltip = () => setHover(null);
  const showTooltip = (index: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setHover({
      index,
      x: rect.left + rect.width / 2,
      y: rect.top - 6,
    });
  };

  const rangeCaption = view === 'hourly'
    ? (() => {
      const hourly = timelines.hourly;
      const tz = hourly.timeZone === 'Europe/Rome' ? 'Italy' : (hourly.timeZone || 'store TZ');
      const through = hourly.throughHourLabel;
      const open = storeHoursLabel ?? '08:00 – 20:00';
      return through
        ? `Today · ${tz} · ${open.split(' – ')[0] ?? '08:00'}–${through}`
        : `Today · ${tz} · ${open}`;
    })()
    : 'Selected period — one bar per day';

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs text-gray-400 uppercase tracking-wider flex items-center">
          Store rhythm
          <KpiTooltip text={PULSE_TOOLTIPS.storeRhythm} />
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex bg-gray-800 rounded-md p-0.5 border border-gray-700/60">
            <button
              type="button"
              onClick={() => { setMetric('entrants'); hideTooltip(); }}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                metric === 'entrants' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Entrants
            </button>
            <button
              type="button"
              onClick={() => { setMetric('stops'); hideTooltip(); }}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                metric === 'stops' ? 'bg-amber-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Stops
            </button>
          </div>
          <div className="flex bg-gray-800 rounded-md p-0.5 border border-gray-700/60">
            <button
              type="button"
              onClick={() => { setView('hourly'); hideTooltip(); }}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                view === 'hourly' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Today · hourly
            </button>
            {dailyIsUseful && (
              <button
                type="button"
                onClick={() => { setView('daily'); hideTooltip(); }}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  view === 'daily' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Week · daily
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mb-2">
        {rangeCaption}
        {' — '}
        {metric === 'entrants' ? 'gate entrants' : 'shelf stops'}
        {peak.value > 0 && (
          <span className="text-gray-500">
            {' · '}peak {peak.value.toLocaleString()}
            {peak.label ? ` at ${peak.label.replace(':00', '')}` : ''}
          </span>
        )}
      </p>

      <div className="rounded-lg bg-gray-900/50 border border-gray-700/40 px-2 pt-3 pb-1 mb-3">
        <div className="flex gap-1.5">
          <div
            className="flex flex-col justify-between shrink-0 text-[10px] text-gray-500 tabular-nums py-0.5"
            style={{ height: RHYTHM_CHART_H, minWidth: 28 }}
            aria-hidden
          >
            {yTicks.map(tick => (
              <span key={tick} className="leading-none">{tick}</span>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-end gap-0.5 w-full" style={{ height: RHYTHM_CHART_H }}>
              {Array.from({ length: count }, (_, i) => {
                const value = series[i]?.value ?? 0;
                const barH = value > 0
                  ? Math.max(3, Math.round((value / yTop) * (RHYTHM_CHART_H - 4)))
                  : 0;
                const active = hover?.index === i;
                return (
                  <div
                    key={i}
                    className="flex-1 min-w-0 flex items-end h-full cursor-crosshair"
                    onMouseEnter={(e) => showTooltip(i, e.currentTarget)}
                    onMouseLeave={hideTooltip}
                  >
                    <div
                      className={`w-full rounded-t-sm transition-opacity ${
                        active ? `opacity-100 ring-1 ${ringClass}` : 'opacity-85 hover:opacity-100'
                      }`}
                      style={{
                        height: barH,
                        backgroundColor: value > 0 ? barColor : 'transparent',
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-1.5 px-0.5">
              {Array.from({ length: count }, (_, i) => {
                const label = visitors[i]?.label ?? dwells[i]?.label ?? '';
                if (i % labelStep !== 0 && i !== count - 1) {
                  return <span key={i} className="flex-1 min-w-0" />;
                }
                return (
                  <span
                    key={i}
                    className="flex-1 min-w-0 text-center text-[10px] text-gray-400 truncate leading-tight"
                    title={label}
                  >
                    {label.replace(':00', '')}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {hover != null && createPortal(
        <div
          className="fixed pointer-events-none z-[100000] px-2.5 py-2 rounded-lg border border-gray-600 bg-gray-950 shadow-2xl text-xs text-gray-200 min-w-[9rem]"
          style={{
            left: hover.x,
            top: hover.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {(() => {
            const i = hover.index;
            const label = visitors[i]?.label ?? dwells[i]?.label ?? '—';
            const foot = visitors[i]?.value ?? 0;
            const stops = dwells[i]?.value ?? 0;
            const rate = foot > 0 ? Math.round((stops / foot) * 1000) / 10 : 0;
            return (
              <>
                <div className="font-semibold text-white mb-1">{label}</div>
                <div className={`flex justify-between gap-3 ${metric === 'entrants' ? 'font-medium' : ''}`}>
                  <span className="text-cyan-400">Entrants</span>
                  <span className="tabular-nums">{foot.toLocaleString()}</span>
                </div>
                <div className={`flex justify-between gap-3 ${metric === 'stops' ? 'font-medium' : ''}`}>
                  <span className="text-amber-400">Stops</span>
                  <span className="tabular-nums">{stops.toLocaleString()}</span>
                </div>
                {foot > 0 && (
                  <div className="flex justify-between gap-3 text-gray-400 mt-0.5 pt-0.5 border-t border-gray-700/60">
                    <span>Stop rate</span>
                    <span className="tabular-nums">{rate}%</span>
                  </div>
                )}
              </>
            );
          })()}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function ExecutivePulseBand({
  venueId,
  venueName,
  timelines,
  storeHoursLabel,
  heatmapCategories,
  liveOccupancy,
  onExpandHeatmap,
  onFocusCategory,
  heatmapTimeframe,
}: {
  venueId: string;
  venueName: string;
  timelines: ActivityTimelineSet;
  storeHoursLabel?: string;
  heatmapCategories: HeatmapCategoryRow[];
  liveOccupancy: number;
  onExpandHeatmap?: () => void;
  onFocusCategory?: (row: HeatmapCategoryRow) => void;
  heatmapTimeframe: 'day' | 'week' | 'month';
}) {
  const [hoverCat, setHoverCat] = useState<string | null>(null);
  const [vizMode, setVizMode] = useState<FloorVizMode>('flow');
  const topCats = heatmapCategories.slice(0, 8);

  const hoveredRow = hoverCat
    ? heatmapCategories.find(c => c.category === hoverCat) ?? null
    : null;
  const totalVisits = heatmapCategories.reduce((s, c) => s + (c.totalVisits || 0), 0);
  const hoveredShare = hoveredRow && totalVisits > 0
    ? Math.round((hoveredRow.totalVisits / totalVisits) * 1000) / 10
    : null;

  const vizHint = vizMode === 'flow' ? SECTION_TOOLTIPS.flowField : SECTION_TOOLTIPS.heatmap;

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-gray-800/80 via-gray-900/60 to-gray-950/80 shadow-lg shadow-cyan-950/20">
      <div className="px-4 py-3 border-b border-gray-700/40 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
            </span>
            <h2 className="text-sm font-semibold text-white">{venueName}</h2>
            <span className="text-xs text-cyan-400/90 font-medium">Live store intelligence</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5 max-w-xl">
            {vizHint} {SECTION_TOOLTIPS.timeline}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="inline-flex rounded-lg border border-gray-700/70 bg-gray-900/70 p-0.5"
            role="tablist"
            aria-label="Floor visualisation"
          >
            <button
              type="button"
              role="tab"
              aria-selected={vizMode === 'heatmap'}
              onClick={() => setVizMode('heatmap')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                vizMode === 'heatmap'
                  ? 'bg-cyan-500/20 text-cyan-100 border border-cyan-500/30'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent'
              }`}
            >
              <Map className="w-3.5 h-3.5" />
              Heatmap
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={vizMode === 'flow'}
              onClick={() => setVizMode('flow')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                vizMode === 'flow'
                  ? 'bg-cyan-500/20 text-cyan-100 border border-cyan-500/30'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent'
              }`}
            >
              <Wind className="w-3.5 h-3.5" />
              Flow field
            </button>
          </div>
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-900/60 border border-gray-700/50">
            <div className="text-right">
              <div className="text-[11px] text-gray-400 uppercase tracking-wider flex items-center justify-end">
                In store now
                <KpiTooltip text={PULSE_TOOLTIPS.inStoreNow} />
              </div>
              <AnimatedValue value={liveOccupancy} className="text-2xl font-bold text-white" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-0 lg:divide-x divide-gray-700/40">
        <div className="lg:col-span-2 p-4 flex flex-col gap-3">
          <ActivityTimelineChart timelines={timelines} storeHoursLabel={storeHoursLabel} />
          {topCats.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-[11px] text-gray-400 uppercase tracking-wider mb-1 flex items-center">
                Top categories
                <KpiTooltip text={PULSE_TOOLTIPS.topCategories} />
              </div>
              {topCats.map(row => {
                const max = topCats[0]?.totalVisits || 1;
                const w = Math.max(8, (row.totalVisits / max) * 100);
                const active = hoverCat === row.category;
                return (
                  <div
                    key={row.category}
                    role="button"
                    tabIndex={0}
                    onMouseEnter={() => setHoverCat(row.category)}
                    onMouseLeave={() => setHoverCat(null)}
                    onFocus={() => setHoverCat(row.category)}
                    onBlur={() => setHoverCat(null)}
                    onClick={() => onFocusCategory?.(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onFocusCategory?.(row);
                      }
                    }}
                    className={`w-full text-left rounded-md px-1.5 py-1 cursor-pointer transition-colors ${
                      active ? 'bg-cyan-500/10 ring-1 ring-cyan-500/25' : 'hover:bg-gray-800/50'
                    }`}
                  >
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className={`truncate ${active ? 'text-white' : 'text-gray-300'}`}>{row.category}</span>
                      <span className="text-gray-400 tabular-nums shrink-0 ml-2">{row.totalVisits.toLocaleString()}</span>
                    </div>
                    <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-cyan-500/70"
                        style={{ width: `${w}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div
          className={`lg:col-span-3 relative border-t lg:border-t-0 border-gray-700/40 ${
            vizMode === 'flow' ? 'min-h-[480px]' : 'min-h-[260px]'
          }`}
        >
          {vizMode === 'flow' ? (
            <FlowFieldEmbed className="absolute inset-0 rounded-br-2xl" />
          ) : heatmapCategories.length > 0 ? (
            <>
              <HeatmapEmbedPreview
                venueId={venueId}
                categories={heatmapCategories}
                timeframe={heatmapTimeframe}
                metric="visits"
                highlightCategory={hoverCat}
                onExpand={onExpandHeatmap}
              />
              {hoveredRow && (
                <CategoryGlassCard row={hoveredRow} trafficShare={hoveredShare} />
              )}
              {onExpandHeatmap && (
                <button
                  type="button"
                  onClick={onExpandHeatmap}
                  className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-gray-900/80 border border-gray-600 text-gray-300 hover:text-white hover:border-cyan-500/50 transition-colors"
                >
                  <Maximize2 className="w-3 h-3" /> Full heatmap
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full min-h-[200px] text-xs text-gray-400 p-6 text-center">
              Map shelf categories to enable the 3D traffic heatmap
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
