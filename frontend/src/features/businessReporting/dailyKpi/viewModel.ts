import type { ExecutiveHeadline, HeadlineKpi } from '../esselunga/types';
import type { DailyKpiCheck, DailyKpiPayload, DailyKpiRangeDay, DailyKpiRow } from './types';

const SLOTS = ['08-10', '10-12', '12-14', '14-16', '16-18', '18-20'] as const;

export function pickKpi(payload: DailyKpiPayload | null | undefined, id: string, slot = 'giorno'): DailyKpiRow | undefined {
  return payload?.kpis?.find((k) => k.kpi_id === id && k.slot === slot);
}

export function displayValue(row: DailyKpiRow | undefined, digits = 1): string {
  if (!row || row.status === 'unreliable' || row.value == null) return '—';
  if (row.unit === 'count' || row.unit === 'people') return Math.round(row.value).toLocaleString('it-IT');
  return row.value.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function buildHeadlineKpis(payload: DailyKpiPayload, rangeDays: DailyKpiRangeDay[] = []): HeadlineKpi[] {
  const compareReady = rangeDays.length >= 7;
  const medianEntrances = compareReady ? median(rangeDays.map((d) => scalar(d, 'entrances'))) : null;

  const tiles: Array<{ id: string; title: string; slot?: string; digits: number; hint: string; higherIsBetter: boolean }> = [
    { id: 'entrances', title: 'Ingressi', digits: 0, hint: 'Clienti distinti (id VALID) che hanno toccato l’ingresso.', higherIsBetter: true },
    { id: 'visit_min', title: 'Durata media della visita', digits: 1, hint: 'Persone-minuto in negozio ÷ ingressi (legge di Little).', higherIsBetter: true },
    { id: 'people_mean', title: 'Persone presenti in media', digits: 0, hint: 'Persone-minuto ÷ minuti di apertura (08:00–20:00).', higherIsBetter: false },
    { id: 'queue_wait_min_per_entrance', title: 'Attesa in coda per cliente', digits: 2, hint: 'Minuti WAITING in coda ÷ ingressi. Oggetti fissi e transito esclusi.', higherIsBetter: false },
  ];

  return tiles.map((t) => {
    const row = pickKpi(payload, t.id, t.slot || 'giorno');
    const peopleMax = t.id === 'people_mean' ? pickKpi(payload, 'people_max') : undefined;
    let display = displayValue(row, t.digits);
    let hint = row?.method || t.hint;
    if (t.id === 'people_mean' && peopleMax && peopleMax.status === 'ok' && peopleMax.value != null) {
      display = `${display} / max ${displayValue(peopleMax, 0)}`;
      hint = `${hint} Massimo: occupazione media al minuto.`;
    }
    const delta = compareReady && row?.value != null && t.id === 'entrances' && medianEntrances
      ? pctDelta(row.value, medianEntrances)
      : null;
    return {
      id: t.id,
      label: t.title,
      value: row?.status === 'ok' ? row.value : null,
      display,
      hint,
      previous: null,
      higherIsBetter: t.higherIsBetter,
      deltaPct: delta,
      noCompareReason: compareReady ? null : 'Servono 7 giorni consecutivi di daily_kpi',
      compareLabel: compareReady ? 'mediana 7 giorni' : undefined,
      direction: delta == null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down',
      good: delta == null ? null : (delta > 0) === t.higherIsBetter,
      measureLabel: row?.label,
      method: row?.method ?? t.hint,
      status: row?.status ?? 'unreliable',
      statusReason: row?.status_reason ?? undefined,
    };
  });
}

export function buildHeadline(payload: DailyKpiPayload, rangeDays: DailyKpiRangeDay[] = []): ExecutiveHeadline {
  const ent = pickKpi(payload, 'entrances');
  const visit = pickKpi(payload, 'visit_min');
  const mean = pickKpi(payload, 'people_mean');
  const max = pickKpi(payload, 'people_max');
  const wait = pickKpi(payload, 'queue_wait_min_per_entrance');
  const date = formatDayIt(payload.day);

  const slotWaits = SLOTS
    .map((sl) => ({ slot: sl, row: pickKpi(payload, 'queue_wait_min_per_entrance', sl) }))
    .filter((x) => x.row?.status === 'ok' && x.row.value != null);
  const highSlot = slotWaits.find((x) => (x.row!.value as number) > 1.5);

  let tone: ExecutiveHeadline['tone'] = 'info';
  if (highSlot) tone = 'bad';
  else if (rangeDays.length >= 7 && ent?.value != null) {
    const med = median(rangeDays.map((d) => scalar(d, 'entrances')));
    if (med && ent.value < 0.8 * med) tone = 'warn';
    else tone = 'good';
  } else if (ent?.status === 'ok') {
    tone = 'info';
  }

  const parts: string[] = [];
  if (ent?.status === 'ok' && ent.value != null) {
    parts.push(`Il ${date} sono entrati ${Math.round(ent.value).toLocaleString('it-IT')} clienti.`);
  }
  if (visit?.status === 'ok' && visit.value != null) {
    parts.push(`La visita è durata in media ${visit.value.toFixed(1)} minuti (legge di Little).`);
  }
  if (mean?.status === 'ok' && mean.value != null) {
    const maxBit = max?.status === 'ok' && max.value != null ? ` (massimo ${Math.round(max.value)})` : '';
    parts.push(`In negozio c’erano ${Math.round(mean.value)} persone in media${maxBit}.`);
  }
  if (wait?.status === 'ok' && wait.value != null) {
    parts.push(`Attesa in coda: ${wait.value.toFixed(2)} minuti per cliente.`);
  }
  if (highSlot) {
    parts.push(`Coda alta alle ${highSlot.slot}: ${(highSlot.row!.value as number).toFixed(2)} min/cliente.`);
  }
  if (!parts.length) {
    parts.push('I numeri del giorno non sono ancora disponibili o non hanno superato i controlli.');
  }

  return { tone, text: parts.join(' ') };
}

export interface DailyInsight {
  id: string;
  severity: 'good' | 'warn' | 'bad' | 'info';
  title: string;
  message: string;
  action?: string;
}

export function buildInsights(payload: DailyKpiPayload, rangeDays: DailyKpiRangeDay[] = []): DailyInsight[] {
  const cards: DailyInsight[] = [];
  for (const sl of SLOTS) {
    const row = pickKpi(payload, 'queue_wait_min_per_entrance', sl);
    if (row?.status === 'ok' && row.value != null && row.value > 1.0) {
      const people = pickKpi(payload, 'people_mean', sl);
      cards.push({
        id: `queue-${sl}`,
        severity: row.value > 1.5 ? 'bad' : 'warn',
        title: `Coda alta alle ${sl}`,
        message: `${row.value.toFixed(2)} minuti di attesa per cliente. ${people?.value != null ? `${Math.round(people.value)} persone in media in fascia.` : ''}`.trim(),
        action: 'Verificare casse aperte e oggetti fissi in zona coda.',
      });
    }
  }
  const zero = pickKpi(payload, 'zero_observation_rois');
  const names = Array.isArray(zero?.payload) ? (zero!.payload as string[]) : [];
  if (names.length) {
    cards.push({
      id: 'zero-roi',
      severity: 'warn',
      title: 'Zona senza osservazioni',
      message: `${names.join(', ')}: nessuna osservazione — da verificare copertura o posizione.`,
      action: 'Controllare il ROI sul gemello e la copertura LiDAR.',
    });
  }
  // behaviour mix vs 7-day median — only when we have a computed mix and history
  if (cards.length < 3 && rangeDays.length >= 7) {
    const beh = pickKpi(payload, 'behaviour_share');
    if (beh?.status === 'ok') {
      cards.push({
        id: 'behaviour',
        severity: 'info',
        title: 'Mix comportamentale',
        message: 'Confronto con la mediana a 7 giorni disponibile quando il job 120 è calcolato.',
      });
    }
  }
  return cards.slice(0, 3);
}

export interface DeptMinuteRow {
  dept: string;
  minutes: number | null;
  status: DailyKpiRow['status'];
  statusReason?: string | null;
  zeroObservation: boolean;
}

export function departmentMinutes(payload: DailyKpiPayload, slot = 'giorno'): DeptMinuteRow[] {
  const row = pickKpi(payload, 'minutes_per_customer_by_dept', slot);
  const zero = new Set((pickKpi(payload, 'zero_observation_rois')?.payload as string[]) || []);
  const payloadMap = (row?.payload && typeof row.payload === 'object') ? row.payload as Record<string, number> : {};
  const order = [
    'Ingresso', 'Frutta', 'Verdura', 'Pane', 'Bakery & Breakfast', 'Salumi', 'Gastronomia',
    'Carne', 'Pesce', 'Latticini', 'Acqua', 'Bar', 'Surgelati',
    'Scaffali senza categoria', 'Corsie / fuori zona', 'Coda cassa', 'Cassa (servizio)',
  ];
  const keys = [...new Set([...order, ...Object.keys(payloadMap)])];
  return keys
    .filter((d) => d in payloadMap || zero.has(d))
    .map((dept) => ({
      dept,
      minutes: zero.has(dept) ? null : (payloadMap[dept] ?? null),
      status: zero.has(dept) ? 'ok' : (row?.status ?? 'unreliable'),
      statusReason: row?.status_reason,
      zeroObservation: zero.has(dept),
    }));
}

export function firstDepartment(payload: DailyKpiPayload): Array<{ dst: string; n: number; share: number }> {
  const row = pickKpi(payload, 'first_department_after_entrance');
  return Array.isArray(row?.payload) ? row!.payload as Array<{ dst: string; n: number; share: number }> : [];
}

export function queueBySlot(payload: DailyKpiPayload): Array<{ slot: string; wait: number | null; service: number | null }> {
  return SLOTS.map((slot) => ({
    slot,
    wait: pickKpi(payload, 'queue_wait_min_per_entrance', slot)?.value ?? null,
    service: pickKpi(payload, 'service_min_per_entrance', slot)?.value ?? null,
  }));
}

export function queueLanes(payload: DailyKpiPayload): Array<Record<string, unknown>> {
  const row = pickKpi(payload, 'queue_decomposition_per_lane', 'giorno');
  return Array.isArray(row?.payload) ? row!.payload as Array<Record<string, unknown>> : [];
}

export function slotSeries(payload: DailyKpiPayload): Array<{ slot: string; entrances: number | null; people: number | null }> {
  return SLOTS.map((slot) => ({
    slot,
    entrances: pickKpi(payload, 'entrances', slot)?.value ?? null,
    people: pickKpi(payload, 'people_mean', slot)?.value ?? null,
  }));
}

export function checkRows(payload: DailyKpiPayload): DailyKpiCheck[] {
  return payload.checks || [];
}

function scalar(day: DailyKpiRangeDay, kpiId: string): number | null {
  const cell = day[kpiId] as { value?: number; status?: string } | undefined;
  if (!cell || cell.status === 'unreliable' || cell.value == null) return null;
  return Number(cell.value);
}

function median(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function pctDelta(now: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

function formatDayIt(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('it-IT', {
    day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

export { SLOTS };
