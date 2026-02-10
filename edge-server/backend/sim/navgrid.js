/**
 * NavGrid - 2D occupancy grid for navigation
 * Builds walkable map from 3D scene objects
 */

import { SIM_CONFIG } from './simconfig.js';

export const CELL_FREE = 0;
export const CELL_BLOCKED = 1;
export const CELL_INFLATED = 2;  // Walkable but high cost

export const ZONE_NONE = 0;
export const ZONE_ENTRANCE = 1;
export const ZONE_BYPASS = 2;
export const ZONE_SHOPPING = 3;
export const ZONE_QUEUE = 4;
export const ZONE_CHECKOUT = 5;

export class NavGrid {
  constructor(width, depth, resolution = SIM_CONFIG.gridResolution) {
    this.worldWidth = width;
    this.worldDepth = depth;
    this.resolution = resolution;
    
    this.gridWidth = Math.ceil(width / resolution);
    this.gridDepth = Math.ceil(depth / resolution);
    
    // Occupancy grid (0 = free, 1 = blocked, 2 = inflated)
    this.cells = new Uint8Array(this.gridWidth * this.gridDepth);
    
    // Zone map
    this.zones = new Uint8Array(this.gridWidth * this.gridDepth);
    
    // Cost map (for A* - higher = avoid)
    this.costs = new Float32Array(this.gridWidth * this.gridDepth);
    this.costs.fill(1.0);
    
    // Safe waypoints (precomputed valid positions)
    this.safeWaypoints = {
      entrance: [],
      bypass: [],
      shopping: [],
      queue: [],
      aisles: [],
    };
    
    // Cashier positions for queue assignment
    this.cashiers = [];
    
    // Entrance position
    this.entrancePos = { x: 0, z: 0 };
    
    // Zone bounds (derived from scene)
    this.zoneBounds = { ...SIM_CONFIG.zones };
  }
  
  // Convert world coords to grid coords
  worldToGrid(x, z) {
    return {
      gx: Math.floor(x / this.resolution),
      gz: Math.floor(z / this.resolution),
    };
  }
  
  // Convert grid coords to world coords (cell center)
  gridToWorld(gx, gz) {
    return {
      x: (gx + 0.5) * this.resolution,
      z: (gz + 0.5) * this.resolution,
    };
  }
  
  // Get cell index from grid coords
  cellIndex(gx, gz) {
    if (gx < 0 || gx >= this.gridWidth || gz < 0 || gz >= this.gridDepth) {
      return -1;
    }
    return gz * this.gridWidth + gx;
  }
  
  // Check if grid position is walkable (for pathfinding - allows inflated with cost)
  isWalkable(gx, gz) {
    const idx = this.cellIndex(gx, gz);
    if (idx < 0) return false;
    return this.cells[idx] !== CELL_BLOCKED;
  }
  
  // Check if grid position is strictly walkable (no inflated - for agent movement)
  isStrictlyWalkable(gx, gz) {
    const idx = this.cellIndex(gx, gz);
    if (idx < 0) return false;
    return this.cells[idx] === CELL_FREE;
  }
  
  // Check if world position is walkable
  isWalkableWorld(x, z) {
    const { gx, gz } = this.worldToGrid(x, z);
    return this.isWalkable(gx, gz);
  }
  
  // Check if world position is strictly walkable (agent body won't overlap obstacles)
  isStrictlyWalkableWorld(x, z) {
    const { gx, gz } = this.worldToGrid(x, z);
    return this.isStrictlyWalkable(gx, gz);
  }
  
  // Get movement cost for cell
  getCost(gx, gz) {
    const idx = this.cellIndex(gx, gz);
    if (idx < 0) return Infinity;
    if (this.cells[idx] === CELL_BLOCKED) return Infinity;
    return this.costs[idx];
  }
  
  // Get zone at position
  getZone(gx, gz) {
    const idx = this.cellIndex(gx, gz);
    if (idx < 0) return ZONE_NONE;
    return this.zones[idx];
  }
  
  getZoneWorld(x, z) {
    const { gx, gz } = this.worldToGrid(x, z);
    return this.getZone(gx, gz);
  }
  
