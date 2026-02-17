/**
 * UI Intent Registry
 * 
 * Whitelist of allowed navigation and highlight intents for narration actions.
 * These are deep-link strings that the frontend can interpret.
 */

/**
 * @typedef {Object} UiIntent
 * @property {string} id - Intent identifier
 * @property {string} label - Display label
 * @property {string} description - Description of the action
 * @property {string[]} applicablePersonas - Personas this applies to
 * @property {string[]} applicableSteps - Steps this applies to
 */

/**
 * Import deep links from registry for dynamic intent generation
 */
import { getDeepLinkForStep, getValidPersonas, getStepsForPersona } from './PersonaStepRegistry.js';

export const UI_INTENTS = {
  // Navigation intents (aligned with PersonaStepRegistry.json deepLinks)
  'NAVIGATE:/dashboard/live': {
    id: 'NAVIGATE:/dashboard/live',
    label: 'Open Live Store View',
    description: 'Navigate to real-time store dashboard',
    applicablePersonas: ['store_manager'],
    applicableSteps: ['operations_pulse'],
  },
  'NAVIGATE:/operations/checkout': {
    id: 'NAVIGATE:/operations/checkout',
    label: 'Open Checkout Manager',
    description: 'Navigate to checkout management',
    applicablePersonas: ['store_manager'],
    applicableSteps: ['checkout_pressure'],
  },
  'NAVIGATE:/analytics/categories': {
    id: 'NAVIGATE:/analytics/categories',
    label: 'Open Category Analytics',
    description: 'Navigate to category performance',
    applicablePersonas: ['category_manager'],
    applicableSteps: ['category_engagement'],
  },
  'NAVIGATE:/analytics/shelves': {
    id: 'NAVIGATE:/analytics/shelves',
    label: 'Open Shelf Heatmap',
    description: 'Navigate to shelf analytics',
    applicablePersonas: ['category_manager'],
    applicableSteps: ['shelf_quality'],
  },
  'NAVIGATE:/analytics/dooh': {
    id: 'NAVIGATE:/analytics/dooh',
    label: 'Open DOOH Analytics',
    description: 'Navigate to DOOH effectiveness',
    applicablePersonas: ['retail_media_manager'],
    applicableSteps: ['dooh_effectiveness'],
  },
  'NAVIGATE:/analytics/dooh/funnel': {
    id: 'NAVIGATE:/analytics/dooh/funnel',
    label: 'View Campaign Funnel',
    description: 'Navigate to attention-to-action funnel',
    applicablePersonas: ['retail_media_manager'],
    applicableSteps: ['attention_to_action'],
  },
  'NAVIGATE:/dashboard/executive': {
    id: 'NAVIGATE:/dashboard/executive',
    label: 'Open Executive Dashboard',
    description: 'Navigate to executive overview',
    applicablePersonas: ['executive'],
    applicableSteps: ['business_overview'],
  },
  'NAVIGATE:/analytics/opportunities': {
    id: 'NAVIGATE:/analytics/opportunities',
    label: 'Open Opportunity Map',
    description: 'Navigate to growth opportunities',
    applicablePersonas: ['executive'],
    applicableSteps: ['growth_opportunities'],
  },

  // Panel intents
  'OPEN_PANEL:checkout-manager': {
    id: 'OPEN_PANEL:checkout-manager',
    label: 'Open Checkout Manager',
    description: 'Open queue management panel',
    applicablePersonas: ['store_manager'],
    applicableSteps: ['checkout_pressure'],
  },
  'OPEN_PANEL:heatmap': {
    id: 'OPEN_PANEL:heatmap',
    label: 'View Heatmap',
    description: 'Open traffic heatmap overlay',
    applicablePersonas: ['store_manager', 'category_manager', 'executive'],
    applicableSteps: ['operations_pulse', 'shelf_quality', 'business_overview'],
  },
  'OPEN_PANEL:smart-kpi': {
    id: 'OPEN_PANEL:smart-kpi',
    label: 'Configure Smart KPIs',
    description: 'Open zone KPI configuration',
    applicablePersonas: ['store_manager', 'category_manager'],
    applicableSteps: ['operations_pulse', 'shelf_quality'],
  },

  // Highlight intents (parameterized - these are templates)
  'HIGHLIGHT_ROI': {
    id: 'HIGHLIGHT_ROI',
    label: 'Highlight Zone',
    description: 'Focus on a specific zone/ROI',
    applicablePersonas: ['store_manager', 'category_manager'],
    applicableSteps: ['operations_pulse', 'checkout_pressure', 'shelf_quality'],
    parameterized: true,
  },
  'HIGHLIGHT_SCREEN': {
    id: 'HIGHLIGHT_SCREEN',
    label: 'Highlight Screen',
    description: 'Focus on a DOOH screen',
    applicablePersonas: ['retail_media_manager'],
    applicableSteps: ['dooh_effectiveness'],
    parameterized: true,
  },
  'HIGHLIGHT_SHELF': {
    id: 'HIGHLIGHT_SHELF',
    label: 'Highlight Shelf',
    description: 'Focus on a specific shelf',
    applicablePersonas: ['category_manager'],
    applicableSteps: ['shelf_quality'],
    parameterized: true,
  },
};

