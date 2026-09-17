import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { classifyId, DEFAULT_PHANTOM_FILTER } from '../services/dailyKpi/idClassifier.js';
import {
  classifyQueueVisit,
  collectFixedSpots,
  excludedCheckoutFixedIds,
  DEFAULT_CHECKOUT_FIXED,
} from '../services/dailyKpi/queueClassification.js';
import {
  littleRelError,
  evaluateChecks,
  applyCheckStatus,
  CHECK_DEPENDENCIES,
} from '../services/dailyKpi/checks.js';
import { persistDailyKpi, loadDailyKpi, loadDailyKpiRange } from '../services/dailyKpi/store.js';
import { ensureDailyKpiTables } from '../services/dailyKpi/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const LAB_DAY = path.join(REPO, 'analysis/journey_lab/out/2026-09-14');
const SCRIPT = path.join(REPO, 'scripts/daily-customer-kpi.py');
const VENUE = '55fdd53b-3298-4355-97c0-b4e789b11d06';
const DAY = '2026-09-14';

const CONTRACT_KPI_IDS = [
  'entrances', 'visit_min', 'people_mean', 'people_max',
  'presence_per_minute', 'entrances_per_15min',
  'minutes_per_customer_by_dept',
  'minutes_per_customer_by_dept_area', 'minutes_per_customer_by_dept_counter',
  'department_area_m2',
  'queue_wait_min_per_entrance', 'service_min_per_entrance',
  'queue_decomposition_per_lane', 'first_department_after_entrance',
  'checkout_passages',
  'choice_index_by_dept', 'behaviour_share', 'behaviour_mix_by_slot',
  'heat_traffic', 'heat_still', 'zero_observation_rois', 'quality',
  'staff_on_floor', 'counter_wait_people_mean', 'dept_transitions',
];

function memoryDb() {
  const db = new Database(':memory:');
  ensureDailyKpiTables(db);
  return db;
}

describe('idClassifier (41_ids_phantoms port)', () => {
  it('classifies in CASE order: static, suspect, micro, flicker, speed, valid', () => {
    expect(classifyId({ dur_s: 600, extent_m: 2.9, path_m: 10, med_spd_w: 0.1 })).toBe('PHANTOM_STATIC');
    expect(classifyId({ dur_s: 300, extent_m: 1.4, path_m: 10, med_spd_w: 0.1 })).toBe('STATIC_SUSPECT');
    expect(classifyId({ dur_s: 5, extent_m: 0.4, path_m: 0.8, med_spd_w: 0.1 })).toBe('PHANTOM_MICRO');
    expect(classifyId({ dur_s: 0.5, extent_m: 2, path_m: 2, med_spd_w: 0.1 })).toBe('FLICKER_SHORT');
    expect(classifyId({ dur_s: 10, extent_m: 2, path_m: 5, med_spd_w: 3.6 })).toBe('SPEED_ANOMALY');
    expect(classifyId({ dur_s: 20, extent_m: 4, path_m: 8, med_spd_w: 0.8 })).toBe('VALID');
  });

  it('keeps STATIC_SUSPECT below the static box (customer waiting at a counter)', () => {
    expect(classifyId({ dur_s: 400, extent_m: 1.2, path_m: 3, med_spd_w: 0.05 })).toBe('STATIC_SUSPECT');
    expect(classifyId({ dur_s: 400, extent_m: 2.0, path_m: 3, med_spd_w: 0.05 })).toBe('VALID');
  });

  it('uses the recorded Treviglio thresholds', () => {
    expect(DEFAULT_PHANTOM_FILTER.static_duration_s).toBe(600);
    expect(DEFAULT_PHANTOM_FILTER.static_extent_m).toBe(3.0);
    expect(DEFAULT_PHANTOM_FILTER.suspect_duration_s).toBe(300);
    expect(DEFAULT_PHANTOM_FILTER.suspect_is_customer).toBe(true);
  });
});

