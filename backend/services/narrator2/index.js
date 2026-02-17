/**
 * Narrator2 Service Module
 * 
 * ViewPack-based KPI storytelling subsystem.
 * Parallel to existing /narrator/* - does not modify existing functionality.
 */

export * from './types.js';
export * from './PersonaStepRegistry.js';
export * from './CacheLayer.js';
export * from './KpiSourceAdapter.js';
export * from './Thresholds.js';
export * from './Hashing.js';
export * from './UiIntentRegistry.js';
export * from './NarrationFallback.js';
export * from './ViewPackService.js';
export * from './utils.js';

// Default export for convenience
export { default as ViewPackService } from './ViewPackService.js';
export { default as KpiSourceAdapter } from './KpiSourceAdapter.js';
export { default as CacheLayer } from './CacheLayer.js';
export { default as NarrationFallback } from './NarrationFallback.js';
