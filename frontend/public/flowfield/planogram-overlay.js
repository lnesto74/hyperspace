// Planogram overlay on the retail twin: product fronts coloured by macro-category and section
// markers coloured by match quality. Geometry only, from GET /api/planogram/venues/:id/planogram-sections
// (planogram_sections + fronts of the newest published planogram). No KPI is drawn here.
// Palette and order follow data/planogram/TEV/2026-10-13/TEV_macro_categorie_venue.png.

export const MACRO_COLORS = {
  'Cura persona': '#1f77b4',
  'Colazione e dolci': '#aec7e8',
  'Pasta, riso e dispensa': '#ff7f0e',
  'Bazar e non alimentare': '#ffbb78',
  'Latticini e freschi': '#2ca02c',
  'Bevande alcoliche': '#98df8a',
  'Pulizia casa': '#d62728',
  Surgelati: '#ff9896',
  Petcare: '#9467bd',
  'Salute e benessere': '#c5b0d5',
  Infanzia: '#8c564b',
  'Carta e casalinghi': '#c49c94',
  'Bevande analcoliche': '#e377c2',
  'Pane confezionato': '#f7b6d2',
  Salumi: '#7f7f7f',
  'Snack salati': '#c7c7c7',
  'Impulso avancassa (non classificato)': '#bcbd22',
  'Shopper e borse': '#dbdb8d',
  'Servizi e carte prepagate': '#17becf',
};
const EXTRA = ['#6b8e9f', '#b07aa1', '#9c755f', '#76b7b2', '#edc948', '#59a14f'];

export const QUALITY_COLORS = { ok: '#7CCBA7', da_verificare: '#F3C778', fuori: '#F49B90' };
export const QUALITY_LABELS = { ok: 'On a twin shelf', da_verificare: 'To verify', fuori: 'No twin shelf' };

export function macroColor(macro) {
  if (MACRO_COLORS[macro]) return MACRO_COLORS[macro];
  let h = 0;
  for (const ch of String(macro || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return EXTRA[h % EXTRA.length];
}

/** Macro-categories present in the data, in palette order, with front counts. */
export function macroLegend(sections) {
  const n = new Map();
  for (const s of sections || []) for (const f of s.fronts || []) n.set(f.macro, (n.get(f.macro) || 0) + 1);
  const order = Object.keys(MACRO_COLORS);
  return [...n.entries()]
    .sort((a, b) => ((order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99)) || a[0].localeCompare(b[0], 'it'))
    .map(([macro, fronts]) => ({ macro, fronts, color: macroColor(macro) }));
}

export function qualityLegend(sections) {
  const n = { ok: 0, da_verificare: 0, fuori: 0 };
  for (const s of sections || []) if (n[s.quality] != null) n[s.quality] += 1;
  return Object.entries(n).map(([quality, count]) => ({ quality, count, color: QUALITY_COLORS[quality], label: QUALITY_LABELS[quality] }));
}

export async function loadPlanogramSections(venueId, fetcher = fetch) {
  if (!venueId) return { planogram: null, sections: [], note: 'No venue' };
  try {
    const r = await fetcher(`/api/planogram/venues/${encodeURIComponent(venueId)}/planogram-sections`, { credentials: 'include', cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return { planogram: d.planogram, sections: d.sections || [], note: d.planogram ? `${d.planogram.name} · v${d.planogram.version}` : 'No published planogram with sections' };
  } catch (e) {
    return { planogram: null, sections: [], note: `Planogram unavailable (${e.message})` };
  }
}

/**
 * Two groups added to `root`: fronts (one flat ribbon per front at shelf-edge height) and section pads.
 * Fronts whose section is 'fuori' (> 1 m from any CAD fixture) are not drawn as category fronts.
 */
export function createPlanogramOverlay(THREE, root, sections) {
  const frontGroup = new THREE.Group(); frontGroup.name = 'Planogram fronts · macro-category'; frontGroup.visible = false;
  const sectionGroup = new THREE.Group(); sectionGroup.name = 'Planogram sections · quality'; sectionGroup.visible = false;
  root.add(frontGroup, sectionGroup);
  const color = new THREE.Color();

  const pos = [], col = [];
  const Y = 1.12, HALF = 0.07;
  for (const s of sections) {
    if (s.qualityDwg === 'fuori') continue;
    for (const f of s.fronts || []) {
      const dx = f.x1 - f.x0, dz = f.z1 - f.z0, L = Math.hypot(dx, dz);
      if (!(L > 0.05)) continue;
      const nx = (-dz / L) * HALF, nz = (dx / L) * HALF;
      const q = [[f.x0 + nx, f.z0 + nz], [f.x1 + nx, f.z1 + nz], [f.x1 - nx, f.z1 - nz], [f.x0 - nx, f.z0 - nz]];
      color.set(macroColor(f.macro));
      for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(q[i][0], Y, q[i][1]); col.push(color.r, color.g, color.b); }
    }
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    frontGroup.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false })));
  }

  const placed = sections.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.z));
  if (placed.length) {
    const pad = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 12),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }), placed.length);
    const o = new THREE.Object3D();
    placed.forEach((s, i) => {
      o.position.set(s.x, 2.6, s.z); o.updateMatrix();
      pad.setMatrixAt(i, o.matrix);
      pad.setColorAt(i, color.set(QUALITY_COLORS[s.quality] || '#9aa7b0'));
    });
    pad.instanceMatrix.needsUpdate = true;
    if (pad.instanceColor) pad.instanceColor.needsUpdate = true;
    sectionGroup.add(pad);
  }

  return {
    fronts(on) { frontGroup.visible = !!on; },
    sections(on) { sectionGroup.visible = !!on; },
    dispose() {
      for (const grp of [frontGroup, sectionGroup]) {
        grp.traverse((n) => { n.geometry?.dispose(); n.material?.dispose?.(); });
        root.remove(grp);
      }
    },
  };
}
