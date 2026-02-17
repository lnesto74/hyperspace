/**
 * Fallback Narration Generator
 * 
 * Generates deterministic narration based on ViewPack KPIs without AI.
 * Can optionally use OpenAI if FEATURE_NARRATOR2_OPENAI is enabled.
 * Uses structured prompts from Prompts.js for AI calls.
 */

import { findWorstKpi, countByStatus, getWorstStatus } from './Thresholds.js';
import { getSuggestedActions, getIntentsForStep } from './UiIntentRegistry.js';
import { getStepDefinition } from './PersonaStepRegistry.js';
import {
  SYSTEM_PROMPT,
  SAFETY_FALLBACK,
  buildUserPrompt,
  parseStructuredResponse,
  selectPromptMode,
} from './Prompts.js';

/**
 * @typedef {import('./types.js').ViewPack} ViewPack
 * @typedef {import('./types.js').NarrationResponse} NarrationResponse
 */

/**
 * Generate headline templates based on status
 */
const HEADLINE_TEMPLATES = {
  green: [
    'Performance on track',
    'Metrics looking healthy',
    'All indicators positive',
  ],
  amber: [
    'Some metrics need attention',
    'Minor concerns detected',
    'A few areas to watch',
  ],
  red: [
    '{kpiLabel} requires immediate attention',
    'Critical: {kpiLabel} below threshold',
    'Action needed on {kpiLabel}',
  ],
  na: [
    'Data available for review',
    'Metrics summary ready',
  ],
};

/**
 * Generate bullet templates
 */
const BULLET_TEMPLATES = {
  green: '{label} is performing well at {value}{unit}',
  amber: '{label} at {value}{unit} — approaching threshold',
  red: '{label} at {value}{unit} — below acceptable level',
  na: '{label}: {value}{unit}',
};

/**
 * Format a KPI value for display
 * @param {number|null} value
 * @param {import('./types.js').KpiFormat} format
 * @returns {string}
 */
function formatValue(value, format) {
  if (value === null || value === undefined) return 'N/A';
  
  switch (format) {
    case 'pct':
      return `${value.toFixed(1)}`;
    case 'sec':
      return `${value.toFixed(1)}`;
    case 'min':
      return `${value.toFixed(1)}`;
    case 'count':
      return `${Math.round(value).toLocaleString()}`;
    case 'index':
    case 'score':
      return `${value.toFixed(1)}`;
    case 'currency':
      return `$${value.toFixed(2)}`;
    default:
      return String(value);
  }
}

/**
 * Generate headline based on KPI status
 * @param {ViewPack} viewPack
 * @returns {string}
 */
function generateHeadline(viewPack) {
  const overallStatus = getWorstStatus(viewPack.kpis);
  const worstKpi = findWorstKpi(viewPack.kpis);
  
  const templates = HEADLINE_TEMPLATES[overallStatus] || HEADLINE_TEMPLATES.na;
  const template = templates[Math.floor(Date.now() / 1000) % templates.length];
  
  let headline = template;
  if (worstKpi) {
    headline = headline
      .replace('{kpiLabel}', worstKpi.label || worstKpi.id)
      .replace('{kpiValue}', formatValue(worstKpi.value, worstKpi.format));
  }
  
  return headline;
}

/**
 * Generate bullet points for KPIs
 * @param {ViewPack} viewPack
 * @returns {string[]}
 */
function generateBullets(viewPack) {
  const bullets = [];
  const statusPriority = { red: 3, amber: 2, green: 1, na: 0 };
  
  // Special handling for checkout_pressure step (queue KPIs)
  if (viewPack.stepId === 'checkout_pressure') {
    return generateQueueBullets(viewPack.kpis);
  }
  
  // Sort KPIs by status (worst first)
  const sortedKpis = [...viewPack.kpis].sort((a, b) => {
    const aPriority = statusPriority[a.status] || 0;
    const bPriority = statusPriority[b.status] || 0;
    return bPriority - aPriority;
  });

  // Generate bullets for top 4 KPIs
  for (const kpi of sortedKpis.slice(0, 4)) {
    const status = kpi.status || 'na';
    const template = BULLET_TEMPLATES[status];
    
    const bullet = template
      .replace('{label}', kpi.label || kpi.id)
      .replace('{value}', formatValue(kpi.value, kpi.format))
      .replace('{unit}', kpi.unit || '');
    
    bullets.push(bullet);
  }

  return bullets;
}