/**
 * Get valid intents for a persona-step combination
 * @param {import('./types.js').PersonaId} personaId
 * @param {import('./types.js').StepId} stepId
 * @returns {Array<{id: string, label: string}>}
 */
export function getIntentsForStep(personaId, stepId) {
  const intents = [];
  
  for (const [id, intent] of Object.entries(UI_INTENTS)) {
    if (
      intent.applicablePersonas.includes(personaId) &&
      intent.applicableSteps.includes(stepId)
    ) {
      intents.push({ id, label: intent.label });
    }
  }
  
  return intents;
}

/**
 * Validate an intent string
 * @param {string} intentStr - e.g., "HIGHLIGHT_ROI:zone-123" or "NAVIGATE:/dooh"
 * @returns {boolean}
 */
export function isValidIntent(intentStr) {
  // Check for exact match
  if (UI_INTENTS[intentStr]) {
    return true;
  }
  
  // Check for parameterized match (e.g., HIGHLIGHT_ROI:zone-id)
  const colonIndex = intentStr.indexOf(':');
  if (colonIndex > 0) {
    const baseIntent = intentStr.substring(0, colonIndex);
    const template = UI_INTENTS[baseIntent];
    if (template && template.parameterized) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get suggested actions for a viewpack based on KPI status
 * @param {import('./types.js').PersonaId} personaId
 * @param {import('./types.js').StepId} stepId
 * @param {Array<{id: string, status?: string}>} kpis
 * @returns {Array<{label: string, uiIntent: string}>}
 */
export function getSuggestedActions(personaId, stepId, kpis) {
  const actions = [];
  const hasRedKpis = kpis.some(k => k.status === 'red');
  const hasAmberKpis = kpis.some(k => k.status === 'amber');

  // Persona-step specific suggestions
  switch (`${personaId}:${stepId}`) {
    case 'store-manager:operations-pulse':
      if (hasRedKpis || hasAmberKpis) {
        actions.push({ label: 'View Heatmap', uiIntent: 'OPEN_PANEL:heatmap' });
      }
      actions.push({ label: 'Open Operations Dashboard', uiIntent: 'NAVIGATE:/reporting?persona=store-manager' });
      break;

    case 'store-manager:queue-health':
      if (hasRedKpis) {
        actions.push({ label: 'Manage Checkouts', uiIntent: 'OPEN_PANEL:checkout-manager' });
      }
      actions.push({ label: 'View Operations', uiIntent: 'NAVIGATE:/reporting?persona=store-manager' });
      break;

    case 'merchandising:shelf-performance':
      if (hasRedKpis || hasAmberKpis) {
        actions.push({ label: 'Edit Planogram', uiIntent: 'NAVIGATE:/planogram' });
      }
      actions.push({ label: 'View Merchandising Dashboard', uiIntent: 'NAVIGATE:/reporting?persona=merchandising' });
      break;

    case 'retail-media:dooh-effectiveness':
      actions.push({ label: 'View DOOH Analytics', uiIntent: 'NAVIGATE:/dooh' });
      if (hasRedKpis) {
        actions.push({ label: 'Review Screen Placement', uiIntent: 'NAVIGATE:/dooh' });
      }
      break;

    case 'retail-media:peble-attribution':
      actions.push({ label: 'View Attribution Details', uiIntent: 'NAVIGATE:/dooh-effectiveness' });
      break;

    case 'executive:executive-summary':
      actions.push({ label: 'View Full Report', uiIntent: 'NAVIGATE:/reporting' });
      if (hasRedKpis) {
        actions.push({ label: 'Investigate Issues', uiIntent: 'OPEN_PANEL:heatmap' });
      }
      break;
  }

  // Limit to 2 actions
  return actions.slice(0, 2);
}

export default {
  UI_INTENTS,
  getIntentsForStep,
  isValidIntent,
  getSuggestedActions,
};
