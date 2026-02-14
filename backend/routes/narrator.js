import express from 'express';

const router = express.Router();

// KPI Cache for fast narrator access
const kpiCache = new Map();
const KPI_CACHE_TTL = 60000; // 1 minute cache

// OpenAI configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const OPENAI_TEMPERATURE = 0.2;
const OPENAI_TIMEOUT = 15000; // 15 seconds

// Rate limiting: max 30 calls per minute per session
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 30;

function checkRateLimit(sessionId) {
  const now = Date.now();
  const sessionData = rateLimitMap.get(sessionId) || { calls: [], windowStart: now };
  
  // Clean old calls outside window
  sessionData.calls = sessionData.calls.filter(t => t > now - RATE_LIMIT_WINDOW);
  
  if (sessionData.calls.length >= RATE_LIMIT_MAX) {
    return false;
  }
  
  sessionData.calls.push(now);
  rateLimitMap.set(sessionId, sessionData);
  return true;
}

// Allowed UI intents whitelist
const ALLOWED_INTENTS = [
  'OPEN_MAIN_VIEW',
  'OPEN_DWG_IMPORTER',
  'OPEN_LIDAR_PLANNER',
  'OPEN_PLANOGRAM_BUILDER',
  'OPEN_EDGE_COMMISSIONING',
  'OPEN_DOOH_ANALYTICS',
  'OPEN_DOOH_EFFECTIVENESS',
  'OPEN_BUSINESS_REPORTING',
  'OPEN_HEATMAP_MODAL',
  'OPEN_CHECKOUT_MANAGER',
  'OPEN_SMART_KPI_MODAL',
  'OPEN_ACTIVITY_LEDGER',
  'TOGGLE_KPI_OVERLAYS',
  'TOGGLE_COVERAGE_HEATMAP',
  'TOGGLE_LIDAR_FOV',
  'HIGHLIGHT_ZONE',
  'HIGHLIGHT_SHELF',
  'HIGHLIGHT_SCREEN',
  'HIGHLIGHT_LIDAR',
  'HIGHLIGHT_QUEUE',
  'SELECT_PERSONA',
];

// Validate narrator output schema
function validateNarratorOutput(output) {
  if (!output || typeof output !== 'object') return false;
  if (typeof output.headline !== 'string') return false;
  if (!Array.isArray(output.narration)) return false;
  if (typeof output.businessMeaning !== 'string') return false;
  if (!Array.isArray(output.recommendedActions)) return false;
  if (!['high', 'medium', 'low'].includes(output.confidence)) return false;
  
  // Validate all intents are in whitelist
  for (const action of output.recommendedActions) {
    const intentBase = action.uiIntent?.split(':')[0]; // Handle HIGHLIGHT_ZONE:id format
    if (!ALLOWED_INTENTS.includes(intentBase)) {
      console.warn(`[Narrator] Rejected unknown intent: ${action.uiIntent}`);
      return false;
    }
  }
  
  return true;
}

// Fallback response when AI fails
const FALLBACK_RESPONSE = {
  headline: 'Data available',
  narration: ['Select a KPI or entity to explore insights.'],
  businessMeaning: 'Your analytics data is ready for exploration.',
  recommendedActions: [],
  suggestedFollowUps: [],
  uiFocus: { highlight: [], layersOn: [], layersOff: [] },
  confidence: 'low',
};

