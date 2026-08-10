// Build a printable People-flow appendix for the Esselunga executive report.
//
// Uses the same PDF layout primitives as the main executive document, with the
// three export frames from the flow-field prototype (no control chrome) and a
// short insight under each.
//
//   node scripts/build_flowfield_executive_appendix.mjs
//   node scripts/build_flowfield_executive_appendix.mjs --out ~/Documents/foo.pdf
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const PDFDocument = require('../backend/node_modules/pdfkit');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(ROOT, 'prototypes/flowfield/shots');
const INSIGHTS = JSON.parse(fs.readFileSync(path.join(SHOTS_DIR, 'report_insights.json'), 'utf8'));

function parseArgs(argv) {
  const o = {
    out: path.join(
      process.env.HOME || '',
      'Documents',
      `esselunga-executive-treviglio-flowfield-appendix-${new Date().toISOString().slice(0, 10)}.pdf`,
    ),
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') o.out = path.resolve(argv[++i]);
  }
  return o;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_W = A4.width - MARGIN * 2;
const INK = '#111827';
const MUTED = '#6b7280';
const FAINT = '#9ca3af';
const RULE = '#e5e7eb';

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

function drawHeader(doc) {
  doc.rect(0, 0, A4.width, 68).fillColor('#0f172a').fill();
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff')
    .text(INSIGHTS.meta.venue || 'TREVIGLIO Schematico', MARGIN, 20, { width: CONTENT_W - 150 });
  doc.font('Helvetica').fontSize(9).fillColor('#94a3b8')
    .text(
      `People-flow field · ${INSIGHTS.meta.spanDays} trading days · `
      + `${INSIGHTS.meta.hours[0]}–${INSIGHTS.meta.hours[1]} local`,
      MARGIN, 40, { width: CONTENT_W - 150 },
    );
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#e2e8f0')
    .text('HYPERSPACE', A4.width - MARGIN - 150, 22, { width: 150, align: 'right' });
  doc.font('Helvetica').fontSize(7).fillColor('#64748b')
    .text('Executive appendix · LiDAR', A4.width - MARGIN - 150, 34, { width: 150, align: 'right' });
  doc.font('Helvetica').fontSize(6.5).fillColor('#475569')
    .text(INSIGHTS.meta.coverageNote, A4.width - MARGIN - 150, 45, { width: 150, align: 'right' });
  return 88;
}

function drawFooter(doc, pageNo, pageCount) {
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(6.5).fillColor(FAINT)
    .text(
      `Hyperspace · People-flow appendix · page ${pageNo} of ${pageCount}`,
      MARGIN, A4.height - 28, { width: CONTENT_W, align: 'center', lineBreak: false },
    );
  doc.page.margins.bottom = bottom;
}

async function main() {
  const args = parseArgs(process.argv);
  const shots = INSIGHTS.shots.map((s) => ({
    ...s,
    imagePath: path.join(SHOTS_DIR, s.file),
  }));
  for (const s of shots) {
    if (!fs.existsSync(s.imagePath)) throw new Error(`missing shot: ${s.imagePath}`);
  }

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: false, bufferPages: true });
  const out = fs.createWriteStream(args.out);
  doc.pipe(out);

  // Cover / intro page with first figure — fills the blank-space problem by
  // making each frame a full A4 with caption under it.
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    doc.addPage();
    let y = i === 0 ? drawHeader(doc) : MARGIN;

    y = sectionTitle(
      doc,
      i === 0 ? 'People-flow field' : shot.title,
      y,
      i === 0
        ? 'LiDAR trajectories aggregated into a continuous field — density, dwell and direction '
          + 'in one Windy-style view over the store plan. Frames are chart-only (no UI chrome).'
        : undefined,
    );

    if (i === 0) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
        .text(shot.title, MARGIN, y, { width: CONTENT_W });
      y = doc.y + 8;
    }

    const pageBottom = A4.height - MARGIN - 36;
    const maxImgH = Math.min(420, pageBottom - y - 72);
    const fitted = doc.openImage(shot.imagePath);
    const ar = fitted.width / fitted.height;
    let imgW = CONTENT_W;
    let imgH = imgW / ar;
    if (imgH > maxImgH) {
      imgH = maxImgH;
      imgW = imgH * ar;
    }
    const ix = MARGIN + (CONTENT_W - imgW) / 2;
    doc.image(shot.imagePath, ix, y, { width: imgW, height: imgH });
    doc.roundedRect(ix - 0.5, y - 0.5, imgW + 1, imgH + 1, 2)
      .lineWidth(0.6).strokeColor(RULE).stroke();
    y += imgH + 10;

    doc.font('Helvetica').fontSize(9).fillColor('#374151')
      .text(shot.caption, MARGIN, y, { width: CONTENT_W });
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawFooter(doc, i + 1, range.count);
  }

  doc.end();
  await new Promise((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
  });

  const kb = (fs.statSync(args.out).size / 1024).toFixed(0);
  console.log(`wrote ${args.out} (${kb} KB, ${shots.length} frames)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
