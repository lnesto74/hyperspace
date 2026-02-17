/**
 * Narrator2 API Routes
 * 
 * New parallel narrator subsystem for ViewPack-based KPI storytelling.
 * Does NOT modify existing /narrator/* routes.
 * 
 * Endpoints:
 * - GET  /api/narrator2/health       - Health check
 * - GET  /api/narrator2/viewpack     - Get ViewPack for persona+step
 * - GET  /api/narrator2/viewpackHash - Get ViewPack hash (for change detection)
 * - POST /api/narrator2/narrate      - Generate narration from ViewPack
 */

import { Router } from 'express';
import { 
  validateViewPackRequest, 
  VALID_PERSONAS, 
  VALID_STEPS, 
  VALID_PERIODS 
} from '../services/narrator2/types.js';
import { buildViewPack, getViewPackHash } from '../services/narrator2/ViewPackService.js';
import { generateNarration, answerKpiQuestion } from '../services/narrator2/NarrationFallback.js';
import { getCacheStats, clearAllCaches } from '../services/narrator2/CacheLayer.js';
import { getFeatureFlags, getZoneEngagementRanking, getHourlyTrafficBreakdown, getPeriodComparison } from '../services/narrator2/KpiSourceAdapter.js';
import { hashViewPack } from '../services/narrator2/Hashing.js';
import { getStepsForPersona, getPersonaLabel, getPersonaGoal } from '../services/narrator2/PersonaStepRegistry.js';

const router = Router();

/**
 * GET /api/narrator2/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  const startTime = Date.now();
  
  try {
    const cacheStats = getCacheStats();
    const featureFlags = getFeatureFlags();
    
    res.json({
      status: 'ok',
      service: 'narrator2',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startTime,
      cache: cacheStats,
      featureFlags,
      endpoints: [
        'GET /api/narrator2/health',
        'GET /api/narrator2/viewpack',
        'GET /api/narrator2/viewpackHash',
        'POST /api/narrator2/narrate',
        'POST /api/narrator2/clarify',
        'GET /api/narrator2/personas',
      ],
    });
  } catch (err) {
    console.error('[Narrator2] Health check failed:', err.message);
    res.status(500).json({
      status: 'error',
      service: 'narrator2',
      error: err.message,
    });
  }
});

/**
 * GET /api/narrator2/viewpack
 * Build and return a ViewPack for the given parameters
 * 
 * Query params:
 * - venueId (required)
 * - personaId (required): store-manager, merchandising, retail-media, executive
 * - stepId (required): operations-pulse, queue-health, shelf-performance, etc.
 * - period (optional): hour, day, week, month
 * - startTs (optional): start timestamp in ms
 * - endTs (optional): end timestamp in ms
 */
router.get('/viewpack', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { venueId, personaId, stepId, period, startTs, endTs } = req.query;

    // Validate request
    const validation = validateViewPackRequest({ 
      venueId, 
      personaId, 
      stepId, 
      period, 
      startTs: startTs ? parseInt(startTs) : undefined, 
      endTs: endTs ? parseInt(endTs) : undefined,
    });

    if (!validation.valid) {
      return res.status(400).json({ 
        error: validation.error,
        validPersonas: VALID_PERSONAS,
        validSteps: VALID_STEPS,
        validPeriods: VALID_PERIODS,
      });
    }

    // Build ViewPack
    const result = await buildViewPack({
      venueId,
      personaId,
      stepId,
      period,
      startTs: startTs ? parseInt(startTs) : undefined,
      endTs: endTs ? parseInt(endTs) : undefined,
    });

    if (result.error) {
      return res.status(400).json({ 
        error: result.error,
        cache: result.cache,
      });
    }

    const latencyMs = Date.now() - startTime;
    console.log(`[Narrator2] GET /viewpack completed in ${latencyMs}ms (cache: ${result.cache.layer})`);

    res.json({
      ...result.viewPack,
      _meta: {
        latencyMs,
        cache: result.cache,
        payloadBytes: JSON.stringify(result.viewPack).length,
      },
    });
  } catch (err) {
    console.error('[Narrator2] GET /viewpack error:', err.message);
    res.status(500).json({ 
      error: 'Failed to build viewpack', 
      message: err.message,
    });
  }
});