// Persona definitions with full context
const PERSONA_CONTEXTS = {
  'store-manager': {
    name: 'Store Manager',
    role: 'Operations Lead',
    purpose: 'Monitor store operations, manage queues, optimize staff allocation, and ensure customer satisfaction',
    primaryKpis: ['avgWaitingTimeMin', 'currentQueueLength', 'abandonRate', 'avgOccupancy', 'peakOccupancy', 'utilizationRate'],
    concerns: ['Long wait times', 'Queue abandonment', 'Staff coverage gaps', 'Peak hour management', 'Underutilized zones'],
    actions: ['Open checkout lanes', 'Reallocate staff', 'Adjust operating hours', 'Investigate dead zones'],
  },
  'merchandising': {
    name: 'Merchandising Manager',
    role: 'Category & Shelf Optimization',
    purpose: 'Optimize product placement, increase shelf engagement, improve category performance, and maximize browsing-to-purchase conversion',
    primaryKpis: ['browsingRate', 'avgBrowseTime', 'categoryEngagementRate', 'engagementRate', 'bounceRate', 'avgTimeSpentMin'],
    concerns: ['Low shelf engagement', 'High bounce rates', 'Poor product visibility', 'Inefficient planograms', 'Category underperformance'],
    actions: ['Redesign planogram', 'Move high-interest products', 'Adjust shelf heights', 'Add promotional displays'],
  },
  'retail-media': {
    name: 'Retail Media Manager',
    role: 'DOOH Campaign Effectiveness',
    purpose: 'Measure digital signage impact, optimize ad placements, track viewer attention, and maximize campaign ROI',
    primaryKpis: ['ces', 'aqs', 'eal', 'aar', 'ttaSec', 'dci', 'confidencePct'],
    concerns: ['Low attention quality', 'Poor campaign effectiveness', 'Screen placement issues', 'Ad fatigue', 'Attribution gaps'],
    actions: ['Adjust screen placement', 'Change ad creative', 'Optimize playlist timing', 'Target high-traffic times'],
  },
  'executive': {
    name: 'Executive',
    role: 'Strategic Overview',
    purpose: 'Get high-level insights on store performance, identify trends, and make data-driven strategic decisions',
    primaryKpis: ['totalVisitors', 'avgOccupancy', 'engagementRate', 'avgWaitingTimeMin', 'abandonRate', 'utilizationRate'],
    concerns: ['Overall traffic trends', 'Customer experience quality', 'Operational efficiency', 'Revenue impact', 'Competitive positioning'],
    actions: ['Review weekly reports', 'Compare store performance', 'Identify improvement areas', 'Set KPI targets'],
  },
};

// KPI definitions for analysis
const KPI_MEANINGS = {
  totalVisitors: { name: 'Total Visitors', unit: '', good: '> 100/hr', bad: '< 20/hr', direction: 'higher' },
  avgOccupancy: { name: 'Average Occupancy', unit: ' pax', good: '< 80% capacity', bad: '> 100% capacity', direction: 'optimal' },
  peakOccupancy: { name: 'Peak Occupancy', unit: ' pax', good: 'within capacity', bad: 'exceeds capacity', direction: 'lower' },
  currentOccupancy: { name: 'Current Occupancy', unit: ' pax', good: 'within capacity', bad: 'overcrowded', direction: 'optimal' },
  avgWaitingTimeMin: { name: 'Avg Wait Time', unit: ' min', good: '< 2 min', bad: '> 5 min', direction: 'lower' },
  currentQueueLength: { name: 'Queue Length', unit: ' pax', good: '< 5', bad: '> 10', direction: 'lower' },
  abandonRate: { name: 'Abandon Rate', unit: '%', good: '< 5%', bad: '> 15%', direction: 'lower' },
  servedCount: { name: 'Served Customers', unit: '', good: 'high', bad: 'low', direction: 'higher' },
  engagementRate: { name: 'Engagement Rate', unit: '%', good: '> 60%', bad: '< 30%', direction: 'higher' },
  bounceRate: { name: 'Bounce Rate', unit: '%', good: '< 20%', bad: '> 50%', direction: 'lower' },
  avgTimeSpentMin: { name: 'Avg Time Spent', unit: ' min', good: '> 3 min', bad: '< 1 min', direction: 'higher' },
  avgDwellTime: { name: 'Avg Dwell Time', unit: ' min', good: '> 2 min', bad: '< 30 sec', direction: 'higher' },
  utilizationRate: { name: 'Space Utilization', unit: '%', good: '> 70%', bad: '< 40%', direction: 'higher' },
  zonesAnalyzed: { name: 'Zones Analyzed', unit: '', good: '', bad: '', direction: 'info' },
};

