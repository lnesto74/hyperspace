/**
 * The measurement audit as a printable document.
 *
 * This one is written to be handed to someone who was not in the room — a
 * supplier, a procurement lead, an arbitrator — so it states what was measured,
 * against which identity, and where the method stops being reliable. It renders
 * the same two payloads the tab consumes and recomputes nothing, so paper and
 * screen cannot disagree.
 *
 * Where the executive report leads with a verdict, this leads with the method.
 * A figure that is disputed is only worth as much as the reader's ability to
 * check how it was produced.
 */

import PDFDocument from 'pdfkit';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_W = A4.width - MARGIN * 2;

const INK = '#111827';
const MUTED = '#6b7280';
const FAINT = '#9ca3af';
const RULE = '#e5e7eb';
const PANEL = '#f9fafb';
const GOOD = '#047857';
const WARN = '#b45309';
const BAD = '#b91c1c';

const nf = (v, dp = 1) => (Number.isFinite(v) ? v.toFixed(dp).replace(/\.0+$/, '') : '—');
const int = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');

function secs(v) {
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v < 60) return `${nf(v)}s`;
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Colour is a judgement here, not decoration: green only where sound. */
function tone(good, warn) {
  if (good) return GOOD;
  if (warn) return WARN;
  return BAD;
}

