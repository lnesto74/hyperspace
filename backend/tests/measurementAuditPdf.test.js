/**
 * Does the measurement audit actually render?
 *
 * PDFKit fails late and quietly — a bad colour or a missing field surfaces as a
 * truncated stream rather than a thrown error — so this drives the renderer with
 * payloads shaped like the live ones and asserts the bytes look like a PDF.
 *
 * The cases that matter are the degenerate ones. The overnight job has not run
 * on a fresh server, so the raw-feed half is absent; a quiet window has no zone
 * visits at all; and the zone list is long enough to page, which is where a
 * table that cannot break silently drops the quiet zones an audit exists to
 * expose.
 *
 * Run: node backend/tests/measurementAuditPdf.test.js
 */
import assert from 'node:assert/strict';
import {
  renderMeasurementAuditPdf,
  measurementAuditPdfFileName,
} from '../services/executive/MeasurementAuditPdf.js';

const HOUR = 3600_000;
const END = Date.parse('2026-08-07T06:00:00Z');
const START = END - 24 * HOUR;

function truthZone(i) {
  return {
    id: `roi-${i}`,
    name: `Corsia ${i} — surgelati e latticini`,
    category: i % 3 === 0 ? null : ['Surgelati', 'Latticini', 'Verdura'][i % 3],
    role: 'aisle',
    areaM2: 12 + i,
    spanM: 6.4,
    raw: { visits: 120 - i, meanPathM: 3.11, meanDwellSec: 14.2, meanSamplesPerVisit: 41 },
    reconciled: { visits: 96 - i, people: 90 - i, meanPathM: 4.87, meanDwellSec: 22.6 },
    sampled: { meanPathM: 2.4, pathRetainedPct: 49.3 },
    pathVsSpan: 0.76,
    fragmentsPerVisit: 1 + (i % 5) * 0.15,
  };
}

function fullTruth(zoneCount = 40) {
  return {
    available: true,
    date: '2026-08-06',
    venueId: 'venue-1',
    ingest: { linesRead: 31_200_400, messagesUsed: 28_004_112, medianFrameIntervalMs: 100, elapsedSec: 2140 },
    method: {
      fragmentPath: 'Distance is summed between consecutive frames of one supplier id.',
      personPath: 'A person is the sum of their own fragments, so reconciliation cannot invent distance.',
    },
    totals: {
      raw: {
        tracks: 41_233, meanPathM: 6.2, medianPathM: 3.4, p90PathM: 19.1, totalPathM: 255_646,
        meanDurationSec: 18.4, medianDurationSec: 9.1, p90DurationSec: 61, ghostPct: 18.3,
      },
      reconciled: {
        tracks: 12_004, meanPathM: 21.3, medianPathM: 14.9, p90PathM: 62.2, totalPathM: 255_691,
        meanDurationSec: 64.2, medianDurationSec: 41.0, p90DurationSec: 188, ghostPct: 2.1,
      },
      distinctVendorIds: 48_902,
      vendorFragmentsPerPerson: 3.43,
      peopleAffectedByFragmentationPct: 71.2,
      journeyHeldByVendorIdentityPct: 29.1,
      journeyHeldByVendorIdentitySec: 9.1,
      bridgesPerPerson: 2.41,
      meanBridgedDistanceM: 4.02,
      meanBridgedSec: 3.8,
      fragmentsDroppedAsGhosts: 7_551,
      conservationErrorPct: 0.018,
      pathRetainedBySamplingPct: 48.6,
    },
    zones: Array.from({ length: zoneCount }, (_, i) => truthZone(i)),
  };
}

function storedAudit(zoneCount = 45) {
  return {
    venueId: 'venue-1',
    range: { startTs: START, endTs: END },
    method: { note: 'Distance is accumulated between stored position samples, taken about every three seconds.' },
    totals: {
      visits: 18_442, zones: zoneCount, venueRawPerceptionIds: 48_902,
      venueReconciledTracks: 12_004, venueFragmentsPerTrack: 4.07, positionSamples: 302_881,
    },
    zones: Array.from({ length: zoneCount }, (_, i) => ({
      id: `roi-${i}`,
      name: `Corsia ${i}`,
      category: i % 4 === 0 ? null : 'Surgelati',
      areaM2: 14, spanM: 6.4,
      visits: 400 - i * 3, tracks: 380 - i * 3, sessions: 300 - i * 2,
      meanDwellSec: 21.4, medianDwellSec: 14, distinctDurations: i % 7 === 0 ? 9 : 180,
      durationResolution: 1, zeroLengthPct: 2.1,
      meanPathM: 2.44, pathVsSpan: 0.38,
      samplesPerRun: 2.1, singleSamplePct: i % 5 === 0 ? 46.2 : 12.4,
      rawPerceptionIds: 900, reconciledTracks: 380, fragmentsPerTrack: 2.36,
    })),
  };
}

