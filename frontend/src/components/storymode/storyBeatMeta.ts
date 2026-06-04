import type { StoryBeatMeta } from './storyNarrativeBridge'

/** Progress-strip labels for Story Mode beats (keep in sync with BEATS in StoryMode.tsx). */
export const STORY_BEAT_META: StoryBeatMeta[] = [
  { id: 'ready', rung: 'OBSERVE', time: '07:30', title: 'Before the doors open, the store wakes up' },
  { id: 'live', rung: 'OBSERVE', time: '08:00', title: 'Doors open — the store starts seeing' },
  { id: 'heatmap', rung: 'SENSE', time: '09:30', title: 'Patterns no one would notice by eye' },
  { id: 'queue', rung: 'ALERT', time: '11:00', title: 'A queue forms — before a single complaint' },
  { id: 'peble', rung: 'EXPLAIN', time: '13:00', title: 'The promo gets seen — but doesn\u2019t convert' },
  { id: 'radar', rung: 'QUANTIFY', time: '15:00', title: 'Opportunity, priced in euros' },
  { id: 'funnel', rung: 'DECIDE', time: '16:30', title: 'Where the journey leaks' },
  { id: 'narrator', rung: 'RECOMMEND', time: '18:00', title: '\u201cWhat should I improve tomorrow?\u201d' },
  { id: 'review', rung: 'REMEMBER', time: '20:00', title: 'The store replays its own day' },
]
