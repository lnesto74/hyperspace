import {
  departmentMinutes,
  displayValue,
  firstDepartment,
  pickKpi,
  queueBySlot,
  queueLanes,
  slotSeries,
  SLOTS,
} from '../dailyKpi/viewModel';
import type { DailyKpiPayload, DailyKpiRangeDay, KpiLabel } from '../dailyKpi/types';

const FRESH_DEPTS = new Set([
  'Frutta', 'Verdura', 'Pesce', 'Carne', 'Latticini', 'Bakery & Breakfast', 'Bar',
]);
const AISLES_DEPT = 'Corsie / fuori zona';
const CHECKOUT_DEPTS = new Set(['Coda cassa', 'Cassa (servizio)']);

export type SignalKind = 'observation' | 'attention' | 'positive';

export interface PulseMetric {
  id: string;
  label: string;
  display: string;
  unit?: string;
  measure: KpiLabel | null;
  method?: string;
  deltaPct: number | null;
  deltaAbs: string | null;
  higherIsBetter: boolean;
}

export interface JourneyStage {
  id: 'entrance' | 'fresh' | 'aisles' | 'checkout';
  label: string;
  primary: string;
  secondary: string | null;
}

export interface TimeBucket {
  id: 'aisles' | 'fresh' | 'checkout' | 'other';
  label: string;
  minutes: number;
}

export interface CanvasSignal {
  id: string;
  kind: SignalKind;
  title: string;
  body: string;
}

export interface ExecutiveCanvasModel {
  day: string;
  dayLabel: string;
  venueName: string;
  pulse: PulseMetric[];
  journey: JourneyStage[];
  visitMin: number | null;
  allocation: TimeBucket[];
  flow: Array<{ slot: string; entrances: number | null; people: number | null }>;
  peakSlot: string | null;
  checkout: {
    waitDisplay: string;
    waitValue: number | null;
    healthy: boolean | null;
    peakSlot: string | null;
    peakWait: number | null;
    busiest: string[];
    slots: Array<{ slot: string; wait: number | null }>;
  };
  signals: CanvasSignal[];
}

function fmtMin(n: number, d = 2): string {
  return n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function formatDayEn(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function sumMinutes(map: Map<string, number>, names: Set<string> | string): number {
  if (typeof names === 'string') return map.get(names) ?? 0;
  let t = 0;
  for (const n of names) t += map.get(n) ?? 0;
  return t;
}

function observedMinutes(payload: DailyKpiPayload): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of departmentMinutes(payload)) {
    if (row.zeroObservation || row.minutes == null || row.status === 'unreliable') continue;
    map.set(row.dept, row.minutes);
  }
  return map;
}

function allocation(payload: DailyKpiPayload): TimeBucket[] {
  const map = observedMinutes(payload);
  const aisles = sumMinutes(map, AISLES_DEPT);
  const fresh = sumMinutes(map, FRESH_DEPTS);
  const checkout = sumMinutes(map, CHECKOUT_DEPTS);
  let other = 0;
  for (const [dept, min] of map) {
    if (dept === AISLES_DEPT || FRESH_DEPTS.has(dept) || CHECKOUT_DEPTS.has(dept)) continue;
    other += min;
  }
  return [
    { id: 'aisles', label: 'Aisles', minutes: aisles },
    { id: 'fresh', label: 'Fresh', minutes: fresh },
    { id: 'checkout', label: 'Checkout', minutes: checkout },
    { id: 'other', label: 'Other', minutes: other },
  ].filter((b) => b.minutes > 0);
}

function busiestLanes(payload: DailyKpiPayload): string[] {
  const lanes = queueLanes(payload).filter((l) => l.roi_group === 'CHECKOUT_QUEUE');
  return lanes
    .map((l) => ({ lane: String(l.lane ?? ''), wait: Number(l.WAITING || 0) }))
    .filter((l) => l.lane && l.wait > 0)
    .sort((a, b) => b.wait - a.wait)
    .slice(0, 3)
    .map((l) => `#${l.lane}`);
}

function peakWaitSlot(payload: DailyKpiPayload): { slot: string; wait: number } | null {
  const slots = queueBySlot(payload)
    .filter((s) => s.wait != null)
    .sort((a, b) => (b.wait || 0) - (a.wait || 0));
  if (!slots.length || slots[0].wait == null) return null;
  return { slot: slots[0].slot, wait: slots[0].wait };
}

function peakEntranceSlot(payload: DailyKpiPayload): string | null {
  const slots = slotSeries(payload)
    .filter((s) => s.entrances != null)
    .sort((a, b) => (b.entrances || 0) - (a.entrances || 0));
  return slots[0]?.slot ?? null;
}

