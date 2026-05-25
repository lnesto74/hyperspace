/**
 * Neural X-Ray spatial overlay — clean map + hover-to-reveal KPI cards.
 * Anchors are minimal markers; full halos appear only on hover / pin.
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { XRayData } from '../neuralDashboard/useXRayData'
import type { XRayFilters } from '../neuralDashboard/NeuralDashboard'

const XRAY_MIN_VISITS = 2
const XRAY_MAX_CATEGORIES = 12
const NEAR_RADIUS_M = 3.5
const HIT_SPHERE_R = 0.55
const DETAIL_Y = 3.2

export type XRayZoomTier = 1 | 2 | 3

export type XRayPick =
  | { kind: 'category'; id: string }
  | { kind: 'shelf'; id: string }
  | { kind: 'checkout'; id: string }
  | { kind: 'screen'; id: string }
  | { kind: 'zone'; id: string }

interface CategoryAgg {
  visits: number
  dwells: number
  engagements: number
  avgDwellWeighted: number
  peakOccupancy: number
  cx: number
  cz: number
  count: number
  shelfIds: string[]
}

interface ShelfAgg {
  name: string
  cat: string
  visits: number
  dwells: number
  engagements: number
  avgDwellW: number
  peakOcc: number
  cx: number
  cz: number
  count: number
}

interface CheckoutAgg {
  visits: number
  avgWaitMs: number
  queueDepth: number
  cx: number
  cz: number
  count: number
}

interface MiscZone {
  roiId: string
  name: string
  visits: number
  avgDwellSec: number
  cx: number
  cz: number
}

export interface XRayIndex {
  categories: Map<string, CategoryAgg>
  shelves: Map<string, ShelfAgg>
  checkouts: Map<string, CheckoutAgg>
  checkoutOrder: string[]
  miscZones: Map<string, MiscZone>
  screens: XRayData['doohScreens']
}

function buildIndex(data: XRayData): XRayIndex {
  const categories = new Map<string, CategoryAgg>()
  const shelves = new Map<string, ShelfAgg>()
  const checkoutMap = new Map<string, CheckoutAgg>()
  const miscZones = new Map<string, MiscZone>()

  for (const zone of data.zones) {
    if (!zone.position) continue

    if (zone.template === 'shelf-engagement') {
      const hasCat = zone.categories && zone.categories.length > 0
      const cat = hasCat ? zone.categories![0] : null

      if (cat) {
        const existing = categories.get(cat)
        if (existing) {
          existing.visits += zone.visits
          existing.dwells += zone.dwells
          existing.engagements += zone.engagements
          existing.avgDwellWeighted += zone.avgDwellSec * zone.visits
          existing.peakOccupancy = Math.max(existing.peakOccupancy, zone.peakOccupancy)
          existing.cx += zone.position.x
          existing.cz += zone.position.z
          existing.count += 1
          if (zone.shelfId && !existing.shelfIds.includes(zone.shelfId)) {
            existing.shelfIds.push(zone.shelfId)
          }
        } else {
          categories.set(cat, {
            visits: zone.visits,
            dwells: zone.dwells,
            engagements: zone.engagements,
            avgDwellWeighted: zone.avgDwellSec * zone.visits,
            peakOccupancy: zone.peakOccupancy,
            cx: zone.position.x,
            cz: zone.position.z,
            count: 1,
            shelfIds: zone.shelfId ? [zone.shelfId] : [],
          })
        }
      }

      if (cat && zone.shelfId) {
        const existing = shelves.get(zone.shelfId)
        if (existing) {
          existing.visits += zone.visits
          existing.dwells += zone.dwells
          existing.engagements += zone.engagements
          existing.avgDwellW += zone.avgDwellSec * zone.visits
          existing.peakOcc = Math.max(existing.peakOcc, zone.peakOccupancy)
          existing.cx += zone.position.x
          existing.cz += zone.position.z
          existing.count += 1
        } else {
          const shelfLabel = zone.name.replace(/\s*-\s*Engagement.*$/i, '')
          shelves.set(zone.shelfId, {
            name: shelfLabel,
            cat,
            visits: zone.visits,
            dwells: zone.dwells,
            engagements: zone.engagements,
            avgDwellW: zone.avgDwellSec * zone.visits,
            peakOcc: zone.peakOccupancy,
            cx: zone.position.x,
            cz: zone.position.z,
            count: 1,
          })
        }
      }
      continue
    }

    if (zone.template === 'cashier-queue') {
      const cName = zone.name.replace(/\s*-\s*(Queue|Service)\s*/i, '')
      const wait = (zone as { avgWaitMs?: number }).avgWaitMs || 0
      const depth = (zone as { queueDepth?: number }).queueDepth || zone.peakOccupancy
      const existing = checkoutMap.get(cName)
      if (existing) {
        existing.visits += zone.visits
        existing.avgWaitMs = Math.max(existing.avgWaitMs, wait)
        existing.queueDepth = Math.max(existing.queueDepth, depth)
        existing.cx += zone.position.x
        existing.cz += zone.position.z
        existing.count += 1
      } else {
        checkoutMap.set(cName, {
          visits: zone.visits,
          avgWaitMs: wait,
          queueDepth: depth,
          cx: zone.position.x,
          cz: zone.position.z,
          count: 1,
        })
      }
      continue
    }

    if (zone.visits >= XRAY_MIN_VISITS) {
      miscZones.set(zone.roiId, {
        roiId: zone.roiId,
        name: zone.name,
        visits: zone.visits,
        avgDwellSec: zone.avgDwellSec,
        cx: zone.position.x,
        cz: zone.position.z,
      })
    }
  }

  for (const [cat, agg] of categories) {
    agg.cx /= agg.count
    agg.cz /= agg.count
    categories.set(cat, agg)
  }
  for (const [id, s] of shelves) {
    s.cx /= s.count
    s.cz /= s.count
    shelves.set(id, s)
  }
  for (const [name, c] of checkoutMap) {
    c.cx /= c.count
    c.cz /= c.count
    checkoutMap.set(name, c)
  }

  const checkoutOrder = [...checkoutMap.entries()]
    .map(([name, d]) => ({ name, cx: d.cx, cz: d.cz }))
    .sort((a, b) => a.cx - b.cx || a.cz - b.cz)
    .map(c => c.name)

  return {
    categories,
    shelves,
    checkouts: checkoutMap,
    checkoutOrder,
    miscZones,
    screens: data.doohScreens,
  }
}

