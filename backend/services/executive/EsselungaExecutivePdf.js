/**
 * The Esselunga executive report as a printable document.
 *
 * Rendered from the same journey payload the dashboard tab consumes, and from
 * the server-resolved headlineKpis in particular, so the page and the paper
 * cannot drift apart. Nothing is recomputed here; this module only lays out.
 *
 * Deliberately a light document rather than the dark dashboard theme: this gets
 * printed, forwarded and read on paper, where an inverted palette is a waste of
 * toner and harder to read.
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
const BAD = '#b91c1c';
const WARN = '#b45309';
const ACCENT = '#0e7490';

const TONE = {
  good: { fill: '#ecfdf5', stroke: '#a7f3d0', text: GOOD, label: 'On track' },
  warn: { fill: '#fffbeb', stroke: '#fde68a', text: WARN, label: 'Watch' },
  bad: { fill: '#fef2f2', stroke: '#fecaca', text: BAD, label: 'Action needed' },
  info: { fill: '#eff6ff', stroke: '#bfdbfe', text: ACCENT, label: 'No comparison' },
};

const num = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');

/** Minutes to something a person says out loud. "0.31m" is not a wait time. */
function dur(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const total = Math.round(minutes * 60);
  if (total < 60) return `${total}s`;
  const s = total % 60;
  return s ? `${Math.floor(total / 60)}m ${s}s` : `${Math.floor(total / 60)}m`;
}

/**
 * Direction arrows drawn as paths rather than glyphs. The obvious characters
 * (▲ ▼) are outside Helvetica's WinAnsi encoding, and PDFKit emits mojibake for
 * them rather than failing, so the defect only shows up in the finished
 * document.
 */
function drawArrow(doc, x, y, direction, colour) {
  const w = 5;
  const h = 5;
  doc.save().fillColor(colour);
  if (direction === 'up') {
    doc.moveTo(x + w / 2, y).lineTo(x + w, y + h).lineTo(x, y + h).fill();
  } else if (direction === 'down') {
    doc.moveTo(x, y).lineTo(x + w, y).lineTo(x + w / 2, y + h).fill();
  } else {
    doc.rect(x, y + h / 2 - 0.5, w, 1).fill();
  }
  doc.restore();
}