function renderToBuffer(args) {
  return new Promise((resolve, reject) => {
    const doc = renderMeasurementAuditPdf(args);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

const pageCount = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

let failures = 0;
const check = (name, fn) => fn()
  .then(() => console.log(`  ok    ${name}`))
  .catch((e) => { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); });

(async () => {
  console.log('measurement audit pdf\n');

  await check('a full audit renders a valid multi-page PDF', async () => {
    const buf = await renderToBuffer({
      truth: fullTruth(), stored: storedAudit(), venueName: 'TREVIGLIO Schematico', startTs: START, endTs: END,
    });
    assert.strictEqual(buf.subarray(0, 5).toString(), '%PDF-', 'not a PDF header');
    assert.ok(buf.subarray(-1024).includes('%%EOF'), 'stream did not terminate');
    assert.ok(buf.length > 6000, `suspiciously small: ${buf.length} bytes`);
    console.log(`        ${buf.length.toLocaleString()} bytes, ${pageCount(buf)} pages`);
  });

  await check('long zone lists page instead of being cut at the fold', async () => {
    const short = await renderToBuffer({
      truth: fullTruth(4), stored: storedAudit(4), venueName: 'Venue', startTs: START, endTs: END,
    });
    const long = await renderToBuffer({
      truth: fullTruth(120), stored: storedAudit(140), venueName: 'Venue', startTs: START, endTs: END,
    });
    assert.ok(
      pageCount(long) > pageCount(short),
      `260 zones produced ${pageCount(long)} pages against ${pageCount(short)} for 8 — rows are being dropped`,
    );
    console.log(`        ${pageCount(short)} pages for 8 zones, ${pageCount(long)} for 260`);
  });

  await check('a server with no overnight run still produces the stored half', async () => {
    const buf = await renderToBuffer({
      truth: { available: false, reason: 'No raw-feed forensic runs have completed yet.' },
      stored: storedAudit(6),
      venueName: 'Venue',
      startTs: START,
      endTs: END,
    });
    assert.strictEqual(buf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(buf.subarray(-1024).includes('%%EOF'), 'stream did not terminate');
    console.log(`        ${buf.length.toLocaleString()} bytes`);
  });

  await check('a window with nothing in it renders rather than throwing', async () => {
    const buf = await renderToBuffer({
      truth: { available: false, reason: 'none' },
      stored: { totals: { visits: 0, zones: 0, venueRawPerceptionIds: 0, venueReconciledTracks: 0, venueFragmentsPerTrack: null, positionSamples: 0 }, zones: [] },
      venueName: 'Venue',
      startTs: START,
      endTs: END,
    });
    assert.ok(buf.subarray(-1024).includes('%%EOF'), 'stream did not terminate');
  });

  await check('null metrics degrade to a dash instead of NaN on the page', async () => {
    const truth = fullTruth(3);
    truth.totals.vendorFragmentsPerPerson = null;
    truth.totals.meanBridgedDistanceM = null;
    truth.totals.pathRetainedBySamplingPct = null;
    truth.zones[0].spanM = null;
    truth.zones[0].reconciled.meanPathM = null;
    const buf = await renderToBuffer({
      truth, stored: storedAudit(3), venueName: 'Venue', startTs: START, endTs: END,
    });
    assert.ok(!buf.toString('latin1').includes('NaN'), 'NaN reached the document');
  });

  await check('the filename is safe to write to disk and carries the day', async () => {
    const name = measurementAuditPdfFileName('TREVIGLIO Schematico', END);
    assert.match(name, /^measurement-audit-treviglio-schematico-\d{4}-\d{2}-\d{2}\.pdf$/, name);
    assert.ok(!/[/\\\s]/.test(name), `unsafe characters in ${name}`);
  });

  // Layout defects survive every assertion above — the only way to catch a
  // collision or an overflow is to look at it.
  //   PDF_PREVIEW_DIR=/tmp/pdfprev node backend/tests/measurementAuditPdf.test.js
  if (process.env.PDF_PREVIEW_DIR) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(process.env.PDF_PREVIEW_DIR, { recursive: true });
    const out = `${process.env.PDF_PREVIEW_DIR}/audit.pdf`;
    writeFileSync(out, await renderToBuffer({
      truth: fullTruth(), stored: storedAudit(), venueName: 'TREVIGLIO Schematico', startTs: START, endTs: END,
    }));
    console.log(`\npreview written to ${out}`);
  }

  console.log(`\n${failures === 0 ? 'all passed' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
