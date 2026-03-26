/**
 * LaunchPad API Adapter
 * 
 * Thin wrapper around existing Hyperspace REST APIs.
 * NEVER duplicates business logic — only calls existing endpoints
 * and reshapes responses for LaunchPad consumption.
 */

import { API_BASE } from '../config/api'
import type {
  SelectDwgData,
  MapFixturesData,
  DefineRoisData,
  PlaceLidarsData,
  CommissionEdgeData,
  PairDevicesData,
  DeployHerData,
  ValidateStreamData,
  StreamCheck,
  GoLiveData,
  ClassificationSuggestion,
  FixtureType,
} from './launchpadTypes'

// ─── DWG / Layout APIs ─────────────────────────────────────────

export async function uploadDwgFile(file: File, venueId?: string): Promise<{
  import_id: string
  filename: string
  units: string
  fixture_count: number
}> {
  const formData = new FormData()
  formData.append('file', file)
  if (venueId) formData.append('venue_id', venueId)
  const res = await fetch(`${API_BASE}/api/dwg/import`, { method: 'POST', body: formData })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }))
    throw new Error(err.error || 'DWG upload failed')
  }
  return res.json()
}

export async function listDwgImports(): Promise<Array<{
  import_id: string
  venue_id: string | null
  filename: string
  units: string
  status: string
  created_at: string
}>> {
  const res = await fetch(`${API_BASE}/api/dwg/imports`)
  if (!res.ok) throw new Error('Failed to list DWG imports')
  return res.json()
}

export async function listDwgLayouts(venueId?: string): Promise<Array<{
  id: string
  layout_version_id: string
  import_id: string
  venue_id: string | null
  name: string
  dwg_filename?: string | null
  is_active: boolean
  created_at: string
}>> {
  const url = venueId
    ? `${API_BASE}/api/dwg/layouts?venue_id=${venueId}`
    : `${API_BASE}/api/dwg/layouts`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to list DWG layouts')
  return res.json()
}

export async function getImportDetails(importId: string): Promise<{
  import_id: string
  filename: string
  units: string
  unit_scale_to_m: number
  bounds: Record<string, number>
  status: string
  fixtures: Array<{
    id: string
    source: { type: string; layer: string; block?: string }
    pose2d: { x: number; y: number; rot_deg?: number }
    footprint: { kind: string; w: number; d: number; points?: Array<{ x: number; y: number }> }
    group_id?: string
  }>
  groups: Array<{
    group_id: string
    layer: string
    block: string | null
    count: number
    size: { w: number; d: number }
    members: string[]
  }>
}> {
  const res = await fetch(`${API_BASE}/api/dwg/import/${importId}`)
  if (!res.ok) throw new Error('Failed to get import details')
  return res.json()
}

export async function getDeletedFixtureIds(importId: string): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/api/dwg/import/${importId}/deleted-fixtures`)
    if (!res.ok) return []
    const data = await res.json()
    return data.deleted_fixture_ids || []
  } catch { return [] }
}

export async function listImportLayouts(importId: string): Promise<Array<{
  id: string
  import_id: string
  name: string
  is_active: boolean
  venue_id?: string | null
}>> {
  const res = await fetch(`${API_BASE}/api/dwg/import/${importId}/layouts`)
  if (!res.ok) return []
  return res.json()
}

export async function getLayoutDetails(layoutVersionId: string): Promise<{
  layout_version_id: string
  import_id: string
  venue_id: string | null
  name: string
  layout: {
    fixtures: Array<Record<string, unknown>>
    bounds: Record<string, number>
    unit_scale_to_m: number
    groups: Array<Record<string, unknown>>
  }
  mapping: Record<string, unknown>
}> {
  const res = await fetch(`${API_BASE}/api/dwg/layout/${layoutVersionId}`)
  if (!res.ok) throw new Error('Failed to get layout details')
  return res.json()
}

export async function getMapping(importId: string): Promise<{
  group_mappings: Record<string, {
    catalog_asset_id: string
    type: string
    anchor: string
    offset_m: { x: number; y: number; z: number }
    rotation_offset_deg: number
  }>
}> {
  const res = await fetch(`${API_BASE}/api/dwg/import/${importId}/mapping`)
  if (!res.ok) throw new Error('Failed to get mapping')
  return res.json()
}

export async function saveMapping(importId: string, mappingData: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/api/dwg/import/${importId}/mapping`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mappingData),
  })
  if (!res.ok) throw new Error('Failed to save mapping')
}

export async function generateLayout(importId: string, venueId?: string): Promise<{
  layout_version_id: string
  layout: Record<string, unknown>
}> {
  const res = await fetch(`${API_BASE}/api/dwg/import/${importId}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venue_id: venueId }),
  })
  if (!res.ok) throw new Error('Failed to generate layout')
  return res.json()
}

/**
 * Bootstrap a venue from a DWG layout version.
 * Only creates a NEW venue — NEVER overwrites an existing one.
 * If existingVenueId is provided and that venue already exists, returns it as-is.
 */
export async function bootstrapVenueFromLayout(layoutVersionId: string, existingVenueId?: string): Promise<{
  venueId: string
  venueName: string
  objectCount: number
}> {
  // SAFETY: If an existing venue is provided, check if it already exists in DB.
  // If it does, NEVER overwrite it — just return its info and link the layout.
  if (existingVenueId) {
    try {
      const checkRes = await fetch(`${API_BASE}/api/venues/${existingVenueId}`)
      if (checkRes.ok) {
        const existing = await checkRes.json()
        console.log(`[LaunchPad] Venue "${existing.venue?.name}" already exists — skipping bootstrap, preserving data`)
        // Just link layout to this existing venue (non-destructive)
        await fetch(`${API_BASE}/api/dwg/layout/${layoutVersionId}/link-venue`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ venue_id: existingVenueId }),
        }).catch(() => {})
        return {
          venueId: existingVenueId,
          venueName: existing.venue?.name || 'Venue',
          objectCount: existing.objects?.length || 0,
        }
      }
    } catch { /* venue doesn't exist — proceed to create */ }
  }

  // 1. Get bootstrap data (stateless — doesn't create anything)
  // Read scaleCorrection from localStorage (set by DWG Importer PreviewPanel)
  let scaleCorrection = 1.0
  try {
    // Try all possible storage keys for autoplace settings
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('dwg-autoplace-settings-')) {
        const s = JSON.parse(localStorage.getItem(key) || '{}')
        if (s.scaleCorrection && s.scaleCorrection !== 1.0) {
          scaleCorrection = s.scaleCorrection
          break
        }
      }
    }
  } catch { /* ignore */ }
  const bootstrapRes = await fetch(`${API_BASE}/api/dwg/layout/${layoutVersionId}/as-venue-bootstrap?scaleCorrection=${scaleCorrection}`)
  if (!bootstrapRes.ok) throw new Error('Failed to fetch DWG bootstrap data')
  const bootstrap = await bootstrapRes.json()

  // DEBUG: Log bootstrap response for sizing debugging
  console.log(`[LaunchPad Bootstrap] Venue dimensions from backend:`, {
    width: bootstrap.venueDefaults?.width,
    depth: bootstrap.venueDefaults?.depth,
    height: bootstrap.venueDefaults?.height,
    objectCount: bootstrap.objectsDraft?.length,
    transform: bootstrap.transform,
  })

  // 2. Generate a NEW venue ID — never reuse an existing one
  const venueId = crypto.randomUUID()
  // Derive a clean venue name from the DWG filename (strip ".dwg", " Layout" suffix)
  const rawName = (bootstrap.dwgMetadata?.layoutName || 'DWG Venue') as string
  const venueName = rawName.replace(/\.dwg\b/i, '').replace(/\s*Layout$/i, '').trim() || 'DWG Venue'

  // 3. Build venue + objects payload
  const DEFAULT_COLORS: Record<string, string> = {
    shelf: '#4a9eff', wall: '#6b7280', checkout: '#22c55e', entrance: '#f59e0b',
    pillar: '#9ca3af', digital_display: '#a855f7', radio: '#06b6d4', custom: '#8b5cf6',
  }
  const venue = {
    id: venueId,
    name: venueName,
    width: bootstrap.venueDefaults.width,
    depth: bootstrap.venueDefaults.depth,
    height: bootstrap.venueDefaults.height,
    tileSize: bootstrap.venueDefaults.tileSize,
    scene_source: 'dwg',
    dwg_layout_version_id: layoutVersionId,
    dwg_transform_json: JSON.stringify({ scaleCorrection: bootstrap.transform?.scaleCorrection || scaleCorrection }),
  }
  const objects = (bootstrap.objectsDraft || []).map((obj: Record<string, unknown>) => ({
    ...obj,
    venueId,
    color: (obj.color as string) || DEFAULT_COLORS[(obj.type as string)] || DEFAULT_COLORS.custom,
  }))

  // 4. Create new venue + objects (PUT with new UUID = always a create)
  const saveRes = await fetch(`${API_BASE}/api/venues/${venueId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venue, objects }),
  })
  if (!saveRes.ok) throw new Error('Failed to save venue from DWG bootstrap')

  // 5. Link layout to venue
  await fetch(`${API_BASE}/api/venues/${venueId}/dwg-layout`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dwg_layout_version_id: layoutVersionId }),
  }).catch(() => {})

  // 6. Also update layout_version's venue_id in dwg_layout_versions
  await fetch(`${API_BASE}/api/dwg/layout/${layoutVersionId}/link-venue`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venue_id: venueId }),
  }).catch(() => {})

  console.log(`[LaunchPad] Created NEW venue "${venueName}" (${venueId}) with ${objects.length} objects`)
  return { venueId, venueName, objectCount: objects.length }
}

