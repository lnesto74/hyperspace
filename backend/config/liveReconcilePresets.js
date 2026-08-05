/**
 * Live reconciler presets — authoritative tuning for MQTT ingest + canvas.
 * "luca" is the production default; do not change without explicit owner approval.
 */
import { LUCA_LIVE_RECONCILER_RAW } from './reconcilerDefaults.js';
import { normalizeReconcilerConfig } from '../services/TrajectoryReconciler.js';

export const DEFAULT_LIVE_PRESET_ID = 'luca';

export const LIVE_RECONCILE_PRESETS = [
  {
    id: 'luca',
    label: 'Luca',
    description: 'Owner-tuned Treviglio live reconciler — smooth tracks, no zig-zag, NN off.',
    locked: true,
    config: normalizeReconcilerConfig(LUCA_LIVE_RECONCILER_RAW),
  },
];

export function getLivePreset(presetId) {
  return LIVE_RECONCILE_PRESETS.find((p) => p.id === presetId) || null;
}

export function listLivePresets() {
  return LIVE_RECONCILE_PRESETS.map(({ id, label, description, locked }) => ({
    id, label, description, locked,
  }));
}

/** Normalized config used whenever a venue has no saved reconciler settings. */
export function getDefaultLiveReconcilerConfig() {
  const preset = getLivePreset(DEFAULT_LIVE_PRESET_ID);
  return { ...preset.config, preset_id: DEFAULT_LIVE_PRESET_ID };
}

/** Apply a named preset; returns normalized config with preset_id stamped. */
export function resolveLiveReconcilerConfig({ presetId, overrides } = {}) {
  const id = presetId || DEFAULT_LIVE_PRESET_ID;
  const preset = getLivePreset(id);
  if (!preset) throw new Error(`Unknown live reconciler preset: ${id}`);
  const merged = normalizeReconcilerConfig({ ...preset.config, ...(overrides || {}) });
  return { ...merged, preset_id: id };
}
