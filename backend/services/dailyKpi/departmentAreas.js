/**
 * Two-layer department minutes — staff removal and choice index.
 * Raster construction lives in scripts/daily_kpi/department_areas.py (199 port).
 */

export const CORSIE = 'Corsie / fuori zona';
export const INGRESSO = 'Ingresso, casse, retro banchi';
export const SCAFFALI = 'Scaffali senza categoria';
export const CHOICE_TRAVERSE = 0.25;
export const CHOICE_WORKED = 0.4;

/**
 * Subtract staff person-minutes from Corsie first, remainder from Scaffali
 * (area and counter scaled by the same factor). Fresh departments untouched.
 * Returns minutes-per-entrance objects matching 199 §4.
 */
export function applyStaffRemoval(areaPm, bancoPm, staffPm, entrances) {
  const e = Math.max(Number(entrances) || 0, 1e-9);
  const res = { 'Personale (tolto)': round2(staffPm / e) };
  const corr = Number(areaPm[CORSIE] || 0);
  const takeCorr = Math.min(staffPm, corr);
  const rest = staffPm - takeCorr;
  const scArea = Number(areaPm[SCAFFALI] || 0);
  const scBanco = Number(bancoPm[SCAFFALI] || 0);
  const fSc = Math.max(scArea - rest, 0) / Math.max(scArea, 1e-9);
  for (const [d, raw] of Object.entries(areaPm)) {
    if (d === CORSIE || d === INGRESSO) continue;
    let a = Number(raw || 0);
    let b = Number(bancoPm[d] || 0);
    if (d === SCAFFALI) {
      a *= fSc;
      b *= fSc;
    }
    res[d] = { area: round2(a / e), al_banco: round2(b / e) };
  }
  res[CORSIE] = round2((corr - takeCorr) / e);
  res[INGRESSO] = round2(Number(areaPm[INGRESSO] || 0) / e);
  const totalPm = Object.values(areaPm).reduce((s, v) => s + Number(v || 0), 0) - staffPm;
  res.TOTALE = round2(totalPm / e);
  return { table: res, scaffaliScale: fSc };
}

export function choiceIndex(alBanco, area) {
  if (!area || area <= 0) return 0;
  return Math.round((alBanco / area) * 1000) / 1000;
}

export function choiceLabel(idx) {
  if (idx < CHOICE_TRAVERSE) return 'reparto attraversato';
  if (idx >= CHOICE_WORKED) return 'lavorato';
  return 'intermedio';
}

/** areas_sum_equals_little: |sum − visit_min| / visit_min < 1%. */
export function areasSumEqualsLittle(table, visitMin, maxRel = 0.01) {
  if (visitMin == null || visitMin === 0) return { passed: false, rel_err: null };
  const parts = Object.entries(table)
    .filter(([k]) => k !== 'TOTALE' && k !== 'Personale (tolto)')
    .reduce((s, [, v]) => s + (typeof v === 'number' ? v : Number(v?.area || 0)), 0);
  const rel = Math.abs(parts - visitMin) / visitMin;
  return { passed: rel < maxRel, rel_err: rel, parts };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
