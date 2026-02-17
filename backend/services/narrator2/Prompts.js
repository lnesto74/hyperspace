/**
 * Narrator2 OpenAI Prompt Set
 * 
 * Structured prompts for KPI storytelling with strict output format.
 */

/**
 * 1️⃣ SYSTEM PROMPT — Narrator2 Core Identity
 * Used as `role: system` for ALL OpenAI calls.
 */
export const SYSTEM_PROMPT = `You are Narrator2, an in-product AI guide for the Hyperspace analytics platform.

Your role is to explain KPIs, insights, and trends to users in a clear, business-oriented way, based on their role (persona) and the KPIs provided to you.

IMPORTANT RULES:
- You only explain and interpret the data you receive.
- You NEVER invent KPIs, values, trends, or causes.
- You NEVER access databases, APIs, or raw telemetry.
- You NEVER suggest configuration changes or execute actions.
- You NEVER explain how to set up lidars, upload DWG files, or configure systems.

You may:
- Explain what KPIs mean.
- Compare values to benchmarks or thresholds provided.
- Highlight risks, opportunities, and changes.
- Tell a short, structured story using the KPIs.
- Suggest where in the UI the user should look next using deep links provided.

You must always:
- Speak in concise, executive-friendly language.
- Avoid technical jargon unless the persona is technical.
- Focus on "what happened", "why it matters", and "what to look at next".

If a question is outside the data you received, say:
"I don't have enough information in this view to answer that reliably."

Tone:
- Confident
- Clear
- Neutral
- Insight-driven

You are NOT a chatbot.
You are a KPI narrator embedded inside the product.`;

/**
 * 2️⃣ STORY MODE PROMPT — Primary Use Case
 * Main prompt for KPI storytelling flow.
 */
export const STORY_MODE_TEMPLATE = `Persona: {{persona_name}}

Context:
You are guiding this user through a KPI story inside Hyperspace.
Explain the KPIs below in a logical sequence for decision-making.

KPIs (ViewPack):
{{kpi_list_json}}

Thresholds:
{{thresholds_json}}

Time context:
{{time_range}}

Deep links available:
{{ui_links_json}}

Instructions:
- Start with a short summary (2–3 sentences).
- Then explain each KPI in order.
- Highlight any KPI that is outside its healthy range.
- Explain why this matters for this persona.
- End by suggesting ONE logical next screen to open using a deep link.

RESPONSE FORMAT (strict):
SUMMARY
<2–3 sentence overview>

KEY INSIGHTS
- Insight 1
- Insight 2
- Insight 3 (if needed)

WHY IT MATTERS
<Short persona-specific explanation>

WHAT TO CHECK NEXT
<Single deep link label>`;

/**
 * 3️⃣ KPI QUESTION PROMPT — Ad-hoc Explanation
 * Used when user clicks "Why?" or asks about a specific KPI.
 */
export const KPI_QUESTION_TEMPLATE = `Persona: {{persona_name}}

User question:
"{{user_question}}"

Relevant KPIs:
{{kpi_subset_json}}

Thresholds:
{{thresholds_json}}

Instructions:
- Answer the question using only the KPIs provided.
- Be factual and concise.
- If multiple KPIs are involved, explain the relationship.
- If the data is inconclusive, state that clearly.

RESPONSE FORMAT (strict):
SUMMARY
<Direct answer to the question>

KEY INSIGHTS
- Insight 1
- Insight 2 (if needed)

WHY IT MATTERS
<Brief explanation of business impact>`;

/**
 * 4️⃣ PEBLE/DOOH MODE PROMPT — Attribution Storytelling
 * Specialized for PEBLE™, EAL™, AQS™, CES™ metrics.
 */
export const PEBLE_MODE_TEMPLATE = `Persona: {{persona_name}}

Campaign context:
{{campaign_name}}
{{time_range}}

PEBLE KPIs:
{{peble_kpis_json}}

Control group info:
{{control_info_json}}

Instructions:
- Explain what PEBLE is in one simple sentence.
- Explain whether the campaign worked or not.
- Focus on behavioral lift, not impressions.
- Use EAL™, TTA™, DCI™, CES™ correctly.
- Avoid marketing hype — be analytical.
- End with one insight that a business user can act on.

RESPONSE FORMAT (strict):
SUMMARY
<2–3 sentence campaign effectiveness overview>

KEY INSIGHTS
- Insight 1 (behavioral lift)
- Insight 2 (attention quality)
- Insight 3 (action recommendation)

WHY IT MATTERS
<Business impact explanation>

WHAT TO CHECK NEXT
<Single deep link label>`;