/**
 * Generate queue-specific narration bullets for operations managers
 * @param {Array} kpis
 * @returns {string[]}
 */
function generateQueueBullets(kpis) {
  const bullets = [];
  const kpiMap = {};
  for (const kpi of kpis) {
    kpiMap[kpi.id] = kpi;
  }

  // Capacity narrative
  const avgLanes = kpiMap.avgConcurrentOpenLanes;
  const peakLanes = kpiMap.peakConcurrentOpenLanes;
  if (avgLanes?.value != null && peakLanes?.value != null) {
    bullets.push(`On average, ${avgLanes.value} checkout lanes were serving simultaneously, with up to ${peakLanes.value} lanes at peak.`);
  }

  // Wait time narrative
  const avgWait = kpiMap.avgQueueWaitTime;
  const p95Wait = kpiMap.p95QueueWaitTime;
  if (avgWait?.value != null && p95Wait?.value != null) {
    const avgMin = avgWait.value.toFixed(1);
    const p95Min = p95Wait.value.toFixed(1);
    const waitStatus = avgWait.status === 'green' ? 'within target' : avgWait.status === 'red' ? 'above threshold' : 'approaching threshold';
    bullets.push(`Average wait time was ${avgMin} min (${waitStatus}). 95% of customers waited less than ${p95Min} min.`);
  }

  // Throughput and service narrative
  const throughput = kpiMap.queueThroughput;
  const serviceTime = kpiMap.avgServiceTime;
  if (throughput?.value != null && serviceTime?.value != null) {
    bullets.push(`Serving ${throughput.value} customers/hour with average service time of ${serviceTime.value.toFixed(1)} min.`);
  }

  // Abandonment narrative (failure signal)
  const abandon = kpiMap.queueAbandonmentRate;
  if (abandon?.value != null) {
    if (abandon.value > 10) {
      bullets.push(`⚠️ ${abandon.value.toFixed(1)}% abandonment rate — customers leaving queues before service. Investigate lane staffing.`);
    } else if (abandon.value > 0) {
      bullets.push(`Abandonment rate at ${abandon.value.toFixed(1)}% — within acceptable range.`);
    } else {
      bullets.push(`No queue abandonment detected — lane-opening decisions appear appropriate.`);
    }
  }

  return bullets;
}

/**
 * Determine confidence level
 * @param {ViewPack} viewPack
 * @returns {'low'|'medium'|'high'}
 */
function determineConfidence(viewPack) {
  const kpiCount = viewPack.kpis.filter(k => k.value !== null).length;
  const sampleN = viewPack.evidence?.sampleN || 0;
  
  if (kpiCount === 0) return 'low';
  if (kpiCount < 3 || sampleN < 10) return 'low';
  if (kpiCount >= 5 && sampleN >= 50) return 'high';
  return 'medium';
}

/**
 * Get suggested follow-up questions based on persona and step
 * @param {string} personaId
 * @param {string} stepId
 * @param {Array} kpis
 * @returns {string[]}
 */
function getSuggestedQuestions(personaId, stepId, kpis) {
  const questions = {
    'store_manager:operations_pulse': [
      'Which zones have the highest engagement?',
      'What are the peak hours for traffic?',
      'How does today compare to yesterday?',
    ],
    'store_manager:checkout_pressure': [
      'Were enough lanes open during peak hours?',
      'What was the worst-case wait time today?',
      'How can I reduce queue abandonment?',
      'Which hours had the most queue pressure?',
    ],
    'category_manager:category_engagement': [
      'Which categories have lowest engagement?',
      'What are the top performing zones?',
      'How does this week compare to last week?',
    ],
    'category_manager:shelf_quality': [
      'Which shelves have dead zones?',
      'What is the slot utilization trend?',
      'Which areas need restocking?',
    ],
    'retail_media_manager:dooh_effectiveness': [
      'Which screens have the best performance?',
      'What are the peak viewing hours?',
      'How does attention translate to engagement?',
    ],
    'executive:business_overview': [
      'What are the key trends this week?',
      'Which KPIs need attention?',
      'How does this compare to last month?',
    ],
  };

  const key = `${personaId}:${stepId}`;
  return questions[key] || [
    'Which zones have the highest engagement?',
    'What are the peak hours?',
    'How does this compare to previous periods?',
  ];
}

/**
 * Generate fallback narration (no AI)
 * @param {ViewPack} viewPack
 * @returns {NarrationResponse}
 */