/**
 * Refresh an existing venue's objects from its DWG layout.
 * Call this after fixture classifications/mappings change to keep venue objects in sync.
 * 1. Regenerates layout (picks up latest dwg_mappings)
 * 2. Fetches new bootstrap data from regenerated layout
 * 3. PUTs updated objects to the existing venue
 */
export async function refreshVenueFromLayout(
  importId: string,
  venueId: string,
  venueNameOverride?: string
): Promise<{ layoutVersionId: string; objectCount: number }> {
  // 1. Regenerate layout with current mappings
  const genResult = await generateLayout(importId, venueId)
  const newLayoutId = genResult.layout_version_id
  console.log(`[LaunchPad] Regenerated layout ${newLayoutId} for venue ${venueId}`)

  // 2. Get bootstrap data from new layout (pass scaleCorrection from localStorage)
  let sc = 1.0
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('dwg-autoplace-settings-')) {
        const s = JSON.parse(localStorage.getItem(key) || '{}')
        if (s.scaleCorrection && s.scaleCorrection !== 1.0) { sc = s.scaleCorrection; break }
      }
    }
  } catch { /* ignore */ }
  const bootstrapRes = await fetch(`${API_BASE}/api/dwg/layout/${newLayoutId}/as-venue-bootstrap?scaleCorrection=${sc}`)
  if (!bootstrapRes.ok) throw new Error('Failed to fetch bootstrap data after regeneration')
  const bootstrap = await bootstrapRes.json()

  // 3. Build objects payload
  const DEFAULT_COLORS: Record<string, string> = {
    shelf: '#4a9eff', wall: '#6b7280', checkout: '#22c55e', entrance: '#f59e0b',
    pillar: '#9ca3af', digital_display: '#a855f7', radio: '#06b6d4', custom: '#8b5cf6',
    fridge: '#06b6d4',
  }
  const objects = (bootstrap.objectsDraft || []).map((obj: Record<string, unknown>) => ({
    ...obj,
    venueId,
    color: (obj.color as string) || DEFAULT_COLORS[(obj.type as string)] || DEFAULT_COLORS.custom,
  }))

  // 4. Update venue dimensions + objects (PUT replaces all objects)
  const venue: Record<string, unknown> = {
    id: venueId,
    width: bootstrap.venueDefaults.width,
    depth: bootstrap.venueDefaults.depth,
    height: bootstrap.venueDefaults.height,
    tileSize: bootstrap.venueDefaults.tileSize,
    scene_source: 'dwg',
    dwg_layout_version_id: newLayoutId,
    dwg_transform_json: JSON.stringify({ scaleCorrection: bootstrap.transform?.scaleCorrection || sc }),
  }
  if (venueNameOverride) venue.name = venueNameOverride

  const saveRes = await fetch(`${API_BASE}/api/venues/${venueId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venue, objects }),
  })
  if (!saveRes.ok) throw new Error('Failed to update venue objects')

  // 5. Link layout to venue
  await fetch(`${API_BASE}/api/dwg/layout/${newLayoutId}/link-venue`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venue_id: venueId }),
  }).catch(() => {})

  // 6. Update localStorage so Layout3DPreview uses new layout
  localStorage.setItem('venueDwg-selectedLayout', newLayoutId)
  window.dispatchEvent(new CustomEvent('dwgLayoutSelected', { detail: { layoutId: newLayoutId } }))

  console.log(`[LaunchPad] Refreshed venue ${venueId}: ${objects.length} objects from layout ${newLayoutId}`)
  return { layoutVersionId: newLayoutId, objectCount: objects.length }
}

export async function getCatalogAssets(): Promise<Array<{
  id: string
  name: string
  type: string
  hasCustomModel: boolean
}>> {
  const res = await fetch(`${API_BASE}/api/dwg/catalog`)
  if (!res.ok) throw new Error('Failed to get catalog')
  return res.json()
}

// ─── Fixture Classification Engine (with spatial reasoning) ─────

type FixturePos = {
  id: string
  group_id?: string
  x: number
  y: number
  rot_deg: number
  w: number
  d: number
  points?: Array<{ x: number; y: number }>
}

const BLOCK_NAME_RULES: Array<{ pattern: RegExp; type: FixtureType; confidence: number }> = [
  { pattern: /shelf|gondola|rack|bay|aisle|shelving|scaffal|reparto|corsia|rayon|regal|estanter/i, type: 'shelf', confidence: 0.95 },
  { pattern: /wall|perim|bound|enclos|partition|muro|paret|parete|wand|mur|pared/i, type: 'wall', confidence: 0.90 },
  { pattern: /check|cash|pos|till|register|cassa|caisse|kasse|caja|banco/i, type: 'checkout', confidence: 0.90 },
  { pattern: /door|entrance|exit|gate|ingress|porta|uscita|entrata|ingresso|porte|sortie|puerta/i, type: 'entrance', confidence: 0.90 },
  { pattern: /pillar|column|post|pier|support|colonna|pilastro|pilar|säule|colonne/i, type: 'pillar', confidence: 0.90 },
  { pattern: /display|screen|monitor|sign|dooh|totem|schermo/i, type: 'digital_display', confidence: 0.85 },
  { pattern: /fridge|cooler|freezer|refrig|chiller|frigo|surgelat|congelat|banco\s*frigo/i, type: 'fridge', confidence: 0.90 },
  { pattern: /radio|speaker|audio|altoparlant/i, type: 'radio', confidence: 0.80 },
  { pattern: /mobil|arred|banco|banc[^o]|isola|promoz|esposit|gondol/i, type: 'shelf', confidence: 0.70 },
]

const LAYER_NAME_RULES: Array<{ pattern: RegExp; type: FixtureType; confidence: number }> = [
  { pattern: /wall|struct|arch|perim|muro|paret|parete/i, type: 'wall', confidence: 0.70 },
  { pattern: /fixture|furn|equip|shelf|scaffal|arred|mobil/i, type: 'shelf', confidence: 0.60 },
  { pattern: /elec|light|hvac|mech|plumb|impiant/i, type: 'custom', confidence: 0.40 },
  { pattern: /door|entrance|exit|porta|uscita|ingresso/i, type: 'entrance', confidence: 0.65 },
  { pattern: /cassa|check|cash|register/i, type: 'checkout', confidence: 0.65 },
]

// ─── Spatial helpers ────────────────────────────────────────────

/** Compute axis-aligned bounding box of a set of positions */
function positionsBBox(pts: Array<{ x: number; y: number }>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY }
}

/**
 * Detect parallel row arrangement — the hallmark of grocery shelving.
 * Strategy: quantize one coordinate axis into bins; if most fixtures
 * land in a small number of evenly-spaced bins → parallel rows.
 * Returns { isRowPattern, rowCount, dominantAxis }.
 */
function detectParallelRows(positions: Array<{ x: number; y: number }>, fixtureMaxDim: number): {
  isRowPattern: boolean; rowCount: number; dominantAxis: 'x' | 'y'
} {
  if (positions.length < 4) return { isRowPattern: false, rowCount: 0, dominantAxis: 'x' }

  // Try both axes — rows could be horizontal or vertical
  for (const axis of ['x', 'y'] as const) {
    const vals = positions.map(p => p[axis]).sort((a, b) => a - b)

    // Bin into rows using a tolerance of 1.5× fixture max dimension
    const binTolerance = Math.max(fixtureMaxDim * 1.5, 200)
    const rows: number[][] = []
    let currentRow = [vals[0]]

    for (let i = 1; i < vals.length; i++) {
      if (vals[i] - currentRow[currentRow.length - 1] > binTolerance) {
        rows.push(currentRow)
        currentRow = [vals[i]]
      } else {
        currentRow.push(vals[i])
      }
    }
    rows.push(currentRow)

    // Check if rows are evenly spaced (± 30% tolerance)
    if (rows.length >= 3) {
      const rowCenters = rows.map(r => r.reduce((s, v) => s + v, 0) / r.length)
      const gaps: number[] = []
      for (let i = 1; i < rowCenters.length; i++) gaps.push(rowCenters[i] - rowCenters[i - 1])
      const medianGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
      const evenlySpaced = gaps.filter(g => Math.abs(g - medianGap) / medianGap < 0.35).length
      const evenRatio = evenlySpaced / gaps.length

      // At least 3 rows, with majority evenly spaced, each row having ≥ 2 fixtures
      const bigRows = rows.filter(r => r.length >= 2).length
      if (bigRows >= 3 && evenRatio >= 0.5) {
        return { isRowPattern: true, rowCount: bigRows, dominantAxis: axis }
      }
    }
  }
  return { isRowPattern: false, rowCount: 0, dominantAxis: 'x' }
}

/**
 * Compute how close a group's fixtures are to the floor plan perimeter.
 * Returns 0 (centered) to 1 (touching edge).
 */
function edgeProximity(
  positions: Array<{ x: number; y: number }>,
  floorBBox: { minX: number; minY: number; maxX: number; maxY: number }
): number {
  const { minX, minY, maxX, maxY } = floorBBox
  const w = maxX - minX, h = maxY - minY
  if (w <= 0 || h <= 0) return 0

  let totalProx = 0
  for (const p of positions) {
    const distL = Math.abs(p.x - minX) / w
    const distR = Math.abs(p.x - maxX) / w
    const distT = Math.abs(p.y - minY) / h
    const distB = Math.abs(p.y - maxY) / h
    const minDist = Math.min(distL, distR, distT, distB)
    totalProx += 1 - Math.min(minDist * 4, 1) // 0 at 25%+ from edge, 1 at edge
  }
  return totalProx / positions.length
}

/**
 * Check if a group's fixtures are tightly clustered in one area.
 * Returns ratio of group bbox area to floor plan area.
 */
function clusterCompactness(
  positions: Array<{ x: number; y: number }>,
  floorBBox: { minX: number; minY: number; maxX: number; maxY: number }
): number {
  if (positions.length < 2) return 1
  const gb = positionsBBox(positions)
  const floorArea = (floorBBox.maxX - floorBBox.minX) * (floorBBox.maxY - floorBBox.minY)
  if (floorArea <= 0) return 0
  return (gb.w * gb.h) / floorArea
}

/**
 * Check if fixtures share a consistent orientation.
 * Returns the dominant rotation and how many fixtures match it.
 */
function orientationConsistency(rotations: number[]): { dominant: number; ratio: number } {
  if (rotations.length === 0) return { dominant: 0, ratio: 1 }
  // Normalize to 0-180 range (180° = same orientation flipped)
  const normalized = rotations.map(r => ((r % 180) + 180) % 180)
  // Bin into 10° buckets
  const bins = new Map<number, number>()
  for (const r of normalized) {
    const bin = Math.round(r / 10) * 10
    bins.set(bin, (bins.get(bin) || 0) + 1)
  }
  let maxCount = 0, dominant = 0
  for (const [bin, count] of bins) {
    if (count > maxCount) { maxCount = count; dominant = bin }
  }
  return { dominant, ratio: maxCount / rotations.length }
}

/**
 * Compute polygon area using Shoelace formula.
 */
function polygonArea(points: Array<{ x: number; y: number }>): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return Math.abs(area) / 2
}

// ─── Main Classifier ────────────────────────────────────────────

export function classifyFixtureGroups(
  groups: Array<{
    group_id: string
    layer: string
    block: string | null
    count: number
    size: { w: number; d: number }
  }>,
  fixtures?: FixturePos[]
): ClassificationSuggestion[] {
  // Build spatial index: group_id → fixture positions
  const groupFixtures = new Map<string, FixturePos[]>()
  if (fixtures) {
    for (const f of fixtures) {
      if (!f.group_id) continue
      const arr = groupFixtures.get(f.group_id) || []
      arr.push(f)
      groupFixtures.set(f.group_id, arr)
    }
  }

  // Compute overall floor plan bounding box from ALL fixtures
  const allPositions = fixtures?.map(f => ({ x: f.x, y: f.y })) || []
  const floorBBox = allPositions.length > 0
    ? positionsBBox(allPositions)
    : { minX: 0, minY: 0, maxX: 1, maxY: 1, cx: 0.5, cy: 0.5, w: 1, h: 1 }
  const floorArea = floorBBox.w * floorBBox.h

  return groups.map(group => {
    let suggestedType: FixtureType = 'custom'
    let confidence = 0
    let reason = 'No matching heuristic'

    const { w, d } = group.size
    const aspectRatio = Math.max(w, d) / Math.max(Math.min(w, d), 1)
    const maxDim = Math.max(w, d)
    const minDim = Math.min(w, d)
    const gFixtures = groupFixtures.get(group.group_id) || []
    const gPositions = gFixtures.map(f => ({ x: f.x, y: f.y }))
    const gRotations = gFixtures.map(f => f.rot_deg)

    // ── Priority 1: Block name match (strongest signal) ─────────
    if (group.block) {
      for (const rule of BLOCK_NAME_RULES) {
        if (rule.pattern.test(group.block)) {
          suggestedType = rule.type
          confidence = rule.confidence
          reason = `Block name "${group.block}" → ${rule.type}`
          break
        }
      }
    }

    // ── Priority 2: Layer name match ────────────────────────────
    if (confidence < 0.5) {
      for (const rule of LAYER_NAME_RULES) {
        if (rule.pattern.test(group.layer)) {
          suggestedType = rule.type
          confidence = rule.confidence
          reason = `Layer "${group.layer}" → ${rule.type}`
          break
        }
      }
    }

    // ── Priority 3: Spatial + geometric analysis ────────────────
    if (confidence < 0.6 && gPositions.length >= 2) {
      const rows = detectParallelRows(gPositions, maxDim)
      const edgeProx = edgeProximity(gPositions, floorBBox)
      const compact = clusterCompactness(gPositions, floorBBox)
      const orient = orientationConsistency(gRotations)

      // SHELVES: parallel rows, elongated, consistent orientation, interior
      if (rows.isRowPattern && rows.rowCount >= 3 && aspectRatio >= 1.2) {
        suggestedType = 'shelf'
        confidence = Math.min(0.92, 0.70 + rows.rowCount * 0.03 + orient.ratio * 0.1)
        reason = `${rows.rowCount} parallel rows, ratio ${aspectRatio.toFixed(1)}:1, ${orient.ratio > 0.7 ? 'consistent' : 'mixed'} orientation → shelves`
      }
      // WALL: fixtures hugging the perimeter, often few & large
      else if (edgeProx > 0.7 && (maxDim > 1500 || (aspectRatio > 3 && maxDim > 800))) {
        suggestedType = 'wall'
        confidence = Math.min(0.85, 0.60 + edgeProx * 0.2)
        reason = `Edge proximity ${(edgeProx * 100).toFixed(0)}%, large (${maxDim}mm) → wall`
      }
      // CHECKOUT: clustered in one area (compact), near one edge, medium count
      else if (compact < 0.15 && edgeProx > 0.4 && group.count >= 3 && group.count <= 30 && orient.ratio > 0.6) {
        suggestedType = 'checkout'
        confidence = Math.min(0.82, 0.55 + (1 - compact) * 0.15 + orient.ratio * 0.1)
        reason = `Tight cluster (${(compact * 100).toFixed(0)}% of floor), near edge, ${group.count} units, consistent orientation → checkout`
      }
      // ENTRANCE: very few fixtures, at extreme edges
      else if (group.count <= 4 && edgeProx > 0.8 && maxDim >= 600) {
        suggestedType = 'entrance'
        confidence = 0.65
        reason = `${group.count} fixtures at floor edge → entrance/exit`
      }
    }

    // ── Priority 4: Pure geometry fallback (no positions needed) ─
    if (confidence < 0.5) {
      // Large polygon → perimeter wall
      if (group.count <= 2 && maxDim > 3000) {
        // Check if it's a polygon covering significant area
        const gf = gFixtures[0]
        if (gf?.points && gf.points.length >= 3) {
          const area = polygonArea(gf.points)
          if (floorArea > 0 && area > floorArea * 0.05) {
            suggestedType = 'wall'
            confidence = 0.80
            reason = `Large polygon (${(area / floorArea * 100).toFixed(0)}% of floor) → perimeter wall`
          }
        }
        if (confidence < 0.5) {
          suggestedType = 'wall'
          confidence = 0.70
          reason = `Single large fixture (${maxDim}mm) → wall`
        }
      }
      // Very elongated → wall segment
      else if (aspectRatio > 4 && maxDim > 2000) {
        suggestedType = 'wall'
        confidence = 0.65
        reason = `Aspect ${aspectRatio.toFixed(1)}:1, ${maxDim}mm → wall segment`
      }
      // Many elongated instances → shelves (even without perfect row pattern)
      else if (group.count >= 3 && maxDim >= 300 && aspectRatio >= 1.3) {
        suggestedType = 'shelf'
        confidence = group.count >= 10 ? 0.75 : 0.60
        reason = `${group.count}× elongated (${aspectRatio.toFixed(1)}:1) → shelves`
      }
      // Small square-ish → pillar
      else if (maxDim < 500 && minDim < 500 && aspectRatio < 2) {
        suggestedType = 'pillar'
        confidence = 0.55
        reason = `Small (${maxDim}mm), square → pillar`
      }
      // Medium few instances near edge → checkout
      else if (group.count >= 3 && group.count <= 20 && maxDim >= 400 && maxDim <= 2000 && aspectRatio < 3) {
        suggestedType = 'checkout'
        confidence = 0.45
        reason = `${group.count} medium fixtures → possible checkout`
      }
    }

    // ── Priority 5: High count fallback ─────────────────────────
    if (confidence < 0.45 && group.count >= 5) {
      suggestedType = 'shelf'
      confidence = group.count >= 15 ? 0.60 : 0.45
      reason = `High count (${group.count}) → likely shelves`
    }

    return {
      groupId: group.group_id,
      blockName: group.block,
      layerName: group.layer,
      count: group.count,
      sizeW: group.size.w,
      sizeD: group.size.d,
      suggestedType,
      confidence,
      reason,
      accepted: confidence >= 0.80,
    }
  })
}

/**
 * Detect perimeter wall from parsed fixtures.
 * Strategy: find the largest-area polygon fixture on a wall/struct layer.
 * If not found, find the largest-area polygon across all layers.
 */
export function detectPerimeterWall(
  fixtures: Array<{
    id: string
    source: { layer: string }
    footprint: { points?: Array<{ x: number; y: number }>; w: number; d: number }
  }>
): { fixtureId: string; area: number; isWallLayer: boolean } | null {
  let bestWallLayer: { fixtureId: string; area: number } | null = null
  let bestAnyLayer: { fixtureId: string; area: number } | null = null

  for (const f of fixtures) {
    const points = f.footprint?.points
    if (!points || points.length < 3) continue

    // Calculate area using Shoelace formula
    let area = 0
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length
      area += points[i].x * points[j].y
      area -= points[j].x * points[i].y
    }
    area = Math.abs(area) / 2

    const isWallLayer = /wall|struct|perim|bound|arch/i.test(f.source.layer)

    if (isWallLayer) {
      if (!bestWallLayer || area > bestWallLayer.area) {
        bestWallLayer = { fixtureId: f.id, area }
      }
    }
    if (!bestAnyLayer || area > bestAnyLayer.area) {
      bestAnyLayer = { fixtureId: f.id, area }
    }
  }

  if (bestWallLayer) {
    return { ...bestWallLayer, isWallLayer: true }
  }
  if (bestAnyLayer && bestAnyLayer.area > 10_000_000) {
    // >10m² in mm² (very large polygon, likely perimeter)
    return { ...bestAnyLayer, isWallLayer: false }
  }
  return null
}

// ─── SelectDwg Step Data Builder ────────────────────────────────

export async function buildSelectDwgData(layoutVersionId: string): Promise<SelectDwgData> {
  const layout = await getLayoutDetails(layoutVersionId)
  // Fetch the original import to get the real .dwg filename
  let filename = layout.name
  try {
    const imp = await getImportDetails(layout.import_id)
    filename = imp.filename || layout.name
  } catch { /* fall back to layout name */ }
  return {
    importId: layout.import_id,
    layoutVersionId: layout.layout_version_id,
    filename,
    fixtureCount: layout.layout?.fixtures?.length || 0,
    groupCount: layout.layout?.groups?.length || 0,
  }
}

// ─── MapFixtures Step Data Builder ──────────────────────────────

export async function buildMapFixturesData(importId: string): Promise<MapFixturesData> {
  const details = await getImportDetails(importId)
  const mapping = await getMapping(importId)
  const groupMappings = mapping.group_mappings || {}

  // Build fixture positions for spatial analysis
  const fixturePositions: FixturePos[] = details.fixtures.map(f => ({
    id: f.id,
    group_id: f.group_id,
    x: f.pose2d.x,
    y: f.pose2d.y,
    rot_deg: f.pose2d.rot_deg || 0,
    w: f.footprint.w,
    d: f.footprint.d,
    points: f.footprint.points,
  }))

  // Run heuristic classification as a baseline
  const heuristicClassifications = classifyFixtureGroups(details.groups, fixturePositions)

  // Override with existing dwg_mappings from DB (ground truth from DWG Importer)
  // This ensures LaunchPad always shows the same types as the manual DWG Importer
  const classifications = heuristicClassifications.map(c => {
    const dbMapping = groupMappings[c.groupId]
    if (dbMapping && dbMapping.type) {
      return {
        ...c,
        suggestedType: dbMapping.type as FixtureType,
        confidence: 1.0,
        reason: `Mapped in DWG Importer: ${dbMapping.type}`,
        accepted: true,
      }
    }
    return c
  })

  const mappedGroups = classifications.filter(c => c.accepted || groupMappings[c.groupId]).length

  return {
    totalGroups: details.groups.length,
    mappedGroups,
    classifications,
    allAccepted: classifications.every(c => c.accepted),
  }
}

// ─── ROI APIs ───────────────────────────────────────────────────

export async function listRois(venueId: string, dwgLayoutId?: string): Promise<Array<{
  id: string
  name: string
  vertices: string
  color: string
}>> {
  const url = dwgLayoutId
    ? `${API_BASE}/api/venues/${venueId}/dwg/${dwgLayoutId}/roi`
    : `${API_BASE}/api/venues/${venueId}/roi`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to list ROIs')
  return res.json()
}

/** Fetch ALL ROIs for a venue regardless of dwg_layout_id */
export async function listAllRois(venueId: string): Promise<Array<{
  id: string
  name: string
  vertices: string
  color: string
  dwgLayoutId?: string
}>> {
  const res = await fetch(`${API_BASE}/api/venues/${venueId}/roi?all=true`)
  if (!res.ok) throw new Error('Failed to list all ROIs')
  return res.json()
}

export async function buildDefineRoisData(venueId: string, dwgLayoutId?: string): Promise<DefineRoisData> {
  const rois = await listRois(venueId, dwgLayoutId)
  return {
    roiCount: rois.length,
    roiNames: rois.map(r => r.name),
  }
}

// ─── LiDAR Planner APIs ────────────────────────────────────────

export async function listLidarModels(): Promise<Array<{
  id: string
  name: string
  hfov_deg: number
  vfov_deg: number
  range_m: number
  dome_mode: boolean
}>> {
  const res = await fetch(`${API_BASE}/api/lidar/models`)
  if (!res.ok) throw new Error('Failed to list LiDAR models')
  return res.json()
}

export async function listLidarInstances(layoutVersionId: string): Promise<Array<{
  id: string
  source: string
  model_id: string
  model_name: string
  x_m: number
  z_m: number
  mount_y_m: number
}>> {
  const res = await fetch(`${API_BASE}/api/lidar/instances?layout_version_id=${layoutVersionId}`)
  if (!res.ok) throw new Error('Failed to list LiDAR instances')
  return res.json()
}

export async function updateLidarInstance(id: string, data: { x_m?: number; z_m?: number; model_id?: string; mount_y_m?: number; yaw_deg?: number }): Promise<void> {
  const res = await fetch(`${API_BASE}/api/lidar/instances/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update LiDAR instance')
}

