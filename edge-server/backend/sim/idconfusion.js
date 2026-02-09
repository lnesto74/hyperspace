/**
 * IDConfusion - Optional simulation of LiDAR tracking errors
 * 
 * Simulates:
 * - ID swaps when customer and cashier are very close
 * - Temporary track occlusion (drop one track briefly)
 * 
 * This is ONLY for simulation realism testing.
 * Does not change output schema - just modifies track IDs temporarily.
 */

import { SIM_CONFIG } from './simconfig.js';

export class IDConfusionManager {
  constructor(rng) {
    this.rng = rng;
    this.enabled = SIM_CONFIG.ENABLE_ID_CONFUSION || false;
    this.cfg = SIM_CONFIG.idConfusion || {};
    
    // Active confusions: { pairKey: { type: 'swap'|'occlusion', startTime, duration, agent1Id, agent2Id } }
    this.activeConfusions = new Map();
    
    // Track ID overrides: { originalId: displayId }
    this.idOverrides = new Map();
    
    // Occluded tracks (temporarily invisible)
    this.occludedTracks = new Set();
  }
  
  /**
   * Update confusion state based on agent positions
   * @param {Array} customers - Array of customer agents
   * @param {Array} cashiers - Array of cashier agents
   * @param {number} dt - Delta time in seconds
   */
  update(customers, cashiers, dt) {
    if (!this.enabled) return;
    
    const confusionDist = this.cfg.confusionDistance || 0.6;
    const confusionProb = (this.cfg.confusionProbPerSec || 0.03) * dt;
    
    // Check for new confusion opportunities
    for (const customer of customers) {
      if (!customer.spawned || customer.state === 'DONE') continue;
      
      for (const cashier of cashiers) {
        if (!cashier.spawned || cashier.state === 'DONE') continue;
        
        const dx = customer.x - cashier.x;
        const dz = customer.z - cashier.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist < confusionDist) {
          const pairKey = `${customer.id}-${cashier.id}`;
          
          // Check if already confused
          if (this.activeConfusions.has(pairKey)) continue;
          
          // Roll for confusion
          if (this.rng.next() < confusionProb) {
            this.startConfusion(customer, cashier, pairKey);
          }
        }
      }
    }
    
    // Update and expire active confusions
    const now = Date.now();
    const toRemove = [];
    
    for (const [pairKey, confusion] of this.activeConfusions) {
      const elapsed = (now - confusion.startTime) / 1000;
      
      if (elapsed >= confusion.duration) {
        toRemove.push(pairKey);
      }
    }
    
    for (const pairKey of toRemove) {
      this.endConfusion(pairKey);
    }
  }
  
  /**
   * Start a confusion event between two agents
   */
  startConfusion(customer, cashier, pairKey) {
    // Decide type: swap or occlusion
    const isSwap = this.rng.next() < 0.5;
    
    if (isSwap) {
      // Swap IDs
      const duration = this.rng.range(
        this.cfg.swapDurationSec?.[0] || 1,
        this.cfg.swapDurationSec?.[1] || 3
      );
      
      this.activeConfusions.set(pairKey, {
        type: 'swap',
        startTime: Date.now(),
        duration,
        agent1Id: customer.id,
        agent2Id: cashier.id,
        agent1Type: 'customer',
        agent2Type: 'cashier',
      });
      
      // Set ID overrides
      const customerId = `person-${customer.id}`;
      const cashierId = `cashier-${cashier.id}`;
      this.idOverrides.set(customerId, cashierId);
      this.idOverrides.set(cashierId, customerId);
      
      console.log(`[IDConfusion] SWAP started: ${customerId} <-> ${cashierId} for ${duration.toFixed(1)}s`);
    } else {
      // Occlusion - drop one track
      const duration = this.rng.range(
        this.cfg.occlusionDurationSec?.[0] || 0.5,
        this.cfg.occlusionDurationSec?.[1] || 2
      );
      
      // Randomly pick which one to occlude
      const occludeCustomer = this.rng.next() < 0.5;
      const occludedId = occludeCustomer 
        ? `person-${customer.id}` 
        : `cashier-${cashier.id}`;
      
      this.activeConfusions.set(pairKey, {
        type: 'occlusion',
        startTime: Date.now(),
        duration,
        occludedId,
        agent1Id: customer.id,
        agent2Id: cashier.id,
      });
      
      this.occludedTracks.add(occludedId);
      
      console.log(`[IDConfusion] OCCLUSION started: ${occludedId} hidden for ${duration.toFixed(1)}s`);
    }
  }
  
  /**
   * End a confusion event
   */
  endConfusion(pairKey) {
    const confusion = this.activeConfusions.get(pairKey);
    if (!confusion) return;
    
    if (confusion.type === 'swap') {
      const customerId = `person-${confusion.agent1Id}`;
      const cashierId = `cashier-${confusion.agent2Id}`;
      this.idOverrides.delete(customerId);
      this.idOverrides.delete(cashierId);
      console.log(`[IDConfusion] SWAP ended: ${customerId} <-> ${cashierId}`);
    } else if (confusion.type === 'occlusion') {
      this.occludedTracks.delete(confusion.occludedId);
      console.log(`[IDConfusion] OCCLUSION ended: ${confusion.occludedId} visible again`);
    }
    
    this.activeConfusions.delete(pairKey);
  }
  
  /**
   * Get the display ID for an agent (may be swapped)
   */
  getDisplayId(originalId) {
    if (!this.enabled) return originalId;
    return this.idOverrides.get(originalId) || originalId;
  }
  
  /**
   * Check if a track should be hidden (occluded)
   */
  isOccluded(trackId) {
    if (!this.enabled) return false;
    return this.occludedTracks.has(trackId);
  }
  
  /**
   * Apply confusion effects to a track message
   * Returns null if track should be hidden, otherwise returns modified message
   */
  applyToMessage(message) {
    if (!this.enabled) return message;
    
    const trackId = message.id;
    
    // Check occlusion
    if (this.isOccluded(trackId)) {
      return null; // Hide this track
    }
    
    // Apply ID swap
    const displayId = this.getDisplayId(trackId);
    if (displayId !== trackId) {
      return {
        ...message,
        id: displayId,
        metadata: {
          ...message.metadata,
          _originalId: trackId, // For debugging only
        },
      };
    }
    
    return message;
  }
  
  /**
   * Get active confusion count (for diagnostics)
   */
  getActiveCount() {
    return this.activeConfusions.size;
  }
  
  /**
   * Get diagnostics
   */
  getDiagnostics() {
    return {
      enabled: this.enabled,
      activeConfusions: this.activeConfusions.size,
      idOverrides: this.idOverrides.size,
      occludedTracks: this.occludedTracks.size,
    };
  }
  
  /**
   * Reset all confusion state
   */
  reset() {
    this.activeConfusions.clear();
    this.idOverrides.clear();
    this.occludedTracks.clear();
  }
}

export default IDConfusionManager;