function checkoutStatus(depth: number): 'OK' | 'MODERATE' | 'BUSY' {
  if (depth > 6) return 'BUSY'
  if (depth > 3) return 'MODERATE'
  return 'OK'
}

function getZoomTier(cameraDist: number, venueSpan: number): XRayZoomTier {
  const n = cameraDist / Math.max(venueSpan, 20)
  if (n > 0.75) return 1
  if (n > 0.32) return 2
  return 3
}

function spiralPositions(count: number, cardW: number, cardH: number): { x: number; y: number }[] {
  if (count <= 1) return [{ x: 0, y: 0 }]
  const positions: { x: number; y: number }[] = [{ x: 0, y: 0 }]
  const minGap = Math.max(cardW, cardH) + 8
  const angleStep = 0.85
  const radiusGrowth = (minGap / (2 * Math.PI)) * angleStep
  let angle = 0
  let radius = minGap * 0.7
  for (let i = 1; i < count; i++) {
    angle += angleStep
    radius += radiusGrowth
    positions.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
  }
  return positions
}

function pickKey(pick: XRayPick): string {
  return `${pick.kind}:${pick.id}`
}

function haloCategoryHtml(catName: string, agg: CategoryAgg): string {
  const avgDwell = agg.visits > 0 ? agg.avgDwellWeighted / agg.visits : 0
  const convRate = agg.engagements > 0 && agg.visits > 0 ? ((agg.engagements / agg.visits) * 100).toFixed(0) : '0'
  return `
    <div class="xray-halo-tag">${catName}</div>
    <div class="xray-halo-body">
      <div class="xray-halo-row"><span class="xray-halo-val">${agg.visits}</span> <span class="xray-halo-lbl">visits</span> <span class="xray-halo-val">${avgDwell.toFixed(1)}s</span> <span class="xray-halo-lbl">dwell</span></div>
      <div class="xray-halo-row"><span class="xray-halo-val">${convRate}%</span> <span class="xray-halo-lbl">engage</span> <span class="xray-halo-val">${agg.peakOccupancy}</span> <span class="xray-halo-lbl">peak</span></div>
    </div>
  `
}