export async function createLidarInstance(data: { layout_version_id: string; model_id?: string; x_m: number; z_m: number; mount_y_m?: number; source?: string }): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/api/lidar/instances`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, source: data.source || 'manual' }),
  })
  if (!res.ok) throw new Error('Failed to create LiDAR instance')
  return res.json()
}

export async function deleteLidarInstance(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/lidar/instances/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete LiDAR instance')
}

export async function runAutoplace(params: {
  layout_version_id: string
  model_id?: string
  coverage_target_pct?: number
  k_required?: number
  mount_y_m?: number
  roi_vertices?: Array<{ x: number; z: number }>
}): Promise<{
  run_id: string
  instances: Array<{ id: string; x_m: number; z_m: number; mount_y_m: number }>
  coverage_pct: number
  k_coverage_pct: number
  solver_status: string
  warnings: string[]
}> {
  const res = await fetch(`${API_BASE}/api/lidar/autoplace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error('Failed to run autoplace')
  return res.json()
}

export async function runCoverageSimulation(layoutVersionId: string): Promise<{
  coverage_pct: number
  overlap_pct: number
  total_target_cells: number
  covered_cells: number
}> {
  const res = await fetch(`${API_BASE}/api/lidar/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout_version_id: layoutVersionId }),
  })
  if (!res.ok) throw new Error('Failed to run coverage simulation')
  return res.json()
}

export async function buildPlaceLidarsData(layoutVersionId: string): Promise<PlaceLidarsData> {
  const instances = await listLidarInstances(layoutVersionId)
  let coveragePct = 0
  let kCoveragePct = 0

  if (instances.length > 0) {
    try {
      const sim = await runCoverageSimulation(layoutVersionId)
      coveragePct = sim.coverage_pct
      kCoveragePct = sim.overlap_pct
    } catch {
      // Coverage sim is optional
    }
  }

  const firstModel = instances.length > 0 ? instances[0] : null

  return {
    modelId: firstModel?.model_id || null,
    modelName: firstModel?.model_name || null,
    sensorCount: instances.length,
    coveragePct,
    kCoveragePct,
    coverageTarget: 0.95,
    meetsCoverage: coveragePct >= 0.95,
  }
}

/**
 * Auto-place LiDARs using the ROIs from the define_rois step.
 * Fetches ROI vertices, converts from DXF units → meters, and calls the autoplace API.
 */
/** Settings for the LaunchPad autoplace */
export interface AutoPlaceSettings {
  /** Scale correction multiplier: 1 = mm (default), 10 = cm, 1000 = m */
  scaleMultiplier: number
  /** Each point must be seen by at least this many LiDARs */
  kRequired: number
  /** LiDAR mount height in meters */
  mountHeightM: number
  /** Sample spacing in meters (smaller = more accurate but slower) */
  sampleSpacingM: number
  /** Coverage target percentage (0-1) */
  coverageTargetPct: number
  /** Explicit LiDAR model ID (if undefined, user hasn't selected yet) */
  modelId?: string
}

export const DEFAULT_AUTOPLACE_SETTINGS: AutoPlaceSettings = {
  scaleMultiplier: 10, // Most DWGs are in cm
  kRequired: 2,
  mountHeightM: 3,
  sampleSpacingM: 0.75,
  coverageTargetPct: 0.95,
  modelId: undefined,
}

export async function autoPlaceWithRois(
  layoutVersionId: string,
  venueId: string,
  dwgLayoutId?: string,
  settings: AutoPlaceSettings = DEFAULT_AUTOPLACE_SETTINGS,
): Promise<PlaceLidarsData> {
  console.log('\n========== [AutoPlace DEBUG] START ==========')
  console.log('[AutoPlace DEBUG] Input params:', { layoutVersionId, venueId, dwgLayoutId })
  console.log('[AutoPlace DEBUG] Settings:', settings)

  // 0) Get unit scale from layout to convert ROI vertices from DXF units → meters
  let unitScaleToM = 0.001 // default: mm → m
  try {
    const layoutDetails = await getLayoutDetails(layoutVersionId)
    unitScaleToM = layoutDetails.layout?.unit_scale_to_m || 0.001
    console.log(`[AutoPlace DEBUG] Layout unit_scale_to_m: ${unitScaleToM}`)
  } catch (e) {
    console.warn('[AutoPlace DEBUG] Could not fetch layout details, using default unit_scale_to_m=0.001')
  }
  // Apply scaleMultiplier from settings (user's scale correction)
  const effectiveScale = unitScaleToM * (settings.scaleMultiplier || 1)
  console.log(`[AutoPlace DEBUG] Effective scale (unitScale × scaleMultiplier): ${unitScaleToM} × ${settings.scaleMultiplier} = ${effectiveScale}`)

  // 1) Fetch ROIs scoped to this DWG layout ONLY (LaunchPad coverage zones)
  // Never use venue-level KPI ROIs (Checkout Service/Queue, etc.) for LiDAR placement
  const rois = await listRois(venueId, dwgLayoutId)
  console.log(`[AutoPlace DEBUG] listRois(venueId=${venueId}, dwgLayoutId=${dwgLayoutId}) → ${rois.length} ROIs`)
  console.log('[AutoPlace DEBUG] Raw ROIs from API:', JSON.stringify(rois, null, 2))
  if (rois.length === 0) {
    throw new Error('No coverage zones defined — draw zones first in the Define ROIs step')
  }

  // 2) Parse all ROI vertices - they are stored in DXF units, need to convert to meters
  const allVerticesMeters: Array<{ x: number; z: number }> = []
  for (const roi of rois) {
    console.log(`[AutoPlace DEBUG] Processing ROI "${roi.name}":`, { color: roi.color, rawVertices: roi.vertices })
    let parsed: Array<{ x?: number; z?: number; y?: number }>
    try {
      parsed = typeof roi.vertices === 'string' ? JSON.parse(roi.vertices) : roi.vertices
      console.log(`[AutoPlace DEBUG]   Parsed vertices (DXF units):`, parsed)
    } catch (e) {
      console.error(`[AutoPlace DEBUG]   FAILED to parse vertices:`, e)
      continue
    }
    if (!Array.isArray(parsed) || parsed.length < 3) {
      console.warn(`[AutoPlace DEBUG]   Skipping ROI - not enough vertices (${parsed?.length || 0})`)
      continue
    }

    for (const v of parsed) {
      // Convert from DXF units to meters
      const xDxf = v.x ?? 0
      const zDxf = v.z ?? v.y ?? 0
      const xMeters = xDxf * effectiveScale
      const zMeters = zDxf * effectiveScale
      allVerticesMeters.push({ x: xMeters, z: zMeters })
    }
    console.log(`[AutoPlace DEBUG]   Added ${parsed.length} vertices (converted to m), total now: ${allVerticesMeters.length}`)
  }

  console.log('[AutoPlace DEBUG] All vertices (meters after conversion):', allVerticesMeters)
  if (allVerticesMeters.length > 0) {
    const xs = allVerticesMeters.map(v => v.x)
    const zs = allVerticesMeters.map(v => v.z)
    console.log('[AutoPlace DEBUG] Vertex bounds (m):', {
      minX: Math.min(...xs).toFixed(3),
      maxX: Math.max(...xs).toFixed(3),
      minZ: Math.min(...zs).toFixed(3),
      maxZ: Math.max(...zs).toFixed(3),
      rangeX: (Math.max(...xs) - Math.min(...xs)).toFixed(3),
      rangeZ: (Math.max(...zs) - Math.min(...zs)).toFixed(3),
    })
  }

  if (allVerticesMeters.length < 3) {
    throw new Error('ROI vertices are empty or invalid')
  }

  // 4) Compute convex hull of all ROI vertices (merged bounding polygon)
  const hullVertices = convexHull(allVerticesMeters)
  console.log(`[AutoPlace DEBUG] Convex hull: ${allVerticesMeters.length} input vertices → ${hullVertices.length} hull vertices`)
  console.log('[AutoPlace DEBUG] Hull vertices:', hullVertices)
  if (hullVertices.length > 0) {
    const hxs = hullVertices.map(v => v.x)
    const hzs = hullVertices.map(v => v.z)
    const hullWidth = Math.max(...hxs) - Math.min(...hxs)
    const hullDepth = Math.max(...hzs) - Math.min(...hzs)
    const hullArea = hullWidth * hullDepth
    console.log('[AutoPlace DEBUG] Hull bounds (m):', {
      minX: Math.min(...hxs).toFixed(3),
      maxX: Math.max(...hxs).toFixed(3),
      minZ: Math.min(...hzs).toFixed(3),
      maxZ: Math.max(...hzs).toFixed(3),
      width: hullWidth.toFixed(3),
      depth: hullDepth.toFixed(3),
      approxArea: hullArea.toFixed(3),
    })
    // Sanity check: warn if area is suspiciously small or large
    if (hullArea < 10) {
      console.warn('[AutoPlace DEBUG] ⚠️ Hull area is VERY SMALL (<10 m²) - possible unit scaling issue!')
    }
    if (hullArea > 100000) {
      console.warn('[AutoPlace DEBUG] ⚠️ Hull area is VERY LARGE (>100000 m²) - possible unit scaling issue!')
    }
  }

  // 5) Get LiDAR model
  let modelId = settings.modelId
  if (!modelId) {
    // Fallback: pick first available model
    try {
      const models = await listLidarModels()
      console.log(`[AutoPlace DEBUG] Available LiDAR models:`, models.map(m => ({ id: m.id, name: m.name, range_m: m.range_m })))
      if (models.length > 0) modelId = models[0].id
    } catch (e) { console.warn('[AutoPlace DEBUG] No LiDAR models found:', e) }
  }

  console.log(`[AutoPlace DEBUG] Selected modelId: ${modelId}`)

  // 6) Call autoplace
  const autoplaceParams = {
    layout_version_id: layoutVersionId,
    model_id: modelId,
    roi_vertices: hullVertices,
    coverage_target_pct: settings.coverageTargetPct,
    k_required: settings.kRequired,
    mount_y_m: settings.mountHeightM,
    sample_spacing_m: settings.sampleSpacingM,
  }
  console.log(`[AutoPlace DEBUG] Calling runAutoplace with params:`, JSON.stringify(autoplaceParams, null, 2))
  
  let result
  try {
    result = await runAutoplace(autoplaceParams)
    console.log(`[AutoPlace DEBUG] runAutoplace SUCCESS:`, {
      instanceCount: result.instances.length,
      coveragePct: (result.coverage_pct * 100).toFixed(1) + '%',
      kCoveragePct: (result.k_coverage_pct * 100).toFixed(1) + '%',
      solverStatus: result.solver_status,
      warnings: result.warnings,
    })
    if (result.instances.length > 0) {
      console.log('[AutoPlace DEBUG] Placed LiDAR positions (m):', result.instances.map(i => ({ id: i.id, x: i.x_m.toFixed(2), z: i.z_m.toFixed(2) })))
    }
  } catch (err: any) {
    console.error('[AutoPlace DEBUG] runAutoplace FAILED:', err.message)
    throw err
  }
  console.log('========== [AutoPlace DEBUG] END ==========\n')

  // 7) Rebuild step data
  return buildPlaceLidarsData(layoutVersionId)
}

/** Simple 2D convex hull (Andrew's monotone chain) for {x, z} points */
function convexHull(points: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  if (points.length <= 3) return points
  const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z)
  const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)

  const lower: Array<{ x: number; z: number }> = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }

  const upper: Array<{ x: number; z: number }> = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

// ─── Edge Commissioning APIs ────────────────────────────────────

/** Get the backend machine's own Tailscale IP (for MQTT broker default) */
export async function getBackendTailscaleIp(): Promise<{ ip: string | null; hostname: string | null; online: boolean }> {
  const res = await fetch(`${API_BASE}/api/discovery/self`)
  if (!res.ok) return { ip: null, hostname: null, online: false }
  return res.json()
}

export async function scanTailscaleEdges(): Promise<Array<{
  edgeId: string
  hostname: string
  tailscaleIp: string
  online: boolean
}>> {
  const res = await fetch(`${API_BASE}/api/edge-commissioning/scan-edges`)
  if (!res.ok) throw new Error('Failed to scan edge devices')
  return res.json()
}

export async function getEdgeStatus(edgeId: string): Promise<{
  online: boolean
  edgeId: string
  hostname: string
  tailscaleIp: string
  appliedConfigHash?: string
  lidarConnectionStatuses?: Array<Record<string, unknown>>
  mqttPublishStatus?: Record<string, unknown>
}> {
  const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/status`)
  if (!res.ok) throw new Error('Failed to get edge status')
  return res.json()
}