// Analyze KPI values and identify insights
function analyzeKpis(kpiSnapshot, personaContext) {
  const insights = [];
  const concerns = [];
  const opportunities = [];
  
  for (const [kpiId, value] of Object.entries(kpiSnapshot || {})) {
    if (value === null || value === undefined || kpiId.startsWith('_')) continue;
    
    const kpiDef = KPI_MEANINGS[kpiId];
    if (!kpiDef) continue;
    
    const numValue = parseFloat(value);
    if (isNaN(numValue)) continue;
    
    // Analyze based on direction
    if (kpiDef.direction === 'lower') {
      if (kpiId === 'avgWaitingTimeMin' && numValue > 3) {
        concerns.push(`Wait time is ${numValue.toFixed(1)} min (target: < 2 min)`);
      } else if (kpiId === 'abandonRate' && numValue > 10) {
        concerns.push(`Abandon rate at ${numValue.toFixed(1)}% (high risk)`);
      } else if (kpiId === 'bounceRate' && numValue > 40) {
        concerns.push(`Bounce rate ${numValue.toFixed(1)}% indicates low engagement`);
      } else if (kpiId === 'currentQueueLength' && numValue > 8) {
        concerns.push(`Queue has ${Math.round(numValue)} people waiting`);
      }
    } else if (kpiDef.direction === 'higher') {
      if (kpiId === 'engagementRate' && numValue > 50) {
        opportunities.push(`Strong engagement at ${numValue.toFixed(1)}%`);
      } else if (kpiId === 'totalVisitors' && numValue > 50) {
        insights.push(`${Math.round(numValue)} visitors recorded`);
      } else if (kpiId === 'avgTimeSpentMin' && numValue > 2) {
        opportunities.push(`Healthy dwell time: ${numValue.toFixed(1)} min average`);
      }
    }
    
    // Always add raw data insight
    if (kpiDef.direction !== 'info') {
      insights.push(`${kpiDef.name}: ${typeof numValue === 'number' ? (numValue % 1 === 0 ? numValue : numValue.toFixed(1)) : value}${kpiDef.unit}`);
    }
  }
  
  return { insights, concerns, opportunities };
}

// Build system prompt for OpenAI
function buildSystemPrompt(persona, usageHistory) {
  const personaContext = PERSONA_CONTEXTS[persona.id] || PERSONA_CONTEXTS['store-manager'];
  
  const usageContext = usageHistory?.topFollowUps?.length > 0
    ? `\nUSER BEHAVIOR PATTERNS:\n- Frequently asks: ${usageHistory.topFollowUps.slice(0, 3).join(', ')}\n- Prefers: ${usageHistory.preferredStyle || 'concise'} explanations`
    : '';

  return `You are an AI Business Analyst for Hyperspace, a retail analytics platform using LiDAR sensors for people tracking.

YOUR PERSONA CONTEXT:
- Role: ${personaContext.role}
- Purpose: ${personaContext.purpose}
- Primary KPIs: ${personaContext.primaryKpis.join(', ')}
- Key Concerns: ${personaContext.concerns.join(', ')}
- Typical Actions: ${personaContext.actions.join(', ')}
${usageContext}

YOUR TASK:
1. ANALYZE the KPI data provided - look for patterns, outliers, and actionable insights
2. EXPLAIN what the numbers mean in plain business language for this persona
3. HIGHLIGHT specific values that need attention (good or bad)
4. RECOMMEND concrete actions based on the data
5. SUGGEST relevant follow-up questions to drill deeper

IMPORTANT RULES:
- Include SPECIFIC NUMBERS from the data in your narration (e.g., "Wait time is 4.2 minutes")
- Identify OUTLIERS or concerning values
- Provide ACTIONABLE insights, not generic advice
- Output STRICT JSON only (no markdown outside JSON structure)
- Only use UI intents from the allowed list
- If data shows good performance, acknowledge it and suggest optimization opportunities
- If data shows problems, prioritize them by severity

OUTPUT FORMAT (strict JSON):
{
  "headline": "Brief summary with key metric (max 120 chars)",
  "narration": [
    "Specific insight with number",
    "Another insight with context",
    "Pattern or trend observation",
    "Recommendation based on data"
  ],
  "businessMeaning": "What this means for the ${personaContext.role} in 1-2 sentences",
  "recommendedActions": [
    { "label": "Action Button Text", "uiIntent": "ALLOWED_INTENT", "reason": "Why this helps" }
  ],
  "suggestedFollowUps": [
    { "question": "Specific question about the data", "intentType": "explain_kpi|compare_trend|drill_down|navigate", "context": {} }
  ],
  "uiFocus": { "highlight": [], "layersOn": [], "layersOff": [] },
  "confidence": "high|medium|low"
}`;
}

