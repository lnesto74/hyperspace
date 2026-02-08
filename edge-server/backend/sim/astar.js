/**
 * AStar - Grid-based A* path planner
 * Works with NavGrid for pathfinding
 */

import { SIM_CONFIG } from './simconfig.js';

// Priority queue using binary heap
class PriorityQueue {
  constructor() {
    this.heap = [];
  }
  
  push(item, priority) {
    this.heap.push({ item, priority });
    this.bubbleUp(this.heap.length - 1);
  }
  
  pop() {
    if (this.heap.length === 0) return null;
    const result = this.heap[0].item;
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return result;
  }
  
  isEmpty() {
    return this.heap.length === 0;
  }
  
  bubbleUp(idx) {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this.heap[parent].priority <= this.heap[idx].priority) break;
      [this.heap[parent], this.heap[idx]] = [this.heap[idx], this.heap[parent]];
      idx = parent;
    }
  }
  
  bubbleDown(idx) {
    while (true) {
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      let smallest = idx;
      
      if (left < this.heap.length && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }
      if (right < this.heap.length && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }
      if (smallest === idx) break;
      
      [this.heap[smallest], this.heap[idx]] = [this.heap[idx], this.heap[smallest]];
      idx = smallest;
    }
  }
}

// 8-directional neighbors
const NEIGHBORS = [
  { dx: -1, dz: 0, cost: 1.0 },
  { dx: 1, dz: 0, cost: 1.0 },
  { dx: 0, dz: -1, cost: 1.0 },
  { dx: 0, dz: 1, cost: 1.0 },
  { dx: -1, dz: -1, cost: 1.414 },
  { dx: 1, dz: -1, cost: 1.414 },
  { dx: -1, dz: 1, cost: 1.414 },
  { dx: 1, dz: 1, cost: 1.414 },
];

export class AStar {
  constructor(navGrid) {
    this.grid = navGrid;
    this.maxIterations = 5000; // Prevent infinite loops
  }
  
  // Heuristic: Euclidean distance
  heuristic(gx1, gz1, gx2, gz2) {
    const dx = gx2 - gx1;
    const dz = gz2 - gz1;
    return Math.sqrt(dx * dx + dz * dz);
  }
  
  // Find path from world coords to world coords
  findPath(startX, startZ, goalX, goalZ, options = {}) {
    const start = this.grid.worldToGrid(startX, startZ);
    const goal = this.grid.worldToGrid(goalX, goalZ);
    
    // Check if goal is walkable, find nearest if not
    if (!this.grid.isWalkable(goal.gx, goal.gz)) {
      const nearest = this.grid.findNearestWalkable(goalX, goalZ);
      if (!nearest) return null;
      const newGoal = this.grid.worldToGrid(nearest.x, nearest.z);
      goal.gx = newGoal.gx;
      goal.gz = newGoal.gz;
    }
    
    // Check if start is walkable
    if (!this.grid.isWalkable(start.gx, start.gz)) {
      const nearest = this.grid.findNearestWalkable(startX, startZ);
      if (!nearest) return null;
      const newStart = this.grid.worldToGrid(nearest.x, nearest.z);
      start.gx = newStart.gx;
      start.gz = newStart.gz;
    }
    
    // A* search
    const openSet = new PriorityQueue();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    
    const startKey = `${start.gx},${start.gz}`;
    const goalKey = `${goal.gx},${goal.gz}`;
    
    gScore.set(startKey, 0);
    fScore.set(startKey, this.heuristic(start.gx, start.gz, goal.gx, goal.gz));
    openSet.push({ gx: start.gx, gz: start.gz }, fScore.get(startKey));
    
    const closedSet = new Set();
    let iterations = 0;
    
    while (!openSet.isEmpty() && iterations < this.maxIterations) {
      iterations++;
      const current = openSet.pop();
      const currentKey = `${current.gx},${current.gz}`;
      
      // Reached goal
      if (current.gx === goal.gx && current.gz === goal.gz) {
        return this.reconstructPath(cameFrom, current, options.smooth !== false);
      }
      
      if (closedSet.has(currentKey)) continue;
      closedSet.add(currentKey);
      
      // Explore neighbors
      for (const neighbor of NEIGHBORS) {
        const ngx = current.gx + neighbor.dx;
        const ngz = current.gz + neighbor.dz;
        const neighborKey = `${ngx},${ngz}`;
        
        if (closedSet.has(neighborKey)) continue;
        if (!this.grid.isWalkable(ngx, ngz)) continue;
        
        // Check diagonal movement doesn't cut corners
        if (neighbor.dx !== 0 && neighbor.dz !== 0) {
          if (!this.grid.isWalkable(current.gx + neighbor.dx, current.gz) ||
              !this.grid.isWalkable(current.gx, current.gz + neighbor.dz)) {
            continue;
          }
        }
        
        // Calculate cost
        const moveCost = neighbor.cost * this.grid.getCost(ngx, ngz);
        const tentativeG = gScore.get(currentKey) + moveCost;
        
        if (!gScore.has(neighborKey) || tentativeG < gScore.get(neighborKey)) {
          cameFrom.set(neighborKey, current);
          gScore.set(neighborKey, tentativeG);
          const h = this.heuristic(ngx, ngz, goal.gx, goal.gz);
          fScore.set(neighborKey, tentativeG + h);
          openSet.push({ gx: ngx, gz: ngz }, fScore.get(neighborKey));
        }
      }
    }
    
    // No path found
    return null;
  }
  