/**
 * GET /api/narrator2/viewpackHash
 * Get hash of ViewPack for change detection (without full payload)
 * 
 * Query params: same as /viewpack
 */
router.get('/viewpackHash', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { venueId, personaId, stepId, period, startTs, endTs } = req.query;

    // Validate request
    const validation = validateViewPackRequest({ 
      venueId, 
      personaId, 
      stepId, 
      period, 
      startTs: startTs ? parseInt(startTs) : undefined, 
      endTs: endTs ? parseInt(endTs) : undefined,
    });

    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Build ViewPack (uses cache)
    const result = await buildViewPack({
      venueId,
      personaId,
      stepId,
      period,
      startTs: startTs ? parseInt(startTs) : undefined,
      endTs: endTs ? parseInt(endTs) : undefined,
    });

    if (result.error) {
      return res.status(400).json({ 
        error: result.error,
        cache: result.cache,
      });
    }

    // Generate hash
    const hash = hashViewPack(result.viewPack);
    const latencyMs = Date.now() - startTime;

    console.log(`[Narrator2] GET /viewpackHash completed in ${latencyMs}ms (cache: ${result.cache.layer})`);

    res.json({
      hash,
      computedAt: result.viewPack.computedAt,
      cache: result.cache,
      latencyMs,
    });
  } catch (err) {
    console.error('[Narrator2] GET /viewpackHash error:', err.message);
    res.status(500).json({ 
      error: 'Failed to compute hash', 
      message: err.message,
    });
  }
});

/**
 * POST /api/narrator2/narrate
 * Generate narration for a ViewPack
 * 
 * Body (optional):
 * - useOpenAI (boolean): Force OpenAI usage if enabled
 * 
 * Query params: same as /viewpack
 */
router.post('/narrate', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { venueId, personaId, stepId, period, startTs, endTs } = req.query;
    const { useOpenAI = false } = req.body || {};

    // Validate request
    const validation = validateViewPackRequest({ 
      venueId, 
      personaId, 
      stepId, 
      period, 
      startTs: startTs ? parseInt(startTs) : undefined, 
      endTs: endTs ? parseInt(endTs) : undefined,
    });

    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Build ViewPack first
    const viewPackResult = await buildViewPack({
      venueId,
      personaId,
      stepId,
      period,
      startTs: startTs ? parseInt(startTs) : undefined,
      endTs: endTs ? parseInt(endTs) : undefined,
    });

    if (viewPackResult.error) {
      return res.status(400).json({ 
        error: viewPackResult.error,
        cache: viewPackResult.cache,
      });
    }

    // Generate narration
    const narration = await generateNarration(viewPackResult.viewPack, useOpenAI);
    const latencyMs = Date.now() - startTime;

    console.log(`[Narrator2] POST /narrate completed in ${latencyMs}ms (openAI: ${useOpenAI})`);

    res.json({
      headline: narration.headline,
      bullets: narration.bullets,
      recommendedActions: narration.recommendedActions,
      confidence: narration.confidence,
      suggestedQuestions: narration.suggestedQuestions || [],
      _meta: {
        viewPackHash: hashViewPack(viewPackResult.viewPack),
        latencyMs,
        cache: viewPackResult.cache,
        usedOpenAI: useOpenAI && process.env.FEATURE_NARRATOR2_OPENAI === 'true',
      },
    });
  } catch (err) {
    console.error('[Narrator2] POST /narrate error:', err.message);
    res.status(500).json({ 
      error: 'Failed to generate narration', 
      message: err.message,
    });
  }
});

/**
 * POST /api/narrator2/clarify
 * Answer a specific question about KPIs
 * 
 * Body:
 * - question (required): User's question about a KPI
 * 
 * Query params: same as /viewpack
 */