function formatRange(startTs, endTs) {
  const s = new Date(startTs);
  const e = new Date(endTs);
  const date = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const hm = { hour: '2-digit', minute: '2-digit', hour12: false };
  if (s.toDateString() === e.toDateString()) {
    return `${s.toLocaleDateString('en-GB', date)} · `
      + `${s.toLocaleTimeString('en-GB', hm)}–${e.toLocaleTimeString('en-GB', hm)}`;
  }
  const short = { day: 'numeric', month: 'short', year: 'numeric' };
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

/**
 * Rows are arrays of strings. `align` is per column; widths are fractions of
 * the content width and must sum to 1.
 */
function table(doc, { headers, rows, widths, align = [], y, zebra = true }) {
  const colX = [];
  let x = MARGIN;
  for (const w of widths) {
    colX.push(x);
    x += w * CONTENT_W;
  }

  const cell = (text, i, cy, opts = {}) => {
    const w = widths[i] * CONTENT_W - 6;
    doc.text(String(text ?? '—'), colX[i] + 3, cy, {
      width: w,
      align: align[i] || 'left',
      lineBreak: false,
      ellipsis: true,
      ...opts,
    });
  };

  let cy = y;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
  headers.forEach((h, i) => cell(h, i, cy));
  cy += 12;
  doc.moveTo(MARGIN, cy - 3).lineTo(MARGIN + CONTENT_W, cy - 3)
    .lineWidth(0.5).strokeColor(RULE).stroke();

  doc.font('Helvetica').fontSize(8.5);
  rows.forEach((row, r) => {
    if (zebra && r % 2 === 1) {
      doc.rect(MARGIN, cy - 3, CONTENT_W, 14).fillColor(PANEL).fill();
    }
    doc.fillColor(INK);
    row.forEach((v, i) => cell(v, i, cy));
    cy += 14;
  });

  return cy + 4;
}

/**
 * Grouped vertical bars. Used for the rhythm of the trading day, which is the
 * one chart a store director reads without being asked to.
 */
function barChart(doc, { x, y, width, height, labels, series }) {
  const max = Math.max(1, ...series.flatMap((s) => s.data));
  const n = labels.length;
  if (n === 0) return y;

  const plotH = height - 16;
  const slot = width / n;
  const groupW = slot * 0.66;
  const barW = groupW / series.length;

  // Baseline and two faint gridlines, enough to read a height without clutter.
  for (const frac of [0, 0.5, 1]) {
    const gy = y + plotH - plotH * frac;
    doc.moveTo(x, gy).lineTo(x + width, gy)
      .lineWidth(0.5).strokeColor(frac === 0 ? RULE : '#f3f4f6').stroke();
  }

  labels.forEach((label, i) => {
    const gx = x + slot * i + (slot - groupW) / 2;
    series.forEach((s, si) => {
      const v = s.data[i] || 0;
      const h = (v / max) * plotH;
      if (h > 0.4) {
        doc.rect(gx + barW * si, y + plotH - h, barW - 1, h)
          .fillColor(s.color).fill();
      }
    });
    doc.font('Helvetica').fontSize(6).fillColor(FAINT)
      .text(label, x + slot * i, y + plotH + 4, { width: slot, align: 'center', lineBreak: false });
  });

  // Legend
  let lx = x;
  const ly = y + plotH + 14;
  series.forEach((s) => {
    doc.rect(lx, ly + 1, 6, 6).fillColor(s.color).fill();
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(s.name, lx + 9, ly, { lineBreak: false });
    lx += doc.widthOfString(s.name) + 26;
  });

  return ly + 14;
}

// ------------------------------------------------------------------ sections

function drawHeader(doc, { venueName, rangeLabel, generatedAt }) {
  doc.rect(0, 0, A4.width, 68).fillColor('#0f172a').fill();
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff')
    .text(venueName, MARGIN, 20, { width: CONTENT_W - 150 });
  doc.font('Helvetica').fontSize(9).fillColor('#94a3b8')
    .text(rangeLabel, MARGIN, 40, { width: CONTENT_W - 150 });

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#e2e8f0')
    .text('HYPERSPACE', A4.width - MARGIN - 150, 22, { width: 150, align: 'right' });
  doc.font('Helvetica').fontSize(7).fillColor('#64748b')
    .text('Executive report · LiDAR', A4.width - MARGIN - 150, 34, { width: 150, align: 'right' });
  doc.font('Helvetica').fontSize(6.5).fillColor('#475569')
    .text(`Generated ${generatedAt}`, A4.width - MARGIN - 150, 45, { width: 150, align: 'right' });

  return 88;
}

function drawVerdict(doc, headline, y) {
  const tone = TONE[headline?.tone] || TONE.info;
  const text = headline?.text || 'Not enough data in this window to summarise the period.';

  doc.font('Helvetica').fontSize(10);
  const textH = doc.heightOfString(text, { width: CONTENT_W - 28 });
  const boxH = textH + 30;

  doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 4)
    .fillColor(tone.fill).fill();
  doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 4)
    .lineWidth(0.75).strokeColor(tone.stroke).stroke();
  doc.rect(MARGIN, y + 1, 3, boxH - 2).fillColor(tone.text).fill();

  doc.font('Helvetica-Bold').fontSize(7).fillColor(tone.text)
    .text(tone.label.toUpperCase(), MARGIN + 14, y + 9);
  doc.font('Helvetica').fontSize(10).fillColor(INK)
    .text(text, MARGIN + 14, y + 21, { width: CONTENT_W - 28 });

  return y + boxH + 14;
}

function drawKpiCards(doc, items, y) {
  if (!items.length) return y;

  const perRow = items.length <= 4 ? items.length : 3;
  const gap = 10;
  const cardW = (CONTENT_W - gap * (perRow - 1)) / perRow;
  const cardH = 62;
  let row = 0;

  items.forEach((kpi, i) => {
    if (i > 0 && i % perRow === 0) row += 1;
    const col = i % perRow;
    const x = MARGIN + col * (cardW + gap);
    const cy = y + row * (cardH + gap);

    doc.roundedRect(x, cy, cardW, cardH, 4).fillColor('#ffffff').fill();
    doc.roundedRect(x, cy, cardW, cardH, 4).lineWidth(0.75).strokeColor(RULE).stroke();

    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(kpi.label.toUpperCase(), x + 9, cy + 8, { width: cardW - 18, lineBreak: false });

    doc.font('Helvetica-Bold').fontSize(19).fillColor(INK)
      .text(kpi.display, x + 9, cy + 19, { width: cardW - 18, lineBreak: false });

    if (kpi.deltaPct == null) {
      doc.font('Helvetica').fontSize(7).fillColor(FAINT)
        .text(kpi.noCompareReason ? 'not comparable' : 'no comparison',
          x + 9, cy + 43, { width: cardW - 18, lineBreak: false });
    } else {
      const colour = kpi.good == null ? MUTED : kpi.good ? GOOD : BAD;
      const label = `${Math.abs(kpi.deltaPct)}%`;
      drawArrow(doc, x + 9, cy + 44, kpi.direction, colour);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colour)
        .text(label, x + 17, cy + 43, { lineBreak: false });
      // Measured with the font that just drew it, so the two never collide.
      const labelW = doc.widthOfString(label);
      doc.font('Helvetica').fontSize(6.5).fillColor(FAINT)
        .text('vs last week', x + 17 + labelW + 4, cy + 44, { lineBreak: false });
    }

    doc.font('Helvetica').fontSize(6).fillColor(FAINT)
      .text(kpi.hint, x + 9, cy + 53, { width: cardW - 18, lineBreak: false, ellipsis: true });
  });

  return y + (row + 1) * (cardH + gap) + 6;
}