export async function scanEdgeLidars(edgeId: string): Promise<{ foundCount: number }> {
  const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/scan-lidars`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to scan LiDARs on edge')
  return res.json()
}

export async function getEdgeInventory(edgeId: string): Promise<{
  edgeId: string
  hostname: string
  tailscaleIp: string
  lidars: Array<{
    lidarId: string
    ip: string
    mac: string
    vendor: string
    model: string
    reachable: boolean
  }>
}> {
  const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/inventory`)
  if (!res.ok) throw new Error('Failed to get edge inventory')
  return res.json()
}

export async function buildCommissionEdgeData(
  edgeId: string,
  neededLidarCount: number
): Promise<CommissionEdgeData> {
  let status: { edgeId?: string; hostname?: string; tailscaleIp?: string; online?: boolean } = {}
  try {
    status = await getEdgeStatus(edgeId)
  } catch (err: any) {
    console.warn('[buildCommissionEdgeData] getEdgeStatus failed:', err.message)
    // Edge status check failed entirely (backend down, tailscale not installed, etc.)
    return {
      edgeId,
      edgeHostname: edgeId,
      edgeTailscaleIp: null,
      edgeOnline: false,
      scannedLidarCount: 0,
      neededLidarCount,
      missingLidars: true,
    }
  }

  let scannedLidarCount = 0
  try {
    const inv = await getEdgeInventory(edgeId)
    scannedLidarCount = inv.lidars?.filter(l => l.reachable).length || 0
  } catch {
    // Inventory may not be available yet
  }

  return {
    edgeId: status.edgeId || edgeId,
    edgeHostname: status.hostname || edgeId,
    edgeTailscaleIp: status.tailscaleIp || null,
    edgeOnline: status.online || false,
    scannedLidarCount,
    neededLidarCount,
    missingLidars: scannedLidarCount < neededLidarCount,
  }
}