function haloShelfHtml(s: ShelfAgg): string {
  const avgDwell = s.visits > 0 ? s.avgDwellW / s.visits : 0
  return `
    <div class="xray-halo-tag">${s.name} <span style="opacity:.5;font-size:8px">${s.cat}</span></div>
    <div class="xray-halo-body">
      <div class="xray-halo-row"><span class="xray-halo-val">${s.visits}</span> <span class="xray-halo-lbl">visits</span> <span class="xray-halo-val">${avgDwell.toFixed(1)}s</span> <span class="xray-halo-lbl">dwell</span></div>
    </div>
  `
}

function haloCheckoutHtml(name: string, c: CheckoutAgg): string {
  const avgWaitSec = c.avgWaitMs > 0 ? (c.avgWaitMs / 1000).toFixed(0) : '—'
  const status = checkoutStatus(c.queueDepth)
  const statusClass = status === 'BUSY' ? 'xray-status-red' : status === 'MODERATE' ? 'xray-status-amber' : 'xray-status-green'
  const shortName = name.replace('Checkout ', '#')
  return `
    <div class="xray-halo-tag xray-tag-queue">${shortName}</div>
    <div class="xray-halo-body">
      <div class="xray-halo-row"><span class="xray-halo-val">${avgWaitSec}s</span> <span class="xray-halo-lbl">w</span> <span class="xray-halo-val">${c.queueDepth}</span> <span class="xray-halo-lbl">q</span> <span class="xray-halo-badge ${statusClass}">${status}</span></div>
    </div>
  `
}

function haloZoneHtml(z: MiscZone): string {
  return `
    <div class="xray-halo-tag xray-tag-zone">${z.name}</div>
    <div class="xray-halo-body">
      <div class="xray-halo-row"><span class="xray-halo-val">${z.visits}</span> <span class="xray-halo-lbl">visits</span> <span class="xray-halo-val">${z.avgDwellSec.toFixed(1)}s</span> <span class="xray-halo-lbl">dwell</span></div>
    </div>
  `
}

function haloScreenHtml(screen: XRayData['doohScreens'][number]): string {
  const liftStr =
    screen.liftRel !== null && screen.liftRel !== undefined
      ? `${screen.liftRel >= 0 ? '▲' : '▼'} ${(Math.abs(screen.liftRel) * 100).toFixed(0)}%`
      : '—'
  const liftClass = screen.liftRel >= 0 ? 'xray-lift-pos' : 'xray-lift-neg'
  return `
    <div class="xray-halo-tag xray-tag-dooh">📺 ${screen.name.replace('Digital_display ', 'DS-')}</div>
    <div class="xray-halo-body">
      <div class="xray-halo-row"><span class="xray-halo-val">${screen.exposures}</span> <span class="xray-halo-lbl">exp</span> <span class="xray-halo-val">${screen.avgAqs.toFixed(0)}</span> <span class="xray-halo-lbl">AQS</span></div>
      <div class="xray-halo-row"><span class="xray-halo-val">${screen.conversionRate.toFixed(1)}%</span> <span class="xray-halo-lbl">conv</span> <span class="${liftClass}">${liftStr}</span> <span class="xray-halo-lbl">lift</span></div>
      ${screen.campaignName ? `<div class="xray-halo-campaign">${screen.campaignName}</div>` : ''}
    </div>
  `
}

interface PickTarget {
  pick: XRayPick
  x: number
  z: number
}

export class XRayModeSystem {
  private scene: THREE.Scene | null = null
  private index: XRayIndex | null = null
  private filters: XRayFilters = { shelves: true, queues: true, screens: true, zones: false }
  private venueSpan = 50
  private zoomTier: XRayZoomTier = 2

  private anchorGroup = new THREE.Group()
  private hitGroup = new THREE.Group()
  private detailGroup = new THREE.Group()
  private anchors = new Map<string, CSS2DObject>()
  private hitMeshes: THREE.Mesh[] = []
  private pickTargets: PickTarget[] = []

  private activePick: XRayPick | null = null
  private pinnedPick: XRayPick | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  private detailInners: HTMLElement[] = []

  attach(scene: THREE.Scene) {
    this.scene = scene
    if (!this.anchorGroup.parent) scene.add(this.anchorGroup)
    if (!this.hitGroup.parent) scene.add(this.hitGroup)
    if (!this.detailGroup.parent) scene.add(this.detailGroup)
  }

  dispose() {
    this.clearDetails()
    this.clearAnchors()
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.anchorGroup.removeFromParent()
    this.hitGroup.removeFromParent()
    this.detailGroup.removeFromParent()
    this.scene = null
    this.index = null
    this.activePick = null
    this.pinnedPick = null
  }

