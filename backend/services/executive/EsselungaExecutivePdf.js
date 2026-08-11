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

/**
 * The daily report window is "venue midnight → now". On a UTC host that looks
 * like two calendar days if you only print dates, which is how a 6 August
 * trading day became "5 Aug – 6 Aug" with no times. Always print the clock, and
 * always in the venue timezone, so a daily report reads as one day with a clear
 * start and end.
 */
export function formatRange(startTs, endTs, timeZone = 'Europe/Rome') {
  const start = Number(startTs);
  const end = Number(endTs);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';

  const dayKey = {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  const longDay = {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  };
  const shortDay = {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  const hm = {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };

  const startDay = new Date(start).toLocaleDateString('en-CA', dayKey); // YYYY-MM-DD
  const endDay = new Date(end).toLocaleDateString('en-CA', dayKey);
  const startTime = new Date(start).toLocaleTimeString('en-GB', hm);
  const endTime = new Date(end).toLocaleTimeString('en-GB', hm);

  if (startDay === endDay) {
    return `${new Date(start).toLocaleDateString('en-GB', longDay)} · ${startTime}–${endTime}`;
  }

  return `${new Date(start).toLocaleDateString('en-GB', shortDay)} ${startTime}`
    + ` → ${new Date(end).toLocaleDateString('en-GB', shortDay)} ${endTime}`;
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
 * the content width and must sum to 1. Optional `x` / `contentW` place a
 * narrow table in a page-1 column without a second table helper.
 */
function table(doc, {
  headers, rows, widths, align = [], y, zebra = true,
  x: originX = MARGIN, contentW = CONTENT_W,
}) {
  const colX = [];
  let x = originX;
  for (const w of widths) {
    colX.push(x);
    x += w * contentW;
  }

  const cell = (text, i, cy, opts = {}) => {
    const w = widths[i] * contentW - 6;
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
  doc.moveTo(originX, cy - 3).lineTo(originX + contentW, cy - 3)
    .lineWidth(0.5).strokeColor(RULE).stroke();

  doc.font('Helvetica').fontSize(8.5);
  rows.forEach((row, r) => {
    if (zebra && r % 2 === 1) {
      doc.rect(originX, cy - 3, contentW, 14).fillColor(PANEL).fill();
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
        .text(`vs ${kpi.compareLabel || 'last week'}`, x + 17 + labelW + 4, cy + 44, { lineBreak: false });
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

  // Shorter than the old 110pt chart so page 1 has room for the journey strip
  // and the checkout / insights columns below.
  return barChart(doc, {
    x: MARGIN,
    y: next,
    width: CONTENT_W,
    height: 90,
    labels: hourly.visitors.map((p) => p.label),
    series: [
      { name: 'Entrants', color: '#0891b2', data: hourly.visitors.map((p) => p.value) },
      { name: 'Shelf stops', color: '#f59e0b', data: (hourly.dwells || []).map((p) => p.value) },
    ],
  }) + 6;
}

/**
 * Compact aisle / journey cards already used on page 2 — repeated as a strip on
 * page 1 so the first page is not half-empty under the rhythm chart.
 */
function drawJourneyStrip(doc, journey, y) {
  const a = journey.aisles || {};
  const rankSec = journey.metricThresholds?.engagementRankSec ?? 15;
  const stats = [
    ['Stopping power', `${a.stoppingPowerPct ?? 0}%`, 'of aisle crossings became a stop'],
    a.engagementRatePct != null
      ? ['Engagement', `${a.engagementRatePct}%`, `held past ${rankSec}s`]
      : null,
    ['Pass-through', `${a.passThroughPct ?? Math.max(0, 100 - (a.stoppingPowerPct ?? 0))}%`, 'crossed without stopping'],
    a.penetrationPct != null
      ? ['Penetration', `${a.penetrationPct}%`, 'of entrance tracks also seen in aisle/fresco']
      : null,
  ].filter(Boolean);

  if (!stats.length) return y;

  let next = sectionTitle(doc, 'Journey at a glance', y);
  const gap = 8;
  const w = (CONTENT_W - gap * (stats.length - 1)) / stats.length;
  stats.forEach(([label, value, hint], i) => {
    const x = MARGIN + i * (w + gap);
    doc.roundedRect(x, next, w, 42, 3).fillColor(PANEL).fill();
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
      .text(label.toUpperCase(), x + 7, next + 6, { width: w - 14, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK)
      .text(value, x + 7, next + 16, { width: w - 14, lineBreak: false });
    doc.font('Helvetica').fontSize(6).fillColor(FAINT)
      .text(hint, x + 7, next + 32, { width: w - 14, lineBreak: false, ellipsis: true });
  });
  next += 50;

  if (journey.checkout?.frictionScore != null) {
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(
        `Checkout friction ${journey.checkout.frictionScore} — queue time as a share of shopping dwell.`,
        MARGIN, next, { width: CONTENT_W },
      );
    next = doc.y + 6;
  }

  return next;
}

/**
 * Page-1 lower half: checkout channel snapshot (left) + up to two insights (right).
 * Matches the density of page 2 without duplicating Fresco / aisle tables.
 */
function drawPage1Lower(doc, journey, y) {
  const colGap = 14;
  const colW = (CONTENT_W - colGap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + colGap;
  const channels = (journey.checkout?.channels || []).slice(0, 3);
  const insights = (journey.insights || []).slice(0, 2);

  if (!channels.length && !insights.length) return y;

  // Shared baseline for both column titles.
  const titleY = y;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
    .text(channels.length ? 'Checkout snapshot' : ' ', leftX, titleY, {
      width: colW, lineBreak: false,
    });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
    .text(insights.length ? 'What to act on' : ' ', rightX, titleY, {
      width: colW, lineBreak: false,
    });
  let ruleY = titleY + 14;
  doc.moveTo(MARGIN, ruleY).lineTo(MARGIN + CONTENT_W, ruleY)
    .lineWidth(0.5).strokeColor(RULE).stroke();
  let leftY = ruleY + 10;
  let rightY = ruleY + 10;

  if (channels.length) {
    doc.font('Helvetica').fontSize(7).fillColor(FAINT)
      .text('Queue sessions by channel', leftX, leftY, { width: colW });
    leftY = doc.y + 4;
    leftY = table(doc, {
      x: leftX,
      contentW: colW,
      y: leftY,
      headers: ['Channel', 'Done', 'Wait', 'Abandon'],
      widths: [0.40, 0.18, 0.22, 0.20],
      align: ['left', 'right', 'right', 'right'],
      rows: channels.map((ch) => [
        ch.label,
        num(ch.completed ?? ch.sessions),
        dur(ch.avgWaitSec != null ? ch.avgWaitSec / 60 : ch.avgWaitMin),
        `${ch.abandonPct}%`,
      ]),
    });
  }

  for (const ins of insights) {
    const tone = TONE[ins.severity] || TONE.info;
    doc.font('Helvetica').fontSize(8);
    const bodyH = doc.heightOfString(ins.message, { width: colW - 16 });
    const actionH = ins.action
      ? doc.heightOfString(`Action: ${ins.action}`, { width: colW - 16 })
      : 0;
    const boxH = Math.min(78, bodyH + actionH + 26);

    doc.roundedRect(rightX, rightY, colW, boxH, 3).fillColor(tone.fill).fill();
    doc.rect(rightX, rightY + 1, 2.5, boxH - 2).fillColor(tone.text).fill();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
      .text(ins.title, rightX + 10, rightY + 6, { width: colW - 16, ellipsis: true });
    doc.font('Helvetica').fontSize(8).fillColor('#374151')
      .text(ins.message, rightX + 10, doc.y + 1, { width: colW - 16, height: bodyH + 2 });
    if (ins.action) {
      doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(tone.text)
        .text(`Action: ${ins.action}`, rightX + 10, Math.min(doc.y + 1, rightY + boxH - 14), {
          width: colW - 16, ellipsis: true, lineBreak: false,
        });
    }
    rightY += boxH + 6;
  }

  return Math.max(leftY, rightY, y);
}

/**
 * Customer-facing wireframe: shelf → engagement strip → category dwell halo.
 * Radii come from journey.categoryPresence (venue settings) or defaults.
 */
function drawDwellGeometryLegend(doc, y, presence) {
  const dM = Number(presence?.categoryDwellRadiusM) || 2.0;
  const eM = Number(presence?.engagementRadiusM) || 0.5;
  const boxH = 72;
  const x0 = MARGIN;
  const w = CONTENT_W;

  doc.roundedRect(x0, y, w, boxH, 3).fillColor(PANEL).fill();
  doc.font('Helvetica-Bold').fontSize(7).fillColor(INK)
    .text('How we measure time at a category', x0 + 10, y + 7, { width: w - 20, lineBreak: false });

  const shelfX = x0 + 14;
  const shelfW = 22;
  const bandY = y + 22;
  const bandH = 28;
  const aisleStart = shelfX + shelfW;
  const scaleW = 210;
  const pxPerM = scaleW / Math.max(dM * 1.25, 0.1);
  const engW = Math.max(10, eM * pxPerM);
  const dwellW = Math.max(engW + 12, dM * pxPerM);

  doc.rect(shelfX, bandY, shelfW, bandH).fillColor('#374151').fill();
  doc.font('Helvetica').fontSize(5.5).fillColor(MUTED)
    .text('SHELF', shelfX - 2, bandY - 8, { width: shelfW + 4, align: 'center', lineBreak: false });

  doc.save();
  doc.rect(aisleStart, bandY, dwellW, bandH)
    .fillColor('#e0f2fe').fillOpacity(0.55).fill()
    .strokeColor(ACCENT).lineWidth(1).dash(2.5, { space: 1.5 })
    .strokeOpacity(1).stroke();
  doc.undash();
  doc.restore();

  doc.rect(aisleStart, bandY, engW, bandH).fillColor('#7dd3fc').fillOpacity(0.85).fill();
  doc.fillOpacity(1);

  const aX = aisleStart + engW * 0.45;
  const bX = aisleStart + engW + (dwellW - engW) * 0.55;
  const cX = aisleStart + dwellW + 28;
  const cy = bandY + bandH / 2;

  doc.circle(aX, cy, 4.5).fillColor(ACCENT).fill();
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#fff')
    .text('A', aX - 2, cy - 2.5, { width: 6, align: 'center', lineBreak: false });
  doc.circle(bX, cy, 4.5).fillColor('#fff').strokeColor('#94a3b8').lineWidth(0.8).fillAndStroke();
  doc.font('Helvetica-Bold').fontSize(6).fillColor(INK)
    .text('B', bX - 2, cy - 2.5, { width: 6, align: 'center', lineBreak: false });
  doc.circle(cX, cy, 4.5).fillColor('#94a3b8').fill();
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#fff')
    .text('C', cX - 2, cy - 2.5, { width: 6, align: 'center', lineBreak: false });

  doc.font('Helvetica').fontSize(5.5).fillColor(MUTED)
    .text(`${eM.toFixed(1)} m engagement`, aisleStart, bandY + bandH + 3, { width: engW + 40, lineBreak: false })
    .text(`${dM.toFixed(1)} m category dwell`, aisleStart + engW + 4, bandY + bandH + 3, {
      width: dwellW, lineBreak: false,
    });

  const noteX = aisleStart + dwellW + 48;
  doc.font('Helvetica').fontSize(6.5).fillColor(INK)
    .text(
      `A pick/read (engagement) · B decide nearby (category dwell) · C pass-by\n`
      + `Engagement is nested inside category dwell — leaving the shelf face does not end dwell.`,
      noteX,
      bandY - 2,
      { width: x0 + w - noteX - 10, lineGap: 1.5 },
    );

  return y + boxH + 8;
}

function drawFresco(doc, journey, y) {
  const depts = (journey.fresco?.departments || []).filter((d) => d.visits > 0);
  if (!depts.length) return y;

  const presence = journey.categoryPresence || {};
  const dM = Number(presence.categoryDwellRadiusM) || 2.0;
  const eM = Number(presence.engagementRadiusM) || 0.5;

  let next = sectionTitle(
    doc,
    'Piazza del Fresco',
    y,
    `Stopping = reached the shelf face (within ${eM.toFixed(1)} m). `
    + `Category dwell = median time within ${dM.toFixed(1)} m among those stops. `
    + `Engagement = median time at the shelf face.`,
  );

  next = drawDwellGeometryLegend(doc, next, presence);

  const dwellCell = (d) => {
    if (!d.dwellReliable || d.medianDwellSec == null) return '—';
    return `${Math.round(d.medianDwellSec)}s`;
  };
  const engCell = (d) => {
    if (!d.engagementReliable || d.medianEngagementSec == null) return '—';
    return `${Math.round(d.medianEngagementSec)}s`;
  };

  return table(doc, {
    y: next,
    headers: ['Department', 'Crossings', 'Stops', 'Stopping', 'Category dwell', 'Engagement', 'In queue'],
    widths: [0.22, 0.11, 0.1, 0.11, 0.16, 0.15, 0.15],
    align: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
    rows: depts.map((d) => [
      d.label,
      num(d.visits),
      d.reportable ? num(d.dwellVisits ?? 0) : '—',
      d.reportable ? `${d.stoppingPct ?? d.browsingPct}%` : '—',
      dwellCell(d),
      engCell(d),
      d.hasQueueZones ? `${d.waitingPct}%` : '—',
    ]),
  });
}

function drawAisles(doc, journey, y) {
  const a = journey.aisles || {};
  const thresholdSec = journey.metricThresholds?.dwellSec ?? 5;
  const rankSec = journey.metricThresholds?.engagementRankSec ?? 15;

  const dM = Number(journey.categoryPresence?.categoryDwellRadiusM) || 2.0;
  let next = sectionTitle(
    doc,
    'Aisles and categories',
    y,
    `Stopping power counts a pause of ${thresholdSec}s; `
    + `category dwell is time within ${dM.toFixed(1)} m of the shelf category. `
    + `Fixture ranking still uses the ${rankSec}s engagement hold threshold.`,
  );

  const stats = [
    ['Stopping power', `${a.stoppingPowerPct ?? 0}%`, 'of aisle crossings became a stop'],
    a.engagementRatePct != null
      ? ['Engagement', `${a.engagementRatePct}%`, `held past ${rankSec}s`]
      : null,
    ['Pass-through', `${a.passThroughPct ?? Math.max(0, 100 - (a.stoppingPowerPct ?? 0))}%`, 'crossed without stopping'],
    a.penetrationPct != null
      ? ['Penetration', `${a.penetrationPct}%`, 'of entrance tracks also seen in aisle/fresco']
      : null,
    a.bypassPct != null
      ? ['Bypass', `${a.bypassPct}%`, 'of entrance tracks never seen in aisle/fresco']
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

/**
 * Optional wind-map style people-flow frames. All shots share one appendix page.
 * Title, image and caption sit in one left-aligned column of equal width — never
 * centred with full-bleed text wrapping wider than the frame.
 */
function drawFlowField(doc, shots) {
  if (!Array.isArray(shots) || !shots.length) return;

  doc.addPage();
  let next = MARGIN;
  const pageBottom = A4.height - MARGIN - 32;
  const n = Math.min(3, shots.length);
  const colX = MARGIN;

  next = sectionTitle(
    doc,
    'People-flow field',
    next,
    'LiDAR trajectories as a continuous field — density, dwell and direction over the store plan.',
  );

  // Budget remaining height evenly (title + image + 2-line caption + gap).
  const chromePer = 30;
  const avail = pageBottom - next;
  const maxImgH = Math.max(110, Math.floor((avail - chromePer * n) / n));

  // Size every frame into the same column width so the left edge and text
  // measure line up. Prefer height-fit, then clamp width to CONTENT_W.
  const frames = [];
  let colW = CONTENT_W;
  for (let i = 0; i < n; i++) {
    const shot = shots[i];
    let ar = 16 / 9;
    if (shot.imagePath) {
      try {
        const fitted = doc.openImage(shot.imagePath);
        ar = fitted.width / Math.max(1, fitted.height);
      } catch {
        /* keep default */
      }
    }
    let imgH = maxImgH;
    let imgW = imgH * ar;
    if (imgW > CONTENT_W) {
      imgW = CONTENT_W;
      imgH = imgW / ar;
    }
    frames.push({ shot, ar, imgW, imgH });
    colW = Math.min(colW, imgW);
  }
  // Re-fit heights to the shared column width so all three share one measure.
  for (const f of frames) {
    f.imgW = colW;
    f.imgH = Math.min(maxImgH, colW / f.ar);
  }

  for (const { shot, imgW, imgH } of frames) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
      .text(shot.title, colX, next, { width: colW, lineBreak: false });
    next = doc.y + 3;

    if (shot.imagePath) {
      try {
        doc.image(shot.imagePath, colX, next, { width: imgW, height: imgH });
        doc.roundedRect(colX - 0.5, next - 0.5, imgW + 1, imgH + 1, 2)
          .lineWidth(0.6).strokeColor(RULE).stroke();
        next += imgH + 3;
      } catch {
        doc.font('Helvetica').fontSize(8).fillColor(FAINT)
          .text('(flow-field image unavailable)', colX, next, { width: colW });
        next = doc.y + 3;
      }
    }

    const caption = shot.shortCaption || shot.caption;
    if (caption) {
      doc.font('Helvetica').fontSize(7.5).fillColor('#374151')
        .text(caption, colX, next, {
          width: colW,
          height: 20,
          ellipsis: true,
        });
      next = doc.y + 10;
    } else {
      next += 8;
    }
  }
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
    ['Bypass', 'Of distinct tracks seen at the entrance, the share never seen in an aisle or fresco zone (100 minus penetration).'],
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

// ----------------------------------------------------------------- board → PDF

/**
 * My-dashboards widget ids → report sections that reuse the executive page-2 look.
 * Ops/PEBLE-only tiles do not yet have PDF chapters and do not count toward thickness.
 */
const WIDGET_TO_SECTIONS = {
  'exec-header-headline': ['verdict', 'kpis'],
  'activity-timeline-chart': ['rhythm'],
  'journey-signals-panel': ['journey'],
  'exec-action-insights': ['insights'],
  'checkout-panel': ['checkout', 'insights'],
  'fresco-department-cards': ['fresco'],
  'aisle-stat-stack': ['aisles'],
  'category-visits-panel': ['aisles'],
  'floor-visual-toggle': ['flow'],
};

const PAGE1_SECTIONS = new Set(['verdict', 'kpis', 'rhythm', 'journey', 'insights', 'checkout']);
const PAGE2_SECTIONS = new Set(['fresco', 'aisles', 'checkout']);

/**
 * @param {string[]} widgetIds
 * @returns {{ thin: boolean, sections: Set<string> }}
 */
export function resolveBoardPdfPlan(widgetIds) {
  const sections = new Set();
  for (const id of widgetIds || []) {
    for (const s of WIDGET_TO_SECTIONS[id] || []) sections.add(s);
  }
  // Thickness ignores flow appendix — a board of only a floor visual still falls back.
  const core = [...sections].filter((s) => s !== 'flow');
  return { thin: core.length < 3, sections };
}

function finishPdf(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawFooter(doc, i + 1);
  }
  return doc;
}

function startPdfDoc(journey, venueName) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: false, bufferPages: true });
  const timeZone = journey.storeHours?.timeZone || 'Europe/Rome';
  doc.addPage();
  const y = drawHeader(doc, {
    venueName,
    rangeLabel: formatRange(journey.range.startTs, journey.range.endTs, timeZone),
    generatedAt: new Date(journey.generatedAt).toLocaleString('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  });
  return { doc, y };
}

/**
 * Fixed-template report whose chapters follow a published My-dashboards board.
 * Same visual language as the executive PDF; omits sections the board does not use.
 *
 * @returns {PDFDocument}
 */
export function renderBoardScopedExecutivePdf(journey, { venueName, flowFieldShots, sections } = {}) {
  const want = sections instanceof Set ? sections : new Set(sections || []);
  const { doc, y: headerY } = startPdfDoc(journey, venueName);
  let y = headerY;

  const wantPage1 = [...PAGE1_SECTIONS].some((s) => want.has(s));
  if (wantPage1) {
    if (want.has('verdict')) y = drawVerdict(doc, journey.headline, y);
    if (want.has('kpis')) y = drawKpiCards(doc, journey.headlineKpis || [], y);
    if (want.has('rhythm')) y = drawRhythm(doc, journey, y);
    if (want.has('journey')) y = drawJourneyStrip(doc, journey, y);
    if (want.has('insights') || want.has('checkout')) {
      // Page-1 lower block already handles missing checkout or insights gracefully.
      y = drawPage1Lower(doc, journey, y);
    }
  }

  const wantPage2 = [...PAGE2_SECTIONS].some((s) => want.has(s));
  if (wantPage2) {
    doc.addPage();
    y = MARGIN;
    if (want.has('fresco')) y = drawFresco(doc, journey, y);
    if (want.has('aisles')) y = drawAisles(doc, journey, y + (want.has('fresco') ? 6 : 0));
    if (want.has('checkout')) {
      if (y > A4.height - 200) {
        doc.addPage();
        y = MARGIN;
      }
      y = drawCheckout(doc, journey, y + 6);
    }
    drawDefinitions(doc, journey, y + 6);
  }

  if (want.has('flow') && flowFieldShots?.length) {
    drawFlowField(doc, flowFieldShots);
  }

  return finishPdf(doc);
}

// ----------------------------------------------------------------- entrypoint

/**
 * @returns {PDFDocument} a streaming document; the caller pipes and ends it.
 */
export function renderEsselungaExecutivePdf(journey, { venueName, flowFieldShots } = {}) {
  const { doc, y: headerY } = startPdfDoc(journey, venueName);
  let y = headerY;

  y = drawVerdict(doc, journey.headline, y);
  y = drawKpiCards(doc, journey.headlineKpis || [], y);
  y = drawRhythm(doc, journey, y);
  y = drawJourneyStrip(doc, journey, y);
  y = drawPage1Lower(doc, journey, y);

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

  // Optional wind-map appendix — three frames on one page.
  if (flowFieldShots?.length) {
    drawFlowField(doc, flowFieldShots);
  }

  return finishPdf(doc);
}

export function executivePdfFileName(venueName, journey, { board } = {}) {
  const slug = String(venueName || 'venue').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const day = new Date(journey.range.endTs).toISOString().slice(0, 10);
  const prefix = board ? 'hyperspace-board' : 'esselunga-executive';
  return `${prefix}-${slug}-${day}.pdf`;
}
