import type { DailyKpiPayload, DailyKpiRow } from '../../dailyKpi/types';
import { pickKpi } from '../../dailyKpi/viewModel';
import { fint, fmt } from './charts';

export const SLOTS = ['08-10', '10-12', '12-14', '14-16', '16-18', '18-20'] as const;
export type Slot = (typeof SLOTS)[number];

export const DEPT_ORDER = [
  'Corsie / fuori zona',
  'Scaffali senza categoria',
  'Coda cassa',
  'Verdura',
  'Surgelati',
  'Bakery & Breakfast',
  'Frutta',
  'Latticini',
  'Carne',
  'Cassa (servizio)',
  'Bar',
  'Pesce',
  'Ingresso',
  'Acqua',
];

export const HEAT_DEPTS = DEPT_ORDER.filter(
  (d) => !d.startsWith('Corsie') && d !== 'Ingresso' && d !== 'Acqua',
);

export const AREA_DEPT_ORDER = [
  'Scaffali senza categoria', 'Frutta', 'Surgelati', 'Latticini',
  'Bakery & Breakfast', 'Carne', 'Verdura', 'Bar', 'Pesce', 'Acqua',
  'Gastronomia', 'Salumi', 'Pane',
];

export const SERVED_COUNTERS = ['Carne', 'Pesce', 'Bar', 'Gastronomia', 'Salumi', 'Pane'];

export const BEHAVIOUR_SER = [
  { key: 'Fermo a scaffale (sceglie)', label: 'Sceglie a scaffale' },
  { key: 'Al banco servito', label: 'Al banco servito' },
  { key: 'coda_cassa', label: 'In coda o in cassa' },
  { key: 'Movimento con soste brevi', label: 'In movimento' },
  { key: 'Fermo in corsia (fuori zona)', label: 'Fermo in corsia' },
  { key: 'Giro lungo in corsia', label: 'Giro lungo in corsia' },
] as const;

export const DEPT_MIX_ORDER = [
  'Bar', 'Pesce', 'Carne', 'Frutta', 'Verdura', 'Latticini',
  'Bakery & Breakfast', 'Surgelati', 'Acqua', 'Scaffali senza categoria',
  'Coda cassa', 'Cassa (servizio)',
];

export const LANE_SER = [
  { key: 'WAITING', label: 'In attesa' },
  { key: 'TRANSIT', label: 'In transito' },
  { key: 'FIXED', label: 'Oggetto fermo' },
] as const;

export type DisplayTile = {
  id: string;
  kpiId: string;
  value: string;
  unit?: string;
  label: string;
  note: string;
  tip: string;
};

export type BehaviourView = {
  segments: number;
  share: Record<string, number>;
  profile: Record<string, { n: number; dur_s: number; path_m: number }>;
  slotMix: Record<string, Record<string, number>>;
  deptMix: Record<string, Record<string, number>>;
};

export type LaneShare = {
  lane: string;
  WAITING: number;
  TRANSIT: number;
  FIXED: number;
};

export type ClienteMedioView = {
  day: string;
  dayLabel: string;
  hours: string;
  visitRounded: number;
  tiles: DisplayTile[];
  qualityTiles: DisplayTile[];
  entrances: Record<string, number | null>;
  visitMin: Record<string, number | null>;
  minutes: Record<string, Record<string, number>>;
  firstAfter: Array<{ dept: string; n: number }>;
  zeroDepts: string[];
  queueWait: Record<string, number | null>;
  queueService: Record<string, number | null>;
  lanes: LaneShare[];
  behaviour: BehaviourView | null;
  behaviourReason: string | null;
  checksPassed: number;
  checksTotal: number;
  minutesArea: Record<string, Record<string, number>>;
  minutesBanco: Record<string, Record<string, number>>;
  deptStays: Record<string, { persons_per_entrance?: number; stay_median_s?: number }>;
  reconOk: boolean;
  counterWait: Record<string, Record<string, number | null>>;
  counterStay: Record<string, { median?: number; p90?: number; stays?: number }>;
  adjacency: Record<string, Record<string, number>>;
  transitions: number | null;
  promoSpots: Array<{ name: string; minutes: number; per1000?: number; department?: string }>;
  flowField: Array<{ x: number; z: number; angle: number; r: number; n: number }>;
};