describe('queueClassification (150_queue_wait port)', () => {
  const fixture = { id: 'person-fix', mx: 61.0, mz: 26.6, dur_s: 700, mean_spd: 0.01 };
  const walker = { id: 'person-walk', mx: 50, mz: 20, dur_s: 8, mean_spd: 0.9 };
  const waiter = { id: 'person-wait', mx: 55, mz: 22, dur_s: 40, mean_spd: 0.1 };
  const fragment = { id: 'person-frag', mx: 61.3, mz: 26.7, dur_s: 80, mean_spd: 0.05 };

  it('marks long visits FIXED, walkers TRANSIT, the rest WAITING', () => {
    const spots = collectFixedSpots([fixture, walker, waiter]);
    expect(spots).toHaveLength(1);
    expect(classifyQueueVisit(fixture, spots)).toBe('FIXED');
    expect(classifyQueueVisit(walker, spots)).toBe('TRANSIT');
    expect(classifyQueueVisit(waiter, spots)).toBe('WAITING');
  });

  it('pulls fragments within 1.2 m of a fixture into FIXED', () => {
    const spots = collectFixedSpots([fixture, fragment]);
    expect(classifyQueueVisit(fragment, spots)).toBe('FIXED');
    expect(excludedCheckoutFixedIds([fixture, fragment]).has('person-frag')).toBe(true);
  });

  it('does not mark a short far visit as FIXED', () => {
    const spots = collectFixedSpots([fixture]);
    expect(classifyQueueVisit({ id: 'x', mx: 40, mz: 10, dur_s: 80, mean_spd: 0.1 }, spots)).toBe('WAITING');
  });

  it('uses the recorded checkout_fixed_object thresholds', () => {
    expect(DEFAULT_CHECKOUT_FIXED.fixed_s).toBe(600);
    expect(DEFAULT_CHECKOUT_FIXED.near_m).toBe(1.2);
    expect(DEFAULT_CHECKOUT_FIXED.near_s).toBe(60);
    expect(DEFAULT_CHECKOUT_FIXED.speed_walk_mps).toBe(0.5);
  });
});

describe('Little reconciliation and check→status map', () => {
  it('reconciles department minutes to the visit total within 1%', () => {
    const depts = {
      Frutta: 0.53,
      Verdura: 0.60,
      Surgelati: 0.58,
      'Corsie / fuori zona': 15.97,
      'Coda cassa': 0.59,
      'Cassa (servizio)': 0.36,
      'TOTALE (Little)': 23.53,
    };
    const parts = 0.53 + 0.60 + 0.58 + 15.97 + 0.59 + 0.36;
    // this fixture is incomplete vs the real day; just prove the helper
    expect(littleRelError({ Frutta: 10, 'Corsie / fuori zona': 13.53, 'TOTALE (Little)': 23.53 }, 23.53))
      .toBeLessThan(0.01);
    expect(littleRelError({ Frutta: 5, 'Corsie / fuori zona': 5 }, 20)).toBeGreaterThan(0.01);
    expect(parts).toBeGreaterThan(0);
    expect(depts['TOTALE (Little)']).toBeCloseTo(23.53);
  });

  it('marks dependent KPIs unreliable when a check fails', () => {
    expect(CHECK_DEPENDENCIES.little).toContain('visit_min');
    const checks = evaluateChecks({
      minutesBySlot: { giorno: { Frutta: 1, 'Corsie / fuori zona': 1, 'TOTALE (Little)': 2 } },
      visitBySlot: { giorno: 2 },
      visitMin: 80,
      phantomRowsPct: 0.5,
      zeroObservationRois: ['Pane'],
      knownUncoveredRois: ['Pane', 'Salumi', 'Gastronomia'],
      fixedLeftoverInKpi: 0,
      rawFixedShare: 0.17,
      streamGapSkipped: true,
    });
    const byId = Object.fromEntries(checks.map((c) => [c.check_id, c.passed]));
    expect(byId.little).toBe(true);
    expect(byId.visit_range).toBe(false);
    expect(byId.phantom_share).toBe(false);
    expect(byId.zero_observation).toBe(true);
    expect(byId.fixed_queue).toBe(true);

    const stamped = applyCheckStatus([
      { kpi_id: 'visit_min', slot: 'giorno', status: 'ok', value: 80 },
      { kpi_id: 'entrances', slot: 'giorno', status: 'ok', value: 100 },
      { kpi_id: 'queue_wait_min_per_entrance', slot: 'giorno', status: 'ok', value: 0.5 },
    ], checks);
    expect(stamped.find((k) => k.kpi_id === 'visit_min').status).toBe('unreliable');
    expect(stamped.find((k) => k.kpi_id === 'entrances').status).toBe('unreliable');
    expect(stamped.find((k) => k.kpi_id === 'queue_wait_min_per_entrance').status).toBe('ok');
  });
});

