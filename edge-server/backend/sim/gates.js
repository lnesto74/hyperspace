/**
 * Gates - Directional constraint enforcement
 * Ensures agents only cross checkout lanes in exit direction
 */

import { SIM_CONFIG } from './simconfig.js';

// Agent states that are allowed to cross checkout gates
const CHECKOUT_ALLOWED_STATES = ['CHECKOUT', 'EXITING'];
const ENTRY_ALLOWED_STATES = ['ENTERING', 'SPAWN'];

export class DirectionalGate {
  constructor(options) {
    this.name = options.name || 'gate';
    
    // Gate line segment
    this.x1 = options.x1;
    this.z1 = options.z1;
    this.x2 = options.x2;
    this.z2 = options.z2;
    
    // Allowed direction (normalized vector pointing in allowed crossing direction)
    this.allowedDirX = options.allowedDirX || 0;
    this.allowedDirZ = options.allowedDirZ || -1; // Default: only allow crossing toward -Z
    
    // Which states can cross this gate
    this.allowedStates = options.allowedStates || CHECKOUT_ALLOWED_STATES;
    
    // Bypass point (where to go to properly enter/exit)
    this.bypassX = options.bypassX;
    this.bypassZ = options.bypassZ;
  }
  
  // Check if a movement from->to crosses this gate
  crossesGate(from, to) {
    // Line segment intersection test
    return this.lineSegmentsIntersect(
      from.x, from.z, to.x, to.z,
      this.x1, this.z1, this.x2, this.z2
    );
  }
  
  // Check if crossing is in forbidden direction
  crossesInForbiddenDirection(from, to, agentState) {
    if (!this.crossesGate(from, to)) {
      return false;
    }
    
    // Check if agent state allows crossing
    if (this.allowedStates.includes(agentState)) {
      // Check direction
      const moveX = to.x - from.x;
      const moveZ = to.z - from.z;
      const dot = moveX * this.allowedDirX + moveZ * this.allowedDirZ;
      
      // If moving in allowed direction, it's okay
      if (dot > 0) {
        return false;
      }
    }
    
    // Crossing in forbidden direction or wrong state
    return true;
  }
  
  // Get bypass point to go around this gate
  getBypassPoint(fromX, fromZ, toX, toZ) {
    if (this.bypassX !== undefined && this.bypassZ !== undefined) {
      return { x: this.bypassX, z: this.bypassZ };
    }
    
    // Default: go around the end of the gate line
    const gateLength = Math.sqrt(
      (this.x2 - this.x1) ** 2 + (this.z2 - this.z1) ** 2
    );
    
    // Pick the end closer to the start position
    const dist1 = Math.sqrt((fromX - this.x1) ** 2 + (fromZ - this.z1) ** 2);
    const dist2 = Math.sqrt((fromX - this.x2) ** 2 + (fromZ - this.z2) ** 2);
    
    if (dist1 < dist2) {
      return { x: this.x1 - 2, z: this.z1 };
    } else {
      return { x: this.x2 + 2, z: this.z2 };
    }
  }
  
  // Line segment intersection test
  lineSegmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (Math.abs(denom) < 0.0001) return false;
    
    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
    
    return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
  }
}

export class GateManager {
  constructor(navGrid) {
    this.gates = [];
    this.navGrid = navGrid;
    this.violations = [];
  }
  
  // Build gates from scene (cashier line)
  buildFromScene(objects) {
    const { cashierLineZ, checkoutMinX, checkoutMaxX, bypassCorridorX } = this.navGrid.zoneBounds;
    
    // Main cashier gate: horizontal line at cashier Z
    // Only allow crossing from z > cashierLineZ to z < cashierLineZ (exit direction)
    const cashierGate = new DirectionalGate({
      name: 'cashier-line',
      x1: checkoutMinX || 5,
      z1: cashierLineZ,
      x2: checkoutMaxX || 35,
      z2: cashierLineZ,
      allowedDirX: 0,
      allowedDirZ: -1, // Only allow crossing toward entrance (negative Z)
      allowedStates: CHECKOUT_ALLOWED_STATES,
      bypassX: bypassCorridorX,
      bypassZ: cashierLineZ + 10, // Go above cashier line via bypass
    });
    
    this.gates.push(cashierGate);
    
    console.log(`Built ${this.gates.length} directional gates`);
  }
  
  // Check if a movement violates any gate
  checkMovement(from, to, agentState) {
    for (const gate of this.gates) {
      if (gate.crossesInForbiddenDirection(from, to, agentState)) {
        return {
          violated: true,
          gate,
          bypass: gate.getBypassPoint(from.x, from.z, to.x, to.z),
        };
      }
    }
    return { violated: false };
  }
  
  // Block movement if it violates a gate
  enforceGates(agent, newX, newZ) {
    const from = { x: agent.x, z: agent.z };
    const to = { x: newX, z: newZ };
    
    const check = this.checkMovement(from, to, agent.state);
    
    if (check.violated) {
      // Log violation
      this.violations.push({
        time: Date.now(),
        agentId: agent.id,
        gate: check.gate.name,
        from,
        to,
        state: agent.state,
      });
      
      // Don't allow the movement
      return {
        allowed: false,
        x: agent.x,
        z: agent.z,
        needsReplan: true,
        bypass: check.bypass,
      };
    }
    
    return {
      allowed: true,
      x: newX,
      z: newZ,
      needsReplan: false,
    };
  }
  
  // Get recent violations for diagnostics
  getViolations(since = 0) {
    return this.violations.filter(v => v.time >= since);
  }
  
  // Clear old violations
  clearOldViolations(olderThan = 60000) {
    const cutoff = Date.now() - olderThan;
    this.violations = this.violations.filter(v => v.time >= cutoff);
  }
}

export default GateManager;