// Build user prompt with context
function buildUserPrompt(input, persona) {
  const { currentView, selectedEntity, kpiSnapshot, venueContext, proactiveInsights, storyStepGoal, allowedUiIntents } = input;
  
  const personaContext = PERSONA_CONTEXTS[persona?.id] || PERSONA_CONTEXTS['store-manager'];
  const { insights, concerns, opportunities } = analyzeKpis(kpiSnapshot, personaContext);
  
  // Determine data mode from metadata
  const isRealtime = kpiSnapshot?._dataMode === 1;
  const timePeriodMap = { 1: 'hour', 2: 'day', 3: 'week', 4: 'month' };
  const timePeriod = timePeriodMap[kpiSnapshot?._timePeriod] || 'day';
  
  // Build KPI summary with actual values
  const kpiSummary = [];
  for (const [key, value] of Object.entries(kpiSnapshot || {})) {
    if (key.startsWith('_') || value === null || value === undefined) continue;
    const def = KPI_MEANINGS[key];
    if (def) {
      const displayValue = typeof value === 'number' ? (value % 1 === 0 ? value : value.toFixed(2)) : value;
      kpiSummary.push(`- ${def.name}: ${displayValue}${def.unit}`);
    }
  }
  
  let prompt = `ANALYSIS REQUEST FOR: ${personaContext.name}

DATA CONTEXT:
- Mode: ${isRealtime ? 'REALTIME (live data)' : `HISTORICAL (${timePeriod} period)`}
- Venue: ${venueContext?.venueName || 'Store'}
- Current View: ${currentView}
- Zones Analyzed: ${kpiSnapshot?.zonesAnalyzed || 'all available'}

ACTUAL KPI VALUES:
${kpiSummary.length > 0 ? kpiSummary.join('\n') : '(No KPI data available - sensors may be offline or no activity recorded)'}

PRE-ANALYSIS:
${concerns.length > 0 ? `⚠️ CONCERNS:\n${concerns.map(c => `  - ${c}`).join('\n')}` : '✅ No major concerns detected'}
${opportunities.length > 0 ? `\n💡 OPPORTUNITIES:\n${opportunities.map(o => `  - ${o}`).join('\n')}` : ''}

ALLOWED UI ACTIONS:
${allowedUiIntents.join(', ')}
`;

  if (proactiveInsights?.length > 0) {
    prompt += `\n🔔 PROACTIVE ALERTS:
${proactiveInsights.map(i => `- [${i.severity.toUpperCase()}] ${i.headline}: ${i.explanation}`).join('\n')}
`;
  }

  if (storyStepGoal) {
    prompt += `\nSTORY STEP GOAL: ${storyStepGoal}
`;
  }

  prompt += `\nTASK: Generate narration for this context. Output JSON only.`;
  
  return prompt;
}

// Main narration endpoint
router.post('/narrate', async (req, res) => {
  const { context, sessionId } = req.body;
  
  // Rate limiting
  if (!checkRateLimit(sessionId || 'anonymous')) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded', 
      fallback: FALLBACK_RESPONSE 
    });
  }
  
  // Check API key
  if (!OPENAI_API_KEY) {
    console.warn('[Narrator] OpenAI API key not configured, returning fallback');
    return res.json({ 
      success: true, 
      narration: FALLBACK_RESPONSE,
      source: 'fallback'
    });
  }
  
  try {
    const persona = context.persona || { id: 'store-manager', name: 'Store Manager', description: 'Operations focused' };
    const systemPrompt = buildSystemPrompt(persona, context.usageHistory);
    const userPrompt = buildUserPrompt(context, persona);
    
    // Call OpenAI
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: OPENAI_TEMPERATURE,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Narrator] OpenAI API error:', response.status, errorText);
      return res.json({ 
        success: true, 
        narration: FALLBACK_RESPONSE,
        source: 'fallback',
        error: `OpenAI error: ${response.status}`
      });
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error('[Narrator] Empty response from OpenAI');
      return res.json({ 
        success: true, 
        narration: FALLBACK_RESPONSE,
        source: 'fallback'
      });
    }
    
    // Parse JSON response
    let narration;
    try {
      narration = JSON.parse(content);
    } catch (parseErr) {
      console.error('[Narrator] Failed to parse OpenAI response as JSON:', content);
      return res.json({ 
        success: true, 
        narration: FALLBACK_RESPONSE,
        source: 'fallback'
      });
    }
    
    // Validate schema
    if (!validateNarratorOutput(narration)) {
      console.error('[Narrator] Invalid schema in OpenAI response:', narration);
      return res.json({ 
        success: true, 
        narration: FALLBACK_RESPONSE,
        source: 'fallback'
      });
    }
    
    // Return validated narration
    res.json({
      success: true,
      narration,
      source: 'openai',
      model: OPENAI_MODEL,
    });
    
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[Narrator] OpenAI request timed out');
    } else {
      console.error('[Narrator] Error calling OpenAI:', err.message);
    }
    
    res.json({ 
      success: true, 
      narration: FALLBACK_RESPONSE,
      source: 'fallback',
      error: err.message
    });
  }
});