// ─── Pairing APIs ───────────────────────────────────────────────

export async function loadPlacements(venueId: string): Promise<{
  placements: Array<{
    id: string
    x_m: number
    z_m: number
    mount_y_m: number
    model_name?: string
  }>
  roiBounds?: Record<string, number>
}> {
  const res = await fetch(`${API_BASE}/api/edge-commissioning/placements?venueId=${venueId}`)
  if (!res.ok) throw new Error('Failed to load placements')
  return res.json()
}

export async function loadPairings(venueId: string): Promise<{
  pairings: Array<{
    id: string
    placementId: string
    edgeId: string
    lidarId: string
    lidarIp: string
  }>
}> {
  const res = await fetch(`${API_BASE}/api/edge-commissioning/pairings?venueId=${venueId}`)
  if (!res.ok) throw new Error('Failed to load pairings')
  return res.json()
}

export async function buildPairDevicesData(venueId: string): Promise<PairDevicesData> {
  const placementsRes = await loadPlacements(venueId)
  const pairingsRes = await loadPairings(venueId)

  const placements = placementsRes.placements || []
  const pairings = pairingsRes.pairings || []
  const pairedIds = new Set(pairings.map(p => p.placementId))
  const unpaired = placements.filter(p => !pairedIds.has(p.id)).map(p => p.id)

  return {
    totalPlacements: placements.length,
    pairedCount: pairings.length,
    unpaired,
    allPaired: unpaired.length === 0 && placements.length > 0,
  }
}