describe('daily_kpi store', () => {
  it('upserts rows idempotently and returns the bundle', () => {
    const db = memoryDb();
    const payload = {
      venue_id: VENUE,
      day: DAY,
      headline: { entrances: 10 },
      kpis: [
        {
          kpi_id: 'entrances', slot: 'giorno', value: 10, unit: 'count',
          label: 'MEASURED', method: 'test', status: 'ok', status_reason: null, payload: null,
        },
      ],
      checks: [{ check_id: 'little', passed: true, detail: 'ok' }],
    };
    persistDailyKpi(db, payload);
    payload.kpis[0].value = 11;
    persistDailyKpi(db, payload);
    const loaded = loadDailyKpi(db, VENUE, DAY);
    expect(loaded.headline.entrances).toBe(10);
    expect(loaded.kpis.find((k) => k.kpi_id === 'entrances').value).toBe(11);
    const range = loadDailyKpiRange(db, VENUE, '2026-09-01', '2026-09-30');
    expect(range).toHaveLength(1);
    expect(range[0].entrances.value).toBe(11);
    db.close();
  });
});

function assembleLabDay() {
  const report = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-kpi-'));
  const run = spawnSync('python3', [
    SCRIPT,
    '--day', DAY,
    '--venue', VENUE,
    '--lab-out', LAB_DAY,
    '--report', report,
    '--assemble-only',
    '--cfg', path.join(REPO, 'analysis/journey_lab/config/treviglio.json'),
  ], { encoding: 'utf8' });
  return { report, run, jsonPath: path.join(report, VENUE, `${DAY}.json`) };
}