  // Reconstruct path from A* result
  reconstructPath(cameFrom, goal, smooth = true) {
    const path = [];
    let current = goal;
    
    while (current) {
      const worldPos = this.grid.gridToWorld(current.gx, current.gz);
      path.unshift(worldPos);
      const key = `${current.gx},${current.gz}`;
      current = cameFrom.get(key);
    }
    
    if (smooth && SIM_CONFIG.pathSmoothingEnabled) {
      return this.smoothPath(path);
    }
    
    return path;
  }
  
  // Smooth path by removing unnecessary waypoints
  smoothPath(path) {
    if (path.length <= 2) return path;
    
    const smoothed = [path[0]];
    let current = 0;
    
    while (current < path.length - 1) {
      // Try to find furthest visible point
      let furthest = current + 1;
      
      for (let i = path.length - 1; i > current + 1; i--) {
        if (this.hasLineOfSight(path[current], path[i])) {
          furthest = i;
          break;
        }
      }
      
      smoothed.push(path[furthest]);
      current = furthest;
    }
    
    return smoothed;
  }
  
  // Check if there's a clear CORRIDOR between two points (not just a line)
  // This prevents path smoothing from creating shortcuts that graze obstacles
  hasLineOfSight(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    
    // Use finer step size for more accurate collision detection
    const stepSize = this.grid.resolution * 0.25;
    const steps = Math.ceil(dist / stepSize);
    
    // Check corridor width = agent radius + safety margin
    const corridorHalfWidth = SIM_CONFIG.agentRadius + 0.2;
    
    // Perpendicular direction for corridor checks
    const perpX = -dz / dist;
    const perpZ = dx / dist;
    
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const centerX = from.x + dx * t;
      const centerZ = from.z + dz * t;
      
      // Use STRICT walkability to prevent smoothing through inflated zones
      // Check center line
      if (!this.grid.isStrictlyWalkableWorld(centerX, centerZ)) {
        return false;
      }
      
      // Check left side of corridor
      if (!this.grid.isStrictlyWalkableWorld(centerX + perpX * corridorHalfWidth, centerZ + perpZ * corridorHalfWidth)) {
        return false;
      }
      
      // Check right side of corridor
      if (!this.grid.isStrictlyWalkableWorld(centerX - perpX * corridorHalfWidth, centerZ - perpZ * corridorHalfWidth)) {
        return false;
      }
    }
    
    return true;
  }
  
  // Find path that respects directional gates
  findPathWithGates(startX, startZ, goalX, goalZ, gates, agentState) {
    // First try direct path
    let path = this.findPath(startX, startZ, goalX, goalZ);
    
    if (!path) return null;
    
    // Check if path crosses any gate in forbidden direction
    for (const gate of gates) {
      const violation = this.checkGateViolation(path, gate, agentState);
      if (violation) {
        // Path violates gate - need to go around
        // Add intermediate waypoint to bypass
        const bypassPoint = gate.getBypassPoint(startX, startZ, goalX, goalZ);
        if (bypassPoint) {
          const path1 = this.findPath(startX, startZ, bypassPoint.x, bypassPoint.z);
          const path2 = this.findPath(bypassPoint.x, bypassPoint.z, goalX, goalZ);
          
          if (path1 && path2) {
            // Combine paths, removing duplicate waypoint
            path = [...path1, ...path2.slice(1)];
          }
        }
      }
    }
    
    return path;
  }
  
  // Check if path violates a directional gate
  checkGateViolation(path, gate, agentState) {
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      
      if (gate.crossesInForbiddenDirection(from, to, agentState)) {
        return { segmentIndex: i, from, to };
      }
    }
    return null;
  }
}

export default AStar;