export function generateFallbackNarration(viewPack) {
  const headline = generateHeadline(viewPack);
  const bullets = generateBullets(viewPack);
  const recommendedActions = getSuggestedActions(
    viewPack.personaId,
    viewPack.stepId,
    viewPack.kpis
  );
  const confidence = determineConfidence(viewPack);
  const suggestedQuestions = getSuggestedQuestions(
    viewPack.personaId,
    viewPack.stepId,
    viewPack.kpis
  );

  return {
    headline,
    bullets,
    recommendedActions,
    confidence,
    suggestedQuestions,
  };
}

/**
 * Generate narration with optional OpenAI enhancement
 * @param {ViewPack} viewPack
 * @param {boolean} [useOpenAI=false]
 * @returns {Promise<NarrationResponse>}
 */
export async function generateNarration(viewPack, useOpenAI = false) {
  // Check if OpenAI is enabled and available
  const openAIEnabled = process.env.FEATURE_NARRATOR2_OPENAI === 'true';
  const openAIKey = process.env.OPENAI_API_KEY;

  if (!useOpenAI || !openAIEnabled || !openAIKey) {
    return generateFallbackNarration(viewPack);
  }

  // OpenAI enhanced narration
  try {
    const narration = await generateOpenAINarration(viewPack);
    return narration;
  } catch (err) {
    console.warn('[NarrationFallback] OpenAI failed, using fallback:', err.message);
    return generateFallbackNarration(viewPack);
  }
}

/**
 * Generate narration using OpenAI with structured prompts
 * @param {ViewPack} viewPack
 * @param {Object} [context] - Additional context (question, comparison, etc.)
 * @returns {Promise<NarrationResponse>}
 */