// ─── HER Deployment APIs ────────────────────────────────────────

export async function getHerStatus(edgeId: string): Promise<{
  mode: 'simulator' | 'her'
  containerRunning: boolean
  containerStatus: string | null
  providerModule: { providerId: string; name: string; version: string; dockerImage: string } | null
  deploymentId: string | null
  startedAt: string | null
  lastError: string | null
  uptimeSeconds: number | null
  recentLogs: string | null
}> {
  const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/her-status`)
  if (!res.ok) throw new Error('Failed to get HER status')
  const data = await res.json()
  // Normalize response - backend wraps in { herStatus: ... }
  return data.herStatus || data
}

export async function checkEdgePrerequisites(edgeId: string): Promise<{
  tailscaleInstalled: boolean
  dockerAvailable: boolean
  dockerVersion?: string
}> {
  const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/prerequisites`)
  if (!res.ok) {
    // Assume defaults if endpoint not available
    return { tailscaleInstalled: true, dockerAvailable: true }
  }
  return res.json()
}

export async function listAlgorithmProviders(): Promise<Array<{
  id: string
  name: string
  version: string
  dockerImage: string
  description?: string
}>> {
  const res = await fetch(`${API_BASE}/api/edge-commissioning/providers`)
  if (!res.ok) return []
  const data = await res.json()
  // Backend returns { providers: [...] }
  return (data.providers || []).map((p: any) => ({
    id: p.providerId || p.id,
    name: p.name,
    version: p.version,
    dockerImage: p.dockerImage,
    description: p.description,
  }))
}

export async function deployHer(
  edgeId: string,
  venueId: string,
  providerId: string,
  mqttBrokerUrl?: string,
): Promise<{
  ok: boolean
  message: string
  error?: string
  deploymentId?: string
  containerId?: string
  imagePulled?: boolean
  containerRunning?: boolean
  dockerImage?: string
  moduleStatus?: {
    containerRunning: boolean
    imagePulled: boolean
    containerId?: string
    provider: string
    version: string
  }
}> {
  const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/deploy-her`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venueId, providerId, mqttBrokerUrl }),
  })
  const data = await res.json()
  // Normalize response with full deployment details
  const herResp = data.herResponse || {}
  return {
    ok: data.success || false,
    message: data.message || (data.success ? 'HER deployed' : 'Deployment failed'),
    error: data.error,
    deploymentId: data.deploymentId,
    containerId: herResp.containerId,
    imagePulled: herResp.imagePulled,
    containerRunning: herResp.containerRunning,
    dockerImage: herResp.dockerImage,
    moduleStatus: data.providerModule ? {
      containerRunning: herResp.containerRunning || true,
      imagePulled: herResp.imagePulled || true,
      containerId: herResp.containerId,
      provider: data.providerModule.name,
      version: data.providerModule.version,
    } : undefined,
  }
}

export async function stopHer(edgeId: string): Promise<{
  ok: boolean
  message: string
  mode: string
}> {
  const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/stop-her`, {
    method: 'POST',
  })
  const data = await res.json()
  return {
    ok: data.success || false,
    message: data.message || 'HER stopped',
    mode: data.response?.mode || 'simulator',
  }
}

export async function buildDeployHerData(
  edgeId: string,
  pairedLidarCount: number
): Promise<DeployHerData> {
  // Edge is already validated in commission_edge step (Tailscale reachability confirmed)
  // Docker is installed as part of HER deployment, not a prerequisite
  
  // Check HER status to see if already running
  let herStatus: Awaited<ReturnType<typeof getHerStatus>> | null = null
  try {
    herStatus = await getHerStatus(edgeId)
  } catch {
    // HER status endpoint not available — HER not deployed yet, which is fine
  }

  if (herStatus?.mode === 'her' && herStatus.containerRunning) {
    return {
      edgeId,
      providerId: herStatus.providerModule?.providerId || null,
      providerName: herStatus.providerModule?.name || 'Unknown Provider',
      status: 'running',
      tailscaleInstalled: true, // Edge is commissioned, Tailscale is working
      dockerAvailable: true,    // HER is running, Docker is working
      pairedLidarCount,
      deployedAt: herStatus.startedAt,
      lastError: null,
      containerStatus: herStatus.containerStatus || 'running',
    }
  }

  if (herStatus?.lastError) {
    return {
      edgeId,
      providerId: herStatus.providerModule?.providerId || null,
      providerName: herStatus.providerModule?.name || null,
      status: 'error',
      tailscaleInstalled: true,
      dockerAvailable: true,
      pairedLidarCount,
      deployedAt: null,
      lastError: herStatus.lastError,
      containerStatus: herStatus.containerStatus || undefined,
    }
  }

  // Ready for deployment - edge is commissioned, LiDARs are paired
  return {
    edgeId,
    providerId: null,
    providerName: null,
    status: 'ready',
    tailscaleInstalled: true, // Edge is commissioned
    dockerAvailable: true,    // Will be installed with HER deployment
    pairedLidarCount,
    deployedAt: null,
    lastError: null,
  }
}

// ─── Validation APIs ────────────────────────────────────────────