  rebuild(data: XRayData | null, filters: XRayFilters, venueSpan: number) {
    if (!this.scene) return
    this.filters = filters
    this.venueSpan = Math.max(venueSpan, 20)
    const savedPin = this.pinnedPick
    this.clearDetails()
    this.clearAnchors()
    if (!data) {
      this.index = null
      this.activePick = null
      this.pinnedPick = null
      return
    }
    this.index = buildIndex(data)
    this.buildAnchors()
    if (savedPin) {
      this.pinnedPick = savedPin
      this.activePick = savedPin
      this.showDetails(savedPin)
    }
  }

  updateZoomTier(cameraDist: number) {
    const tier = getZoomTier(cameraDist, this.venueSpan)
    if (tier === this.zoomTier) return
    this.zoomTier = tier
    if (this.activePick && !this.pinnedPick) {
      this.showDetails(this.activePick)
    }
  }

  getZoomTier(): XRayZoomTier {
    return this.zoomTier
  }

  clearPin() {
    this.pinnedPick = null
    this.activePick = null
    this.clearDetails()
  }

  togglePin(pick: XRayPick | null) {
    if (!pick) {
      this.clearPin()
      return
    }
    const key = pickKey(pick)
    if (this.pinnedPick && pickKey(this.pinnedPick) === key) {
      this.clearPin()
      return
    }
    this.pinnedPick = pick
    this.activePick = pick
    this.showDetails(pick)
  }

