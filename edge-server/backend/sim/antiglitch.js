/**
 * AntiGlitch - Stuck detection and recovery system
 * Prevents agents from getting stuck, oscillating, or deadlocking
 */

import { SIM_CONFIG } from './simconfig.js';

export class AntiGlitch {
  constructor(navGrid) {
    this.navGrid = navGrid;
    this.agentHistory = new Map(); // agentId -> position history
    this.stuckEvents = [];
    this.recoveryActions = [];
  }
  
  // Initialize tracking for an agent
  initAgent(agentId) {
    this.agentHistory.set(agentId, {
      positions: [],
      stuckCounter: 0,
      lastSpeed: 0,
      lowSpeedTime: 0,
      recoveryAttempts: 0,
      lastRecoveryTime: 0,
      oscillationDetected: false,
    });
  }
  
  // Remove agent tracking
  removeAgent(agentId) {
    this.agentHistory.delete(agentId);
  }
  
  // Update agent tracking and check for stuck conditions
  update(agent, dt) {
    // Skip agents in SERVICE or IN_QUEUE states - they're supposed to be stationary
    if (agent.state === 'SERVICE' || agent.state === 'IN_QUEUE') {
      return null;
    }
    
    // Be lenient with EXITING agents near cashier area - don't warp them
    // They may just need time to path around checkout obstacles
    const isExiting = agent.state === 'EXITING' || agent.state === 'EXIT_FAST';
    const isNearCashiers = agent.z < 12; // Within checkout area (Z < 12)
    
    if (isExiting && isNearCashiers) {
      // Only allow nudge actions, no warping for agents exiting near cashiers
      const history = this.agentHistory.get(agent.id);
      if (history && history.stuckCounter > 6) {
        // Reset counter and just nudge instead of warp
        history.stuckCounter = 3;
      }
    }
    
    let history = this.agentHistory.get(agent.id);
    if (!history) {
      this.initAgent(agent.id);
      history = this.agentHistory.get(agent.id);
    }
    
    // Track position
    history.positions.push({ x: agent.x, z: agent.z, time: Date.now() });
    
    // Keep only recent positions
    const maxHistory = SIM_CONFIG.oscillationWindow;
    if (history.positions.length > maxHistory) {
      history.positions.shift();
    }
    
    // Calculate current speed
    const speed = Math.sqrt(agent.vx * agent.vx + agent.vz * agent.vz);
    history.lastSpeed = speed;
    
    // Check for stuck (low speed)
    if (speed < SIM_CONFIG.stuckSpeedThreshold) {
      history.lowSpeedTime += dt;
    } else {
      history.lowSpeedTime = Math.max(0, history.lowSpeedTime - dt * 2); // Decay
    }
    
    // Check for oscillation
    const oscillating = this.detectOscillation(history);
    history.oscillationDetected = oscillating;
    
    // Determine if agent is stuck
    const isStuck = history.lowSpeedTime > SIM_CONFIG.stuckTimeThreshold || oscillating;
    
    if (isStuck) {
      history.stuckCounter++;
      return this.getRecoveryAction(agent, history);
    } else {
      // Gradually reduce stuck counter
      history.stuckCounter = Math.max(0, history.stuckCounter - 0.5);
    }
    
    return null; // No recovery needed
  }
  
  // Detect oscillation pattern (moving back and forth)
  detectOscillation(history) {
    if (history.positions.length < SIM_CONFIG.oscillationWindow) {
      return false;
    }
    
    const positions = history.positions;
    
    // Calculate standard deviation of positions
    const avgX = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const avgZ = positions.reduce((s, p) => s + p.z, 0) / positions.length;
    
    const variance = positions.reduce((s, p) => {
      return s + (p.x - avgX) ** 2 + (p.z - avgZ) ** 2;
    }, 0) / positions.length;
    
    const stdDev = Math.sqrt(variance);
    
    // Check time span
    const timeSpan = (positions[positions.length - 1].time - positions[0].time) / 1000;
    
    // Oscillating if low movement variance over extended time
    return stdDev < SIM_CONFIG.oscillationThreshold && timeSpan > 3;
  }
  
