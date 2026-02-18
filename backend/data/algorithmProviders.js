/**
 * Algorithm Provider Seed Data
 * 
 * Seeds the database with initial algorithm providers on startup.
 * All providers must have Docker images - .deb packages are converted
 * to Docker images via the Conversion Service.
 * 
 * NOTE: This file is for seeding only. Runtime provider management
 * is handled via the /api/algorithm-providers endpoints.
 */

import { v4 as uuidv4 } from 'uuid';

// Seed data for initial providers
export const SEED_PROVIDERS = [
  {
    providerId: 'aruvii-fusion-v1',
    displayName: 'Aruvii',
    version: '1.0.0',
    dockerImageRef: 'ghcr.io/aruvii/lidar-fusion:1.0.0',
    onboardingMode: 'docker_existing',
    supportedLidars: ['Livox LS', 'Quanergy', 'RoboSense'],
    requiresGpu: false,
    notes: 'Multi-LiDAR fusion with advanced person tracking and trajectory output.',
    website: 'https://aruvii.com',
    docsUrl: 'https://docs.aruvii.com/lidar-fusion',
  },
  {
    providerId: 'hyperspace-beta-v1',
    displayName: 'Hyperspace Beta',
    version: '0.9.0-beta',
    dockerImageRef: 'ghcr.io/hyperspace-ai/fusion:0.9.0-beta',
    onboardingMode: 'docker_existing',
    supportedLidars: ['Livox LS', 'Quanergy', 'RoboSense'],
    requiresGpu: false,
    notes: 'Hyperspace internal beta - for development and testing.',
    website: 'https://hyperspace.ai',
    docsUrl: 'https://docs.hyperspace.ai/edge-runtime',
  },
  {
    providerId: 'quanergy-tracker-v2',
    displayName: 'Quanergy',
    version: '2.1.0',
    dockerImageRef: 'ghcr.io/quanergy/qortex-tracker:2.1.0',
    onboardingMode: 'docker_existing',
    supportedLidars: ['Livox LS', 'Quanergy', 'RoboSense'],
    requiresGpu: false,
    notes: 'Quanergy Qortex tracker - requires Conversion Service if only .deb available.',
    website: 'https://quanergy.com',
    docsUrl: 'https://support.quanergy.com/qortex',
  },
];

/**
 * Seed providers into database on startup
 * Only inserts if provider doesn't already exist
 */
export function seedProviders(db) {
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO algorithm_providers (
      id, provider_id, display_name, version, docker_image_ref,
      onboarding_mode, supported_lidars_json, requires_gpu,
      notes, docs_url, website, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
  `);

  let seeded = 0;
  for (const provider of SEED_PROVIDERS) {
    const result = insertStmt.run(
      uuidv4(),
      provider.providerId,
      provider.displayName,
      provider.version,
      provider.dockerImageRef,
      provider.onboardingMode,
      JSON.stringify(provider.supportedLidars),
      provider.requiresGpu ? 1 : 0,
      provider.notes || null,
      provider.docsUrl || null,
      provider.website || null
    );
    if (result.changes > 0) seeded++;
  }

  if (seeded > 0) {
    console.log(`📦 Seeded ${seeded} algorithm providers`);
  }
}

/**
 * Get all active providers from database
 */
export function getActiveProviders(db) {
  const providers = db.prepare(`
    SELECT * FROM algorithm_providers WHERE is_active = 1 ORDER BY display_name ASC
  `).all();
  
  return providers.map(p => ({
    providerId: p.provider_id,
    name: p.display_name,
    version: p.version,
    dockerImage: p.docker_image_ref,
    onboardingMode: p.onboarding_mode,
    supportedLidarModels: JSON.parse(p.supported_lidars_json || '[]'),
    requiresGpu: Boolean(p.requires_gpu),
    notes: p.notes,
    docsUrl: p.docs_url,
    website: p.website,
    isActive: Boolean(p.is_active),
  }));
}

/**
 * Get provider by ID from database
 */
export function getProviderById(db, providerId) {
  const p = db.prepare(`
    SELECT * FROM algorithm_providers WHERE provider_id = ? OR id = ?
  `).get(providerId, providerId);
  
  if (!p) return null;
  
  return {
    providerId: p.provider_id,
    name: p.display_name,
    version: p.version,
    dockerImage: p.docker_image_ref,
    onboardingMode: p.onboarding_mode,
    supportedLidarModels: JSON.parse(p.supported_lidars_json || '[]'),
    requiresGpu: Boolean(p.requires_gpu),
    notes: p.notes,
    docsUrl: p.docs_url,
    website: p.website,
    isActive: Boolean(p.is_active),
  };
}

/**
 * Validate provider exists and is active
 */
export function validateProvider(db, providerId) {
  const provider = getProviderById(db, providerId);
  if (!provider) {
    return { valid: false, error: `Provider not found: ${providerId}` };
  }
  if (!provider.isActive) {
    return { valid: false, error: `Provider is not active: ${providerId}` };
  }
  return { valid: true, provider };
}

export default {
  SEED_PROVIDERS,
  seedProviders,
  getActiveProviders,
  getProviderById,
  validateProvider,
};
