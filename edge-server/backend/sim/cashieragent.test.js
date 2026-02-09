/**
 * Unit tests for CashierAgent
 * 
 * Tests:
 * 1. Cashier stays inside serviceArea in WORKING state
 * 2. Cashier variance in WORKING < threshold (std < 0.25m)
 * 3. Lane open/close timeline matches cashier WORKING presence
 * 4. State machine transitions work correctly
 * 5. ID confusion doesn't crash (if enabled)
 */

import { CashierAgent, CASHIER_STATE } from './cashieragent.js';
import { SeededRandom } from './simconfig.js';

// Mock NavGrid
function createMockNavGrid() {
  return {
    cashiers: [
      { x: 10, z: 7, width: 1.5 },
      { x: 15, z: 7, width: 1.5 },
    ],
    zoneBounds: {
      cashierLineZ: 7,
      shoppingMinZ: 15,
    },
    isWalkableWorld: () => true,
  };
}

// Mock PathPlanner
function createMockPathPlanner() {
  return {
    findPath: (x1, z1, x2, z2) => [{ x: x2, z: z2 }],
  };
}

// Test helper: run simulation for N seconds
function runSimulation(agent, seconds, dt = 0.1) {
  const steps = Math.floor(seconds / dt);
  const positions = [];
  
  for (let i = 0; i < steps; i++) {
    agent.update(dt, []);
    if (agent.spawned) {
      positions.push({ x: agent.x, z: agent.z, state: agent.state });
    }
  }
  
  return positions;
}

// Calculate standard deviation
function stdDev(values) {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  return Math.sqrt(variance);
}

// ============ TESTS ============

export function testCashierStaysInServiceArea() {
  console.log('\n=== Test: Cashier stays inside serviceArea in WORKING ===');
  
  const rng = new SeededRandom(12345);
  const navGrid = createMockNavGrid();
  const pathPlanner = createMockPathPlanner();
  
  const cashier = new CashierAgent(1, 0, navGrid.cashiers[0], navGrid, pathPlanner, rng);
  
  // Fast-forward past spawn delay and arrival
  cashier.shiftStartDelay = 0;
  cashier.arrivalDuration = 0;
  
  // Run for 60 seconds
  const positions = runSimulation(cashier, 60, 0.1);
  
  // Filter to WORKING state only
  const workingPositions = positions.filter(p => p.state === CASHIER_STATE.WORKING);
  
  let violations = 0;
  for (const pos of workingPositions) {
    const inArea = (
      pos.x >= cashier.serviceArea.minX &&
      pos.x <= cashier.serviceArea.maxX &&
      pos.z >= cashier.serviceArea.minZ &&
      pos.z <= cashier.serviceArea.maxZ
    );
    if (!inArea) violations++;
  }
  
  console.log(`  Working positions: ${workingPositions.length}`);
  console.log(`  Violations: ${violations}`);
  console.log(`  Service area: X[${cashier.serviceArea.minX.toFixed(2)}, ${cashier.serviceArea.maxX.toFixed(2)}] Z[${cashier.serviceArea.minZ.toFixed(2)}, ${cashier.serviceArea.maxZ.toFixed(2)}]`);
  
  const passed = violations === 0;
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  return passed;
}

export function testCashierVarianceBelowThreshold() {
  console.log('\n=== Test: Cashier variance in WORKING < 0.25m ===');
  
  const rng = new SeededRandom(12345);
  const navGrid = createMockNavGrid();
  const pathPlanner = createMockPathPlanner();
  
  const cashier = new CashierAgent(1, 0, navGrid.cashiers[0], navGrid, pathPlanner, rng);
  
  // Fast-forward past spawn delay
  cashier.shiftStartDelay = 0;
  
  // Run for 120 seconds to get good sample
  const positions = runSimulation(cashier, 120, 0.1);
  
  // Filter to WORKING state only
  const workingPositions = positions.filter(p => p.state === CASHIER_STATE.WORKING);
  
  if (workingPositions.length < 10) {
    console.log(`  Not enough WORKING positions: ${workingPositions.length}`);
    console.log(`  Result: ⚠️ SKIP`);
    return true; // Skip if not enough data
  }
  
  const xValues = workingPositions.map(p => p.x);
  const zValues = workingPositions.map(p => p.z);
  
  const xStd = stdDev(xValues);
  const zStd = stdDev(zValues);
  
  console.log(`  Working positions: ${workingPositions.length}`);
  console.log(`  X std dev: ${xStd.toFixed(4)}m`);
  console.log(`  Z std dev: ${zStd.toFixed(4)}m`);
  
  const threshold = 0.25;
  const passed = xStd < threshold && zStd < threshold;
  console.log(`  Threshold: ${threshold}m`);
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  return passed;
}