  // Build grid from scene objects
  buildFromScene(objects, rois = []) {
    console.log(`Building NavGrid: ${this.gridWidth}x${this.gridDepth} cells`);
    
    // Reset
    this.cells.fill(CELL_FREE);
    this.costs.fill(1.0);
    this.zones.fill(ZONE_NONE);
    
    // Process objects
    let entranceObj = null;
    const checkoutObjs = [];
    
    for (const obj of objects) {
      if (!obj.position) continue;
      
      const type = (obj.type || '').toLowerCase();
      const name = (obj.name || '').toLowerCase();
      
      // Detect entrance
      if (type === 'entrance' || name.includes('entrance') || name.includes('door')) {
        entranceObj = obj;
        this.entrancePos = { x: obj.position.x, z: obj.position.z };
        continue; // Don't block entrance
      }
      
      // Detect checkouts
      if (type === 'checkout' || name.includes('checkout') || name.includes('cashier')) {
        checkoutObjs.push(obj);
        this.cashiers.push({
          x: obj.position.x,
          z: obj.position.z,
          width: obj.scale?.x || 1.5,
        });
      }
      
      // Block obstacles - any solid object that's not entrance, floor, or zone marker
      const isPassable = (
        type === 'entrance' || type === 'door' || type === 'floor' || type === 'ground' ||
        type === 'zone' || type === 'area' || type === 'region' || type === 'roi' ||
        type === 'light' || type === 'camera' || type === 'sensor' ||
        name.includes('entrance') || name.includes('door') || name.includes('floor')
      );
      
      if (!isPassable) {
        // Block all solid objects: walls, shelves, shelved, counters, tables, etc.
        this.blockObject(obj);
      }
    }
    
    // Parse checkout lanes from ROIs (Queue + Service pairs)
    this.parseCheckoutLanesFromROIs(rois);
    
    // Derive zone bounds from scene
    this.deriveZoneBounds(objects, checkoutObjs, entranceObj);
    
    // Apply inflation around blocked cells
    this.applyInflation(SIM_CONFIG.wallInflation);
    
    // Classify zones
    this.classifyZones();
    
    // Generate safe waypoints
    this.generateSafeWaypoints();
    
    console.log(`NavGrid built: ${this.cashiers.length} cashiers, entrance at (${this.entrancePos.x.toFixed(1)}, ${this.entrancePos.z.toFixed(1)})`);
    console.log(`Safe waypoints: entrance=${this.safeWaypoints.entrance.length}, bypass=${this.safeWaypoints.bypass.length}, shopping=${this.safeWaypoints.shopping.length}, aisles=${this.safeWaypoints.aisles.length}`);
  }
  
  // Parse checkout lanes from ROI pairs (e.g., "Checkout 1 - Queue" + "Checkout 1 - Service")
  parseCheckoutLanesFromROIs(rois) {
    if (!rois || rois.length === 0) return;
    
    // Find Queue and Service ROI pairs
    const queueRois = rois.filter(r => r.name && r.name.includes('- Queue'));
    const serviceRois = rois.filter(r => r.name && r.name.includes('- Service'));
    
    console.log(`[NavGrid] Parsing ROIs: ${queueRois.length} Queue, ${serviceRois.length} Service`);
    
    // Match Queue/Service pairs by prefix (e.g., "Checkout 1")
    for (const queueRoi of queueRois) {
      const prefix = queueRoi.name.replace('- Queue', '').trim();
      const serviceRoi = serviceRois.find(s => s.name.replace('- Service', '').trim() === prefix);
      
      if (serviceRoi) {
        // Calculate center of service ROI as cashier position
        const serviceCenter = this.calculateROICenter(serviceRoi);
        const queueCenter = this.calculateROICenter(queueRoi);
        
        // Check if this cashier position already exists (from 3D objects)
        const existing = this.cashiers.find(c => 
          Math.abs(c.x - serviceCenter.x) < 2 && Math.abs(c.z - serviceCenter.z) < 2
        );
        
        if (!existing) {
          this.cashiers.push({
            x: serviceCenter.x,
            z: serviceCenter.z,
            width: 1.5,
            name: prefix,
            queueCenter,
            serviceCenter,
          });
          console.log(`[NavGrid] Added lane "${prefix}" from ROIs: service=(${serviceCenter.x.toFixed(1)}, ${serviceCenter.z.toFixed(1)})`);
        }
      }
    }
  }
  