async function generateOpenAINarration(viewPack, context = {}) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
  const OPENAI_TIMEOUT = 10000;

  // Get step definition for thresholds
  const stepDef = getStepDefinition(viewPack.personaId, viewPack.stepId);
  
  // Get available UI links for this step
  const uiLinks = getIntentsForStep(viewPack.personaId, viewPack.stepId);
  
  // Build the structured user prompt
  const userPrompt = buildUserPrompt(viewPack, stepDef, uiLinks, context);
  
  // Determine prompt mode for logging
  const mode = selectPromptMode(viewPack.stepId, context);
  console.log(`[NarrationFallback] Using ${mode} mode for ${viewPack.personaId}/${viewPack.stepId}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 600,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Parse the structured response
    const parsed = parseStructuredResponse(content);
    
    // Get recommended actions - prefer AI suggestion if valid, else use registry
    let recommendedActions = getSuggestedActions(
      viewPack.personaId,
      viewPack.stepId,
      viewPack.kpis
    );

    // If AI suggested a next action, try to match it to a UI intent
    if (parsed.nextAction) {
      const matchedLink = uiLinks.find(l => 
        parsed.nextAction.toLowerCase().includes(l.label.toLowerCase())
      );
      if (matchedLink) {
        recommendedActions = [
          { label: parsed.nextAction, uiIntent: matchedLink.id },
          ...recommendedActions.slice(0, 1),
        ];
      }
    }

    // Determine confidence based on data and response
    const confidence = determineConfidence(viewPack);

    return {
      headline: parsed.summary || 'Data summary',
      bullets: parsed.insights.length > 0 ? parsed.insights : generateBullets(viewPack),
      recommendedActions: recommendedActions.slice(0, 2),
      confidence,
      whyItMatters: parsed.whyItMatters || null,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Answer a specific KPI question using OpenAI or specialized fallback handlers
 * @param {ViewPack} viewPack
 * @param {string} question
 * @param {Object} specializedData - { type: 'zone'|'hourly'|'compare', data: any }
 * @returns {Promise<NarrationResponse>}
 */
export async function answerKpiQuestion(viewPack, question, specializedData = { type: null, data: null, askingWorst: false }) {
  const openAIEnabled = process.env.FEATURE_NARRATOR2_OPENAI === 'true';
  const openAIKey = process.env.OPENAI_API_KEY;
  const { type, data, askingWorst } = specializedData;
  
  console.log(`[NarrationFallback] answerKpiQuestion: type=${type}, dataLen=${data?.length}, askingWorst=${askingWorst}`);

  // Handle zone-specific questions
  if (type === 'zone' && data && data.length > 0) {
    // If asking for worst, reverse the order (data is sorted best first)
    const sortedZones = askingWorst ? [...data].reverse() : data;
    const displayZones = sortedZones.slice(0, 3);
    const rankLabel = askingWorst ? 'Lowest performing' : 'Top';
    
    const bullets = [
      `${rankLabel} ${displayZones.length} zones by engagement:`,
      ...displayZones.map((z, i) => 
        `${i + 1}. ${z.zoneName || 'Zone ' + (i+1)} — ${z.engagementRate?.toFixed(1)}% engagement, ${z.totalVisitors} visitors, ${z.avgDwellTime?.toFixed(2)} min avg dwell`
      ),
    ];
    
    return {
      headline: askingWorst ? `Lowest performing zones` : `Zone engagement breakdown`,
      bullets,
      recommendedActions: [
        { label: 'Open Heatmap', uiIntent: 'open_heatmap' },
        { label: 'View Zone Details', uiIntent: 'open_zone_analytics' },
      ],
      confidence: 'high',
      suggestedQuestions: askingWorst 
        ? ['How can I improve these underperforming zones?', 'What are the top performing zones?']
        : ['How can I improve engagement in low-performing zones?', 'What is the dwell time trend for these zones?'],
    };
  }

  // Handle hourly/peak traffic questions
  if (type === 'hourly' && data && data.length > 0) {
    const topHours = data.slice(0, 4);
    const peakHour = topHours[0];
    const bullets = [
      `Peak hour: ${peakHour.hour}:00 with ${peakHour.visitors} visitors`,
      `Top traffic hours:`,
      ...topHours.map(h => 
        `• ${h.hour}:00 — ${h.visitors} visitors, ${h.avgDwellTime?.toFixed(2)} min avg dwell`
      ),
    ];
    
    return {
      headline: `Hourly traffic breakdown`,
      bullets,
      recommendedActions: [
        { label: 'View Traffic Heatmap', uiIntent: 'open_heatmap' },
        { label: 'Staff Planning', uiIntent: 'open_staff_planning' },
      ],
      confidence: 'high',
      suggestedQuestions: [
        'How should I adjust staffing for peak hours?',
        'Which zones are busiest during peak?',
      ],
    };
  }

  // Handle period comparison questions
  if (type === 'compare' && data) {
    const { current, previous, deltas, compareType } = data;
    const periodLabel = compareType === 'week' ? 'This week vs Last week' : 'Today vs Yesterday';
    const formatDelta = (val) => val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`;
    const deltaIcon = (val) => val > 0 ? '📈' : val < 0 ? '📉' : '➡️';
    
    const bullets = [
      `${periodLabel}`,
      `${deltaIcon(deltas.visitors)} Visitors: ${current.visitors || 0} (${formatDelta(deltas.visitors)})`,
      `${deltaIcon(deltas.avgDwellTime)} Avg Dwell: ${(current.avgDwellTime || 0).toFixed(2)} min (${formatDelta(deltas.avgDwellTime)})`,
      `${deltaIcon(deltas.engagementRate)} Engagement: ${(current.engagementRate || 0).toFixed(1)}% (${formatDelta(deltas.engagementRate)})`,
    ];
    
    return {
      headline: `Period comparison: ${periodLabel}`,
      bullets,
      recommendedActions: [
        { label: 'View Trends', uiIntent: 'open_analytics' },
        { label: 'Download Report', uiIntent: 'download_report' },
      ],
      confidence: 'high',
      suggestedQuestions: [
        'What caused the change in visitors?',
        'How does this week compare to last month?',
      ],
    };
  }

  if (!openAIEnabled || !openAIKey) {
    // Fallback: generate a simple response based on the question
    return {
      headline: 'Question response',
      bullets: [
        `Regarding your question: "${question}"`,
        ...generateBullets(viewPack).slice(0, 2),
      ],
      recommendedActions: getSuggestedActions(viewPack.personaId, viewPack.stepId, viewPack.kpis),
      confidence: 'low',
    };
  }

  try {
    return await generateOpenAINarration(viewPack, { question });
  } catch (err) {
    console.warn('[NarrationFallback] Question answering failed:', err.message);
    return {
      headline: SAFETY_FALLBACK.split('\n')[0],
      bullets: [SAFETY_FALLBACK],
      recommendedActions: [],
      confidence: 'low',
    };
  }
}

export default {
  generateFallbackNarration,
  generateNarration,
  answerKpiQuestion,
};