/**
 * 5️⃣ COMPARATIVE INSIGHT PROMPT — Before/After Analysis
 * Used for trend or comparison analysis.
 */
export const COMPARATIVE_TEMPLATE = `Persona: {{persona_name}}

Comparison type:
{{comparison_type}}

KPIs:
{{comparison_kpis_json}}

Instructions:
- Explain what changed.
- Quantify the change where possible.
- Identify whether the change is positive or negative.
- Explain the likely business impact.
- Do NOT guess root causes beyond the data.

RESPONSE FORMAT (strict):
SUMMARY
<2–3 sentence comparison overview>

KEY INSIGHTS
- Change 1 with quantification
- Change 2 with quantification
- Change 3 (if significant)

WHY IT MATTERS
<Business impact of these changes>

WHAT TO CHECK NEXT
<Single deep link label>`;

/**
 * 7️⃣ SAFETY FALLBACK — Insufficient Data
 */
export const SAFETY_FALLBACK = `I don't have enough information in this view to answer that reliably.
Try switching to a different KPI view or time range.`;

/**
 * Persona display names mapping (from PersonaStepRegistry.json)
 */
export const PERSONA_NAMES = {
  'store_manager': 'Store Manager',
  'category_manager': 'Category Manager',
  'retail_media_manager': 'Retail Media / DOOH Manager',
  'executive': 'Executive / C-Level',
};

/**
 * Step to prompt mode mapping (from PersonaStepRegistry.json)
 */
export const STEP_TO_MODE = {
  'operations_pulse': 'story',
  'checkout_pressure': 'story',
  'category_engagement': 'story',
  'shelf_quality': 'story',
  'dooh_effectiveness': 'peble',
  'attention_to_action': 'peble',
  'business_overview': 'story',
  'growth_opportunities': 'story',
};

/**
 * Interpolate template variables
 * @param {string} template
 * @param {Record<string, string>} variables
 * @returns {string}
 */
export function interpolateTemplate(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    result = result.split(placeholder).join(value || '');
  }
  return result;
}

/**
 * Format KPIs for prompt
 * @param {Array<{id: string, label: string, value: number|null, unit?: string, status?: string}>} kpis
 * @returns {string}
 */
export function formatKpisForPrompt(kpis) {
  return JSON.stringify(
    kpis.map(k => ({
      id: k.id,
      label: k.label,
      value: k.value,
      unit: k.unit || '',
      status: k.status || 'na',
      hint: k.hint || '',
    })),
    null,
    2
  );
}

/**
 * Format thresholds for prompt
 * @param {Array<{id: string, thresholds?: object}>} kpiDefs
 * @returns {string}
 */
export function formatThresholdsForPrompt(kpiDefs) {
  const thresholds = {};
  for (const def of kpiDefs) {
    if (def.thresholds) {
      thresholds[def.id] = {
        green: def.thresholds.green,
        amber: def.thresholds.amber,
        direction: def.thresholds.direction,
      };
    }
  }
  return JSON.stringify(thresholds, null, 2);
}

/**
 * Format time range for prompt
 * @param {{startTs: number, endTs: number}} timeRange
 * @param {string} period
 * @returns {string}
 */
export function formatTimeRange(timeRange, period) {
  const start = new Date(timeRange.startTs).toISOString();
  const end = new Date(timeRange.endTs).toISOString();
  return `Period: ${period}\nFrom: ${start}\nTo: ${end}`;
}

/**
 * Format UI links for prompt
 * @param {Array<{label: string, uiIntent: string}>} links
 * @returns {string}
 */
export function formatUiLinksForPrompt(links) {
  return JSON.stringify(
    links.map(l => ({ label: l.label, intent: l.uiIntent })),
    null,
    2
  );
}

/**
 * Select prompt template based on step and context
 * @param {string} stepId
 * @param {Object} [context]
 * @returns {'story'|'peble'|'comparative'|'question'}
 */
export function selectPromptMode(stepId, context = {}) {
  if (context.comparison) {
    return 'comparative';
  }
  if (context.question) {
    return 'question';
  }
  return STEP_TO_MODE[stepId] || 'story';
}

/**
 * Get the appropriate prompt template
 * @param {'story'|'peble'|'comparative'|'question'} mode
 * @returns {string}
 */