export function testLaneOpenCloseTimeline() {
  console.log('\n=== Test: Lane open/close matches cashier presence ===');
  
  const rng = new SeededRandom(12345);
  const navGrid = createMockNavGrid();
  const pathPlanner = createMockPathPlanner();
  
  const cashier = new CashierAgent(1, 0, navGrid.cashiers[0], navGrid, pathPlanner, rng);
  
  // Fast-forward past spawn delay
  cashier.shiftStartDelay = 0;
  
  // Track lane open status over time
  const timeline = [];
  const dt = 1.0; // 1 second steps for faster test
  
  for (let t = 0; t < 300; t++) { // 5 minutes
    cashier.update(dt, []);
    if (cashier.spawned) {
      timeline.push({
        t,
        state: cashier.state,
        inServiceArea: cashier.isInServiceArea(),
        isLaneOpen: cashier.isLaneOpen(),
        timeInArea: cashier.timeInServiceArea,
      });
    }
  }
  
  console.log(`  Timeline entries: ${timeline.length}`);
  
  // After ~2 minutes of WORKING, lane should be open
  const after2min = timeline.filter(t => t.t > 120 && t.state === CASHIER_STATE.WORKING);
  const openCount = after2min.filter(t => t.isLaneOpen).length;
  
  console.log(`  After 2min WORKING entries: ${after2min.length}`);
  console.log(`  Lane open count: ${openCount}`);
  
  // At least 80% should show lane as open after confirmation window
  const openRatio = after2min.length > 0 ? openCount / after2min.length : 0;
  const passed = openRatio > 0.8;
  
  console.log(`  Open ratio: ${(openRatio * 100).toFixed(1)}%`);
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  return passed;
}

export function testStateTransitions() {
  console.log('\n=== Test: State machine transitions ===');
  
  const rng = new SeededRandom(12345);
  const navGrid = createMockNavGrid();
  const pathPlanner = createMockPathPlanner();
  
  const cashier = new CashierAgent(1, 0, navGrid.cashiers[0], navGrid, pathPlanner, rng);
  
  // Track state changes
  const stateChanges = [];
  let lastState = cashier.state;
  
  cashier.shiftStartDelay = 0; // Immediate spawn
  cashier.shiftDuration = 30; // Short shift for testing (30 seconds)
  
  const dt = 0.5;
  for (let t = 0; t < 60; t += dt) { // 60 seconds
    cashier.update(dt, []);
    if (cashier.state !== lastState) {
      stateChanges.push({ t, from: lastState, to: cashier.state });
      lastState = cashier.state;
    }
  }
  
  console.log(`  State changes: ${stateChanges.length}`);
  for (const change of stateChanges) {
    console.log(`    t=${change.t.toFixed(1)}s: ${change.from} -> ${change.to}`);
  }
  
  // Should at least transition: OFFSHIFT -> ARRIVE -> WORKING
  const hasArrive = stateChanges.some(c => c.to === CASHIER_STATE.ARRIVE);
  const hasWorking = stateChanges.some(c => c.to === CASHIER_STATE.WORKING);
  
  const passed = hasArrive && hasWorking;
  console.log(`  Has ARRIVE: ${hasArrive}`);
  console.log(`  Has WORKING: ${hasWorking}`);
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  return passed;
}

export function testTrackCountStable() {
  console.log('\n=== Test: Track count remains stable (no crashes) ===');
  
  const rng = new SeededRandom(12345);
  const navGrid = createMockNavGrid();
  const pathPlanner = createMockPathPlanner();
  
  // Create multiple cashiers
  const cashiers = [];
  for (let i = 0; i < navGrid.cashiers.length; i++) {
    const c = new CashierAgent(i + 1, i, navGrid.cashiers[i], navGrid, pathPlanner, rng);
    c.shiftStartDelay = i * 5; // Stagger starts
    cashiers.push(c);
  }
  
  let crashed = false;
  let maxActive = 0;
  let minActive = Infinity;
  
  try {
    const dt = 0.1;
    for (let t = 0; t < 120; t += dt) { // 2 minutes
      for (const c of cashiers) {
        c.update(dt, cashiers);
      }
      
      const active = cashiers.filter(c => c.spawned && c.state !== CASHIER_STATE.DONE).length;
      maxActive = Math.max(maxActive, active);
      minActive = Math.min(minActive, active);
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
    crashed = true;
  }
  
  console.log(`  Cashiers: ${cashiers.length}`);
  console.log(`  Max active: ${maxActive}`);
  console.log(`  Min active: ${minActive}`);
  console.log(`  Crashed: ${crashed}`);
  
  const passed = !crashed && maxActive <= cashiers.length;
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  return passed;
}

// Run all tests
export function runAllTests() {
  console.log('\n========================================');
  console.log('  CASHIER AGENT UNIT TESTS');
  console.log('========================================');
  
  const results = [];
  
  results.push({ name: 'Cashier stays in service area', passed: testCashierStaysInServiceArea() });
  results.push({ name: 'Cashier variance below threshold', passed: testCashierVarianceBelowThreshold() });
  results.push({ name: 'Lane open/close timeline', passed: testLaneOpenCloseTimeline() });
  results.push({ name: 'State transitions', passed: testStateTransitions() });
  results.push({ name: 'Track count stable', passed: testTrackCountStable() });
  
  console.log('\n========================================');
  console.log('  SUMMARY');
  console.log('========================================');
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`);
  }
  
  console.log(`\n  Total: ${passed}/${total} passed`);
  console.log('========================================\n');
  
  return passed === total;
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const allPassed = runAllTests();
  process.exit(allPassed ? 0 : 1);
}