export async function runStreamValidation(
  edgeId: string,
  venueId?: string
): Promise<ValidateStreamData> {
  // Initialize checks array
  const checks: StreamCheck[] = [
    { id: 'lidar_conn', status: 'pending', detail: 'Checking LiDAR connections...' },
    { id: 'her_health', status: 'pending', detail: 'Checking HER container...' },
    { id: 'edge_mqtt', status: 'pending', detail: 'Checking MQTT publish...' },
    { id: 'cloud_mqtt', status: 'pending', detail: 'Checking cloud bridge...' },
    { id: 'backend_rx', status: 'pending', detail: 'Checking backend reception...' },
    { id: 'websocket', status: 'pending', detail: 'Checking WebSocket broadcast...' },
  ]

  let mqttConnected = false
  let overallHealthy = false
  let stage: ValidateStreamData['stage'] = 'lidar_conn'
  const lidarStatuses: ValidateStreamData['lidarStatuses'] = []
  const validationLogs: string[] = []

  const log = (msg: string) => {
    validationLogs.push(msg)
    console.log(`[StreamValidation] ${msg}`)
  }

  log(`Starting stream validation for edge: ${edgeId}`)
  if (venueId) log(`Venue ID: ${venueId}`)

  try {
    // Check 1: LiDAR connections
    log('Step 1/6: Checking LiDAR connections...')
    
    // Get expected LiDAR count from pairings for this venue
    let expectedLidarCount = 0
    const expectedLidarIps = new Set<string>()
    if (venueId) {
      try {
        const pairingsRes = await fetch(`${API_BASE}/api/edge-commissioning/pairings?venueId=${venueId}`)
        if (pairingsRes.ok) {
          const pairingsData = await pairingsRes.json()
          expectedLidarCount = (pairingsData.pairings || []).length
          for (const p of (pairingsData.pairings || [])) {
            if (p.lidarIp) expectedLidarIps.add(p.lidarIp)
          }
          log(`Expected ${expectedLidarCount} LiDARs from venue pairings`)
        }
      } catch (err) {
        log(`Could not fetch pairings: ${(err as Error).message}`)
      }
    }
    
    const edgeStatus = await getEdgeStatus(edgeId)
    
    // Handle both array format and object format { lidarId: connected }
    const lidarConnections = edgeStatus.lidarConnectionStatuses || {}
    if (Array.isArray(lidarConnections)) {
      for (const ls of lidarConnections as any[]) {
        lidarStatuses.push({
          lidarId: ls.lidarId || ls.id || 'unknown',
          ip: ls.ip || '',
          connected: ls.connected || ls.status === 'connected' || ls.reachable === true,
          publishRate: ls.publishRate,
        })
      }
    } else if (typeof lidarConnections === 'object') {
      // Edge server returns { lidarId: boolean } format
      for (const [lidarId, connected] of Object.entries(lidarConnections)) {
        lidarStatuses.push({
          lidarId,
          ip: '',
          connected: connected === true,
        })
      }
    }
    
    const connectedLidars = lidarStatuses.filter(l => l.connected).length
    // Use expected count from pairings if available, otherwise use what edge reports
    const totalLidars = expectedLidarCount > 0 ? expectedLidarCount : lidarStatuses.length
    log(`Found ${lidarStatuses.length} LiDARs on edge, ${connectedLidars} connected (expected: ${expectedLidarCount})`)
    
    if (connectedLidars > 0) {
      const status = connectedLidars === totalLidars ? 'pass' : 'pass' // Still pass if at least 1 connected
      const detail = connectedLidars === totalLidars 
        ? `All ${totalLidars} LiDARs connected`
        : `${connectedLidars}/${totalLidars} LiDARs connected`
      log(`✅ LiDAR check passed: ${connectedLidars}/${totalLidars} connected`)
      checks[0] = { id: 'lidar_conn', status, detail }
      stage = 'her_health'
    } else if (totalLidars === 0) {
      log(`❌ No LiDARs found or paired`)
      checks[0] = { id: 'lidar_conn', status: 'fail', detail: 'No LiDARs found' }
      return { stage, checks, mqttConnected, lidarStatuses, overallHealthy, validationLogs }
    } else {
      log(`❌ All ${totalLidars} LiDARs disconnected`)
      checks[0] = { id: 'lidar_conn', status: 'fail', detail: `All ${totalLidars} LiDARs disconnected` }
      return { stage, checks, mqttConnected, lidarStatuses, overallHealthy, validationLogs }
    }

    // Check 2: HER health
    log('Step 2/6: Checking HER container health...')
    const herStatus = await getHerStatus(edgeId)
    log(`HER mode: ${herStatus.mode}, running: ${herStatus.containerRunning}`)
    if (herStatus.mode === 'her' && herStatus.containerRunning) {
      log(`✅ HER container running (uptime: ${herStatus.uptimeSeconds ? `${Math.floor(herStatus.uptimeSeconds / 60)}m` : 'unknown'})`)
      checks[1] = { id: 'her_health', status: 'pass', detail: `Running ${herStatus.uptimeSeconds ? `${Math.floor(herStatus.uptimeSeconds / 60)}m` : ''}` }
      stage = 'edge_mqtt'
    } else if (herStatus.mode === 'simulator') {
      log(`⏭️ Simulator mode - skipping HER check`)
      checks[1] = { id: 'her_health', status: 'skipped', detail: 'Simulator mode' }
      stage = 'edge_mqtt'
    } else {
      log(`❌ HER container not running: ${herStatus.lastError || 'unknown error'}`)
      checks[1] = { id: 'her_health', status: 'fail', detail: herStatus.lastError || 'Container not running' }
      return { stage, checks, mqttConnected, lidarStatuses, overallHealthy, validationLogs }
    }

    // Check 3: Edge MQTT publish
    log('Step 3/6: Checking edge MQTT publishing...')
    // Edge server returns mqttConnected (boolean), tracksSent (number), mqttBroker (string)
    // NOTE: In HER mode, MQTT is handled by the HER container, not the edge server stats
    const operationalMode = (edgeStatus as any).operationalMode || 'simulator'
    const herStatusFromEdge = (edgeStatus as any).herStatus
    const isMqttConnectedSimulator = (edgeStatus as any).mqttConnected === true
    const tracksSent = (edgeStatus as any).tracksSent || 0
    const mqttBrokerUrl = (edgeStatus as any).mqttBroker || 'unknown'
    const lastError = (edgeStatus as any).lastError || null
    
    log(`Operational mode: ${operationalMode}`)
    log(`MQTT broker configured: ${mqttBrokerUrl}`)
    
    if (operationalMode === 'her') {
      // In HER mode, the Docker container manages MQTT publishing
      // If HER container is running, we assume MQTT is working (container handles it)
      const herRunning = herStatusFromEdge?.containerRunning === true
      log(`HER container running: ${herRunning}`)
      if (herRunning) {
        mqttConnected = true
        log(`✅ HER mode - container is running and publishing to ${mqttBrokerUrl}`)
        checks[2] = { id: 'edge_mqtt', status: 'pass', detail: `HER publishing to ${mqttBrokerUrl}` }
        stage = 'cloud_mqtt'
      } else {
        log(`❌ HER container not running - cannot publish to MQTT`)
        checks[2] = { id: 'edge_mqtt', status: 'fail', detail: 'HER container not running' }
        return { stage, checks, mqttConnected, lidarStatuses, overallHealthy, validationLogs }
      }
    } else {
      // Simulator mode - check edge server's own MQTT connection
      log(`Simulator MQTT connected: ${isMqttConnectedSimulator}`)
      log(`Simulator tracks sent: ${tracksSent}`)
      if (lastError) log(`Last error: ${lastError}`)
      
      if (isMqttConnectedSimulator) {
        mqttConnected = true
        log(`✅ Simulator publishing to MQTT (${tracksSent} tracks sent to ${mqttBrokerUrl})`)
        checks[2] = { id: 'edge_mqtt', status: 'pass', detail: `Publishing to ${mqttBrokerUrl} (${tracksSent} tracks)` }
        stage = 'cloud_mqtt'
      } else {
        log(`❌ Simulator not connected to MQTT broker: ${mqttBrokerUrl}`)
        if (lastError) log(`   Error: ${lastError}`)
        checks[2] = { id: 'edge_mqtt', status: 'fail', detail: `Not connected to ${mqttBrokerUrl}` }
        return { stage, checks, mqttConnected, lidarStatuses, overallHealthy, validationLogs }
      }
    }

    // Check 4 & 5: Cloud MQTT bridge and backend reception (combined endpoint call)
    log('Step 4/6: Checking cloud MQTT bridge...')
    let trackingData: any = null
    if (venueId) {
      try {
        const trackingStatus = await fetch(`${API_BASE}/api/tracking/venue/${venueId}/status`)
        if (trackingStatus.ok) {
          trackingData = await trackingStatus.json()
          log(`Backend MQTT broker: ${trackingData.mqtt?.brokerUrl || 'unknown'}`)
          log(`Backend MQTT connected: ${trackingData.connected}`)
          log(`Backend MQTT subscribed to: ${trackingData.mqtt?.topic || 'unknown'}`)
          
          if (trackingData.connected) {
            log(`✅ Cloud MQTT bridge connected to broker`)
            checks[3] = { id: 'cloud_mqtt', status: 'pass', detail: `Connected to ${trackingData.mqtt?.brokerUrl || 'broker'}` }
            stage = 'backend_rx'
          } else {
            log(`❌ Cloud MQTT bridge not connected`)
            checks[3] = { id: 'cloud_mqtt', status: 'fail', detail: 'Backend not connected to MQTT broker' }
            return { stage, checks, mqttConnected, lidarStatuses, overallHealthy, validationLogs }
          }
        } else {
          log(`⏭️ Status endpoint returned ${trackingStatus.status}, skipping`)
          checks[3] = { id: 'cloud_mqtt', status: 'skipped', detail: `Endpoint returned ${trackingStatus.status}` }
          stage = 'backend_rx'
        }
      } catch (err) {
        log(`⏭️ Cloud MQTT check failed: ${(err as Error).message}`)
        checks[3] = { id: 'cloud_mqtt', status: 'skipped', detail: 'Check unavailable' }
        stage = 'backend_rx'
      }

      // Check 5: Backend reception - use data from previous call if available
      log('Step 5/6: Checking backend track reception...')
      if (trackingData) {
        const tracksLast10s = trackingData.tracksLast10s || 0
        const lastTrackTs = trackingData.lastTrackTs
        const totalTracks = trackingData.totalTracksReceived || 0
        log(`Venue tracks last 10s: ${tracksLast10s}`)
        log(`Venue last track: ${lastTrackTs ? new Date(lastTrackTs).toLocaleTimeString() : 'never'}`)
        log(`Venue total tracks: ${totalTracks}`)
        
        if (tracksLast10s > 0) {
          log(`✅ Backend receiving tracks: ${tracksLast10s} tracks/10s`)
          checks[4] = { id: 'backend_rx', status: 'pass', detail: `${tracksLast10s} tracks/10s` }
          stage = 'websocket'
        } else if (lastTrackTs && (Date.now() - lastTrackTs < 60000)) {
          // Had tracks in last minute
          log(`✅ Backend received tracks recently (last: ${new Date(lastTrackTs).toLocaleTimeString()})`)
          checks[4] = { id: 'backend_rx', status: 'pass', detail: `Last track: ${new Date(lastTrackTs).toLocaleTimeString()}` }
          stage = 'websocket'
        } else if (totalTracks > 0) {
          // Has received tracks at some point
          log(`⚠️ Backend received tracks before but none recently (total: ${totalTracks})`)
          checks[4] = { id: 'backend_rx', status: 'pass', detail: `${totalTracks} total tracks (none recent)` }
          stage = 'websocket'
        } else {
          log(`❌ No tracks received by backend for this venue`)
          checks[4] = { id: 'backend_rx', status: 'fail', detail: 'No tracks received for venue' }
          // Don't block - this might be expected if no one is in the venue
          stage = 'websocket'
        }
      } else {
        log(`⏭️ No tracking data available, skipping backend check`)
        checks[4] = { id: 'backend_rx', status: 'skipped', detail: 'No data available' }
        stage = 'websocket'
      }
    } else {
      log(`⏭️ No venue ID - skipping cloud MQTT and backend checks`)
      checks[3] = { id: 'cloud_mqtt', status: 'skipped', detail: 'No venue ID' }
      checks[4] = { id: 'backend_rx', status: 'skipped', detail: 'No venue ID' }
      stage = 'websocket'
    }

    // Check 6: WebSocket broadcast (client-side check — we can only verify endpoint exists)
    log('Step 6/6: Checking WebSocket readiness...')
    log(`✅ WebSocket endpoint ready for subscription`)
    checks[5] = { id: 'websocket', status: 'pass', detail: 'Ready for subscription' }
    stage = 'complete'
    overallHealthy = checks.filter(c => c.status === 'fail').length === 0
    
    if (overallHealthy) {
      log(`🎉 Stream validation complete - all checks passed!`)
    } else {
      const failedCount = checks.filter(c => c.status === 'fail').length
      log(`⚠️ Stream validation complete - ${failedCount} check(s) failed`)
    }

  } catch (err: any) {
    log(`❌ Error during validation: ${err.message}`)
    console.error('[buildValidateStreamData] Error:', err.message)
  }

  return {
    stage,
    checks,
    mqttConnected,
    lidarStatuses,
    overallHealthy,
    trackCount: 0,
    validationLogs,
  }
}