  // Calculate center of an ROI from its vertices
  calculateROICenter(roi) {
    if (!roi.vertices || roi.vertices.length === 0) {
      return { x: 0, z: 0 };
    }
    
    let sumX = 0, sumZ = 0;
    for (const v of roi.vertices) {
      sumX += v.x;
      sumZ += v.z || v.y; // Some ROIs use y for z-coordinate
    }
    return {
      x: sumX / roi.vertices.length,
      z: sumZ / roi.vertices.length,
    };
  }
  
  // Block cells occupied by an object
  blockObject(obj) {
    const width = obj.scale?.x || obj.width || 1;
    const depth = obj.scale?.z || obj.depth || 1;
    const rotation = obj.rotation?.y || 0;
    
    // Initialize blockedObjects array if needed
    if (!this.blockedObjects) this.blockedObjects = [];
    
    // DEBUG: Log object being blocked
    const type = (obj.type || '').toLowerCase();
    const name = (obj.name || '').toLowerCase();
    console.log(`[NavGrid] Blocking: "${obj.name}" type="${obj.type}" pos=(${obj.position.x.toFixed(1)}, ${obj.position.z.toFixed(1)}) scale=(${width.toFixed(1)}, ${depth.toFixed(1)}) rot=${rotation.toFixed(2)}`);
    
    // Handle rotation by using larger bounding box
    const cosR = Math.abs(Math.cos(rotation));
    const sinR = Math.abs(Math.sin(rotation));
    let effectiveW = width * cosR + depth * sinR;
    let effectiveD = width * sinR + depth * cosR;
    
    // MINIMUM OBSTACLE SIZE: Prevent agents from stepping through thin obstacles
    // Shelves are often only 0.6m deep - agents can tunnel through in one frame
    // BUT: Don't expand checkouts - agents need to stand near them for service
    const isCheckout = type.includes('checkout') || type.includes('cashier') || type.includes('counter');
    if (!isCheckout) {
      const MIN_OBSTACLE_SIZE = 1.5; // At least 1.5m in each dimension
      effectiveW = Math.max(effectiveW, MIN_OBSTACLE_SIZE);
      effectiveD = Math.max(effectiveD, MIN_OBSTACLE_SIZE);
    }
    
    const halfW = effectiveW / 2;
    const halfD = effectiveD / 2;
    
    const minX = obj.position.x - halfW;
    const maxX = obj.position.x + halfW;
    const minZ = obj.position.z - halfD;
    const maxZ = obj.position.z + halfD;
    
    // Block all cells within bounding box
    const startGx = Math.floor(minX / this.resolution);
    const endGx = Math.ceil(maxX / this.resolution);
    const startGz = Math.floor(minZ / this.resolution);
    const endGz = Math.ceil(maxZ / this.resolution);
    
    const cellsBlocked = (endGx - startGx + 1) * (endGz - startGz + 1);
    console.log(`[NavGrid]   -> bounds: X[${minX.toFixed(1)}, ${maxX.toFixed(1)}] Z[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}] cells: ${cellsBlocked}`);
    
    // Store for debug
    this.blockedObjects.push({
      name: obj.name || 'unknown',
      type: obj.type || 'unknown',
      centerX: obj.position.x,
      centerZ: obj.position.z,
      width,
      depth,
      rotation,
      effectiveW,
      effectiveD,
      minX,
      maxX,
      minZ,
      maxZ,
      cellsBlocked,
    });
    
    for (let gx = startGx; gx <= endGx; gx++) {
      for (let gz = startGz; gz <= endGz; gz++) {
        const idx = this.cellIndex(gx, gz);
        if (idx >= 0) {
          this.cells[idx] = CELL_BLOCKED;
          this.costs[idx] = Infinity;
        }
      }
    }
  }
  