router.post('/clarify', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { venueId, personaId, stepId, period, startTs, endTs } = req.query;
    const { question } = req.body || {};

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ error: 'question is required in request body' });
    }

    // Validate request
    const validation = validateViewPackRequest({ 
      venueId, 
      personaId, 
      stepId, 
      period, 
      startTs: startTs ? parseInt(startTs) : undefined, 
      endTs: endTs ? parseInt(endTs) : undefined,
    });

    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Build ViewPack first
    const viewPackResult = await buildViewPack({
      venueId,
      personaId,
      stepId,
      period,
      startTs: startTs ? parseInt(startTs) : undefined,
      endTs: endTs ? parseInt(endTs) : undefined,
    });

    if (viewPackResult.error) {
      return res.status(400).json({ 
        error: viewPackResult.error,
        cache: viewPackResult.cache,
      });
    }

    // Detect question type and fetch relevant data
    const questionLower = question.toLowerCase();
    const isZoneQuestion = questionLower.includes('zone') || 
                           questionLower.includes('area') ||
                           questionLower.includes('section') ||
                           (questionLower.includes('which') && questionLower.includes('engagement'));
    const isHourlyQuestion = questionLower.includes('hour') || 
                              questionLower.includes('peak') ||
                              questionLower.includes('busiest') ||
                              questionLower.includes('traffic');
    const isCompareQuestion = questionLower.includes('compare') || 
                               questionLower.includes('yesterday') ||
                               questionLower.includes('last week') ||
                               questionLower.includes('vs') ||
                               questionLower.includes('trend');
    
    // Detect if asking for worst/lowest vs best/highest
    const isAskingWorst = questionLower.includes('worst') || 
                          questionLower.includes('lowest') ||
                          questionLower.includes('least') ||
                          questionLower.includes('bottom') ||
                          questionLower.includes('poor');
    
    // Fetch specialized data based on question type
    let specializedData = { type: null, data: null, askingWorst: isAskingWorst };
    
    if (isZoneQuestion) {
      const { startTs: vpStart, endTs: vpEnd } = viewPackResult.viewPack.timeRange;
      specializedData = { type: 'zone', data: await getZoneEngagementRanking(venueId, vpStart, vpEnd, 5), askingWorst: isAskingWorst };
    } else if (isHourlyQuestion) {
      specializedData = { type: 'hourly', data: await getHourlyTrafficBreakdown(venueId), askingWorst: isAskingWorst };
    } else if (isCompareQuestion) {
      const compareType = questionLower.includes('week') ? 'week' : 'day';
      specializedData = { type: 'compare', data: await getPeriodComparison(venueId, compareType), askingWorst: isAskingWorst };
    }

    // Answer the question with specialized data if available
    const answer = await answerKpiQuestion(viewPackResult.viewPack, question.trim(), specializedData);
    const latencyMs = Date.now() - startTime;

    console.log(`[Narrator2] POST /clarify completed in ${latencyMs}ms`);

    res.json({
      question: question.trim(),
      headline: answer.headline,
      bullets: answer.bullets,
      recommendedActions: answer.recommendedActions,
      confidence: answer.confidence,
      whyItMatters: answer.whyItMatters || null,
      suggestedQuestions: answer.suggestedQuestions || [],
      _meta: {
        viewPackHash: hashViewPack(viewPackResult.viewPack),
        latencyMs,
        cache: viewPackResult.cache,
        usedOpenAI: process.env.FEATURE_NARRATOR2_OPENAI === 'true',
      },
    });
  } catch (err) {
    console.error('[Narrator2] POST /clarify error:', err.message);
    res.status(500).json({ 
      error: 'Failed to answer question', 
      message: err.message,
    });
  }
});

/**
 * GET /api/narrator2/personas
 * List available personas and their steps (from registry)
 */
router.get('/personas', (req, res) => {
  const personas = VALID_PERSONAS.map(personaId => {
    const steps = getStepsForPersona(personaId);
    return {
      id: personaId,
      label: getPersonaLabel(personaId),
      goal: getPersonaGoal(personaId),
      steps,
    };
  });

  res.json({
    personas,
    validPeriods: VALID_PERIODS,
  });
});

/**
 * POST /api/narrator2/cache/clear
 * Clear all narrator2 caches to force fresh data
 */
router.post('/cache/clear', (req, res) => {
  try {
    clearAllCaches();
    console.log('[Narrator2] Cache cleared');
    res.json({ success: true, message: 'All narrator2 caches cleared' });
  } catch (err) {
    console.error('[Narrator2] Cache clear failed:', err.message);
    res.status(500).json({ error: 'Failed to clear cache', message: err.message });
  }
});

export default router;