describe('assemble 2026-09-14 Treviglio from Journey Lab JSON', () => {
  const haveLab = fs.existsSync(path.join(LAB_DAY, '110_average_journey.json'));

  it.skipIf(!haveLab)('writes the contractual payload shape and acceptance scalars', () => {
    const { run, jsonPath } = assembleLabDay();
    expect(run.status, run.stderr || run.stdout).toBe(0);
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const ids = new Set(payload.kpis.map((k) => k.kpi_id));
    for (const id of CONTRACT_KPI_IDS) {
      expect(ids.has(id), `missing kpi_id ${id}`).toBe(true);
    }

    const pick = (id, slot = 'giorno') => payload.kpis.find((k) => k.kpi_id === id && k.slot === slot);
    expect(pick('entrances').value).toBeGreaterThanOrEqual(1948 * 0.99);
    expect(pick('entrances').value).toBeLessThanOrEqual(1948 * 1.01);
    expect(pick('entrances').label).toBe('MEASURED');
    expect(pick('visit_min').value).toBeGreaterThanOrEqual(17.3);
    expect(pick('visit_min').value).toBeLessThanOrEqual(17.9);
    expect(pick('visit_min').label).toBe('ESTIMATED');
    expect(pick('people_mean').value).toBeGreaterThanOrEqual(47);
    expect(pick('people_mean').value).toBeLessThanOrEqual(49);
    expect(pick('people_mean').label).toBe('MEASURED');
    expect(pick('queue_wait_min_per_entrance').value).toBeGreaterThanOrEqual(0.62);
    expect(pick('queue_wait_min_per_entrance').value).toBeLessThanOrEqual(0.66);
    expect(pick('queue_wait_min_per_entrance').label).toBe('ESTIMATED');
    expect(pick('queue_wait_min_per_entrance', '18-20').value).toBeGreaterThanOrEqual(0.98);
    expect(pick('queue_wait_min_per_entrance', '18-20').value).toBeLessThanOrEqual(1.04);
    expect(pick('service_min_per_entrance').value).toBeGreaterThanOrEqual(0.38);
    expect(pick('service_min_per_entrance').value).toBeLessThanOrEqual(0.42);

    const verdura = pick('minutes_per_customer_by_dept', 'giorno|Verdura');
    const surg = pick('minutes_per_customer_by_dept', 'giorno|Surgelati');
    const frutta = pick('minutes_per_customer_by_dept', 'giorno|Frutta');
    const corsie = pick('minutes_per_customer_by_dept', 'giorno|Corsie / fuori zona');
    expect(verdura.value).toBeCloseTo(0.66, 2);
    expect(surg.value).toBeCloseTo(0.63, 2);
    expect(frutta.value).toBeCloseTo(0.58, 2);
    expect(corsie.value).toBeGreaterThanOrEqual(9.6);
    expect(corsie.value).toBeLessThanOrEqual(10.0);

    const area = (dept) => pick('minutes_per_customer_by_dept_area', `giorno|${dept}`);
    const banco = (dept) => pick('minutes_per_customer_by_dept_counter', `giorno|${dept}`);
    expect(area('Frutta').value).toBeCloseTo(1.63, 1);
    expect(area('Surgelati').value).toBeCloseTo(1.54, 1);
    expect(area('Latticini').value).toBeCloseTo(1.32, 1);
    expect(area('Bakery & Breakfast').value).toBeCloseTo(1.21, 1);
    expect(area('Carne').value).toBeCloseTo(1.13, 1);
    expect(area('Verdura').value).toBeCloseTo(0.88, 1);
    expect(area('Scaffali senza categoria').value).toBeCloseTo(6.69, 1);
    expect(area('Ingresso, casse, retro banchi').value).toBeCloseTo(1.92, 1);
    expect(area('Corsie / fuori zona').value).toBeCloseTo(0.0, 1);
    expect(banco('Surgelati').value).toBeCloseTo(0.74, 1);
    expect(banco('Frutta').value).toBeCloseTo(0.60, 1);
    expect(area('Frutta').label).toBe('MEASURED');
    expect(pick('minutes_per_customer_by_dept').label).toBe('ESTIMATED');
    expect(pick('choice_index_by_dept', 'giorno|Surgelati').value).toBeGreaterThan(0.4);
    expect(pick('staff_on_floor').value).toBeGreaterThanOrEqual(11);
    expect(pick('staff_on_floor').value).toBeLessThanOrEqual(15);
    expect(pick('counter_wait_people_mean', 'giorno|Carne').value).toBeCloseTo(0.33, 1);
    expect(pick('counter_wait_people_mean', 'giorno|Pesce').value).toBeCloseTo(0.43, 1);
    expect(pick('counter_wait_people_mean', 'giorno|Bar').value).toBeCloseTo(0.58, 1);
    expect(pick('dept_transitions').value).toBeGreaterThan(21620 * 0.9);
    expect(pick('dept_transitions').value).toBeLessThan(21620 * 1.1);
    const share = pick('dept_next_area_share').payload;
    expect(share.Frutta.Verdura).toBeCloseTo(0.94, 1);
    expect(share.Verdura.Frutta).toBeCloseTo(0.68, 1);
    expect(pick('recon_blind_precision').value).toBeCloseTo(0.89, 1);
    expect(pick('recon_vendor_pairs_linked').value).toBeCloseTo(0.68, 1);

    const first = pick('first_department_after_entrance');
    expect(first.payload[0].dst).toBe('Frutta');
    expect(first.value).toBeGreaterThanOrEqual(0.90);
    expect(first.value).toBeLessThanOrEqual(0.92);
    expect(new Set(pick('zero_observation_rois').payload)).toEqual(new Set(['Pane', 'Salumi', 'Gastronomia']));

    const beh = pick('behaviour_share');
    if (beh.status === 'unreliable') {
      expect(beh.status_reason).toBe('not_computed');
    } else {
      expect(beh.status).toBe('ok');
      expect(beh.payload).toBeTruthy();
    }

    const checks = Object.fromEntries(payload.checks.map((c) => [c.check_id, c.passed]));
    expect(checks.little).toBe(true);
    expect(checks.visit_range).toBe(true);
    expect(checks.phantom_share).toBe(true);
    expect(checks.zero_observation).toBe(true);
    expect(checks.fixed_queue).toBe(true);

    const db = memoryDb();
    persistDailyKpi(db, payload);
    const loaded = loadDailyKpi(db, VENUE, DAY);
    expect(loaded.headline.entrances).toBe(1948);
    db.close();
  });
});

describe('acceptance on parquet (skipped unless present)', () => {
  const parquet = process.env.DAILY_KPI_PARQUET
    || '/data/hyperspace/raw/hyperspace-raw-2026-09-14.parquet';
  const have = fs.existsSync(parquet);

  it.skipIf(!have)('recomputes 2026-09-14 within the published bands', () => {
    const report = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-kpi-pq-'));
    const run = spawnSync('python3', [
      SCRIPT,
      '--day', DAY,
      '--venue', VENUE,
      '--parquet', parquet,
      '--lab-out', LAB_DAY,
      '--report', report,
      '--assemble-only',
    ], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const payload = JSON.parse(fs.readFileSync(path.join(report, VENUE, `${DAY}.json`), 'utf8'));
    expect(payload.headline.entrances).toBeGreaterThanOrEqual(1928);
    expect(payload.headline.visit_min).toBeGreaterThanOrEqual(17.3);
    expect(payload.headline.people_mean).toBeGreaterThanOrEqual(47);
    expect(payload.headline.queue_wait_min_per_entrance).toBeGreaterThanOrEqual(0.62);
  });
});