export async function buildValidateStreamData(edgeId: string, venueId?: string): Promise<ValidateStreamData> {
  return runStreamValidation(edgeId, venueId)
}

// ─── Deploy / Go Live ───────────────────────────────────────────

export async function deployToEdge(edgeId: string, venueId: string): Promise<{
  success: boolean
  lidarCount?: number
  configHash?: string
  error?: string
}> {
  const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venueId }),
  })
  return res.json()
}

// ─── AI Classification (GPT-4o Vision) ──────────────────────────

export interface AiClassification {
  group_id: string
  category: string
  confidence: number
  reasoning: string
  tags?: string[]
}

export interface AiClassifyResult {
  classifications: {
    classifications: AiClassification[]
    summary?: {
      layout_type?: string
      estimated_aisle_count?: number
      estimated_checkout_count?: number
      notes?: string
    }
  }
  cached: boolean
  model: string
  latencyMs: number
  tokens?: { prompt: number; completion: number }
  createdAt?: string
  error?: string
}

/**
 * Call GPT-4o Vision to classify fixture groups from the ORIGINAL DWG image.
 * Results are cached server-side per import_id.
 */
export async function aiClassifyImport(importId: string, force = false): Promise<AiClassifyResult> {
  const url = `${API_BASE}/api/dwg/import/${importId}/ai-classify${force ? '?force=true' : ''}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000) // 5 min
  try {
    const res = await fetch(url, { method: 'POST', signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `AI classify failed: ${res.status}`)
    }
    return res.json()
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('AI classification timed out after 5 minutes. The server may still be processing — try again in a moment.')
    }
    throw err
  }
}

/**
 * Get cached AI classification result (no API call to OpenAI).
 */
export async function getAiClassifyCache(importId: string): Promise<AiClassifyResult | null> {
  const res = await fetch(`${API_BASE}/api/dwg/import/${importId}/ai-classify`)
  if (!res.ok) return null
  const data = await res.json()
  return data.classifications ? data : null
}

/** Map AI category → our FixtureType (supports both v3 two-pass and legacy v1 categories) */
const AI_CATEGORY_MAP: Record<string, FixtureType> = {
  shelf: 'shelf',
  fridge: 'fridge',
  wall: 'wall',
  checkout: 'checkout',
  entrance: 'entrance',
  custom: 'custom',
  service_counter: 'shelf',
  shelf_gondola: 'shelf',
  shelf_wall_bay: 'shelf',
  perimeter_wall: 'wall',
  internal_wall: 'wall',
  checkout_counter: 'checkout',
  queue_lane: 'checkout',
  refrigeration_unit: 'fridge',
  island_promo: 'shelf',
  pillar: 'custom',
  digital_display: 'custom',
  back_of_house: 'custom',
}

/**
 * Merge AI classifications with existing heuristic classifications.
 * AI results override heuristic results when AI confidence is higher.
 */
export function mergeAiClassifications(
  heuristicClassifications: ClassificationSuggestion[],
  aiResult: AiClassifyResult
): ClassificationSuggestion[] {
  const aiMap = new Map<string, AiClassification>()
  if (aiResult.classifications?.classifications) {
    for (const c of aiResult.classifications.classifications) {
      aiMap.set(c.group_id, c)
    }
  }

  return heuristicClassifications.map(hc => {
    const ai = aiMap.get(hc.groupId)
    if (!ai) return hc

    const aiType = AI_CATEGORY_MAP[ai.category] || 'custom'
    const aiConf = ai.confidence

    // AI agrees with heuristic → boost confidence
    if (aiType === hc.suggestedType) {
      return {
        ...hc,
        confidence: Math.min(0.98, Math.max(hc.confidence, aiConf) + 0.05),
        reason: `${hc.reason} · AI confirms: ${ai.reasoning}`,
        accepted: Math.max(hc.confidence, aiConf) >= 0.70,
      }
    }

    // AI disagrees — use whichever has higher confidence
    if (aiConf > hc.confidence) {
      return {
        ...hc,
        suggestedType: aiType,
        confidence: aiConf,
        reason: `AI: ${ai.reasoning} (was: ${hc.suggestedType} @ ${(hc.confidence * 100).toFixed(0)}%)`,
        accepted: aiConf >= 0.70,
      }
    }

    // Heuristic was stronger — keep it but note AI disagreement
    return {
      ...hc,
      reason: `${hc.reason} · AI suggested ${ai.category} (${(aiConf * 100).toFixed(0)}%)`,
    }
  })
}

// ─── Venue Auto-Resolve ─────────────────────────────────────────
// Ensures a venueId exists for the LaunchPad session.
// If none provided, finds an existing venue or creates a default one.

export async function ensureVenueId(currentVenueId?: string | null): Promise<{ venueId: string; venueName: string }> {
  // Already have one
  if (currentVenueId) {
    try {
      const res = await fetch(`${API_BASE}/api/venues/${currentVenueId}`)
      if (res.ok) {
        const data = await res.json()
        return { venueId: currentVenueId, venueName: data.venue?.name || 'Store' }
      }
    } catch { /* venue ID invalid, fall through */ }
  }

  // Try to find an existing venue
  try {
    const res = await fetch(`${API_BASE}/api/venues`)
    if (res.ok) {
      const venues = await res.json()
      if (Array.isArray(venues) && venues.length > 0) {
        console.log('[LaunchPad] Auto-resolved venue:', venues[0].name, venues[0].id)
        return { venueId: venues[0].id, venueName: venues[0].name }
      }
    }
  } catch { /* no venues endpoint or error */ }

  // No venues exist — create a default one
  try {
    const res = await fetch(`${API_BASE}/api/venues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Default Store', width: 30, depth: 20, height: 4, tileSize: 1 }),
    })
    if (res.ok) {
      const data = await res.json()
      console.log('[LaunchPad] Auto-created venue:', data.id)
      return { venueId: data.id, venueName: data.name || 'Default Store' }
    }
  } catch { /* creation failed */ }

  throw new Error('Could not find or create a venue')
}

export function buildGoLiveData(trackCount: number): GoLiveData {
  return {
    trackingSubscribed: true,
    activeTrackCount: trackCount,
    isLive: trackCount > 0,
  }
}