  // Derive zone bounds from scene objects
  deriveZoneBounds(objects, checkouts, entrance) {
    if (checkouts.length > 0) {
      // Cashier line Z is the Z of checkouts
      const checkoutZs = checkouts.map(c => c.position.z);
      this.zoneBounds.cashierLineZ = Math.min(...checkoutZs);
      
      // Shopping area starts above cashier line with margin
      this.zoneBounds.shoppingMinZ = this.zoneBounds.cashierLineZ + 8;
      
      // Checkout X range
      const checkoutXs = checkouts.map(c => c.position.x);
      this.zoneBounds.checkoutMinX = Math.min(...checkoutXs) - 2;
      this.zoneBounds.checkoutMaxX = Math.max(...checkoutXs) + 2;
    }
    
    if (entrance) {
      // Bypass corridor on opposite side of entrance
      if (entrance.position.x > this.worldWidth / 2) {
        // Entrance on right, bypass on right
        this.zoneBounds.bypassCorridorX = this.worldWidth - 2;
      } else {
        // Entrance on left, bypass on left
        this.zoneBounds.bypassCorridorX = 2;
      }
    }
    
    // Find shelf bounds for shopping area
    const shelves = objects.filter(o => 
      (o.type || '').toLowerCase() === 'shelf' || 
      (o.name || '').toLowerCase().includes('shelf')
    );
    if (shelves.length > 0) {
      const shelfXs = shelves.map(s => s.position.x);
      const shelfZs = shelves.map(s => s.position.z);
      this.zoneBounds.shoppingMinX = Math.min(...shelfXs) - 2;
      this.zoneBounds.shoppingMaxX = Math.max(...shelfXs) + 2;
      this.zoneBounds.shoppingMaxZ = Math.max(...shelfZs) + 3;
    }
  }
  
  // Apply inflation (increase cost near obstacles)
  applyInflation(inflationRadius) {
    const inflationCells = Math.ceil(inflationRadius / this.resolution);
    const tempCells = new Uint8Array(this.cells);
    
    for (let gz = 0; gz < this.gridDepth; gz++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        const idx = this.cellIndex(gx, gz);
        if (this.cells[idx] === CELL_BLOCKED) {
          // Mark nearby cells as inflated
          for (let dz = -inflationCells; dz <= inflationCells; dz++) {
            for (let dx = -inflationCells; dx <= inflationCells; dx++) {
              if (dx === 0 && dz === 0) continue;
              const dist = Math.sqrt(dx * dx + dz * dz);
              if (dist <= inflationCells) {
                const nidx = this.cellIndex(gx + dx, gz + dz);
                if (nidx >= 0 && tempCells[nidx] === CELL_FREE) {
                  tempCells[nidx] = CELL_INFLATED;
                  // Higher cost closer to obstacle
                  const costFactor = 1 + (inflationCells - dist) / inflationCells * 3;
                  this.costs[nidx] = Math.max(this.costs[nidx], costFactor);
                }
              }
            }
          }
        }
      }
    }
    
