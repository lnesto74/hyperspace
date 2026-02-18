/**
 * StoryRecipeEngine
 * 
 * JSON-driven demo playlist / story recipe system.
 * Recipes are static definitions that filter the episode store
 * and assemble a narrated playlist.
 */

// Built-in story recipes
const BUILT_IN_RECIPES = [
  {
    id: 'grocery_exec_weekly',
    name: 'Weekly Executive Review',
    persona: 'executive',
    description: 'Top operational insights for the week — checkout pressure, category engagement, and visit patterns.',
    steps: [
      { type: 'episode', filter: 'QUEUE_BUILDUP_SPIKE', limit: 2, label: 'Checkout Pressure' },
      { type: 'episode', filter: 'LANE_UNDERSUPPLY', limit: 1, label: 'Staffing Gaps' },
      { type: 'episode', filter: 'HIGH_PASSBY_LOW_BROWSE', limit: 2, label: 'Category Attention' },
      { type: 'episode', filter: 'STORE_VISIT_TIME_SHIFT', limit: 1, label: 'Visit Patterns' },
    ],
  },
  {
    id: 'ops_manager_daily',
    name: 'Daily Operations Pulse',
    persona: 'store_manager',
    description: 'Quick daily check — queue performance, bottlenecks, and abandonment alerts.',
    steps: [
      { type: 'episode', filter: 'QUEUE_BUILDUP_SPIKE', limit: 2, label: 'Queue Spikes' },
      { type: 'episode', filter: 'ABANDONMENT_WAVE', limit: 1, label: 'Abandonment Events' },
      { type: 'episode', filter: 'BOTTLENECK_CORRIDOR', limit: 1, label: 'Congestion Points' },
      { type: 'episode', filter: 'LANE_UNDERSUPPLY', limit: 1, label: 'Lane Coverage' },
    ],
  },
  {
    id: 'category_manager_weekly',
    name: 'Category Performance Review',
    persona: 'category_manager',
    description: 'Shelf engagement patterns — what captured attention and what was overlooked.',
    steps: [
      { type: 'episode', filter: 'HIGH_PASSBY_LOW_BROWSE', limit: 3, label: 'Missed Attention' },
      { type: 'episode', filter: 'BROWSE_NO_CONVERT_PROXY', limit: 2, label: 'Hesitation Signals' },
      { type: 'episode', filter: 'BOTTLENECK_CORRIDOR', limit: 1, label: 'Flow Impact' },
    ],
  },
  {
    id: 'retail_media_campaign',
    name: 'Retail Media Effectiveness',
    persona: 'retail_media_manager',
    description: 'Display campaign performance — exposure outcomes and creative effectiveness.',
    steps: [
      { type: 'episode', filter: 'EXPOSURE_TO_ACTION_WIN', limit: 2, label: 'Successful Influence' },
      { type: 'episode', filter: 'EXPOSURE_NO_FOLLOWTHROUGH', limit: 2, label: 'Creative Gaps' },
    ],
  },
  {
    id: 'checkout_deep_dive',
    name: 'Checkout Deep Dive',
    persona: 'store_manager',
    description: 'Comprehensive checkout analysis — supply, demand, abandonment, and efficiency.',
    steps: [
      { type: 'episode', filter: 'QUEUE_BUILDUP_SPIKE', limit: 2, label: 'Peak Demand' },
      { type: 'episode', filter: 'LANE_UNDERSUPPLY', limit: 2, label: 'Understaffed Periods' },
      { type: 'episode', filter: 'LANE_OVERSUPPLY', limit: 1, label: 'Overstaffed Periods' },
      { type: 'episode', filter: 'ABANDONMENT_WAVE', limit: 2, label: 'Lost Shoppers' },
    ],
  },
];

export class StoryRecipeEngine {
  /**
   * @param {import('./EpisodeStore.js').EpisodeStore} episodeStore
   */
  constructor(episodeStore) {
    this.episodeStore = episodeStore;
    this._seedBuiltInRecipes();
  }

  /**
   * Seed built-in recipes into the episode store
   */
  _seedBuiltInRecipes() {
    for (const recipe of BUILT_IN_RECIPES) {
      this.episodeStore.upsertRecipe(recipe);
    }
  }

  /**
   * Get all available recipes
   */
  getRecipes() {
    return this.episodeStore.getRecipes();
  }

  /**
   * Get a single recipe by ID
   */
  getRecipe(recipeId) {
    return this.episodeStore.getRecipe(recipeId);
  }

  /**
   * Execute a recipe — resolve steps against the episode store
   * Returns an ordered playlist of episodes with narration packs
   * 
   * @param {string} recipeId
   * @param {string} venueId
   * @param {Object} options - { period, startTs, endTs }
   * @returns {{ recipe: Object, playlist: Array }}
   */
  executeRecipe(recipeId, venueId, options = {}) {
    const recipe = this.getRecipe(recipeId);
    if (!recipe) return { recipe: null, playlist: [] };

    const playlist = [];

    for (const step of recipe.steps) {
      if (step.type === 'episode') {
        const episodes = this.episodeStore.getEpisodes(venueId, {
          episodeType: step.filter,
          period: options.period,
          startTs: options.startTs,
          endTs: options.endTs,
          limit: step.limit || 2,
          minScore: 0.1,
        });

        for (const episode of episodes) {
          playlist.push({
            step_label: step.label || step.filter,
            episode,
          });
        }
      }
    }

    return { recipe, playlist };
  }

  /**
   * Create a custom recipe
   */
  createRecipe(recipe) {
    if (!recipe.id) {
      recipe.id = `recipe-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    }
    this.episodeStore.upsertRecipe(recipe);
    return recipe;
  }
}

export { BUILT_IN_RECIPES };
export default StoryRecipeEngine;
