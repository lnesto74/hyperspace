/**
 * Replay Insight Service Module
 * 
 * Parallel, read-only behavior episode detection and replay system.
 * Does NOT modify any existing Hyperspace functionality.
 */

export { EpisodeStore } from './EpisodeStore.js';
export { BaselineTracker } from './BaselineTracker.js';
export { EpisodeDetectorOrchestrator } from './EpisodeDetector.js';
export { EpisodeRanker } from './EpisodeRanker.js';
export { ReplayClipBuilder } from './ReplayClipBuilder.js';
export { NarrationPackBuilder, EPISODE_CATEGORIES, EPISODE_COLORS, EPISODE_SEVERITY } from './NarrationPackBuilder.js';
export { StoryRecipeEngine } from './StoryRecipeEngine.js';
export { getEpisodeTypesForKpi, getKpisForEpisodeType, getFullIndex } from './KpiEpisodeIndex.js';

// Default export: the orchestrator class
export { default } from './EpisodeDetector.js';