function formatRange(startTs, endTs) {
  const s = new Date(startTs);
  const e = new Date(endTs);
  const hm = { hour: '2-digit', minute: '2-digit', hour12: false };
  const short = { day: 'numeric', month: 'short', year: 'numeric' };
  if (s.toDateString() === e.toDateString()) {
    return `${s.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
      + ` · ${s.toLocaleTimeString('en-GB', hm)}–${e.toLocaleTimeString('en-GB', hm)}`;
  }
  return `${s.toLocaleDateString('en-GB', short)} – ${e.toLocaleDateString('en-GB', short)}`;
}

// ---------------------------------------------------------------- primitives

function sectionTitle(doc, text, y, note) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(text, MARGIN, y);
  let next = doc.y;
  if (note) {
    doc.font('Helvetica').fontSize(7.5).fillColor(FAINT)
      .text(note, MARGIN, next + 1, { width: CONTENT_W });
    next = doc.y;
  }
  doc.moveTo(MARGIN, next + 4).lineTo(MARGIN + CONTENT_W, next + 4)
    .lineWidth(0.5).strokeColor(RULE).stroke();
  return next + 12;
}

function findings(doc, cards, y) {
  if (!cards.length) return y;
  const perRow = cards.length <= 2 ? cards.length : (cards.length % 3 === 0 ? 3 : 2);
  const gap = 10;
  const cardW = (CONTENT_W - gap * (perRow - 1)) / perRow;
  let cy = y;
  let rowH = 0;

  cards.forEach((c, i) => {
    const col = i % perRow;
    if (col === 0 && i > 0) {
      cy += rowH + gap;
      rowH = 0;
    }
    const x = MARGIN + col * (cardW + gap);

    doc.font('Helvetica').fontSize(6.5);
    const bodyH = doc.heightOfString(c.body, { width: cardW - 18 });
    const h = bodyH + 40;
    if (h > rowH) rowH = h;

    doc.roundedRect(x, cy, cardW, h, 4).fillColor('#ffffff').fill();
    doc.roundedRect(x, cy, cardW, h, 4).lineWidth(0.75).strokeColor(RULE).stroke();

    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
      .text(c.label.toUpperCase(), x + 9, cy + 8, { width: cardW - 18, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(15).fillColor(c.tone || INK)
      .text(c.value, x + 9, cy + 18, { width: cardW - 18, lineBreak: false });
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
      .text(c.body, x + 9, cy + 36, { width: cardW - 18 });
  });

  return cy + rowH + 10;
}

/**
 * Paginating table. Zone lists run to dozens of rows, and a table that silently
 * stopped at the page break would drop exactly the quiet zones an audit exists
 * to expose.
 */
function table(doc, { headers, rows, widths, align = [], y, onNewPage }) {
  const colX = [];
  let x = MARGIN;
  for (const w of widths) {
    colX.push(x);
    x += w * CONTENT_W;
  }

  /**
   * Clipped by measured width rather than by PDFKit's ellipsis option, which
   * let long zone names wrap onto a second line and overprint the row beneath.
   * Zone names here are free text a store wrote, so some of them are sentences.
   */
  const cell = (text, i, cy) => {
    const w = widths[i] * CONTENT_W - 6;
    let s = String(text ?? '—');
    if (doc.widthOfString(s) > w) {
      while (s.length > 1 && doc.widthOfString(`${s}…`) > w) s = s.slice(0, -1);
      s += '…';
    }
    doc.text(s, colX[i] + 3, cy, { width: w, align: align[i] || 'left', lineBreak: false });
  };

  const head = (cy) => {
    doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED);
    headers.forEach((h, i) => cell(h, i, cy));
    doc.moveTo(MARGIN, cy + 9).lineTo(MARGIN + CONTENT_W, cy + 9)
      .lineWidth(0.5).strokeColor(RULE).stroke();
    return cy + 13;
  };

  let cy = head(y);
  doc.font('Helvetica').fontSize(7.5);

  rows.forEach((row, r) => {
    if (cy > A4.height - 60) {
      doc.addPage();
      cy = onNewPage ? onNewPage(doc) : MARGIN;
      cy = head(cy);
      doc.font('Helvetica').fontSize(7.5);
    }
    if (r % 2 === 1) doc.rect(MARGIN, cy - 2.5, CONTENT_W, 12).fillColor(PANEL).fill();
    row.forEach((v, i) => {
      doc.fillColor(v && v.color ? v.color : INK);
      cell(v && v.text !== undefined ? v.text : v, i, cy);
    });
    cy += 12;
  });

  return cy + 4;
}

// ------------------------------------------------------------------ sections

function drawHeader(doc, { venueName, rangeLabel, generatedAt }) {
  doc.rect(0, 0, A4.width, 68).fillColor('#0f172a').fill();
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff')
    .text('Measurement audit', MARGIN, 18, { width: CONTENT_W - 160 });
  doc.font('Helvetica').fontSize(9).fillColor('#94a3b8')
    .text(`${venueName} · ${rangeLabel}`, MARGIN, 38, { width: CONTENT_W - 160 });

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#e2e8f0')
    .text('HYPERSPACE', A4.width - MARGIN - 160, 20, { width: 160, align: 'right' });
  doc.font('Helvetica').fontSize(7).fillColor('#64748b')
    .text('Internal · perception evidence', A4.width - MARGIN - 160, 32, { width: 160, align: 'right' });
  doc.font('Helvetica').fontSize(6.5).fillColor('#475569')
    .text(`Generated ${generatedAt}`, A4.width - MARGIN - 160, 43, { width: 160, align: 'right' });

  return 86;
}

function drawPurpose(doc, y) {
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(
    'Evidence for whether a suspicious number comes from the store, from our processing, or from the '
    + 'perception supplier. The same people are counted three ways — as the supplier\'s own object ids, as the '
    + 'identities our reconciler stitches together in real time, and as what the database keeps afterwards — so '
    + 'the contribution of each stage can be read on its own. Nothing here is a business KPI.',
    MARGIN, y, { width: CONTENT_W },
  );
  return doc.y + 12;
}

function drawSupplier(doc, truth, y) {
  if (!truth?.available || !truth.totals) {
    const next = sectionTitle(doc, 'What the perception supplier delivered', y);
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(
      truth?.reason || 'No raw-feed forensic run is available. A run covers one trading day and is produced '
        + 'offline overnight, because a day is tens of millions of messages.',
      MARGIN, next, { width: CONTENT_W },
    );
    return doc.y + 12;
  }

  const t = truth.totals;
  const next = sectionTitle(
    doc,
    'What the perception supplier delivered',
    y,
    `${truth.date} · ${int(truth.ingest?.messagesUsed)} messages at ${truth.ingest?.medianFrameIntervalMs} ms `
    + `between frames · ${int(t.raw?.tracks)} supplier tracks from ${int(t.distinctVendorIds)} object ids, `
    + `resolving to ${int(t.reconciled?.tracks)} people. Measured at the full 10 Hz the supplier publishes, `
    + 'so these are true walked paths rather than the corner-cutting estimate stored samples allow.',
  );

  const frags = t.vendorFragmentsPerPerson;
  const held = t.journeyHeldByVendorIdentityPct;
  const life = t.raw?.medianDurationSec;
  const ghost = t.raw?.ghostPct;

  return findings(doc, [
    {
      label: 'Identities per person',
      value: nf(frags, 2),
      tone: tone(frags < 1.2, frags < 1.6),
      body: `Separate continuous tracks emitted for each shopper. ${nf(t.peopleAffectedByFragmentationPct)}% of `
        + 'people were split across more than one id.',
    },
    {
      label: 'Journey held by one id',
      value: `${nf(held)}%`,
      tone: tone(held > 85, held > 60),
      body: `A single supplier identity covers this share of the distance a shopper actually walks — `
        + `${nf(t.raw?.meanPathM, 2)} m of ${nf(t.reconciled?.meanPathM, 2)} m.`,
    },
    {
      label: 'Median track life',
      value: secs(life),
      tone: tone(life > 20, life > 8),
      body: `Half the supplier's tracks are shorter than this. After reconciliation the median presence is `
        + `${secs(t.reconciled?.medianDurationSec)}.`,
    },
    {
      label: 'Tracks that never moved',
      value: `${nf(ghost)}%`,
      tone: tone(ghost < 10, ghost < 25),
      body: 'Supplier tracks whose entire path is under half a metre — clutter every downstream count discards.',
    },
    {
      label: 'Route we had to infer',
      value: `${nf(t.meanBridgedDistanceM, 2)} m · ${secs(t.meanBridgedSec)}`,
      tone: WARN,
      body: `Per shopper, the distance and time the supplier stopped reporting them entirely, across `
        + `${nf(t.bridgesPerPerson, 2)} dropouts each. Counted apart from measured distance because it is inferred.`,
    },
    {
      label: 'Distance is conserved',
      // The headline is the agreement, not the totals: two six-figure numbers
      // and an arrow overflow the card, and the arrow glyph is outside
      // Helvetica's WinAnsi encoding, which PDFKit renders as mojibake rather
      // than failing.
      value: `${nf(t.conservationErrorPct, 3)}%`,
      tone: INK,
      body: `Total walked distance before and after reconciliation agrees to this: ${int(t.raw?.totalPathM)} m `
        + `against ${int(t.reconciled?.totalPathM)} m. A person's distance is the sum of their own fragments, `
        + 'so reconciliation cannot invent a metre.',
    },
  ], next);
}

