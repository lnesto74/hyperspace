import { jsPDF } from 'jspdf';
import type { EsselungaJourneyPayload } from './types';

export function exportWeeklyExecutivePdf(journey: EsselungaJourneyPayload, venueName: string) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 16;
  let y = margin;

  const line = (text: string, size = 10, bold = false) => {
    if (y > 280) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(text, margin, y);
    y += size * 0.45 + 3;
  };

  line('Hyperspace · Esselunga Executive Brief', 14, true);
  line(venueName, 11, true);
  line(
    journey.hqSummary?.headline
      || `Period: ${new Date(journey.range.startTs).toLocaleDateString()} – ${new Date(journey.range.endTs).toLocaleDateString()}`,
    9,
  );
  y += 4;

  line('Store overview', 11, true);
  line(`Total visitors: ${journey.overview.totalVisitors.toLocaleString()}`);
  line(`Avg store dwell: ${journey.overview.avgStoreDwellMin} min`);
  if (journey.overview.avgTicket != null) line(`Avg ticket: €${journey.overview.avgTicket.toFixed(2)}`);
  if (journey.overview.spi != null) line(`SPI: ${journey.overview.spi}`);
  if (journey.crossKpis.shoppingEfficiency != null) {
    line(`Shopping efficiency: €${journey.crossKpis.shoppingEfficiency}/min dwell`);
  }
  y += 4;

  line('Piazza del Fresco', 11, true);
  for (const d of journey.fresco.departments.slice(0, 5)) {
    line(`${d.label}: ${d.visits} visits · ${d.browsingPct}% browsing / ${d.waitingPct}% waiting · ${d.avgDwellMin}m dwell`);
  }
  y += 4;

  line('Aisles', 11, true);
  line(`Penetration: ${journey.aisles.penetrationPct}% · Stopping power: ${journey.aisles.stoppingPowerPct}%`);
  if (journey.aisles.aisleConversionPct != null) {
    line(`Aisle conversion: ${journey.aisles.aisleConversionPct}%`);
  }
  y += 4;

  line('Checkout', 11, true);
  for (const ch of journey.checkout.channels) {
    line(`${ch.label}: ${ch.sessions} sessions · ${ch.avgWaitMin}m wait · ${ch.abandonPct}% abandon`);
  }
  y += 4;

  line('Top 3 actionable insights', 11, true);
  for (const ins of journey.insights.slice(0, 3)) {
    line(`• ${ins.title}`, 9, true);
    line(`  ${ins.message}`, 9);
    line(`  Action: ${ins.action}`, 9);
  }

  const fileName = `esselunga-executive-${venueName.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}
