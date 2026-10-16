// The eight lenses of the spatial workspace. One twin, one selection, one clock.
// `base` is the renderer view (applyEverydayView id); `mode` overrides the drawing mode.

export const LENSES = [
  { id: 'pulse', n: '01', tab: 'Pulse', kicker: 'STORE PULSE', title: 'A living view of the store',
    sub: 'How the day went, on the floor where it happened.', base: 'moved', accent: '#65DEF0', icon: 'pulse',
    layers: [['movement', 'Movement'], ['evidence', 'Evidence'], ['clean', 'Clean']] },
  { id: 'flow', n: '02', tab: 'Flow Explorer', kicker: 'FLOW EXPLORER', title: 'Read the movement field',
    sub: 'Where people walked, slowed and crossed. Movement only, not people counts.', base: 'moved', mode: 'flow', accent: '#65DEF0', icon: 'waves',
    layers: [['movement', 'Movement'], ['dwell', 'Dwell'], ['footfall', 'Activity'], ['purity', 'Direction'], ['convergence', 'Convergence'], ['regime', 'Regimes']] },
  { id: 'behaviour', n: '03', tab: 'Behaviour', kicker: 'BEHAVIOURAL FINGERPRINT', title: 'How people move, not just where',
    sub: 'Six movement states measured on the raw 10 Hz tracks: passing, browsing, choosing, standing, hesitating, waiting.', base: 'moved', accent: '#FF7AC8', icon: 'motion',
    layers: [['streams', 'Streams by state'], ['fingerprint', 'Department fingerprints'], ['hotspots', 'Hesitation spots']] },
  { id: 'engagement', n: '04', tab: 'Engagement', kicker: 'DEPARTMENT ENGAGEMENT', title: 'Where customers spend their time',
    sub: 'Minutes per entrant in each department, and how much of it at the shelf.', base: 'stopped', accent: '#A9B5EE', icon: 'chart',
    layers: [['area', 'Time in area'], ['shelf', 'At the shelf'], ['choice', 'Choice index']] },
  { id: 'categories', n: '05', tab: 'Categories', kicker: 'PLANOGRAM CATEGORIES', title: 'Which shelves make people stop',
    sub: 'The Esselunga planogram on the twin: for every category, who passes, who stops and how long they choose.', base: 'moved', accent: '#F3C778', icon: 'shelf',
    layers: [['store', 'Store'], ['aisle', 'Aisle'], ['shelf', 'Shelf (est.)']] },
  { id: 'service', n: '06', tab: 'Service', kicker: 'CHECKOUT SERVICE', title: 'Where waiting concentrates',
    sub: 'Queue time per entrant through the day, and which lanes carry it.', base: 'queues', accent: '#E58E92', icon: 'cart',
    layers: [['replay', 'Minute by minute'], ['waiting', 'Waiting time'], ['transit', 'Walk-through']] },
  { id: 'opportunities', n: '07', tab: 'Opportunities', kicker: 'VALUE OPPORTUNITIES', title: 'From observation to a test',
    sub: 'What was observed, what is assumed, and a small test to check it.', base: 'value', accent: '#C2A87F', icon: 'spark',
    layers: [['value', 'Modelled scenarios'], ['radar', 'Profit Radar now']] },
  { id: 'compare', n: '08', tab: 'Compare', kicker: 'SPATIAL COMPARE', title: 'One store through the day',
    sub: 'How the same store changes through the day, on one scale.', base: 'moved', accent: '#81E0A3', icon: 'split',
    layers: [['day', 'The day'], ['ab', 'A vs B'], ['diff', 'Difference']] },
  { id: 'media', n: '09', tab: 'Media', kicker: 'IN-STORE MEDIA', title: 'Who sees the totems, and what it sells',
    sub: 'Audience measured on the floor, the best spot for each totem, an ON/OFF sales test and the price per thousand.', base: 'moved', accent: '#8FD3FF', icon: 'screen',
    layers: [['placement', 'Placement'], ['audience', 'Audience'], ['test', 'ON/OFF test'], ['price', 'Schedule & CPM'], ['simulate', 'Simulate']] },
  { id: 'live', n: '10', tab: 'Live', kicker: 'LIVE OPERATIONS', title: 'The store, as it is now',
    sub: 'Anonymous bodies on the floor right now, in the same 3D store.', base: 'moved', accent: '#81E0A3', icon: 'live',
    layers: [['tracks', 'Live tracks'], ['context', 'Flow context']] },
];

export const LENS = Object.fromEntries(LENSES.map((l) => [l.id, l]));

/** Visitor Journey slot → flow slice id (backend FlowFieldDailyService.SLICES). */
export const SLOT_TO_SLICE = { giorno: 'trading', '08-10': 'h08_10', '10-12': 'h10_12', '12-14': 'h12_14', '14-16': 'h14_16', '16-18': 'h16_18', '18-20': 'h18_20' };

export const ICONS = {
  logo: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 3 27 9.5v13L16 29 5 22.5v-13Z"/><path d="M11 12.5 16 9.5l5 3v7l-5 3-5-3Z" opacity=".7"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5" opacity=".6"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 12h4l2.5-6 4 12 2.5-6H21"/></svg>',
  waves: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8c3-2.5 6 2.5 9 0s6 2.5 9 0M3 13c3-2.5 6 2.5 9 0s6 2.5 9 0M3 18c3-2.5 6 2.5 9 0s6 2.5 9 0"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 15 3-4 3 2 4-6"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4h2.5l2 11h10l2-8H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/></svg>',
  split: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg>',
  motion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="5" cy="17" r="2"/><path d="M7 16c3-1 3.5-7 7-8"/><circle cx="16.5" cy="7.5" r="2.2"/><path d="M18 9.5c1.5 2 1.5 4.5 0 6.5" stroke-dasharray="1.5 2"/><circle cx="17" cy="18" r="1.4"/></svg>',
  screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="7" y="3" width="10" height="15" rx="1.5"/><path d="M12 18v3M8.5 21h7"/><path d="M3.5 8.5c-1 2-1 5 0 7M20.5 8.5c1 2 1 5 0 7" opacity=".7"/></svg>',
  shelf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M3.5 9h17M3.5 14.5h17"/><path d="M6.5 6.5h3M12 6.5h5M6.5 12h6M15 12h2.5M6.5 17.5h4M13 17.5h4.5" opacity=".7"/></svg>',
  lab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 17 17 7M9 7h8v8"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 7v6M12 16.5v.5"/></svg>',
};