function drawRhythm(doc, journey, y) {
  const hourly = journey.activityTimelines?.hourly;
  if (!hourly?.visitors?.length) return y;

  const next = sectionTitle(
    doc,
    'Rhythm of the trading day',
    y,
    journey.storeHours?.hoursLabel
      ? `Store hours ${journey.storeHours.hoursLabel} · ${journey.storeHours.timeZone || 'local time'}`
      : undefined,
  );

  return barChart(doc, {
    x: MARGIN,
    y: next,
    width: CONTENT_W,
    height: 110,
    labels: hourly.visitors.map((p) => p.label),
    series: [
      { name: 'Entrants', color: '#0891b2', data: hourly.visitors.map((p) => p.value) },
      { name: 'Shelf stops', color: '#f59e0b', data: (hourly.dwells || []).map((p) => p.value) },
    ],
  }) + 8;
}

function drawFresco(doc, journey, y) {
  const depts = (journey.fresco?.departments || []).filter((d) => d.visits > 0);
  if (!depts.length) return y;

  const next = sectionTitle(
    doc,
    'Piazza del Fresco',
    y,
    'Counter zones — how many crossings became a stop, and for how long. Visits are '
    + 'rebuilt by rejoining tracker fragments, so dwell is a lower bound; stopping rate '
    + 'is the sturdier comparison between counters.',
  );

  const dwellCell = (d) => {
    if (!d.dwellReliable || d.medianDwellSec == null) return '—';
    if (d.p75DwellSec != null && d.p75DwellSec > d.medianDwellSec) {
      return `${d.medianDwellSec}-${d.p75DwellSec}s`;
    }
    return `${d.medianDwellSec}s`;
  };

  return table(doc, {
    y: next,
    headers: ['Department', 'Crossings', 'Visits', 'Stops', 'Stopping', 'Typical dwell', 'In queue'],
    widths: [0.26, 0.12, 0.11, 0.11, 0.12, 0.16, 0.12],
    align: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
    rows: depts.map((d) => [
      d.label,
      num(d.visits),
      num(d.episodes ?? 0),
      d.reportable ? num(d.dwellVisits ?? 0) : '—',
      d.reportable ? `${d.stoppingPct ?? d.browsingPct}%` : '—',
      dwellCell(d),
      d.hasQueueZones ? `${d.waitingPct}%` : '—',
    ]),
  });
}

