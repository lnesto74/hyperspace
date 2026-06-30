/**
 * Entrance gate counting: trail segment crosses a polygon perimeter edge.
 * No dwell, no dedup — caller decides when to persist each crossing event.
 */

export function parseRoiVertices(verticesJson) {
  let vs = verticesJson;
  if (typeof vs === 'string') {
    try { vs = JSON.parse(vs); } catch { return []; }
  }
  if (!Array.isArray(vs)) return [];
  return vs
    .map((p) => ({ x: Number(p.x), z: Number(p.z ?? p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
}

/** Closed polygon perimeter as line segments. */
export function perimeterEdges(verts) {
  const edges = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    edges.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
  return edges;
}

/** True when open segment (p1→p2) properly crosses closed segment (a→b). */
export function segmentsIntersect(p1x, p1z, p2x, p2z, ax, az, bx, bz) {
  const d1x = p2x - p1x;
  const d1z = p2z - p1z;
  const d2x = bx - ax;
  const d2z = bz - az;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-12) return false;
  const t = ((ax - p1x) * d2z - (az - p1z) * d2x) / denom;
  const u = ((ax - p1x) * d1z - (az - p1z) * d1x) / denom;
  return t > 0 && t < 1 && u >= 0 && u <= 1;
}

/** Does movement from prev→cur cross any perimeter edge of verts? */
export function movementCrossesPerimeter(prev, cur, edges) {
  if (!prev || !cur) return false;
  if (!Number.isFinite(prev.x) || !Number.isFinite(prev.z)) return false;
  if (!Number.isFinite(cur.x) || !Number.isFinite(cur.z)) return false;
  for (const e of edges) {
    if (segmentsIntersect(prev.x, prev.z, cur.x, cur.z, e.ax, e.az, e.bx, e.bz)) {
      return true;
    }
  }
  return false;
}
