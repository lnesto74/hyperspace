/**
 * Nightly / download PDF from daily_kpi only.
 * Glossary wording from TREVIGLIO_STRATEGIA_KPI_AFFIDABILI.md §1.3.
 */
import PDFDocument from 'pdfkit';

const A4 = { width: 595.28, height: 841.89 };
const M = 40;
const W = A4.width - M * 2;

function pick(payload, id, slot = 'giorno') {
  return (payload.kpis || []).find((k) => k.kpi_id === id && k.slot === slot);
}

function shown(row, digits = 1) {
  if (!row || row.status === 'unreliable' || row.value == null) return '—';
  if (row.unit === 'count' || row.unit === 'people') return String(Math.round(row.value));
  return Number(row.value).toFixed(digits);
}

function chip(row) {
  if (!row) return '';
  if (row.status === 'unreliable') return 'non affidabile';
  return row.label === 'MEASURED' ? 'MISURATO' : 'STIMATO';
}

export function renderDailyKpiPdf(payload, { venueName = 'Treviglio' } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: M, info: { Title: `Esselunga Executive ${payload.day}` } });
  const ent = pick(payload, 'entrances');
  const visit = pick(payload, 'visit_min');
  const mean = pick(payload, 'people_mean');
  const max = pick(payload, 'people_max');
  const wait = pick(payload, 'queue_wait_min_per_entrance');
  const tiles = [
    { title: 'Ingressi', row: ent, digits: 0 },
    { title: 'Durata media visita', row: visit, digits: 1 },
    { title: 'Persone in media / max', row: mean, extra: max, digits: 0 },
    { title: 'Attesa in coda / cliente', row: wait, digits: 2 },
  ];

  doc.fontSize(9).fillColor('#6b7280').text('Esselunga · Executive · LiDAR raw 10 Hz', M, M);
  doc.fontSize(18).fillColor('#111827').text(venueName, M, M + 14);
  doc.fontSize(11).fillColor('#374151').text(payload.day, M, M + 38);

  let y = M + 60;
  const tw = (W - 18) / 4;
  tiles.forEach((t, i) => {
    const x = M + i * (tw + 6);
    doc.roundedRect(x, y, tw, 62, 4).fillAndStroke('#f9fafb', '#e5e7eb');
    doc.fillColor('#6b7280').fontSize(8).text(t.title, x + 6, y + 8, { width: tw - 12 });
    const value = t.extra && t.extra.status === 'ok'
      ? `${shown(t.row, t.digits)} / ${shown(t.extra, 0)}`
      : shown(t.row, t.digits);
    doc.fillColor('#111827').fontSize(16).text(value, x + 6, y + 24, { width: tw - 12 });
    doc.fillColor('#0e7490').fontSize(7).text(chip(t.row), x + 6, y + 46, { width: tw - 12 });
  });

  y += 80;
  doc.fillColor('#111827').fontSize(12).text('Ritmo della giornata (ingressi per fascia)', M, y);
  y += 18;
  const slots = ['08-10', '10-12', '12-14', '14-16', '16-18', '18-20'];
  const ents = slots.map((s) => pick(payload, 'entrances', s)?.value || 0);
  const maxE = Math.max(1, ...ents);
  slots.forEach((s, i) => {
    const x = M + i * (W / 6);
    const h = 50 * (ents[i] / maxE);
    doc.rect(x + 8, y + 50 - h, 40, h).fill('#0e7490');
    doc.fillColor('#6b7280').fontSize(7).text(s, x + 8, y + 54, { width: 40, align: 'center' });
    doc.fillColor('#111827').fontSize(8).text(String(ents[i] || '—'), x + 8, y + 64, { width: 40, align: 'center' });
  });

  y += 86;
  doc.fillColor('#111827').fontSize(12).text('Minuti per cliente per reparto', M, y);
  y += 16;
  const deptRow = pick(payload, 'minutes_per_customer_by_dept', 'giorno');
  const zero = new Set(pick(payload, 'zero_observation_rois')?.payload || []);
  const depts = Object.entries((deptRow?.payload && typeof deptRow.payload === 'object') ? deptRow.payload : {});
  depts.forEach(([name, val]) => {
    if (y > 760) return;
    doc.fillColor('#374151').fontSize(8).text(name, M, y, { width: 160 });
    if (zero.has(name)) {
      doc.fillColor('#b45309').text('nessuna osservazione — da verificare', M + 170, y);
    } else {
      doc.fillColor('#111827').text(Number(val).toFixed(2), M + 170, y);
    }
    y += 12;
  });

  y += 8;
  const first = pick(payload, 'first_department_after_entrance')?.payload || [];
  doc.fillColor('#111827').fontSize(12).text('Primo reparto dopo l’ingresso', M, y);
  y += 14;
  first.forEach((f) => {
    doc.fillColor('#374151').fontSize(8).text(`${f.dst}  ${Math.round((f.share || 0) * 100)}%`, M, y);
    y += 12;
  });

  y += 8;
  doc.fillColor('#111827').fontSize(12).text('Controlli del giorno', M, y);
  y += 14;
  for (const c of payload.checks || []) {
    doc.fillColor(c.passed ? '#047857' : '#b91c1c').fontSize(8)
      .text(`${c.passed ? 'PASS' : 'FAIL'}  ${c.check_id}`, M, y, { width: W });
    y += 11;
  }

  doc.addPage();
  doc.fillColor('#111827').fontSize(14).text('Casse e fresco', M, M);
  let y2 = M + 24;
  doc.fontSize(10).text('Attesa vs servizio per fascia (min / ingresso)', M, y2);
  y2 += 16;
  for (const sl of slots) {
    const q = pick(payload, 'queue_wait_min_per_entrance', sl);
    const s = pick(payload, 'service_min_per_entrance', sl);
    doc.fontSize(8).fillColor('#374151')
      .text(`${sl}   coda ${shown(q, 2)}   servizio ${shown(s, 2)}`, M, y2);
    y2 += 12;
  }
  y2 += 10;
  doc.fontSize(10).fillColor('#111827').text('Piazza del Fresco', M, y2);
  y2 += 14;
  depts.filter(([n]) => !['Ingresso', 'Corsie / fuori zona', 'Coda cassa', 'Cassa (servizio)', 'Scaffali senza categoria'].includes(n))
    .forEach(([name, val]) => {
      const line = zero.has(name) ? 'nessuna osservazione — da verificare' : Number(val).toFixed(2);
      doc.fontSize(8).fillColor('#374151').text(`${name}: ${line}`, M, y2);
      y2 += 12;
    });

  y2 += 16;
  doc.fontSize(12).fillColor('#111827').text('Glossario', M, y2);
  y2 += 16;
  const glossary = [
    ['Ingressi', 'Id VALID (e STATIC_SUSPECT) con visita grezza nell’ROI ingresso. MISURATO. Non è zone_visits.'],
    ['Durata media della visita', 'Persone-minuto in negozio ÷ ingressi (legge di Little). STIMATO.'],
    ['Persone presenti', 'Persone-minuto ÷ minuti di apertura. MISURATO.'],
    ['Minuti per reparto', 'Persone-minuto nel reparto ÷ ingressi della fascia. Corsie = in negozio − nei ROI.'],
    ['Attesa in coda', 'Minuti WAITING in CHECKOUT_QUEUE ÷ ingressi. Esclusi oggetti fissi (≥600 s) e transito (≥0,5 m/s).'],
    ['MISURATO / STIMATO', 'Il sensore lo ha visto, oppure il numero viene da un calcolo dichiarato.'],
  ];
  glossary.forEach(([k, v]) => {
    doc.fontSize(8).fillColor('#111827').text(k, M, y2, { width: W });
    y2 += 11;
    doc.fontSize(8).fillColor('#6b7280').text(v, M, y2, { width: W });
    y2 += 16;
  });

  doc.addPage();
  doc.fontSize(14).fillColor('#111827').text('Mappe di calore', M, M);
  doc.fontSize(9).fillColor('#6b7280').text(
    'heat_traffic e heat_still (griglia 1 m) sostituiscono i fotogrammi 3D del flow-field. Se il job non le ha calcolate, questa pagina resta intenzionalmente vuota — nessun interpolato.',
    M, M + 24, { width: W },
  );
  const heat = pick(payload, 'heat_traffic');
  if (!heat || heat.status === 'unreliable') {
    doc.fontSize(10).fillColor('#9ca3af').text('heat_traffic: non calcolato.', M, M + 70);
  }
  return doc;
}

export function dailyKpiHeadlineUnreliable(payload) {
  const ids = ['entrances', 'visit_min', 'people_mean', 'queue_wait_min_per_entrance'];
  return ids.some((id) => {
    const row = pick(payload, id);
    return !row || row.status === 'unreliable';
  });
}