function drawAisles(doc, journey, y) {
  const a = journey.aisles || {};
  const thresholdSec = journey.metricThresholds?.dwellSec ?? 5;
  const rankSec = journey.metricThresholds?.engagementRankSec ?? 15;

  let next = sectionTitle(
    doc,
    'Aisles and categories',
    y,
    `Stopping power counts a pause of ${thresholdSec}s per Esselunga's specification; `
    + `engagement counts ${rankSec}s, which is what ranks one fixture against another`,
  );

  const stats = [
    ['Stopping power', `${a.stoppingPowerPct ?? 0}%`, 'of aisle crossings became a stop'],
    a.engagementRatePct != null
      ? ['Engagement', `${a.engagementRatePct}%`, `held past ${rankSec}s`]
      : null,
    ['Pass-through', `${a.passThroughPct ?? Math.max(0, 100 - (a.stoppingPowerPct ?? 0))}%`, 'crossed without stopping'],
    a.penetrationPct != null
      ? ['Penetration', `${a.penetrationPct}%`, 'of visitors reached an aisle']
      : null,
    a.bypassPct != null
      ? ['Bypass', `${a.bypassPct}%`, 'of visitors never entered an aisle']
      : null,
  ].filter(Boolean);

  const gap = 10;
  const w = (CONTENT_W - gap * (stats.length - 1)) / stats.length;
  stats.forEach(([label, value, hint], i) => {
    const x = MARGIN + i * (w + gap);
    doc.roundedRect(x, next, w, 44, 3).fillColor(PANEL).fill();
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
      .text(label.toUpperCase(), x + 8, next + 7, { width: w - 16, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK)
      .text(value, x + 8, next + 17, { width: w - 16, lineBreak: false });
    doc.font('Helvetica').fontSize(6).fillColor(FAINT)
      .text(hint, x + 8, next + 34, { width: w - 16, lineBreak: false, ellipsis: true });
  });
  next += 56;

  const cats = (a.categoryGroups || []).slice(0, 8);
  if (cats.length) {
    next = table(doc, {
      y: next,
      headers: ['Category', 'Zones', 'Crossings', 'Stopping', `Held ${rankSec}s`, 'Avg dwell'],
      widths: [0.3, 0.12, 0.16, 0.14, 0.14, 0.14],
      align: ['left', 'right', 'right', 'right', 'right', 'right'],
      rows: cats.map((c) => [
        c.category,
        num(c.roiCount ?? 0),
        num(c.visits),
        `${c.stoppingPowerPct}%`,
        c.engagementRatePct != null ? `${c.engagementRatePct}%` : '—',
        dur(c.avgDwellSec ? c.avgDwellSec / 60 : c.avgDwellMin),
      ]),
    });
  }

  return next;
}

function drawCheckout(doc, journey, y) {
  const channels = journey.checkout?.channels || [];
  if (!channels.length) return y;

  const next = sectionTitle(doc, 'Checkout', y, 'Queue sessions by channel');

  let after = table(doc, {
    y: next,
    headers: ['Channel', 'Completed', 'Sessions', 'Avg wait', 'Abandon'],
    widths: [0.34, 0.17, 0.17, 0.16, 0.16],
    align: ['left', 'right', 'right', 'right', 'right'],
    rows: channels.map((ch) => [
      ch.label,
      num(ch.completed ?? ch.sessions),
      num(ch.sessions),
      dur(ch.avgWaitSec != null ? ch.avgWaitSec / 60 : ch.avgWaitMin),
      `${ch.abandonPct}%`,
    ]),
  });

  // A channel average hides the till the queue actually forms at, which is the
  // one piece of this section a store manager can act on the same morning.
  const lanes = channels
    .flatMap(ch => (ch.lanes || []).map(l => ({ ...l, channel: ch.label })))
    .sort((a, b) => (b.avgWaitSec ?? b.avgWaitMin * 60) - (a.avgWaitSec ?? a.avgWaitMin * 60))
    .slice(0, 6);

  if (lanes.length > 1) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
      .text('Lanes with the longest waits', MARGIN, after + 6, { width: CONTENT_W });
    after = table(doc, {
      y: doc.y + 4,
      headers: ['Lane', 'Channel', 'Shoppers', 'Avg wait', 'Abandon'],
      widths: [0.2, 0.3, 0.18, 0.16, 0.16],
      align: ['left', 'left', 'right', 'right', 'right'],
      rows: lanes.map(l => [
        l.label,
        l.channel,
        num(l.sessions),
        dur(l.avgWaitSec != null ? l.avgWaitSec / 60 : l.avgWaitMin),
        `${l.abandonPct}%`,
      ]),
    });
  }

  if (journey.checkout.frictionScore != null) {
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(
        `Checkout friction ${journey.checkout.frictionScore} — queue time as a share of shopping dwell.`,
        MARGIN, after, { width: CONTENT_W },
      );
    after = doc.y + 4;
  }

  return after;
}