    // Apply inflated cells (but keep them walkable)
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] === CELL_FREE && tempCells[i] === CELL_INFLATED) {
        this.cells[i] = CELL_INFLATED;
      }
    }
  }
  
  // Classify zones based on position
  classifyZones() {
    const { cashierLineZ, shoppingMinZ, shoppingMaxZ, shoppingMinX, shoppingMaxX, bypassCorridorX } = this.zoneBounds;
    
    for (let gz = 0; gz < this.gridDepth; gz++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        const idx = this.cellIndex(gx, gz);
        const { x, z } = this.gridToWorld(gx, gz);
        
        if (z < cashierLineZ - 1) {
          // In front of cashiers - entrance area
          this.zones[idx] = ZONE_ENTRANCE;
        } else if (z >= cashierLineZ - 1 && z < cashierLineZ + 3) {
          // Cashier/checkout zone
          this.zones[idx] = ZONE_CHECKOUT;
        } else if (z >= cashierLineZ + 3 && z < shoppingMinZ) {
          // Queue zone (between checkout and shopping)
          this.zones[idx] = ZONE_QUEUE;
        } else if (z >= shoppingMinZ && z <= shoppingMaxZ) {
          // Shopping area
          if (Math.abs(x - bypassCorridorX) < 3) {
            this.zones[idx] = ZONE_BYPASS;
          } else {
            this.zones[idx] = ZONE_SHOPPING;
          }
        } else {
          // Bypass corridor or back of store
          this.zones[idx] = ZONE_BYPASS;
        }
      }
    }
  }
  
  // Generate safe waypoints in each zone
  generateSafeWaypoints() {
    this.safeWaypoints = {
      entrance: [],
      bypass: [],
      shopping: [],
      queue: [],
      aisles: [],
    };
    
    const spacing = 2.0; // Waypoint spacing in meters
    const spacingCells = Math.ceil(spacing / this.resolution);
    
    for (let gz = 0; gz < this.gridDepth; gz += spacingCells) {
      for (let gx = 0; gx < this.gridWidth; gx += spacingCells) {
        if (!this.isWalkable(gx, gz)) continue;
        
        const { x, z } = this.gridToWorld(gx, gz);
        const zone = this.getZone(gx, gz);
        const wp = { x, z, gx, gz };
        
        switch (zone) {
          case ZONE_ENTRANCE:
            this.safeWaypoints.entrance.push(wp);
            break;
          case ZONE_BYPASS:
            this.safeWaypoints.bypass.push(wp);
            break;
          case ZONE_SHOPPING:
            this.safeWaypoints.shopping.push(wp);
            break;
          case ZONE_QUEUE:
            this.safeWaypoints.queue.push(wp);
            break;
        }
      }
    }
    
    // Generate aisle waypoints (spaces between shelf rows)
    this.generateAisleWaypoints();
  }
  
  // Generate waypoints along aisles (between blocked areas)
  generateAisleWaypoints() {
    const { shoppingMinZ, shoppingMaxZ, shoppingMinX, shoppingMaxX } = this.zoneBounds;
    
    // Scan horizontally for gaps between obstacles
    for (let z = shoppingMinZ; z <= shoppingMaxZ; z += 2) {
      const { gz } = this.worldToGrid(0, z);
      let inAisle = false;
      let aisleStart = 0;
      
      for (let gx = 0; gx < this.gridWidth; gx++) {
        const walkable = this.isWalkable(gx, gz);
        
        if (walkable && !inAisle) {
          inAisle = true;
          aisleStart = gx;
        } else if (!walkable && inAisle) {
          // End of aisle - add waypoint in middle
          const midGx = Math.floor((aisleStart + gx) / 2);
          const { x } = this.gridToWorld(midGx, gz);
          if (x >= shoppingMinX && x <= shoppingMaxX) {
            this.safeWaypoints.aisles.push({ x, z, gx: midGx, gz });
          }
          inAisle = false;
        }
      }
    }
  }
  
  // Find nearest walkable cell to a position
  findNearestWalkable(x, z, maxRadius = 5) {
    const { gx, gz } = this.worldToGrid(x, z);
    
    if (this.isWalkable(gx, gz)) {
      return { x, z };
    }
    
    const maxCells = Math.ceil(maxRadius / this.resolution);
    
    for (let r = 1; r <= maxCells; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          
          const ngx = gx + dx;
          const ngz = gz + dz;
          
          if (this.isWalkable(ngx, ngz)) {
            return this.gridToWorld(ngx, ngz);
          }
        }
      }
    }
    
    return null;
  }
  
  // Find nearest STRICTLY walkable cell (not in inflated zone)
  findNearestStrictlyWalkable(x, z, maxRadius = 10) {
    const { gx, gz } = this.worldToGrid(x, z);
    
    if (this.isStrictlyWalkable(gx, gz)) {
      return { x, z };
    }
    
    const maxCells = Math.ceil(maxRadius / this.resolution);
    
    for (let r = 1; r <= maxCells; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          
          const ngx = gx + dx;
          const ngz = gz + dz;
          
          if (this.isStrictlyWalkable(ngx, ngz)) {
            return this.gridToWorld(ngx, ngz);
          }
        }
      }
    }
    
    return null;
  }
  
  // Get random safe waypoint from a zone
  getRandomWaypoint(zone, rng) {
    let waypoints;
    switch (zone) {
      case ZONE_ENTRANCE:
        waypoints = this.safeWaypoints.entrance;
        break;
      case ZONE_BYPASS:
        waypoints = this.safeWaypoints.bypass;
        break;
      case ZONE_SHOPPING:
        waypoints = this.safeWaypoints.shopping.length > 0 
          ? this.safeWaypoints.shopping 
          : this.safeWaypoints.aisles;
        break;
      case ZONE_QUEUE:
        waypoints = this.safeWaypoints.queue;
        break;
      default:
        waypoints = this.safeWaypoints.shopping;
    }
    
    if (waypoints.length === 0) return null;
    return rng.pick(waypoints);
  }
  
  // Get queue start position for a cashier
  getQueuePosition(cashierIndex) {
    if (cashierIndex >= this.cashiers.length) return null;
    const cashier = this.cashiers[cashierIndex];
    return {
      x: cashier.x,
      z: this.zoneBounds.cashierLineZ + 5,
    };
  }
  
  // Debug: export grid as ASCII
  toAscii() {
    let result = '';
    for (let gz = this.gridDepth - 1; gz >= 0; gz--) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        const idx = this.cellIndex(gx, gz);
        const cell = this.cells[idx];
        const zone = this.zones[idx];
        
        if (cell === CELL_BLOCKED) {
          result += '█';
        } else if (cell === CELL_INFLATED) {
          result += '░';
        } else {
          switch (zone) {
            case ZONE_ENTRANCE: result += 'E'; break;
            case ZONE_BYPASS: result += 'B'; break;
            case ZONE_SHOPPING: result += 'S'; break;
            case ZONE_QUEUE: result += 'Q'; break;
            case ZONE_CHECKOUT: result += 'C'; break;
            default: result += '.';
          }
        }
      }
      result += '\n';
    }
    return result;
  }
  
  // Debug: get all blocked objects with their exact geometry
  getBlockedObjectsDebug() {
    return this.blockedObjects || [];
  }
  
  // Debug: trace a path and check for collisions with blocked cells
  tracePathCollisions(path) {
    const collisions = [];
    
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      
      // Check line between waypoints
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const steps = Math.ceil(dist / 0.1); // Check every 10cm
      
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = from.x + dx * t;
        const z = from.z + dz * t;
        
        if (!this.isWalkableWorld(x, z)) {
          collisions.push({
            segmentIndex: i,
            t,
            x,
            z,
            fromWaypoint: from,
            toWaypoint: to,
          });
        }
      }
    }
    
    return collisions;
  }
  
  // Debug: generate wireframe representation
  toWireframe() {
    const lines = [];
    
    // Grid boundary
    lines.push({ type: 'boundary', points: [
      { x: 0, z: 0 },
      { x: this.worldWidth, z: 0 },
      { x: this.worldWidth, z: this.worldDepth },
      { x: 0, z: this.worldDepth },
      { x: 0, z: 0 },
    ]});
    
    // Blocked objects as rectangles
    if (this.blockedObjects) {
      for (const obj of this.blockedObjects) {
        lines.push({
          type: 'obstacle',
          name: obj.name,
          objType: obj.type,
          points: [
            { x: obj.minX, z: obj.minZ },
            { x: obj.maxX, z: obj.minZ },
            { x: obj.maxX, z: obj.maxZ },
            { x: obj.minX, z: obj.maxZ },
            { x: obj.minX, z: obj.minZ },
          ],
        });
      }
    }
    
    // Cashier positions
    for (let i = 0; i < this.cashiers.length; i++) {
      const c = this.cashiers[i];
      lines.push({
        type: 'cashier',
        index: i,
        points: [{ x: c.x, z: this.zoneBounds.cashierLineZ }],
      });
    }
    
    // Entrance
    lines.push({
      type: 'entrance',
      points: [{ x: this.entrancePos.x, z: this.entrancePos.z }],
    });
    
    return lines;
  }
}


export default NavGrid;