function drawOurLoss(doc, truth, y) {
  const pct = truth?.totals?.pathRetainedBySamplingPct;
  if (!Number.isFinite(pct)) return y;

  const next = sectionTitle(doc, 'What our own storage costs', y);
  doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(
    `${nf(pct)}% of the true walked path survives in the database once positions are stored every three `
    + 'seconds. This limit is ours, not the supplier\'s, and it reduces every distance in the stored-window '
    + 'table below. It is stated here rather than in a footnote because an audit that only lists the other '
    + 'party\'s failures is not an audit.',
    MARGIN, next, { width: CONTENT_W },
  );
  return doc.y + 12;
}

function drawTruthZones(doc, truth, y, onNewPage) {
  const zones = truth?.zones || [];
  if (!zones.length) return y;

  const next = sectionTitle(
    doc,
    'True path per zone, before and after reconciliation',
    y,
    'Distance walked inside each zone at full frame rate. Compare with the zone\'s span — roughly a straight '
    + 'crossing — to separate a zone people walk through from one they stand in. Where raw and reconciled '
    + 'diverge, the supplier was splitting one visit into several.',
  );

  return table(doc, {
    y: next,
    onNewPage,
    headers: ['Zone', 'Category', 'Span', 'Visits raw', 'Visits rec.', 'Path raw', 'Path rec.', 'Dwell raw', 'Dwell rec.', 'Frag.'],
    widths: [0.23, 0.11, 0.06, 0.08, 0.08, 0.09, 0.09, 0.08, 0.08, 0.10],
    align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
    rows: zones.map((z) => [
      z.name,
      z.category || 'untagged',
      `${nf(z.spanM)} m`,
      int(z.raw?.visits),
      int(z.reconciled?.visits),
      `${nf(z.raw?.meanPathM, 2)} m`,
      `${nf(z.reconciled?.meanPathM, 2)} m`,
      secs(z.raw?.meanDwellSec),
      secs(z.reconciled?.meanDwellSec),
      {
        text: nf(z.fragmentsPerVisit, 2),
        color: (z.fragmentsPerVisit ?? 1) >= 1.4 ? BAD : (z.fragmentsPerVisit ?? 1) >= 1.2 ? WARN : INK,
      },
    ]),
  });
}

