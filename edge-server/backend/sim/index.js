/**
 * Simulation V2 Module Index
 * Feature flags: SIM_NAV_V2, SIM_BEHAVIOR_V2, SIM_RECOVERY_V2
 */

import { SIM_CONFIG, SeededRandom, selectPersona } from './simconfig.js';
import NavGrid, { CELL_FREE, CELL_BLOCKED, CELL_INFLATED, ZONE_NONE, ZONE_ENTRANCE, ZONE_BYPASS, ZONE_SHOPPING, ZONE_QUEUE, ZONE_CHECKOUT } from './navgrid.js';
import AStar from './astar.js';
import { DirectionalGate, GateManager } from './gates.js';
import AntiGlitch from './antiglitch.js';
import { CheckoutQueueSubsystem, QUEUE_STATE } from './checkoutqueue.js';
import { AgentV2, STATE } from './agent.js';
import SimulatorV2 from './simulator.js';

export {
  SIM_CONFIG,
  SeededRandom,
  selectPersona,
  NavGrid,
  CELL_FREE,
  CELL_BLOCKED,
  CELL_INFLATED,
  ZONE_NONE,
  ZONE_ENTRANCE,
  ZONE_BYPASS,
  ZONE_SHOPPING,
  ZONE_QUEUE,
  ZONE_CHECKOUT,
  AStar,
  DirectionalGate,
  GateManager,
  AntiGlitch,
  CheckoutQueueSubsystem,
  QUEUE_STATE,
  AgentV2,
  STATE,
  SimulatorV2,
};

export default SimulatorV2;