  // Get appropriate recovery action based on stuck severity
  getRecoveryAction(agent, history) {
    const severity = history.stuckCounter;
    
    // Cooldown between recovery attempts
    const now = Date.now();
    if (now - history.lastRecoveryTime < 500) {
      return null;
    }
    history.lastRecoveryTime = now;
    history.recoveryAttempts++;
    
    let action;
    
    if (severity <= 3) {
      // Level 1: Random nudge
      action = {
        type: 'nudge',
        dx: (Math.random() - 0.5) * SIM_CONFIG.recoveryNudgeStrength * 2,
        dz: (Math.random() - 0.5) * SIM_CONFIG.recoveryNudgeStrength * 2,
        replan: false,
      };
    } else if (severity <= 6) {
      // Level 2: Nudge + replan
      action = {
        type: 'nudge_replan',
        dx: (Math.random() - 0.5) * SIM_CONFIG.recoveryNudgeStrength * 3,
        dz: (Math.random() - 0.5) * SIM_CONFIG.recoveryNudgeStrength * 3,
        replan: true,
        shrinkPersonalSpace: true,
      };
    } else if (severity <= SIM_CONFIG.maxRecoveryAttempts) {
      // Level 3: Warp to nearest safe waypoint
      const safePoint = this.findNearestSafeWaypoint(agent);
      if (safePoint) {
        action = {
          type: 'warp_safe',
          x: safePoint.x,
          z: safePoint.z,
          replan: true,
        };
      } else {
        // Fallback: gradient descent to walkable
        const walkable = this.navGrid.findNearestWalkable(agent.x, agent.z);
        if (walkable) {
          action = {
            type: 'warp_walkable',
            x: walkable.x,
            z: walkable.z,
            replan: true,
          };
        }
      }
    } else {
      // Emergency: force complete path reset
      action = {
        type: 'reset_path',
        replan: true,
        resetWaypoints: true,
      };
      history.stuckCounter = 0;
      history.recoveryAttempts = 0;
    }
    
    if (action) {
      this.logStuckEvent(agent, action, severity);
    }
    
    return action;
  }
  
  // Find safe waypoint for emergency warp - prefer direction of travel
  findNearestSafeWaypoint(agent) {
    const allWaypoints = [
      ...this.navGrid.safeWaypoints.shopping,
      ...this.navGrid.safeWaypoints.aisles,
      ...this.navGrid.safeWaypoints.bypass,
      ...this.navGrid.safeWaypoints.queue,
    ];
    
    if (allWaypoints.length === 0) return null;
    
    // Determine target direction based on agent state
    let targetX = this.navGrid.entrancePos?.x || agent.x;
    let targetZ = this.navGrid.entrancePos?.z || 0;
    
    // If agent is exiting, warp toward entrance
    // If agent is in shopping area, warp away from cashiers
    const isExiting = agent.state === 'EXITING' || agent.state === 'EXIT_FAST';
    const isNearCashiers = agent.z < 15; // Cashier area
    
    let best = null;
    let bestScore = -Infinity;
    
    const MIN_WARP_DIST = 3; // Minimum 3m warp distance
    const MAX_WARP_DIST = 15; // Don't warp too far
    
    for (const wp of allWaypoints) {
      const dist = Math.sqrt((wp.x - agent.x) ** 2 + (wp.z - agent.z) ** 2);
      
      // Skip waypoints too close or too far
      if (dist < MIN_WARP_DIST || dist > MAX_WARP_DIST) continue;
      
      // Calculate direction score (prefer waypoints toward destination)
      const toWpX = wp.x - agent.x;
      const toWpZ = wp.z - agent.z;
      const toTargetX = targetX - agent.x;
      const toTargetZ = targetZ - agent.z;
      
      // Dot product for direction alignment
      const dot = toWpX * toTargetX + toWpZ * toTargetZ;
      const dirScore = dot / (dist + 0.1);
      
      // Bonus for exiting agents: prefer waypoints closer to entrance (lower Z)
      const exitBonus = isExiting ? (agent.z - wp.z) * 0.5 : 0;
      
      // Bonus for agents near cashiers: prefer waypoints further from cashier line
      const cashierBonus = isNearCashiers ? (wp.z - 10) * 0.3 : 0;
      
      const score = dirScore + exitBonus + cashierBonus - dist * 0.1;
      
      if (score > bestScore) {
        bestScore = score;
        best = wp;
      }
    }
    
    // Fallback: if no good waypoint found, create one in exit direction
    if (!best && isExiting) {
      const fallbackDist = 5;
      const dirToExit = Math.atan2(targetX - agent.x, targetZ - agent.z);
      const fallbackX = agent.x + Math.sin(dirToExit) * fallbackDist;
      const fallbackZ = agent.z + Math.cos(dirToExit) * fallbackDist;
      
      if (this.navGrid.isWalkableWorld(fallbackX, fallbackZ)) {
        return { x: fallbackX, z: fallbackZ };
      }
    }
    
    return best;
  }
  