export function getPromptTemplate(mode) {
  switch (mode) {
    case 'peble':
      return PEBLE_MODE_TEMPLATE;
    case 'comparative':
      return COMPARATIVE_TEMPLATE;
    case 'question':
      return KPI_QUESTION_TEMPLATE;
    case 'story':
    default:
      return STORY_MODE_TEMPLATE;
  }
}

/**
 * Parse structured response from OpenAI
 * @param {string} responseText
 * @returns {{summary: string, insights: string[], whyItMatters: string, nextAction: string|null}}
 */
export function parseStructuredResponse(responseText) {
  const sections = {
    summary: '',
    insights: [],
    whyItMatters: '',
    nextAction: null,
  };

  // Extract SUMMARY section
  const summaryMatch = responseText.match(/SUMMARY\s*\n([\s\S]*?)(?=KEY INSIGHTS|WHY IT MATTERS|WHAT TO CHECK|$)/i);
  if (summaryMatch) {
    sections.summary = summaryMatch[1].trim();
  }

  // Extract KEY INSIGHTS section
  const insightsMatch = responseText.match(/KEY INSIGHTS\s*\n([\s\S]*?)(?=WHY IT MATTERS|WHAT TO CHECK|$)/i);
  if (insightsMatch) {
    const insightsText = insightsMatch[1].trim();
    sections.insights = insightsText
      .split('\n')
      .map(line => line.replace(/^[-•*]\s*/, '').trim())
      .filter(line => line.length > 0);
  }

  // Extract WHY IT MATTERS section
  const whyMatch = responseText.match(/WHY IT MATTERS\s*\n([\s\S]*?)(?=WHAT TO CHECK|$)/i);
  if (whyMatch) {
    sections.whyItMatters = whyMatch[1].trim();
  }

  // Extract WHAT TO CHECK NEXT section
  const nextMatch = responseText.match(/WHAT TO CHECK NEXT\s*\n([\s\S]*?)$/i);
  if (nextMatch) {
    const nextText = nextMatch[1].trim();
    // Extract the action (e.g., "Open: LiDAR Planner → Coverage Simulation")
    const actionMatch = nextText.match(/(?:Open:\s*)?(.+)/i);
    if (actionMatch) {
      sections.nextAction = actionMatch[1].trim();
    }
  }

  return sections;
}

/**
 * Build complete user prompt
 * @param {import('./types.js').ViewPack} viewPack
 * @param {Object} stepDef
 * @param {Array<{label: string, uiIntent: string}>} uiLinks
 * @param {Object} [context]
 * @returns {string}
 */
export function buildUserPrompt(viewPack, stepDef, uiLinks, context = {}) {
  const mode = selectPromptMode(viewPack.stepId, context);
  const template = getPromptTemplate(mode);

  const variables = {
    persona_name: PERSONA_NAMES[viewPack.personaId] || viewPack.personaId,
    kpi_list_json: formatKpisForPrompt(viewPack.kpis),
    thresholds_json: formatThresholdsForPrompt(stepDef?.kpis || []),
    time_range: formatTimeRange(viewPack.timeRange, viewPack.period),
    ui_links_json: formatUiLinksForPrompt(uiLinks),
  };

  // Mode-specific variables
  if (mode === 'peble') {
    variables.campaign_name = context.campaignName || 'Current Campaign';
    variables.peble_kpis_json = formatKpisForPrompt(viewPack.kpis);
    variables.control_info_json = JSON.stringify(context.controlInfo || { available: false }, null, 2);
  }

  if (mode === 'comparative') {
    variables.comparison_type = context.comparison || 'period-over-period';
    variables.comparison_kpis_json = formatKpisForPrompt(viewPack.kpis);
  }

  if (mode === 'question') {
    variables.user_question = context.question || '';
    variables.kpi_subset_json = formatKpisForPrompt(viewPack.kpis);
  }

  return interpolateTemplate(template, variables);
}

export default {
  SYSTEM_PROMPT,
  STORY_MODE_TEMPLATE,
  KPI_QUESTION_TEMPLATE,
  PEBLE_MODE_TEMPLATE,
  COMPARATIVE_TEMPLATE,
  SAFETY_FALLBACK,
  PERSONA_NAMES,
  STEP_TO_MODE,
  interpolateTemplate,
  formatKpisForPrompt,
  formatThresholdsForPrompt,
  formatTimeRange,
  formatUiLinksForPrompt,
  selectPromptMode,
  getPromptTemplate,
  parseStructuredResponse,
  buildUserPrompt,
};
