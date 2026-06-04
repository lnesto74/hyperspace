/**
 * Story Mode intro variant — classic "Store Awakening" vs experimental kinetic reel.
 * Persisted in localStorage so you can flip back instantly without redeploying.
 */

export type StoryIntroVariant = 'classic' | 'kinetic'

const STORAGE_KEY = 'hyperspace-story-kinetic-intro'

export const KINETIC_INTRO_REPLAY_SPEED = 10
export const KINETIC_INTRO_TOTAL_MS = 9600
export const KINETIC_INTRO_FALLBACK_MS = 11000

export function getKineticIntroEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function setKineticIntroEnabled(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false')
  } catch { /* ignore */ }
}

export function resolveIntroVariant(): StoryIntroVariant {
  return getKineticIntroEnabled() ? 'kinetic' : 'classic'
}

/** Dispatched by MainViewport when kinetic intro needs live MQTT trajectories. */
export const STORY_INTRO_REPLAY_START = 'hyperspace:story-intro-replay-start'