const DASH = '—';

function ok(row: DailyKpiRow | undefined): row is DailyKpiRow & { value: number } {
  return !!row && row.status === 'ok' && row.value != null && Number.isFinite(row.value);
}

function tipFor(row: DailyKpiRow | undefined, fallback: string): string {
  if (row?.status === 'unreliable') {
    return row.status_reason || 'Valore non affidabile: un controllo del giorno è fallito.';
  }
  return row?.method || fallback;
}

function slotMap(payload: DailyKpiPayload, id: string): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const sl of SLOTS) {
    const row = pickKpi(payload, id, sl);
    out[sl] = ok(row) ? row.value : null;
  }
  return out;
}

function phantomPct(quality: Record<string, unknown> | undefined): number | null {
  const raw = quality?.phantom_rows_pct;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return raw > 1 ? raw : raw * 100;
}

function formatObs(n: number): string {
  if (n >= 1e6) return `${fmt(n / 1e6, 1)} M`;
  return fint(n);
}

export function formatDayLongIt(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = dt.toLocaleDateString('it-IT', { weekday: 'long', timeZone: 'UTC' });
  const rest = dt.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${rest}`;
}

/** First day with a validated daily_kpi payload (Journey Lab + canvas). */
export const KPI_EPOCH = '2026-09-14';

export function todayRome(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

export function yesterdayRome(now = new Date()): string {
  const today = todayRome(now);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) return out;
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = shiftDay(cur, 1);
  }
  return out;
}

export function nextDailyKpiRun(now = new Date()): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 30, 0));
  if (now.getTime() >= next.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function formatNextJob(now = new Date()): string {
  const next = nextDailyKpiRun(now);
  const utc = next.toLocaleString('it-IT', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const rome = next.toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
  return `Prossimo calcolo: ${utc} UTC (${rome} ora di Roma).`;
}

function mergeShare(obj: Record<string, number>): Record<string, number> {
  const o = { ...obj };
  o.coda_cassa = (obj['In coda'] || 0) + (obj['In cassa (servizio)'] || 0);
  return o;
}

function parseBehaviour(row: DailyKpiRow | undefined): BehaviourView | null {
  if (!row || row.status !== 'ok' || row.payload == null || typeof row.payload !== 'object') return null;
  const p = row.payload as Record<string, unknown>;

  const share: Record<string, number> = {};
  const profile: Record<string, { n: number; dur_s: number; path_m: number }> = {};

  if (Array.isArray(p.cluster_profiles)) {
    for (const c of p.cluster_profiles as Array<Record<string, unknown>>) {
      const name = String(c.name || '');
      if (!name) continue;
      share[name] = (share[name] || 0) + Number(c.share || 0);
      const prev = profile[name];
      const n = Number(c.n || 0);
      if (!prev || n > prev.n) {
        profile[name] = { n, dur_s: Number(c.dur_s || 0), path_m: Number(c.path_m || 0) };
      }
    }
  } else if (p.share && typeof p.share === 'object' && !Array.isArray(p.share)) {
    Object.assign(share, p.share as Record<string, number>);
  } else if (!p.cluster_profiles && !p.dept_mix_time_share) {
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === 'number') share[k] = v;
    }
  }

  const slotSrc = (p.slot_mix_segment_share || p.slot_mix || p.by_slot) as Record<string, Record<string, number>> | undefined;
  const deptSrc = (p.dept_mix_time_share || p.dept_mix) as Record<string, Record<string, number>> | undefined;
  if (!Object.keys(share).length && !slotSrc && !deptSrc) return null;

  return {
    segments: Number(p.segments || 0),
    share,
    profile,
    slotMix: slotSrc || {},
    deptMix: deptSrc || {},
  };
}

function minutesKeyed(
  payload: DailyKpiPayload,
  kpiId: string,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const giorno = pickKpi(payload, kpiId, 'giorno');
  const giornoMap = (giorno?.payload && typeof giorno.payload === 'object')
    ? giorno.payload as Record<string, number>
    : {};
  const depts = new Set([...AREA_DEPT_ORDER, 'Corsie / fuori zona', 'Ingresso, casse, retro banchi', ...Object.keys(giornoMap)]);
  for (const dept of depts) {
    out[dept] = {};
    for (const sl of [...SLOTS, 'giorno'] as const) {
      const keyed = pickKpi(payload, kpiId, `${sl}|${dept}`);
      if (ok(keyed)) {
        out[dept][sl] = keyed.value as number;
        continue;
      }
      const slotRow = pickKpi(payload, kpiId, sl);
      const map = (slotRow?.payload && typeof slotRow.payload === 'object')
        ? slotRow.payload as Record<string, number>
        : {};
      const raw = map[dept];
      if (typeof raw === 'number') out[dept][sl] = raw;
      else if (raw && typeof raw === 'object' && 'area' in (raw as object)) {
        const rec = raw as { area?: number; al_banco?: number };
        if (kpiId.endsWith('_counter') && rec.al_banco != null) out[dept][sl] = rec.al_banco;
        else if (rec.area != null) out[dept][sl] = rec.area;
      }
    }
  }
  return out;
}

function minutesMatrix(payload: DailyKpiPayload): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const giorno = pickKpi(payload, 'minutes_per_customer_by_dept', 'giorno');
  const giornoMap = (giorno?.payload && typeof giorno.payload === 'object')
    ? giorno.payload as Record<string, number>
    : {};
  const depts = new Set([...DEPT_ORDER, ...Object.keys(giornoMap)]);
  for (const dept of depts) {
    out[dept] = {};
    for (const sl of [...SLOTS, 'giorno'] as const) {
      const keyed = pickKpi(payload, 'minutes_per_customer_by_dept', `${sl}|${dept}`);
      if (ok(keyed)) {
        out[dept][sl] = keyed.value as number;
        continue;
      }
      const slotRow = pickKpi(payload, 'minutes_per_customer_by_dept', sl);
      const map = (slotRow?.payload && typeof slotRow.payload === 'object')
        ? slotRow.payload as Record<string, number>
        : {};
      if (typeof map[dept] === 'number') out[dept][sl] = map[dept];
    }
  }
  return out;
}

function laneShares(payload: DailyKpiPayload): LaneShare[] {
  const row = pickKpi(payload, 'queue_decomposition_per_lane', 'giorno');
  const list = Array.isArray(row?.payload) ? row!.payload as Array<Record<string, unknown>> : [];
  return list
    .filter((l) => l.roi_group === 'CHECKOUT_QUEUE')
    .map((l) => {
      const W = Number(l.WAITING || 0);
      const T = Number(l.TRANSIT || 0);
      const F = Number(l.FIXED || 0);
      const tot = W + T + F;
      return {
        lane: `Cassa ${l.lane}`,
        WAITING: tot ? W / tot : 0,
        TRANSIT: tot ? T / tot : 0,
        FIXED: tot ? F / tot : 0,
      };
    });
}

export function buildClienteMedioView(payload: DailyKpiPayload): ClienteMedioView {
  const ent = pickKpi(payload, 'entrances');
  const visit = pickKpi(payload, 'visit_min');
  const people = pickKpi(payload, 'people_mean');
  const peopleMax = pickKpi(payload, 'people_max');
  const wait = pickKpi(payload, 'queue_wait_min_per_entrance');
  const passages = pickKpi(payload, 'checkout_passages');
  const minutes = minutesMatrix(payload);
  const minutesArea = minutesKeyed(payload, 'minutes_per_customer_by_dept_area');
  const minutesBanco = minutesKeyed(payload, 'minutes_per_customer_by_dept_counter');
  const corsie = minutes['Corsie / fuori zona']?.giorno;
  const visitDay = ok(visit) ? visit.value as number : null;
  const fruttaA = pickKpi(payload, 'minutes_per_customer_by_dept_area', 'giorno|Frutta');
  const verduraA = pickKpi(payload, 'minutes_per_customer_by_dept_area', 'giorno|Verdura');
  const fruttaB = pickKpi(payload, 'minutes_per_customer_by_dept_counter', 'giorno|Frutta');
  const verduraB = pickKpi(payload, 'minutes_per_customer_by_dept_counter', 'giorno|Verdura');
  const hasAreas = ok(fruttaA) || ok(verduraA);
  const orto = (ok(fruttaA) ? fruttaA.value : 0) + (ok(verduraA) ? verduraA.value : 0);
  const ortoBanco = (ok(fruttaB) ? fruttaB.value : 0) + (ok(verduraB) ? verduraB.value : 0);
  const hours = payload.store_hours_local
    ? `${payload.store_hours_local[0]}–${payload.store_hours_local[1]}`
    : '08:00–20:00';

  const queueSlots = slotMap(payload, 'queue_wait_min_per_entrance');
  const peakSlot = SLOTS.reduce<{ slot: string; v: number } | null>((best, sl) => {
    const v = queueSlots[sl];
    if (v == null) return best;
    if (!best || v > best.v) return { slot: sl, v };
    return best;
  }, null);

  const tiles: DisplayTile[] = [
    {
      id: 'entrances',
      kpiId: 'entrances',
      value: ok(ent) ? fint(ent.value as number) : DASH,
      label: 'ingressi',
      note: 'eventi contati alla porta',
      tip: tipFor(ent, 'Id VALID distinti con una visita raw nella ROI ingresso.'),
    },
    {
      id: 'visit_min',
      kpiId: 'visit_min',
      value: ok(visit) ? fmt(visit.value as number, 1) : DASH,
      unit: ok(visit) ? 'min' : undefined,
      label: 'durata media della visita',
      note: 'persone presenti × tempo ÷ ingressi',
      tip: tipFor(visit, 'Persone-minuto in negozio ÷ ingressi (legge di Little).'),
    },
    {
      id: 'people_mean',
      kpiId: 'people_mean',
      value: ok(people) ? fint(people.value as number) : DASH,
      label: 'persone in negozio in media',
      note: ok(peopleMax)
        ? `massimo ${fint(peopleMax.value as number)} nello stesso istante`
        : (peopleMax?.status === 'unreliable'
          ? (peopleMax.status_reason || 'massimo non affidabile')
          : 'massimo non calcolato'),
      tip: tipFor(people, 'Persone-minuto ÷ minuti di apertura (08:00–20:00).'),
    },
    {
      id: 'queue_wait',
      kpiId: 'queue_wait_min_per_entrance',
      value: ok(wait) ? fmt(wait.value as number, 1) : DASH,
      unit: ok(wait) ? 'min' : undefined,
      label: 'coda per cliente',
      note: peakSlot ? `${fmt(peakSlot.v, 2)} min nella fascia ${peakSlot.slot}` : 'tempo in zona coda ÷ ingressi',
      tip: tipFor(wait, 'Minuti WAITING in coda ÷ ingressi. Oggetti fissi e transito esclusi.'),
    },
    {
      id: 'checkout_passages',
      kpiId: 'checkout_passages',
      value: ok(passages) ? fint(passages.value as number) : DASH,
      label: 'passaggi in cassa',
      note: 'tracce viste nella zona servizio',
      tip: tipFor(passages, 'Id distinti con una visita raw in CHECKOUT_SERVICE.'),
    },
    hasAreas && orto > 0
      ? {
        id: 'ortofrutta',
        kpiId: 'minutes_per_customer_by_dept_area',
        value: fmt(orto, 1),
        unit: 'min',
        label: 'in ortofrutta per cliente',
        note: `di cui ${fmt(ortoBanco, 1)} al banco, a scegliere`,
        tip: tipFor(fruttaA, 'Frutta + Verdura, minuti nell’area ÷ ingressi. Al banco = entro 1 m, fermo o lento.'),
      }
      : {
        id: 'aisle_share',
        kpiId: 'minutes_per_customer_by_dept',
        value: visitDay && corsie != null ? fmt(100 * corsie / visitDay, 0) : DASH,
        unit: visitDay && corsie != null ? '%' : undefined,
        label: 'del tempo fuori da ogni zona',
        note: 'corsie e scaffali senza ROI',
        tip: tipFor(pickKpi(payload, 'minutes_per_customer_by_dept'), 'Corsie = tempo in negozio − tempo in ROI, ÷ ingressi.'),
      },
  ];

  const qualityRow = pickKpi(payload, 'quality');
  const quality = (qualityRow?.payload && typeof qualityRow.payload === 'object')
    ? qualityRow.payload as Record<string, unknown>
    : {};
  const ph = phantomPct(quality);
  const checks = payload.checks || [];
  const checksPassed = checks.filter((c) => c.passed).length;
  const checksTotal = checks.length || 7;
  const zero = pickKpi(payload, 'zero_observation_rois');
  const zeroDepts = Array.isArray(zero?.payload) ? zero!.payload as string[] : [];
  const clean = ph != null ? 100 - ph : null;

  const qualityTiles: DisplayTile[] = [
    {
      id: 'obs',
      kpiId: 'quality',
      value: typeof quality.rows === 'number' ? formatObs(quality.rows as number) : DASH,
      label: 'osservazioni nel giorno',
      note: '10 al secondo, nessun buco nel flusso',
      tip: tipFor(qualityRow, 'Righe del parquet 10 Hz in orario di apertura.'),
    },
    {
      id: 'ids',
      kpiId: 'quality',
      value: typeof quality.ids === 'number' ? fint(quality.ids as number) : DASH,
      label: 'numeri di traccia emessi dal sensore',
      note: typeof quality.valid_ids === 'number'
        ? `${fint(quality.valid_ids as number)} validi in orario di apertura`
        : 'classi VALID + STATIC_SUSPECT',
      tip: tipFor(qualityRow, 'Id emessi dal sensore; i validi restano dopo il filtro fantasmi.'),
    },
    {
      id: 'checks',
      kpiId: 'daily_kpi_checks',
      value: `${checksPassed}/${checksTotal}`,
      label: 'controlli del giorno superati',
      note: checksPassed === checksTotal ? 'tutti i controlli automatici ok' : 'almeno un controllo è fallito',
      tip: checks.map((c) => `${c.check_id}: ${c.passed ? 'ok' : 'fallito'}`).join(' · ') || 'Controlli daily_kpi.',
    },
    {
      id: 'phantom',
      kpiId: 'quality',
      value: ph != null ? fmt(ph, 0) : DASH,
      unit: ph != null ? '%' : undefined,
      label: 'osservazioni di oggetti fermi (fantasmi)',
      note: 'tolte prima dei calcoli',
      tip: tipFor(qualityRow, 'Quota di osservazioni PHANTOM_STATIC / MICRO / FLICKER.'),
    },
    {
      id: 'clean',
      kpiId: 'quality',
      value: clean != null ? fmt(clean, 0) : DASH,
      unit: clean != null ? '%' : undefined,
      label: 'quota osservazioni pulite',
      note: '100 % meno la quota fantasmi',
      tip: 'Osservazioni non classificate come fantasma, sullo stesso denominatore di quality.',
    },
    {
      id: 'zero',
      kpiId: 'zero_observation_rois',
      value: ok(zero) || zeroDepts.length ? fint(zeroDepts.length) : DASH,
      label: 'zone del twin senza osservazioni',
      note: zeroDepts.length ? zeroDepts.join(', ') : 'nessuna zona scoperta oltre quelle note',
      tip: tipFor(zero, 'Reparti del twin con zero visite raw nel giorno.'),
    },
  ];

  const firstRow = pickKpi(payload, 'first_department_after_entrance');
  const firstAfter = Array.isArray(firstRow?.payload)
    ? (firstRow!.payload as Array<{ dst?: string; dept?: string; n: number }>)
      .map((r) => ({ dept: String(r.dst || r.dept || ''), n: Number(r.n || 0) }))
      .filter((r) => r.dept)
    : [];

  const behRow = pickKpi(payload, 'behaviour_share');
  const behaviour = parseBehaviour(behRow);
  const behaviourReason = !behaviour
    ? (behRow?.status_reason || 'Mix comportamentale non calcolato per questo giorno.')
    : null;

  const stayRow = pickKpi(payload, 'dept_stay_per_person');
  const deptStays = (stayRow?.payload && typeof stayRow.payload === 'object')
    ? stayRow.payload as ClienteMedioView['deptStays']
    : {};
  const reconPrec = pickKpi(payload, 'recon_blind_precision');
  const reconVendor = pickKpi(payload, 'recon_vendor_pairs_linked');
  const reconOk = stayRow?.status === 'ok'
    && (reconPrec?.value == null || (reconPrec.value as number) >= 0.85)
    && (reconVendor?.value == null || (reconVendor.value as number) >= 0.50);

  const counterWait: Record<string, Record<string, number | null>> = {};
  const counterStay: ClienteMedioView['counterStay'] = {};
  for (const name of SERVED_COUNTERS) {
    counterWait[name] = {};
    for (const sl of [...SLOTS, 'giorno'] as const) {
      const row = pickKpi(payload, 'counter_wait_people_mean', `${sl}|${name}`);
      counterWait[name][sl] = ok(row) ? row.value : null;
    }
    const stay = pickKpi(payload, 'counter_stay_s', `giorno|${name}`);
    const served = pickKpi(payload, 'counter_served_stays', `giorno|${name}`);
    const p = (stay?.payload && typeof stay.payload === 'object')
      ? stay.payload as { median?: number; p90?: number }
      : {};
    counterStay[name] = { median: p.median, p90: p.p90, stays: served?.value ?? undefined };
  }

  const adjRow = pickKpi(payload, 'dept_next_area_share');
  const adjacency = (adjRow?.payload && typeof adjRow.payload === 'object')
    ? adjRow.payload as Record<string, Record<string, number>>
    : {};
  const transRow = pickKpi(payload, 'dept_transitions');
  const promoRow = pickKpi(payload, 'promo_spot_counter_minutes');
  const promoRaw = promoRow?.payload;
  const promoSpots: ClienteMedioView['promoSpots'] = Array.isArray(promoRaw)
    ? (promoRaw as ClienteMedioView['promoSpots'])
    : (promoRaw && typeof promoRaw === 'object' && Array.isArray((promoRaw as { spots?: unknown }).spots)
      ? (promoRaw as { spots: ClienteMedioView['promoSpots'] }).spots
      : []);
  const flowRow = pickKpi(payload, 'flow_field');
  const flowField = Array.isArray(flowRow?.payload)
    ? flowRow!.payload as ClienteMedioView['flowField']
    : [];

  return {
    day: payload.day,
    dayLabel: formatDayLongIt(payload.day),
    hours,
    visitRounded: visitDay != null ? Math.floor(visitDay) : 23,
    tiles,
    qualityTiles,
    entrances: slotMap(payload, 'entrances'),
    visitMin: slotMap(payload, 'visit_min'),
    minutes,
    firstAfter,
    zeroDepts,
    queueWait: queueSlots,
    queueService: slotMap(payload, 'service_min_per_entrance'),
    lanes: laneShares(payload),
    behaviour,
    behaviourReason,
    checksPassed,
    checksTotal,
    minutesArea,
    minutesBanco,
    deptStays,
    reconOk,
    counterWait,
    counterStay,
    adjacency,
    transitions: transRow?.value ?? (transRow?.payload as { n?: number } | undefined)?.n ?? null,
    promoSpots,
    flowField,
  };
}

export function mergeBehaviour(obj: Record<string, number>): Record<string, number> {
  return mergeShare(obj);
}