function drawStoredZones(doc, stored, y, onNewPage) {
  const zones = stored?.zones || [];
  const totals = stored?.totals;

  const next = sectionTitle(
    doc,
    'Stored data for the selected window',
    y,
    totals
      ? `${int(totals.visits)} visits across ${totals.zones} zones · ${int(totals.positionSamples)} stored `
        + `positions · ${int(totals.venueRawPerceptionIds)} vendor ids resolving to `
        + `${int(totals.venueReconciledTracks)} tracks. Distances here are lower bounds by construction. The `
        + 'column worth watching is distinct durations: many visits sharing few distinct values means a coarse '
        + 'clock, whatever the average happens to be.'
      : undefined,
  );

  if (!zones.length) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text('No zone visits were stored in this window.', MARGIN, next, { width: CONTENT_W });
    return doc.y + 12;
  }

  return table(doc, {
    y: next,
    onNewPage,
    headers: ['Zone', 'Category', 'Visits', 'Mean dwell', 'Median dwell', 'Distinct', 'Path', 'Path/span', '1-sample', 'Ids/track'],
    widths: [0.21, 0.11, 0.07, 0.09, 0.10, 0.08, 0.07, 0.08, 0.10, 0.09],
    align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
    rows: zones.map((z) => [
      z.name,
      z.category || 'untagged',
      int(z.visits),
      secs(z.meanDwellSec),
      secs(z.medianDwellSec),
      {
        text: int(z.distinctDurations),
        color: z.visits > 50 && z.distinctDurations < z.visits * 0.2 ? WARN : INK,
      },
      `${nf(z.meanPathM, 2)} m`,
      nf(z.pathVsSpan, 2),
      {
        text: `${nf(z.singleSamplePct)}%`,
        color: (z.singleSamplePct ?? 0) > 40 ? BAD : (z.singleSamplePct ?? 0) > 20 ? WARN : INK,
      },
      nf(z.fragmentsPerTrack, 2),
    ]),
  });
}

function drawMethod(doc, truth, stored, y) {
  const notes = [];
  if (truth?.method) {
    for (const [k, v] of Object.entries(truth.method)) {
      if (typeof v === 'string') notes.push([k.replace(/([A-Z])/g, ' $1').toLowerCase(), v]);
    }
  }
  if (stored?.method?.note) notes.push(['stored samples', stored.method.note]);
  if (!notes.length) return y;

  if (y > A4.height - 180) {
    doc.addPage();
    y = MARGIN;
  }

  let cy = sectionTitle(doc, 'How these were measured', y);
  for (const [term, body] of notes) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor(INK).text(`${term}  `, MARGIN, cy, { continued: true });
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(body, { width: CONTENT_W });
    cy = doc.y + 3;
  }
  return cy;
}

function drawFooter(doc, pageNo) {
  // PDFKit starts a new page when text lands below the bottom margin, and that
  // page would then get a footer of its own. Lifting the margin for the call is
  // the documented way into that band.
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(6.5).fillColor(FAINT)
    .text(
      `Hyperspace · measurement audit · internal evidence · page ${pageNo}`,
      MARGIN, A4.height - 28, { width: CONTENT_W, align: 'center', lineBreak: false },
    );
  doc.page.margins.bottom = bottom;
}

// ----------------------------------------------------------------- entrypoint

/**
 * @returns {PDFDocument} a streaming document; the caller pipes and ends it.
 */
export function renderMeasurementAuditPdf({ truth, stored, venueName, startTs, endTs }) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: false, bufferPages: true });
  const continuation = (d) => {
    d.font('Helvetica').fontSize(7).fillColor(FAINT)
      .text(`Measurement audit · ${venueName} (continued)`, MARGIN, MARGIN - 12, { width: CONTENT_W });
    return MARGIN + 6;
  };

  doc.addPage();
  let y = drawHeader(doc, {
    venueName,
    rangeLabel: formatRange(startTs, endTs),
    generatedAt: new Date().toLocaleString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }),
  });

  y = drawPurpose(doc, y);
  y = drawSupplier(doc, truth, y);
  y = drawOurLoss(doc, truth, y);

  // Tables flow from wherever the findings ended and page themselves, rather
  // than each claiming a fresh sheet: forcing a break left most of the first
  // page white for no benefit to the reader.
  const room = (needed) => {
    if (A4.height - MARGIN - y >= needed) return y;
    doc.addPage();
    return continuation(doc);
  };

  if (truth?.zones?.length) {
    y = drawTruthZones(doc, truth, room(120) + 6, continuation);
  }

  y = drawStoredZones(doc, stored, room(120) + 6, continuation);
  drawMethod(doc, truth, stored, y + 6);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawFooter(doc, i + 1);
  }

  return doc;
}

export function measurementAuditPdfFileName(venueName, endTs) {
  const slug = String(venueName || 'venue').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const day = new Date(endTs).toISOString().slice(0, 10);
  return `measurement-audit-${slug}-${day}.pdf`;
}
