/**
 * SimConfig - All tunable simulation parameters
 * Feature flag: SIM_NAV_V2
 */

export const SIM_CONFIG = {
  // Feature flags
  SIM_NAV_V2: true,
  SIM_BEHAVIOR_V2: true,
  SIM_RECOVERY_V2: true,
  
  // Grid settings
  gridResolution: 0.5,          // meters per cell
  wallInflation: 0.5,           // meters - safety margin around obstacles
  
  // Zone detection (derived from scene, these are fallbacks)
  zones: {
    cashierLineZ: 7,            // Z coordinate of cashier line
    shoppingMinZ: 15,           // Shopping area starts here
    shoppingMaxZ: 35,           // Shopping area ends here
    shoppingMinX: 5,            // Shopping area X bounds
    shoppingMaxX: 30,
    bypassCorridorX: 38,        // Right side bypass corridor
  },
  
  // Arrival and occupancy
  arrivalRatePerMin: 10,        // people/minute entering
  maxOccupancy: 200,            // max people in store
  
  // Personas with probabilities (must sum to 1)
  personas: {
    fastBuyer: {
      probability: 0.3,
      stopsRange: [1, 3],
      speedRange: [1.0, 1.3],
      stayTimeMinRange: [2, 5],
      checkoutProb: 0.9,
    },
    browser: {
      probability: 0.4,
      stopsRange: [4, 8],
      speedRange: [0.7, 1.0],
      stayTimeMinRange: [5, 15],
      checkoutProb: 0.85,
    },
    family: {
      probability: 0.2,
      stopsRange: [3, 6],
      speedRange: [0.5, 0.8],
      stayTimeMinRange: [8, 20],
      checkoutProb: 0.95,
    },
    staff: {
      probability: 0.1,
      stopsRange: [0, 2],
      speedRange: [1.0, 1.2],
      stayTimeMinRange: [30, 60],
      checkoutProb: 0.0,
    },
  },
  
  // Movement
  personalSpaceRadius: 0.5,     // meters
  agentRadius: 0.25,            // meters - physical agent size
  maxSpeed: 1.5,                // m/s
  minSpeed: 0.3,                // m/s
  
  // Dwell times
  browsingDwellSec: [3, 15],    // seconds at each shelf
  queueSpacing: 1.0,            // meters between queued agents
  serviceTimeSec: [15, 60],     // checkout service time range (legacy, see queueBehavior)
  
  // Realistic Checkout Queue Behavior
  queueBehavior: {
    // Pre-queue decision phase
    decisionDwellSec: [1.0, 3.0],       // pause to evaluate lanes
    redecisionDwellSec: [0.5, 1.5],     // shorter dwell when re-evaluating
    perceptionNoise: [0.85, 1.25],      // multiplier for perceived queue cost
    movingLaneBonus: 0.95,              // 5% reduction if lane advanced recently
    movingLaneWindowSec: 10,            // "recently" = within this many seconds
    
    // Commitment and lane switching
    laneSwitchProbability: 0.03,        // base probability of switching (max 0.05)
    stallThresholdSec: 25,              // time without progress before considering switch
    
    // Buffer and queue joining
    bufferDistanceM: 2.0,               // distance from queue tail to buffer point
    
    // Queue progression (stop-and-go)
    reactionDelaySec: [0.5, 1.5],       // delay before advancing
    stepDistanceM: [0.3, 0.8],          // discrete step size
    personalSpaceM: [0.6, 1.0],         // min gap to person in front
    personalSpaceCrowdFactor: 0.85,     // shrink factor when crowded
    maxQueueSlots: 8,                   // max people per lane
    
    // Service at P0 (high variance)
    serviceTimeByBasket: {
      small: [20, 60],                  // seconds - quick shoppers
      medium: [45, 120],                // normal basket
      large: [90, 240],                 // big shoppers
    },
    basketSizeWeights: [0.35, 0.45, 0.20], // small/medium/large probabilities
    frictionEventProb: 0.08,            // chance of delay (card issue, price check)
    frictionTimeSec: [15, 60],          // extra time for friction events
    
    // Exit behavior
    exitSpeedMultiplier: [1.25, 1.40],  // faster exit after checkout
    
    // Service skip prevention
    serviceZoneRadius: 1.0,             // radius around P0 that triggers service check
  },
  
  // Path planning
  pathSmoothingEnabled: true,
  replanIntervalSec: 2.0,       // replan every N seconds if blocked
  waypointReachThreshold: 0.5,  // meters - consider waypoint reached
  
  // Anti-glitch
  stuckSpeedThreshold: 0.05,    // m/s - below this is "stuck"
  stuckTimeThreshold: 2.0,      // seconds before declaring stuck
  oscillationWindow: 10,        // number of positions to track
  oscillationThreshold: 0.3,    // meters std dev for oscillation
  maxRecoveryAttempts: 10,
  recoveryNudgeStrength: 0.5,   // meters
  
  // Output
  outputFrequencyHz: 10,
  addMeasurementNoise: true,
  noiseStdDev: 0.02,            // meters
  
  // Diagnostics
  enableDiagnostics: true,
  logConstraintViolations: true,
  trackHeatmap: true,
  heatmapResolution: 1.0,       // meters per heatmap cell
  
  // Seeded RNG for reproducibility
  seed: null,                   // null = random, number = fixed seed
  
  // ========== CASHIER AGENTS (Feature Flag) ==========
  ENABLE_CASHIER_AGENTS: true,  // Master toggle for cashier simulation
  
  cashierBehavior: {
    // Spawn settings
    cashiersPerLane: 1,           // 0 or 1 (MVP = max 1 per lane)
    spawnAtStart: true,           // Auto-spawn cashiers at simulation start
    staggeredStartSec: [0, 60],   // Stagger shift starts by 0-60 seconds
    
    // Shift schedule
    shiftDurationMin: [30, 180],  // minutes (30 min to 3 hours)
    
    // Break behavior
    breakProbabilityPerHour: 0.15,  // 15% chance per hour to take break
    breakDurationMin: [2, 10],      // minutes
    breakCheckIntervalSec: 60,      // How often to roll for break
    
    // Transition timing
    arrivalTransitionSec: [5, 20],  // Time to walk to position
    leaveTransitionSec: [5, 15],    // Time to walk away
    
    // Service area (synthetic rectangle around cashier position)
    serviceAreaWidth: 1.5,        // meters
    serviceAreaDepth: 1.5,        // meters
    serviceAreaOffsetZ: 0.5,      // offset from cashier position toward queue
    
    // Staff exit point (auto-computed behind checkouts)
    staffExitOffsetZ: -3.0,       // meters behind cashier (negative = toward entrance)
    
    // WORKING state motion model
    jitterSigma: 0.04,            // meters - gaussian step per tick
    microShiftRadius: 0.2,        // meters - occasional shift target radius
    microShiftIntervalSec: [30, 180],  // seconds between micro-shifts
    microShiftDurationSec: [2, 6],     // seconds to complete micro-shift
    microShiftSpeed: 0.1,         // m/s during micro-shift
    
    // Walking speed (ARRIVE/LEAVE/BREAK states)
    walkSpeed: [0.7, 1.3],        // m/s
    
    // LiDAR noise (same as customers but can be tuned separately)
    measurementNoiseSigma: 0.03,  // meters
  },
  
  // Lane open/close detection (ground truth)
  laneOpenClose: {
    openConfirmWindowSec: 120,    // Must be in service area for 2 min to confirm open
    closeGraceWindowSec: 180,     // Lane stays "open" for 3 min after cashier leaves
  },
  
  // Optional: ID confusion simulation (LiDAR tracking errors)
  ENABLE_ID_CONFUSION: false,
  idConfusion: {
    confusionDistance: 0.6,       // meters - trigger distance
    confusionProbPerSec: 0.03,    // probability per second when close
    swapDurationSec: [1, 3],      // how long ID swap lasts
    occlusionDurationSec: [0.5, 2], // how long track drops
  },
};

// Seeded random number generator (Mulberry32)
export class SeededRandom {
  constructor(seed = null) {
    this.seed = seed !== null ? seed : Math.floor(Math.random() * 2147483647);
    this.state = this.seed;
  }
  
  next() {
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  
  range(min, max) {
    return min + this.next() * (max - min);
  }
  
  rangeInt(min, max) {
    return Math.floor(this.range(min, max + 1));
  }
  
  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }
  
  gaussian(mean = 0, stdDev = 1) {
    const u1 = this.next();
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdDev;
  }
  
  pickWeighted(items, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
}

// Select persona based on probabilities
export function selectPersona(rng, config = SIM_CONFIG) {
  const personas = Object.entries(config.personas);
  const names = personas.map(([name]) => name);
  const probs = personas.map(([, p]) => p.probability);
  return rng.pickWeighted(names, probs);
}

export default SIM_CONFIG;