function drawInsights(doc, journey, y) {
  const insights = (journey.insights || []).slice(0, 3);
  if (!insights.length) return y;

  let next = sectionTitle(doc, 'What to act on', y);

  for (const ins of insights) {
    const tone = TONE[ins.severity] || TONE.info;
    doc.font('Helvetica').fontSize(8.5);
    const bodyH = doc.heightOfString(ins.message, { width: CONTENT_W - 24 });
    const actionH = ins.action ? doc.heightOfString(`Action: ${ins.action}`, { width: CONTENT_W - 24 }) : 0;
    const boxH = bodyH + actionH + 30;

    doc.roundedRect(MARGIN, next, CONTENT_W, boxH, 3).fillColor(tone.fill).fill();
    doc.rect(MARGIN, next + 1, 2.5, boxH - 2).fillColor(tone.text).fill();

    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
      .text(ins.title, MARGIN + 12, next + 8, { width: CONTENT_W - 24 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#374151')
      .text(ins.message, MARGIN + 12, doc.y + 2, { width: CONTENT_W - 24 });
    if (ins.action) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(tone.text)
        .text(`Action: ${ins.action}`, MARGIN + 12, doc.y + 2, { width: CONTENT_W - 24 });
    }
    next += boxH + 8;
  }

  return next;
}

function drawDefinitions(doc, journey, y) {
  const th = journey.metricThresholds || {};
  const t = th.dwellSec ?? 5;
  const rank = th.engagementRankSec ?? 15;
  const queueFloor = th.queueFloorSec ?? 10;
  const next = sectionTitle(doc, 'How these numbers are defined', y);

  const defs = [
    ['Entrants', 'People crossing the entrance line, counted from LiDAR trajectories.'],
    ['Crossing', 'Any entry into a zone lasting at least 300 milliseconds.'],
    ['Stopping power', `Share of zone crossings where the shopper paused for ${t} seconds or more.`],
    ['Engagement rate', `Share of crossings held past ${rank} seconds. This is the figure to rank fixtures by: `
      + 'at 5 seconds most zones sit within a few points of each other, where at this bar they spread about '
      + 'five times wider.'],
    ['Mean dwell', 'Total time in the zone divided by distinct shoppers, with no minimum. Restricting the average '
      + 'to long visits raises the number but makes it less able to separate one zone from another.'],
    ['Pass-through', 'Share of crossings that did not become a stop.'],
    ['Bypass', 'Share of store visitors who never entered the category, that is 100 minus penetration.'],
    ['Checkout wait', `Measured over queue visits of ${queueFloor} seconds or more, since most crossings of a `
      + 'queue zone are shoppers walking past it.'],
    ['Shopping dwell', 'Median time a visit spends inside tracked zones. Not entrance-to-exit time in store.'],
    ['Comparison', 'The same window seven days earlier, chosen because supermarket traffic is weekday-shaped.'],
  ];

  if (journey.comparison?.comparable === false) {
    defs.push([
      'Withheld comparisons',
      `Figures are shown without a week-on-week change: ${journey.comparison.caveat}.`,
    ]);
  }

  let cy = next;
  for (const [term, body] of defs) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK)
      .text(`${term}  `, MARGIN, cy, { continued: true });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(body, { width: CONTENT_W });
    cy = doc.y + 2;
  }

  return cy;
}

function drawFooter(doc, pageNo) {
  // The footer sits below the bottom margin, and PDFKit reacts to that by
  // helpfully starting a new page — which then also gets a footer. Lifting the
  // margin for the duration of the call is the documented way to write into
  // that band without triggering the flow.
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(6.5).fillColor(FAINT)
    .text(
      `Hyperspace · LiDAR customer journey analytics · page ${pageNo}`,
      MARGIN, A4.height - 28, { width: CONTENT_W, align: 'center', lineBreak: false },
    );
  doc.page.margins.bottom = bottom;
}

// ----------------------------------------------------------------- entrypoint

/**
 * @returns {PDFDocument} a streaming document; the caller pipes and ends it.
 */
export function renderEsselungaExecutivePdf(journey, { venueName }) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: false, bufferPages: true });

  doc.addPage();
  let y = drawHeader(doc, {
    venueName,
    rangeLabel: formatRange(journey.range.startTs, journey.range.endTs),
    generatedAt: new Date(journey.generatedAt).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }),
  });

  y = drawVerdict(doc, journey.headline, y);
  y = drawKpiCards(doc, journey.headlineKpis || [], y);
  y = drawRhythm(doc, journey, y);
  y = drawInsights(doc, journey, y);

  doc.addPage();
  y = MARGIN;
  y = drawFresco(doc, journey, y);
  y = drawAisles(doc, journey, y + 6);

  if (y > A4.height - 200) {
    doc.addPage();
    y = MARGIN;
  }
  y = drawCheckout(doc, journey, y + 6);
  drawDefinitions(doc, journey, y + 6);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawFooter(doc, i + 1);
  }

  return doc;
}

export function executivePdfFileName(venueName, journey) {
  const slug = String(venueName || 'venue').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const day = new Date(journey.range.endTs).toISOString().slice(0, 10);
  return `esselunga-executive-${slug}-${day}.pdf`;
}
