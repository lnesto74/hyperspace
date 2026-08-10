/**
 * Does the executive report actually render?
 *
 * PDFKit fails late and quietly — a bad colour or a missing field surfaces as a
 * truncated stream rather than a thrown error — so this drives the renderer
 * with a payload shaped like the live one and asserts the bytes look like a
 * PDF. It also runs the degenerate cases that occur in production every night:
 * a window with no comparison, no ERP, no insights and no checkout lanes.
 *
 * Run: node backend/tests/esselungaExecutivePdf.test.js
 */
import assert from 'node:assert/strict';
import {
  renderEsselungaExecutivePdf,
  executivePdfFileName,
  formatRange,
} from '../services/executive/EsselungaExecutivePdf.js';

const HOUR = 3600_000;
const END = Date.parse('2026-08-06T18:00:00Z');
const START = END - 24 * HOUR;

function headlineKpi(over = {}) {
  return {
    id: 'entrants',
    label: 'Entrants',
    value: 1518,
    display: '1,518',
    hint: 'people crossing the entrance line',
    previous: 1402,
    higherIsBetter: true,
    deltaPct: 8.3,
    direction: 'up',
    good: true,
    ...over,
  };
}

function fullPayload() {
  return {
    variant: 'live',
    venueId: 'venue-1',
    range: { startTs: START, endTs: END },
    generatedAt: END,
    metricThresholds: { dwellSec: 5, engagementSec: 60, minVisitMs: 300, source: 'venue_default' },
    storeHours: { openingHour: 8, closingHour: 20, hoursLabel: '08:00 – 20:00', timeZone: 'Europe/Rome' },
    activityTimelines: {
      hourly: {
        grain: 'hour',
        visitors: Array.from({ length: 12 }, (_, i) => ({ label: `${8 + i}:00`, value: 60 + i * 17 })),
        dwells: Array.from({ length: 12 }, (_, i) => ({ label: `${8 + i}:00`, value: 20 + i * 6 })),
      },
      daily: { grain: 'day', visitors: [], dwells: [] },
    },
    taxonomy: { totalRois: 86, fresco: 21, aisles: 37, checkout: 26, ingress: 1 },
    overview: {
      totalVisitors: 1073, perimeterEntrants: 1518, avgStoreDwellMin: 0.9,
      medianStoreDwellMin: 0.9, avgStoreDwellReliable: true, currentOccupancy: 36,
      avgTicket: 44.5, spi: 18.6, spiSource: 'erp',
    },
    fresco: {
      departments: [
        { id: 'ortofrutta', label: 'Verdura', visits: 1379, dwellVisits: 844, avgDwellSec: 16, avgDwellMin: 0.3, stoppingPct: 61.2, browsingPct: 61.2, waitingPct: 0, abandonPct: 0, hasQueueZones: false },
        { id: 'macelleria', label: 'Carne', visits: 495, dwellVisits: 277, avgDwellSec: 21, avgDwellMin: 0.4, stoppingPct: 56, browsingPct: 56, waitingPct: 34, abandonPct: 12, hasQueueZones: true },
      ],
    },
    aisles: {
      penetrationPct: 6.5, stoppingPowerPct: 54.4, engagementRatePct: 28.1,
      passThroughPct: 45.6, bypassPct: 93.5,
      dwellVisits: 1493, totalAisleVisits: 2746, aisleConversionPct: null,
      categoryGroups: [
        { category: 'Surgelati', visits: 1211, uniqueVisitors: 573, stoppingPowerPct: 70.2, avgDwellMin: 0.4, roiCount: 10 },
        { category: 'Bar', visits: 489, uniqueVisitors: 318, stoppingPowerPct: 39.9, avgDwellMin: 0.1, roiCount: 4 },
      ],
      topAisles: [{ id: 'r1', name: 'Shelf 15', category: 'Surgelati', visits: 300, stoppingPowerPct: 70, avgDwellMin: 0.4 }],
    },
    checkout: {
      channels: [
        { id: 'traditional', label: 'Traditional', sessions: 425, completed: 425, avgWaitMin: 0.31, abandonPct: 0, currentQueue: 5, roiIds: [] },
      ],
      avgWaitMin: 0.31, completed: 425, frictionScore: 0.34,
    },
    crossKpis: { spi: 18.6, spiSource: 'erp', shoppingEfficiency: 49.4, checkoutFrictionScore: 0.34, avgTicket: 44.5, totalRevenue: 47738, mediaCes: 0, mediaEal: 0 },
    media: { ces: 0, eal: 0 },
    erp: { hasData: true, lastUpload: null, rowCount: 1073, byCategory: [] },
    insights: [
      { id: 'i1', severity: 'warn', title: 'Carne: elevated waiting', message: '34% of time in queue rather than browsing.', action: 'Review service counter staffing', section: 'fresco' },
      { id: 'i2', severity: 'info', title: 'Aisle penetration below target', message: 'Only 6.5% of entrants reach aisles.', action: 'Review layout and signage', section: 'aisles' },
    ],
    comparison: {
      label: 'same window, previous week', range: { startTs: START - 7 * 24 * HOUR, endTs: END - 7 * 24 * HOUR },
      entrants: 1402, totalVisitors: 990, shoppingDwellMin: 1.1, shoppingDwellReliable: true,
      stoppingPowerPct: 49.1, penetrationPct: 7.2, checkoutCompleted: 400, avgWaitMin: 0.4,
      avgTicket: 43.1, spi: 17.9,
    },
    headlineKpis: [
      headlineKpi(),
      headlineKpi({ id: 'stopping', label: 'Stopping power', value: 54.4, display: '54.4%', hint: 'aisle crossings with a pause over 5s', previous: 49.1, deltaPct: 10.8 }),
      headlineKpi({ id: 'dwell', label: 'Shopping dwell', value: 0.9, display: '0.9m', hint: 'median time in tracked zones per visit', previous: 1.1, deltaPct: -18.2, direction: 'down', good: false }),
      headlineKpi({ id: 'wait', label: 'Checkout wait', value: 0.31, display: '19s', hint: 'average queue time across lanes', previous: 0.4, deltaPct: -22.5, direction: 'down', good: true, higherIsBetter: false }),
    ],
    headline: {
      tone: 'good',
      text: '1,518 people came in, up 8.3% on the same window last week. 54.4% of aisle crossings became a stop at the shelf, against 49.1% a week ago. Checkout queues averaged 19s.',
    },
  };
}

