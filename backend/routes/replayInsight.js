/**
 * Replay Insight REST API Routes
 * 
 * All endpoints are read-only from the perspective of existing Hyperspace data.
 * Episode data is served from the replay_insight.db.
 * 
 * Endpoints:
 *   GET  /api/replay-insights              - List episodes for a venue
 *   GET  /api/replay-insights/markers       - Timeline markers for overlay
 *   GET  /api/replay-insights/explain       - Episodes explaining a KPI movement
 *   GET  /api/replay-insights/recipes       - List story recipes
 *   GET  /api/replay-insights/recipes/:id   - Execute a story recipe
 *   POST /api/replay-insights/recipes       - Create a custom recipe
 *   GET  /api/replay-insights/:episodeId    - Single episode with replay data
 *   GET  /api/replay-insights/:episodeId/narrator-context - Narrator v2 context
 */

import { Router } from 'express';

export default function createReplayInsightRoutes(orchestrator) {
  const router = Router();

  /**
   * GET /api/replay-insights
   * List episodes for a venue, optionally filtered by period/type/time range
   * 
   * Query params:
   *   venueId (required)
   *   period  - 'day' | 'week' | 'month'
   *   type    - episode type filter (e.g. 'QUEUE_BUILDUP_SPIKE')
   *   start   - start timestamp
   *   end     - end timestamp
   *   limit   - max results (default 20)
   */
  router.get('/', (req, res) => {
    try {
      const { venueId, period, type, start, end, limit } = req.query;

      if (!venueId) {
        return res.status(400).json({ error: 'venueId is required' });
      }

      const episodes = orchestrator.getEpisodes(venueId, {
        period: period || undefined,
        episodeType: type || undefined,
        startTs: start ? parseInt(start) : undefined,
        endTs: end ? parseInt(end) : undefined,
        limit: limit ? parseInt(limit) : 20,
      });

      res.json({
        episodes,
        count: episodes.length,
        venueId,
        filters: { period, type, start, end },
      });

    } catch (err) {
      console.error('[ReplayInsight API] GET / error:', err.message);
      res.status(500).json({ error: 'Failed to fetch episodes' });
    }
  });

  /**
   * GET /api/replay-insights/markers
   * Timeline markers for the timeline overlay component
   * 
   * Query params:
   *   venueId (required)
   *   start   (required) - start timestamp
   *   end     (required) - end timestamp
   */
  router.get('/markers', (req, res) => {
    try {
      const { venueId, start, end } = req.query;

      if (!venueId || !start || !end) {
        return res.status(400).json({ error: 'venueId, start, and end are required' });
      }

      const markers = orchestrator.getTimelineMarkers(
        venueId,
        parseInt(start),
        parseInt(end)
      );

      res.json({ markers, count: markers.length });

    } catch (err) {
      console.error('[ReplayInsight API] GET /markers error:', err.message);
      res.status(500).json({ error: 'Failed to fetch markers' });
    }
  });

  /**
   * GET /api/replay-insights/explain
   * Get episodes that explain why a specific KPI moved (reverse index)
   * 
   * Query params:
   *   venueId (required)
   *   kpiId   (required) - e.g. 'queueWaitTime', 'browsingRate'
   *   limit   - max results (default 5)
   */
  router.get('/explain', (req, res) => {
    try {
      const { venueId, kpiId, limit } = req.query;

      if (!venueId || !kpiId) {
        return res.status(400).json({ error: 'venueId and kpiId are required' });
      }

      const episodes = orchestrator.getEpisodesForKpi(venueId, kpiId, {
        limit: limit ? parseInt(limit) : 5,
      });

      res.json({
        kpiId,
        episodes,
        count: episodes.length,
      });

    } catch (err) {
      console.error('[ReplayInsight API] GET /explain error:', err.message);
      res.status(500).json({ error: 'Failed to fetch explanations' });
    }
  });

  /**
   * GET /api/replay-insights/recipes
   * List all available story recipes
   */
  router.get('/recipes', (req, res) => {
    try {
      const recipes = orchestrator.getRecipes();
      res.json({ recipes, count: recipes.length });
    } catch (err) {
      console.error('[ReplayInsight API] GET /recipes error:', err.message);
      res.status(500).json({ error: 'Failed to fetch recipes' });
    }
  });

  /**
   * GET /api/replay-insights/recipes/:recipeId
   * Execute a story recipe — returns ordered playlist of episodes
   * 
   * Query params:
   *   venueId (required)
   *   period  - 'day' | 'week' | 'month'
   *   start   - start timestamp
   *   end     - end timestamp
   */
  router.get('/recipes/:recipeId', (req, res) => {
    try {
      const { recipeId } = req.params;
      const { venueId, period, start, end } = req.query;

      if (!venueId) {
        return res.status(400).json({ error: 'venueId is required' });
      }

      const result = orchestrator.executeRecipe(recipeId, venueId, {
        period: period || undefined,
        startTs: start ? parseInt(start) : undefined,
        endTs: end ? parseInt(end) : undefined,
      });

      if (!result.recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }

      res.json(result);

    } catch (err) {
      console.error('[ReplayInsight API] GET /recipes/:id error:', err.message);
      res.status(500).json({ error: 'Failed to execute recipe' });
    }
  });

  /**
   * POST /api/replay-insights/recipes
   * Create a custom story recipe
   * 
   * Body: { name, persona, description, steps: [{ type, filter, limit, label }] }
   */
  router.post('/recipes', (req, res) => {
    try {
      const { name, persona, description, steps } = req.body;

      if (!name || !persona || !steps || !Array.isArray(steps)) {
        return res.status(400).json({ error: 'name, persona, and steps are required' });
      }

      const recipe = orchestrator.createRecipe({ name, persona, description, steps });
      res.status(201).json(recipe);

    } catch (err) {
      console.error('[ReplayInsight API] POST /recipes error:', err.message);
      res.status(500).json({ error: 'Failed to create recipe' });
    }
  });

  /**
   * GET /api/replay-insights/:episodeId
   * Get a single episode with full replay clip data
   */
  router.get('/:episodeId', (req, res) => {
    try {
      const { episodeId } = req.params;
      const episode = orchestrator.getEpisode(episodeId);

      if (!episode) {
        return res.status(404).json({ error: 'Episode not found' });
      }

      res.json(episode);

    } catch (err) {
      console.error('[ReplayInsight API] GET /:id error:', err.message);
      res.status(500).json({ error: 'Failed to fetch episode' });
    }
  });

  /**
   * GET /api/replay-insights/:episodeId/narrator-context
   * Get Narrator v2 context for an episode (for OpenAI prompt injection)
   */
  router.get('/:episodeId/narrator-context', (req, res) => {
    try {
      const { episodeId } = req.params;
      const context = orchestrator.getNarrator2Context(episodeId);

      if (!context) {
        return res.status(404).json({ error: 'Episode not found' });
      }

      res.json(context);

    } catch (err) {
      console.error('[ReplayInsight API] GET /:id/narrator-context error:', err.message);
      res.status(500).json({ error: 'Failed to fetch narrator context' });
    }
  });

  return router;
}