  onMouseLeave() {
    if (this.pinnedPick) return
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => {
      this.activePick = null
      this.clearDetails()
    }, 280)
  }

  pickAt(
    mouse: THREE.Vector2,
    camera: THREE.Camera,
    raycaster: THREE.Raycaster,
    objectMeshes: THREE.Object3D[],
  ): XRayPick | null {
    if (!this.index) return null

    raycaster.setFromCamera(mouse, camera)

    // 1) Invisible hit spheres at anchor positions
    if (this.hitMeshes.length > 0) {
      const hits = raycaster.intersectObjects(this.hitMeshes, false)
      if (hits.length > 0) {
        const ud = hits[0].object.userData as { xrayPick?: XRayPick }
        if (ud.xrayPick) return ud.xrayPick
      }
    }

    // 2) Fixture raycast → shelf
    if (this.filters.shelves) {
      const objHits = raycaster.intersectObjects(objectMeshes, false)
      if (objHits.length > 0) {
        let cur: THREE.Object3D | null = objHits[0].object
        while (cur) {
          const oid = cur.userData.objectId as string | undefined
          if (oid && this.index.shelves.has(oid)) {
            return { kind: 'shelf', id: oid }
          }
          cur = cur.parent
        }
        // Match by proximity if object id differs from shelfId
        const pt = objHits[0].point
        const nearShelf = this.nearestPickTarget(pt.x, pt.z, t => t.pick.kind === 'shelf', 2.5)
        if (nearShelf) return nearShelf.pick
      }
    }

    // 3) Floor proximity to pick targets
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const target = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(floor, target)) {
      const near = this.nearestPickTarget(target.x, target.z, () => true, NEAR_RADIUS_M)
      if (near) return near.pick
    }

    return null
  }

  handleHover(pick: XRayPick | null) {
    if (this.pinnedPick) return
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    const prevKey = this.activePick ? pickKey(this.activePick) : null
    const nextKey = pick ? pickKey(pick) : null
    if (prevKey === nextKey) return
    this.activePick = pick
    if (!pick) {
      this.clearDetails()
      return
    }
    this.showDetails(pick)
  }

  private nearestPickTarget(
    x: number,
    z: number,
    pred: (t: PickTarget) => boolean,
    radius: number,
  ): PickTarget | null {
    let best: PickTarget | null = null
    let bestD = radius
    for (const t of this.pickTargets) {
      if (!pred(t)) continue
      const d = Math.hypot(t.x - x, t.z - z)
      if (d < bestD) {
        bestD = d
        best = t
      }
    }
    return best
  }

  private clearAnchors() {
    this.anchors.forEach(a => {
      a.element.remove()
      this.anchorGroup.remove(a)
    })
    this.anchors.clear()
    this.hitMeshes.forEach(m => {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
      this.hitGroup.remove(m)
    })
    this.hitMeshes = []
    this.pickTargets = []
  }

  private addHitSphere(x: number, z: number, pick: XRayPick, y = 1.2) {
    const geo = new THREE.SphereGeometry(HIT_SPHERE_R, 8, 8)
    const mat = new THREE.MeshBasicMaterial({ visible: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    mesh.userData.xrayPick = pick
    this.hitGroup.add(mesh)
    this.hitMeshes.push(mesh)
    this.pickTargets.push({ pick, x, z })
  }

  private addVisualAnchor(id: string, x: number, z: number, className: string, inner: string) {
    const el = document.createElement('div')
    el.className = className
    el.innerHTML = inner
    const label = new CSS2DObject(el)
    label.position.set(x, 0.35, z)
    this.anchorGroup.add(label)
    this.anchors.set(id, label)
  }

  private buildAnchors() {
    if (!this.index) return

    if (this.filters.shelves) {
      const ranked = [...this.index.categories.entries()]
        .sort((a, b) => b[1].visits - a[1].visits)
        .slice(0, XRAY_MAX_CATEGORIES)

      for (const [catName, agg] of ranked) {
        const pick: XRayPick = { kind: 'category', id: catName }
        this.addVisualAnchor(
          `cat:${catName}`,
          agg.cx,
          agg.cz,
          'xray-anchor xray-anchor-shelf',
          '<span class="xray-anchor-dot"></span>',
        )
        this.addHitSphere(agg.cx, agg.cz, pick)
      }

      for (const [shelfId, s] of this.index.shelves) {
        this.addHitSphere(s.cx, s.cz, { kind: 'shelf', id: shelfId }, 0.9)
      }
    }

    if (this.filters.queues) {
      for (const name of this.index.checkoutOrder) {
        const c = this.index.checkouts.get(name)!
        const pick: XRayPick = { kind: 'checkout', id: name }
        this.addHitSphere(c.cx, c.cz, pick)
        const status = checkoutStatus(c.queueDepth)
        if (status === 'OK') continue
        const statusClass =
          status === 'BUSY' ? 'xray-anchor-queue-busy' : 'xray-anchor-queue-moderate'
        this.addVisualAnchor(
          `checkout:${name}`,
          c.cx,
          c.cz,
          `xray-anchor xray-anchor-queue ${statusClass}`,
          '<span class="xray-anchor-dot"></span>',
        )
      }
    }

    if (this.filters.screens) {
      for (const screen of this.index.screens) {
        if (!screen.position) continue
        const pick: XRayPick = { kind: 'screen', id: screen.screenId }
        this.addVisualAnchor(
          `screen:${screen.screenId}`,
          screen.position.x,
          screen.position.z,
          'xray-anchor xray-anchor-screen',
          '<span class="xray-anchor-pin">📺</span>',
        )
        this.addHitSphere(screen.position.x, screen.position.z, pick)
      }
    }

    if (this.filters.zones) {
      for (const [roiId, z] of this.index.miscZones) {
        const pick: XRayPick = { kind: 'zone', id: roiId }
        this.addVisualAnchor(
          `zone:${roiId}`,
          z.cx,
          z.cz,
          'xray-anchor xray-anchor-zone',
          '<span class="xray-anchor-dot"></span>',
        )
        this.addHitSphere(z.cx, z.cz, pick)
      }
    }
  }

  private clearDetails() {
    this.detailInners.forEach(inner => {
      inner.style.transform = ''
      inner.style.zIndex = ''
      inner.style.transition = ''
    })
    this.detailInners = []
    while (this.detailGroup.children.length > 0) {
      const child = this.detailGroup.children[0]
      if (child instanceof CSS2DObject) {
        child.element.remove()
      }
      this.detailGroup.remove(child)
    }
  }

  private positionForPick(pick: XRayPick): { x: number; z: number } | null {
    if (!this.index) return null
    switch (pick.kind) {
      case 'category': {
        const agg = this.index.categories.get(pick.id)
        return agg ? { x: agg.cx, z: agg.cz } : null
      }
      case 'shelf': {
        const s = this.index.shelves.get(pick.id)
        return s ? { x: s.cx, z: s.cz } : null
      }
      case 'checkout': {
        const c = this.index.checkouts.get(pick.id)
        return c ? { x: c.cx, z: c.cz } : null
      }
      case 'screen': {
        const scr = this.index.screens.find(s => s.screenId === pick.id)
        return scr?.position ? { x: scr.position.x, z: scr.position.z } : null
      }
      case 'zone': {
        const z = this.index.miscZones.get(pick.id)
        return z ? { x: z.cx, z: z.cz } : null
      }
      default:
        return null
    }
  }

  private createDetailCard(id: string, html: string, extraClass = ''): { obj: CSS2DObject; inner: HTMLElement } {
    const el = document.createElement('div')
    el.className = `xray-halo xray-halo-detail ${extraClass}`.trim()
    el.dataset.detailId = id
    const inner = document.createElement('div')
    inner.className = 'xray-halo-inner'
    inner.innerHTML = html
    el.appendChild(inner)
    const obj = new CSS2DObject(el)
    this.detailGroup.add(obj)
    this.detailInners.push(inner)
    return { obj, inner }
  }

  private showDetails(pick: XRayPick) {
    if (!this.index) return
    this.clearDetails()

    const pos = this.positionForPick(pick)
    if (!pos) return

    const cards: { id: string; html: string; extraClass?: string }[] = []

    if (pick.kind === 'category') {
      const agg = this.index.categories.get(pick.id)
      if (!agg) return
      cards.push({ id: pickKey(pick), html: haloCategoryHtml(pick.id, agg) })
      if (this.zoomTier >= 2) {
        for (const shelfId of agg.shelfIds.slice(0, 8)) {
          const s = this.index.shelves.get(shelfId)
          if (s) cards.push({ id: `shelf:${shelfId}`, html: haloShelfHtml(s), extraClass: 'xray-halo-compact' })
        }
      }
    } else if (pick.kind === 'shelf') {
      const s = this.index.shelves.get(pick.id)
      if (!s) return
      if (this.zoomTier >= 3) {
        cards.push({ id: pickKey(pick), html: haloShelfHtml(s) })
      } else {
        const agg = this.index.categories.get(s.cat)
        if (agg) {
          cards.push({ id: `cat:${s.cat}`, html: haloCategoryHtml(s.cat, agg) })
          if (this.zoomTier >= 2) {
            for (const shelfId of agg.shelfIds.slice(0, 8)) {
              const sh = this.index.shelves.get(shelfId)
              if (sh) cards.push({ id: `shelf:${shelfId}`, html: haloShelfHtml(sh), extraClass: 'xray-halo-compact' })
            }
          }
        } else {
          cards.push({ id: pickKey(pick), html: haloShelfHtml(s) })
        }
      }
    } else if (pick.kind === 'checkout') {
      const c = this.index.checkouts.get(pick.id)
      if (!c) return
      cards.push({ id: pickKey(pick), html: haloCheckoutHtml(pick.id, c), extraClass: 'xray-halo-compact' })
      const idx = this.index.checkoutOrder.indexOf(pick.id)
      if (idx >= 0) {
        for (const offset of [-1, 1]) {
          const neighbor = this.index.checkoutOrder[idx + offset]
          if (!neighbor || neighbor === pick.id) continue
          const nc = this.index.checkouts.get(neighbor)
          if (nc) {
            cards.push({
              id: `checkout:${neighbor}`,
              html: haloCheckoutHtml(neighbor, nc),
              extraClass: 'xray-halo-compact',
            })
          }
        }
      }
    } else if (pick.kind === 'screen') {
      const scr = this.index.screens.find(s => s.screenId === pick.id)
      if (!scr) return
      cards.push({ id: pickKey(pick), html: haloScreenHtml(scr), extraClass: 'xray-halo-dooh' })
    } else if (pick.kind === 'zone') {
      const z = this.index.miscZones.get(pick.id)
      if (!z) return
      cards.push({ id: pickKey(pick), html: haloZoneHtml(z) })
    }

    if (cards.length === 0) return

    const y = DETAIL_Y + (this.pinnedPick ? 0.3 : 0)
    cards.forEach((card, i) => {
      const { obj, inner } = this.createDetailCard(card.id, card.html, card.extraClass ?? '')
      obj.position.set(pos.x, y, pos.z)
      if (cards.length > 1) {
        requestAnimationFrame(() => {
          const sampleRect = inner.getBoundingClientRect()
          const cardW = sampleRect.width || 90
          const cardH = sampleRect.height || 40
          const positions = spiralPositions(cards.length, cardW, cardH)
          const p = positions[i] ?? { x: 0, y: 0 }
          const delay = i * 30
          inner.style.transition = `transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}ms`
          inner.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`
          inner.style.zIndex = `${200 + i}`
        })
      }
    })
  }
}