// Insight detection endpoint (for proactive mode)
router.post('/detect-insights', async (req, res) => {
  const { venueId, personaId, kpiData, thresholds } = req.body;
  
  const insights = [];
  
  // Detect anomalies and threshold breaches
  for (const [kpiId, value] of Object.entries(kpiData || {})) {
    if (value === null || value === undefined) continue;
    
    const threshold = thresholds?.[kpiId];
    if (!threshold) continue;
    
    const { good, warn, bad, direction } = threshold;
    
    let severity = null;
    let headline = '';
    let explanation = '';
    
    if (direction === 'lower') {
      // Lower is better (e.g., wait time)
      if (value >= bad) {
        severity = 'critical';
        headline = `${kpiId} is critically high`;
        explanation = `Current value ${value} exceeds critical threshold ${bad}`;
      } else if (value >= warn) {
        severity = 'warning';
        headline = `${kpiId} is above target`;
        explanation = `Current value ${value} exceeds warning threshold ${warn}`;
      }
    } else {
      // Higher is better (e.g., conversion rate)
      if (value <= bad) {
        severity = 'critical';
        headline = `${kpiId} is critically low`;
        explanation = `Current value ${value} below critical threshold ${bad}`;
      } else if (value <= warn) {
        severity = 'warning';
        headline = `${kpiId} is below target`;
        explanation = `Current value ${value} below warning threshold ${warn}`;
      }
    }
    
    if (severity) {
      insights.push({
        type: 'threshold_breach',
        severity,
        kpiId,
        currentValue: value,
        benchmark: direction === 'lower' ? good : good,
        delta: direction === 'lower' ? ((value - good) / good * 100) : ((good - value) / good * 100),
        headline,
        explanation,
        suggestedAction: `Review ${kpiId} and take corrective action`,
        relevantEntities: [],
      });
    }
  }
  
  // Sort by severity (critical first)
  insights.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });
  
  // Return top 3 insights
  res.json({
    success: true,
    insights: insights.slice(0, 3),
    total: insights.length,
  });
});

// Usage tracking endpoint
router.post('/track-usage', async (req, res) => {
  const { venueId, personaId, eventType, eventData, sessionId } = req.body;
  
  // For now, just log usage - can be stored in DB later
  console.log(`[Narrator Usage] ${personaId}@${venueId}: ${eventType}`, eventData);
  
  res.json({ success: true });
});

