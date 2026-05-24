import fs from 'fs';
import path from 'path';

function fmt(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(digits);
}

function row(label, value) {
  return `| ${label} | ${value} |`;
}

export function writeReport(runDir, scorecard) {
  const p = scorecard.layers?.perception || {};
  const r = scorecard.layers?.reconciler || {};
  const s = scorecard.layers?.structural || {};
  const gb = r.GROCERY_BALANCED || {};
  const raw = r.BYPASS_RAW || {};
  const fc = s.fragmentation_cause_pct || {};

  const lines = [
    `# Benchmark Report — ${scorecard.capture_id}`,
    '',
    `**Source:** \`${scorecard.source_file}\``,
    `**Venue:** \`${scorecard.venue_id}\``,
    `**Scope:** ${scorecard.scope}`,
    `**Generated:** ${scorecard.generated_at}`,
    '',
    '---',
    '',
    '## Layer 1 — Raw perception (reconciler OFF)',
    '',
    '| Metric | Value |',
    '|--------|------:|',
    row('Messages', p.messages?.toLocaleString?.() ?? p.messages),
    row('Unique perception IDs', p.unique_perception_ids?.toLocaleString?.() ?? p.unique_perception_ids),
    row('Time span (h)', fmt(p.time_span_h, 2)),
    row('Est. real shoppers', p.estimated_real_shoppers),
    row('Fragmentation factor (IDs / shoppers)', fmt(p.fragmentation_factor, 2)),
    row('Mean lifetime (s)', fmt(p.mean_lifetime_s)),
    row('Mean displacement (m)', fmt(p.mean_displacement_m)),
    row('Teleports / 1k msgs', fmt(p.teleports_per_1k, 2)),
    row('Short-lived IDs <2s (%)', fmt(p.pct_ids_under_2s, 1)),
    row('Shopper-grade tracks ≥30m', p.shopper_grade_ge_30m),
    '',
    '## Layer 2 — Reconciler sweep',
    '',
    '| Config | Stable | Frag × | Lifetime (s) | Disp (m) | tp/1k | Ghost % | ≥30m |',
    '|--------|-------:|-------:|-------------:|---------:|------:|--------:|-----:|',
  ];

  for (const name of ['BYPASS_RAW', 'BASELINE_DEFAULT', 'GROCERY_BALANCED', 'GROCERY_AGGRESSIVE', 'GROCERY_CONSERVATIVE']) {
    const c = r[name];
    if (!c) continue;
    lines.push(
      `| ${name} | ${c.stable_tracks} | ${fmt(c.fragmentation_x, 2)} | ${fmt(c.mean_lifetime_s)} | ${fmt(c.mean_displacement_m)} | ${fmt(c.teleports_per_1k, 2)} | ${fmt(c.ghost_pct, 1)} | ${c.shopper_grade_ge_30m ?? '—'} |`,
    );
  }

  lines.push(
    '',
    '### Recommended operating point',
    '',
    gb.mean_lifetime_s != null
      ? `**GROCERY_BALANCED** — ${fmt(gb.mean_lifetime_s)}s mean lifetime, ${fmt(gb.teleports_per_1k, 2)} teleports/1k, ${fmt(gb.ghost_pct, 1)}% ghosts.`
      : '_Reconciler sweep not run._',
    '',
    '## Layer 3 — Structural / spatial',
    '',
    '| Metric | Value |',
    '|--------|------:|',
    row('Walkable area (m²)', fmt(s.walkable_area_m2, 0)),
    row('Significant blindspots (m²)', fmt(s.significant_blindspot_m2, 0)),
    row('Fragmentation: shelf occlusion (%)', fmt(fc.occlusion, 1)),
    row('Fragmentation: blindspot gap (%)', fmt(fc.blindspot, 1)),
    row('Fragmentation: new person / exit (%)', fmt(fc.new_person, 1)),
    '',
    '## Artifacts',
    '',
    '- `artifacts/01_overview.png` — raw perception distributions',
    '- `artifacts/02_spatial_motion.png` — heatmap + birth/death',
    '- `artifacts/05_forensic.png` — fragmentation forensics',
    '- `artifacts/05_blindspots.png` — blindspot map',
    '- `artifacts/06_verify.json` — reconciler metrics',
    '- `scorecard.json` — machine-readable ledger entry',
    '',
  );

  if (raw.mean_lifetime_s != null && gb.mean_lifetime_s != null) {
    const ltGain = ((gb.mean_lifetime_s - raw.mean_lifetime_s) / Math.max(raw.mean_lifetime_s, 0.001)) * 100;
    lines.push(
      '## Delta vs raw',
      '',
      `- Grocery Balanced lifetime: **${fmt(ltGain, 0)}%** vs BYPASS_RAW`,
      '',
    );
  }

  const outPath = path.join(runDir, 'REPORT.md');
  fs.writeFileSync(outPath, lines.join('\n'));
  return outPath;
}