function buildSignals(payload: DailyKpiPayload, visitMin: number | null, buckets: TimeBucket[]): CanvasSignal[] {
  const out: CanvasSignal[] = [];
  const first = firstDepartment(payload);
  const top = first[0];
  if (top && top.share >= 0.5) {
    out.push({
      id: 'first-dept',
      kind: 'observation',
      title: 'Fresh drives the journey',
      body: `${Math.round(top.share * 100)}% of observed customers first enter through ${top.dst}.`,
    });
  }
  const peakQ = peakWaitSlot(payload);
  if (peakQ && out.length < 3) {
    out.push({
      id: 'queue-peak',
      kind: peakQ.wait > 1 ? 'attention' : 'observation',
      title: `Checkout pressure peaks ${peakQ.slot}`,
      body: `Highest waiting pressure is ${fmtMin(peakQ.wait)} min per customer in that window.`,
    });
  }
  const aisles = buckets.find((b) => b.id === 'aisles');
  if (aisles && visitMin && aisles.minutes / visitMin >= 0.4 && out.length < 3) {
    out.push({
      id: 'aisles-time',
      kind: 'observation',
      title: 'Most journey time happens in the aisles',
      body: `About ${fmtMin(aisles.minutes, 1)} of ${fmtMin(visitMin, 1)} minutes are spent outside mapped departments.`,
    });
  }
  const wait = pickKpi(payload, 'queue_wait_min_per_entrance');
  if (wait?.status === 'ok' && wait.value != null && wait.value < 1 && out.length < 3) {
    out.push({
      id: 'queue-healthy',
      kind: 'positive',
      title: 'Checkout wait stays short',
      body: `${fmtMin(wait.value)} min average wait per customer across the day.`,
    });
  }
  return out.slice(0, 3);
}

export function buildExecutiveCanvas(
  payload: DailyKpiPayload,
  _rangeDays: DailyKpiRangeDay[] = [],
  venueName = 'Treviglio',
): ExecutiveCanvasModel {
  const ent = pickKpi(payload, 'entrances');
  const visit = pickKpi(payload, 'visit_min');
  const people = pickKpi(payload, 'people_mean');
  const wait = pickKpi(payload, 'queue_wait_min_per_entrance');
  const first = firstDepartment(payload)[0];
  const buckets = allocation(payload);
  const aislesMin = buckets.find((b) => b.id === 'aisles')?.minutes ?? null;
  const freshMin = buckets.find((b) => b.id === 'fresh')?.minutes ?? null;
  const peakQ = peakWaitSlot(payload);

  const pulse: PulseMetric[] = [
    {
      id: 'visits',
      label: 'Store visits',
      display: displayValue(ent, 0),
      measure: ent?.label ?? null,
      method: ent?.method,
      deltaPct: null,
      deltaAbs: null,
      higherIsBetter: true,
    },
    {
      id: 'journey',
      label: 'Average journey',
      display: displayValue(visit, 1),
      unit: visit?.status === 'ok' ? 'min' : undefined,
      measure: visit?.label ?? null,
      method: visit?.method,
      deltaPct: null,
      deltaAbs: null,
      higherIsBetter: true,
    },
    {
      id: 'people',
      label: 'People in store',
      display: displayValue(people, 0),
      measure: people?.label ?? null,
      method: people?.method,
      deltaPct: null,
      deltaAbs: null,
      higherIsBetter: false,
    },
    {
      id: 'wait',
      label: 'Checkout wait',
      display: displayValue(wait, 2),
      unit: wait?.status === 'ok' ? 'min' : undefined,
      measure: wait?.label ?? null,
      method: wait?.method,
      deltaPct: null,
      deltaAbs: null,
      higherIsBetter: false,
    },
  ];

  const journey: JourneyStage[] = [
    {
      id: 'entrance',
      label: 'Entrance',
      primary: displayValue(ent, 0),
      secondary: ent?.status === 'ok' ? 'visits' : null,
    },
    {
      id: 'fresh',
      label: 'Fresh',
      primary: first ? `${Math.round(first.share * 100)}%` : (freshMin != null ? `${fmtMin(freshMin, 1)} min` : '—'),
      secondary: first
        ? `first stop · ${first.dst}${freshMin != null ? ` · ${fmtMin(freshMin, 1)} min` : ''}`
        : (freshMin != null ? 'observed minutes' : null),
    },
    {
      id: 'aisles',
      label: 'Aisles',
      primary: aislesMin != null ? `${fmtMin(aislesMin, 1)} min` : '—',
      secondary: 'outside mapped departments',
    },
    {
      id: 'checkout',
      label: 'Checkout',
      primary: displayValue(wait, 2),
      secondary: wait?.status === 'ok' ? 'min wait' : null,
    },
  ];

  return {
    day: payload.day,
    dayLabel: formatDayEn(payload.day),
    venueName,
    pulse,
    journey,
    visitMin: visit?.status === 'ok' ? visit.value : null,
    allocation: buckets,
    flow: slotSeries(payload),
    peakSlot: peakEntranceSlot(payload),
    checkout: {
      waitDisplay: displayValue(wait, 2),
      waitValue: wait?.status === 'ok' ? wait.value ?? null : null,
      healthy: wait?.status === 'ok' && wait.value != null ? wait.value < 1 : null,
      peakSlot: peakQ?.slot ?? null,
      peakWait: peakQ?.wait ?? null,
      busiest: busiestLanes(payload),
      slots: queueBySlot(payload).map((s) => ({ slot: s.slot, wait: s.wait })),
    },
    signals: buildSignals(payload, visit?.status === 'ok' ? visit.value ?? null : null, buckets),
  };
}

export { SLOTS, FRESH_DEPTS };