// Story paths endpoint
router.get('/story-paths', (req, res) => {
  const storyPaths = {
    'store-manager': {
      name: 'Operations Pulse',
      steps: [
        { id: 1, title: 'Queue Pressure', kpis: ['avgWaitingTimeMin', 'currentQueueLength', 'abandonRate'], goal: 'Assess current queue health' },
        { id: 2, title: 'Peak Planning', kpis: ['peakOccupancy', 'avgOccupancy'], goal: 'Understand capacity trends' },
        { id: 3, title: 'Space Efficiency', kpis: ['utilizationRate', 'deadZonesCount'], goal: 'Identify underutilized areas' },
        { id: 4, title: 'Action Items', kpis: [], goal: 'Navigate to tools for improvement' },
        { id: 5, title: 'Summary', kpis: [], goal: 'Review key recommendations' },
      ],
    },
    'merchandising': {
      name: 'Shelf & Category',
      steps: [
        { id: 1, title: 'Shelf Attraction', kpis: ['browsingRate', 'passbyCount'], goal: 'Measure shelf drawing power' },
        { id: 2, title: 'Engagement Depth', kpis: ['avgBrowseTime', 'categoryEngagementRate'], goal: 'Understand shopper interest' },
        { id: 3, title: 'Conversion Impact', kpis: ['categoryConversionRate'], goal: 'Link engagement to sales' },
        { id: 4, title: 'Brand Balance', kpis: ['brandEfficiencyIndex', 'skuPositionScoreAvg'], goal: 'Optimize shelf allocation' },
        { id: 5, title: 'Optimization', kpis: [], goal: 'Open planogram builder' },
      ],
    },
    'retail-media': {
      name: 'PEBLE™ Effectiveness',
      steps: [
        { id: 1, title: 'Campaign Overview', kpis: ['ces', 'confidencePct'], goal: 'Assess campaign health' },
        { id: 2, title: 'Attention Quality', kpis: ['aqs'], goal: 'Measure viewer attention' },
        { id: 3, title: 'Lift & Attribution', kpis: ['eal', 'aar'], goal: 'Quantify ad impact' },
        { id: 4, title: 'Speed to Action', kpis: ['ttaSec', 'dci'], goal: 'Measure response time' },
        { id: 5, title: 'Optimization', kpis: [], goal: 'Navigate to DOOH tools' },
      ],
    },
    'executive': {
      name: 'Executive Summary',
      steps: [
        { id: 1, title: 'Traffic Health', kpis: ['totalVisitors', 'avgOccupancy'], goal: 'Overview of foot traffic' },
        { id: 2, title: 'Experience Quality', kpis: ['avgWaitingTimeMin', 'abandonRate'], goal: 'Customer experience snapshot' },
        { id: 3, title: 'Engagement', kpis: ['engagementRate', 'utilizationRate'], goal: 'Store performance' },
        { id: 4, title: 'Media ROI', kpis: ['ces', 'eal'], goal: 'Retail media value' },
      ],
    },
  };
  
  res.json({ success: true, storyPaths });
});

/**
 * Fast KPI summary endpoint with caching
 * Returns cached venue-level KPIs for narrator use
 */
router.post('/kpi-summary', async (req, res) => {
  try {
    const { venueId, period = 'day', roiIds = [] } = req.body;
    
    if (!venueId) {
      return res.status(400).json({ error: 'venueId required' });
    }
    
    const cacheKey = `${venueId}_${period}`;
    const cached = kpiCache.get(cacheKey);
    
    // Return cached data if fresh
    if (cached && Date.now() - cached.timestamp < KPI_CACHE_TTL) {
      console.log('[Narrator] Returning cached KPIs for', cacheKey);
      return res.json({ success: true, kpis: cached.data, cached: true });
    }
    
    // No cache or expired - compute from provided ROI IDs
    // The frontend will send the ROI IDs it wants summarized
    const summary = {
      venueId,
      period,
      zonesRequested: roiIds.length,
      timestamp: Date.now(),
      // Placeholder - will be populated by frontend batch fetch
    };
    
    console.log('[Narrator] KPI summary request for', cacheKey, 'with', roiIds.length, 'ROIs');
    
    res.json({ 
      success: true, 
      kpis: summary, 
      cached: false,
      message: 'Use /api/roi/:id/kpis for individual ROI data'
    });
  } catch (err) {
    console.error('[Narrator] KPI summary error:', err);
    res.status(500).json({ error: 'Failed to get KPI summary' });
  }
});

/**
 * Update KPI cache (called by frontend after fetching KPIs)
 */
router.post('/kpi-cache', async (req, res) => {
  try {
    const { venueId, period, kpis } = req.body;
    
    if (!venueId || !kpis) {
      return res.status(400).json({ error: 'venueId and kpis required' });
    }
    
    const cacheKey = `${venueId}_${period || 'day'}`;
    kpiCache.set(cacheKey, {
      data: kpis,
      timestamp: Date.now()
    });
    
    console.log('[Narrator] Cached KPIs for', cacheKey);
    res.json({ success: true, cached: true });
  } catch (err) {
    console.error('[Narrator] Cache update error:', err);
    res.status(500).json({ error: 'Failed to cache KPIs' });
  }
});

/**
 * Get cached KPIs (fast path)
 */
router.get('/kpi-cache/:venueId', async (req, res) => {
  try {
    const { venueId } = req.params;
    const { period = 'day' } = req.query;
    
    const cacheKey = `${venueId}_${period}`;
    const cached = kpiCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < KPI_CACHE_TTL) {
      return res.json({ success: true, kpis: cached.data, cached: true, age: Date.now() - cached.timestamp });
    }
    
    res.json({ success: false, cached: false, message: 'No cached data' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get cached KPIs' });
  }
});

export default router;