/** The shape produced overnight, when almost everything is empty. */
function sparsePayload() {
  const p = fullPayload();
  return {
    ...p,
    activityTimelines: { hourly: { grain: 'hour', visitors: [], dwells: [] }, daily: { grain: 'day', visitors: [], dwells: [] } },
    fresco: { departments: [] },
    aisles: { ...p.aisles, penetrationPct: null, bypassPct: null, categoryGroups: [], topAisles: [], stoppingPowerPct: 0, passThroughPct: 100 },
    checkout: { channels: [], avgWaitMin: 0, completed: 0, frictionScore: null },
    erp: { hasData: false, lastUpload: null, rowCount: 0, byCategory: [] },
    insights: [],
    comparison: null,
    headlineKpis: [headlineKpi({ previous: null, deltaPct: null, direction: 'flat', good: null, value: 0, display: '0' })],
    headline: { tone: 'info', text: '0 people came in.' },
  };
}

function renderToBuffer(payload, venueName) {
  return new Promise((resolve, reject) => {
    const doc = renderEsselungaExecutivePdf(payload, { venueName });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

let failures = 0;
const check = (name, fn) => fn()
  .then(() => console.log(`  ok    ${name}`))
  .catch((e) => { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); });

(async () => {
  console.log('esselunga executive pdf\n');

  await check('a full payload renders a valid multi-page PDF', async () => {
    const buf = await renderToBuffer(fullPayload(), 'TREVIGLIO Schematico');
    assert.strictEqual(buf.subarray(0, 5).toString(), '%PDF-', 'not a PDF header');
    assert.ok(buf.subarray(-1024).includes('%%EOF'), 'stream did not terminate');
    assert.ok(buf.length > 6000, `suspiciously small: ${buf.length} bytes`);
    // Exactly two, not "at least". Drawing the footer below the bottom margin
    // used to make PDFKit start a fresh page per footer, so the report shipped
    // with a blank page after every real one and nothing complained.
    const pages = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || [];
    assert.strictEqual(pages.length, 2, `expected 2 pages, got ${pages.length}`);
    console.log(`        ${buf.length.toLocaleString()} bytes, ${pages.length} pages`);
  });

  await check('an empty overnight window still renders rather than throwing', async () => {
    const buf = await renderToBuffer(sparsePayload(), 'TREVIGLIO Schematico');
    assert.strictEqual(buf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(buf.subarray(-1024).includes('%%EOF'), 'stream did not terminate');
    console.log(`        ${buf.length.toLocaleString()} bytes`);
  });

  await check('every tone renders — a bad day must not crash the report', async () => {
    for (const tone of ['good', 'warn', 'bad', 'info']) {
      const p = fullPayload();
      p.headline = { tone, text: `Tone ${tone}.` };
      p.insights = p.insights.map((i) => ({ ...i, severity: tone }));
      const buf = await renderToBuffer(p, 'Venue');
      assert.ok(buf.length > 5000, `tone ${tone} produced ${buf.length} bytes`);
    }
  });

  await check('the filename is safe to write to disk and carries the day', async () => {
    const name = executivePdfFileName('TREVIGLIO Schematico', fullPayload());
    assert.match(name, /^esselunga-executive-treviglio-schematico-\d{4}-\d{2}-\d{2}\.pdf$/, name);
    assert.ok(!/[/\\\s]/.test(name), `unsafe characters in ${name}`);
  });

  await check('daily window in Rome TZ reads as one day with start and end times', async () => {
    // Venue midnight → 14:38 on 6 Aug — in UTC that is 5 Aug 22:00 → 6 Aug 12:38,
    // which used to render as "5 Aug – 6 Aug" with no clocks.
    const start = Date.parse('2026-08-05T22:00:00.000Z');
    const end = Date.parse('2026-08-06T12:38:00.000Z');
    const label = formatRange(start, end, 'Europe/Rome');
    assert.match(label, /6 August 2026/, label);
    assert.match(label, /00:00/, label);
    assert.match(label, /14:38/, label);
    assert.ok(!label.includes('5 Aug'), `must not look like two bare dates: ${label}`);
  });

  await check('multi-day windows always keep times so the span is unambiguous', async () => {
    const start = Date.parse('2026-08-05T06:00:00.000Z'); // 08:00 Rome
    const end = Date.parse('2026-08-06T12:38:00.000Z');   // 14:38 Rome
    const label = formatRange(start, end, 'Europe/Rome');
    assert.match(label, /5 Aug 2026 08:00/, label);
    assert.match(label, /6 Aug 2026 14:38/, label);
    assert.match(label, /→/, label);
  });

  // Layout defects survive every assertion above — the only way to catch a
  // collision or an overflow is to look at it.
  //   PDF_PREVIEW_DIR=/tmp/pdfprev node backend/tests/esselungaExecutivePdf.test.js
  if (process.env.PDF_PREVIEW_DIR) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(process.env.PDF_PREVIEW_DIR, { recursive: true });
    const out = `${process.env.PDF_PREVIEW_DIR}/exec.pdf`;
    writeFileSync(out, await renderToBuffer(fullPayload(), 'TREVIGLIO Schematico'));
    console.log(`\npreview written to ${out}`);
  }

  console.log(`\n${failures === 0 ? 'all passed' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