  // Apply recovery action to agent
  applyRecovery(agent, action, rng) {
    if (!action) return false;
    
    switch (action.type) {
      case 'nudge':
      case 'nudge_replan': {
        // Apply nudge
        let newX = agent.x + action.dx;
        let newZ = agent.z + action.dz;
        
        // Ensure nudge lands in walkable area
        if (!this.navGrid.isWalkableWorld(newX, newZ)) {
          const walkable = this.navGrid.findNearestWalkable(newX, newZ, 2);
          if (walkable) {
            newX = walkable.x;
            newZ = walkable.z;
          } else {
            return false;
          }
        }
        
        agent.x = newX;
        agent.z = newZ;
        
        if (action.shrinkPersonalSpace) {
          agent.personalSpaceMultiplier = 0.5;
          agent.personalSpaceRestoreTime = 2.0;
        }
        
        return action.replan;
      }
      
      case 'warp_safe':
      case 'warp_walkable': {
        agent.x = action.x;
        agent.z = action.z;
        return true; // Always replan after warp
      }
      
      case 'reset_path': {
        // Will be handled by agent - just signal
        return true;
      }
    }
    
    return false;
  }
  
  // Log stuck event for diagnostics
  logStuckEvent(agent, action, severity) {
    const event = {
      time: Date.now(),
      agentId: agent.id,
      state: agent.state,
      position: { x: agent.x, z: agent.z },
      action: action.type,
      severity,
    };
    
    this.stuckEvents.push(event);
    
    // Keep only recent events
    if (this.stuckEvents.length > 1000) {
      this.stuckEvents = this.stuckEvents.slice(-500);
    }
    
    if (SIM_CONFIG.logConstraintViolations) {
      console.log(`[AntiGlitch] Agent ${agent.id} stuck (severity=${severity}): ${action.type}`);
    }
  }
  
  // Get diagnostics
  getDiagnostics() {
    const recentTime = Date.now() - 60000; // Last minute
    const recentEvents = this.stuckEvents.filter(e => e.time >= recentTime);
    
    const byType = {};
    for (const event of recentEvents) {
      byType[event.action] = (byType[event.action] || 0) + 1;
    }
    
    return {
      totalStuckEvents: this.stuckEvents.length,
      recentStuckEvents: recentEvents.length,
      byActionType: byType,
      activeAgents: this.agentHistory.size,
    };
  }
  
  // Clear old data
  clearOldData(olderThan = 300000) {
    const cutoff = Date.now() - olderThan;
    this.stuckEvents = this.stuckEvents.filter(e => e.time >= cutoff);
  }
}

export default AntiGlitch;
