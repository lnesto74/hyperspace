/**
 * Algorithm Providers API Routes
 * 
 * Endpoints for managing HER algorithm providers and the DEB → Docker Conversion Service.
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
  buildProviderImage,
  validateDebFile,
  getBuildStatus,
  getProviderBuilds,
  encryptSecret,
} from '../services/ProviderBuildService.js';

const router = Router();

// Configure multer for .deb file uploads
const UPLOAD_DIR = process.env.PROVIDER_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'providers');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(UPLOAD_DIR, req.body.providerId || 'temp');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max
    files: 10, // Max 10 .deb files
  },
  fileFilter: (req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.deb')) {
      cb(null, true);
    } else if (file.fieldname === 'licenseFile') {
      cb(null, true); // Allow any license file type
    } else {
      cb(new Error('Only .deb files are allowed'));
    }
  },
});

// Supported LiDAR models for dropdown
const SUPPORTED_LIDARS = [
  'Livox LS',
  'Livox Mid-360',
  'Quanergy M8',
  'Quanergy S3',
  'RoboSense RS-LiDAR-16',
  'RoboSense RS-LiDAR-32',
  'Ouster OS1',
  'Velodyne VLP-16',
  'Hesai XT32',
];

/**
 * GET /api/algorithm-providers
 * List all active algorithm providers
 */
router.get('/', (req, res) => {
  try {
    const db = req.app.get('db');
    
    // Get providers from database
    const providers = db.prepare(`
      SELECT * FROM algorithm_providers 
      WHERE is_active = 1 
      ORDER BY display_name ASC
    `).all();

    // Transform to API format
    const result = providers.map(p => ({
      providerId: p.provider_id,
      name: p.display_name,
      version: p.version,
      dockerImage: p.docker_image_ref,
      dockerImageDigest: p.docker_image_digest,
      onboardingMode: p.onboarding_mode,
      supportedLidarModels: JSON.parse(p.supported_lidars_json || '[]'),
      requiresGpu: Boolean(p.requires_gpu),
      runCommand: p.run_command_json ? JSON.parse(p.run_command_json) : null,
      ubuntuBase: p.ubuntu_base,
      notes: p.notes,
      docsUrl: p.docs_url,
      website: p.website,
      isActive: Boolean(p.is_active),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));

    res.json(result);
  } catch (err) {
    console.error('Error fetching providers:', err);
    res.status(500).json({ error: 'Failed to fetch providers', message: err.message });
  }
});

/**
 * GET /api/algorithm-providers/supported-lidars
 * Get list of supported LiDAR models for dropdown
 */
router.get('/supported-lidars', (req, res) => {
  res.json(SUPPORTED_LIDARS);
});

/**
 * GET /api/algorithm-providers/:id
 * Get a specific provider by ID
 */
router.get('/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const provider = db.prepare(`
      SELECT * FROM algorithm_providers WHERE provider_id = ? OR id = ?
    `).get(req.params.id, req.params.id);

    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    res.json({
      id: provider.id,
      providerId: provider.provider_id,
      name: provider.display_name,
      version: provider.version,
      dockerImage: provider.docker_image_ref,
      dockerImageDigest: provider.docker_image_digest,
      onboardingMode: provider.onboarding_mode,
      supportedLidarModels: JSON.parse(provider.supported_lidars_json || '[]'),
      requiresGpu: Boolean(provider.requires_gpu),
      runCommand: provider.run_command_json ? JSON.parse(provider.run_command_json) : null,
      ubuntuBase: provider.ubuntu_base,
      notes: provider.notes,
      docsUrl: provider.docs_url,
      website: provider.website,
      config: provider.config_json ? JSON.parse(provider.config_json) : null,
      isActive: Boolean(provider.is_active),
      createdAt: provider.created_at,
      updatedAt: provider.updated_at,
    });
  } catch (err) {
    console.error('Error fetching provider:', err);
    res.status(500).json({ error: 'Failed to fetch provider', message: err.message });
  }
});

/**
 * POST /api/algorithm-providers
 * Create or update a provider (Docker existing mode)
 */
router.post('/', (req, res) => {
  try {
    const db = req.app.get('db');
    const {
      providerId,
      displayName,
      version,
      dockerImage,
      supportedLidars = [],
      requiresGpu = false,
      notes,
      docsUrl,
      website,
    } = req.body;

    // Validate required fields
    if (!providerId || !displayName || !version || !dockerImage) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['providerId', 'displayName', 'version', 'dockerImage'],
      });
    }

    // Check if provider already exists
    const existing = db.prepare('SELECT id FROM algorithm_providers WHERE provider_id = ?').get(providerId);
    
    const id = existing?.id || uuidv4();
    const now = new Date().toISOString();

    if (existing) {
      // Update existing provider
      db.prepare(`
        UPDATE algorithm_providers SET
          display_name = ?,
          version = ?,
          docker_image_ref = ?,
          supported_lidars_json = ?,
          requires_gpu = ?,
          notes = ?,
          docs_url = ?,
          website = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        displayName,
        version,
        dockerImage,
        JSON.stringify(supportedLidars),
        requiresGpu ? 1 : 0,
        notes || null,
        docsUrl || null,
        website || null,
        now,
        id
      );
    } else {
      // Insert new provider
      db.prepare(`
        INSERT INTO algorithm_providers (
          id, provider_id, display_name, version, docker_image_ref,
          onboarding_mode, supported_lidars_json, requires_gpu,
          notes, docs_url, website, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        id,
        providerId,
        displayName,
        version,
        dockerImage,
        'docker_existing',
        JSON.stringify(supportedLidars),
        requiresGpu ? 1 : 0,
        notes || null,
        docsUrl || null,
        website || null,
        now,
        now
      );
    }

    res.json({
      success: true,
      id,
      providerId,
      message: existing ? 'Provider updated' : 'Provider created',
    });
  } catch (err) {
    console.error('Error creating/updating provider:', err);
    res.status(500).json({ error: 'Failed to save provider', message: err.message });
  }
});

/**
 * POST /api/algorithm-providers/conversion/build
 * Start a DEB → Docker conversion build
 */
router.post('/conversion/build', upload.fields([
  { name: 'debFiles', maxCount: 10 },
  { name: 'licenseFile', maxCount: 1 },
]), async (req, res) => {
  try {
    const db = req.app.get('db');
    
    // Parse provider metadata from form data
    let metadata;
    try {
      metadata = JSON.parse(req.body.metadata || '{}');
    } catch (parseErr) {
      return res.status(400).json({ error: 'Invalid metadata JSON' });
    }

    const {
      providerId,
      displayName,
      version,
      supportedLidars = [],
      requiresGpu = false,
      runCommand,
      ubuntuBase = '22.04',
      notes,
      docsUrl,
      website,
      licenseMode = 'none',
      licenseEnvVarName,
    } = metadata;

    // Validate required fields
    if (!providerId || !displayName || !version || !runCommand) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['providerId', 'displayName', 'version', 'runCommand'],
      });
    }

    // Validate runCommand is an array
    let runCommandJson;
    try {
      if (typeof runCommand === 'string') {
        runCommandJson = runCommand;
        JSON.parse(runCommand); // Validate it's valid JSON
      } else if (Array.isArray(runCommand)) {
        runCommandJson = JSON.stringify(runCommand);
      } else {
        throw new Error('runCommand must be a JSON array');
      }
    } catch (cmdErr) {
      return res.status(400).json({
        error: 'Invalid runCommand format',
        message: 'runCommand must be a JSON array like ["/usr/bin/tracker", "--config", "/data/config.json"]',
      });
    }

    // Validate .deb files were uploaded
    const debFiles = req.files?.debFiles || [];
    if (debFiles.length === 0) {
      return res.status(400).json({ error: 'At least one .deb file is required' });
    }

    // Validate each .deb file
    const debFilePaths = [];
    for (const file of debFiles) {
      const validation = validateDebFile(file.path);
      if (!validation.valid) {
        // Clean up uploaded files
        for (const f of debFiles) {
          try { fs.unlinkSync(f.path); } catch (e) {}
        }
        return res.status(400).json({
          error: `Invalid .deb file: ${file.originalname}`,
          message: validation.error,
        });
      }
      debFilePaths.push(file.path);
    }

    // Create or update provider record
    const existingProvider = db.prepare('SELECT id FROM algorithm_providers WHERE provider_id = ?').get(providerId);
    const providerDbId = existingProvider?.id || uuidv4();
    const now = new Date().toISOString();

    if (existingProvider) {
      db.prepare(`
        UPDATE algorithm_providers SET
          display_name = ?,
          version = ?,
          onboarding_mode = 'deb_converted',
          supported_lidars_json = ?,
          requires_gpu = ?,
          run_command_json = ?,
          ubuntu_base = ?,
          notes = ?,
          docs_url = ?,
          website = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        displayName,
        version,
        JSON.stringify(supportedLidars),
        requiresGpu ? 1 : 0,
        runCommandJson,
        ubuntuBase,
        notes || null,
        docsUrl || null,
        website || null,
        now,
        providerDbId
      );
    } else {
      db.prepare(`
        INSERT INTO algorithm_providers (
          id, provider_id, display_name, version, onboarding_mode,
          supported_lidars_json, requires_gpu, run_command_json, ubuntu_base,
          notes, docs_url, website, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'deb_converted', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        providerDbId,
        providerId,
        displayName,
        version,
        JSON.stringify(supportedLidars),
        requiresGpu ? 1 : 0,
        runCommandJson,
        ubuntuBase,
        notes || null,
        docsUrl || null,
        website || null,
        now,
        now
      );
    }

    // Handle license file if provided
    const licenseFile = req.files?.licenseFile?.[0];
    if (licenseFile && licenseMode !== 'none') {
      const licenseContent = fs.readFileSync(licenseFile.path, 'utf-8');
      const encryptedLicense = encryptSecret(licenseContent);
      
      // Store encrypted license
      db.prepare(`
        INSERT OR REPLACE INTO provider_secrets (id, provider_id, secret_type, secret_name, encrypted_value, created_at)
        VALUES (?, ?, 'license_file', ?, ?, ?)
      `).run(uuidv4(), providerDbId, licenseFile.originalname, encryptedLicense, now);
      
      // Clean up license file
      fs.unlinkSync(licenseFile.path);
    }

    // Create build record
    const buildId = uuidv4();
    db.prepare(`
      INSERT INTO provider_builds (id, provider_id, status, deb_files_json, created_at)
      VALUES (?, ?, 'queued', ?, ?)
    `).run(buildId, providerDbId, JSON.stringify(debFilePaths.map(p => path.basename(p))), now);

    // Start build asynchronously
    const buildConfig = {
      id: providerDbId,
      providerId,
      displayName,
      version,
      supportedLidars,
      requiresGpu,
      runCommandJson,
      ubuntuBase,
    };

    // Run build in background
    setImmediate(async () => {
      await buildProviderImage(buildId, buildConfig, debFilePaths, db);
      
      // Clean up uploaded .deb files
      for (const filePath of debFilePaths) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error('Failed to clean up .deb file:', e.message);
        }
      }
    });

    res.json({
      success: true,
      buildId,
      providerId: providerDbId,
      message: 'Build started',
      status: 'queued',
    });

  } catch (err) {
    console.error('Error starting conversion build:', err);
    res.status(500).json({ error: 'Failed to start build', message: err.message });
  }
});

/**
 * GET /api/algorithm-providers/conversion/builds/:buildId
 * Get build status and logs
 */
router.get('/conversion/builds/:buildId', (req, res) => {
  try {
    const db = req.app.get('db');
    const build = getBuildStatus(req.params.buildId, db);

    if (!build) {
      return res.status(404).json({ error: 'Build not found' });
    }

    res.json({
      id: build.id,
      providerId: build.provider_id,
      status: build.status,
      logs: build.logs,
      dockerImageTag: build.docker_image_tag,
      dockerImageDigest: build.docker_image_digest,
      errorMessage: build.error_message,
      createdAt: build.created_at,
      startedAt: build.started_at,
      completedAt: build.completed_at,
    });
  } catch (err) {
    console.error('Error fetching build status:', err);
    res.status(500).json({ error: 'Failed to fetch build status', message: err.message });
  }
});

/**
 * GET /api/algorithm-providers/:providerId/builds
 * Get all builds for a provider
 */
router.get('/:providerId/builds', (req, res) => {
  try {
    const db = req.app.get('db');
    
    // Get provider ID from slug
    const provider = db.prepare('SELECT id FROM algorithm_providers WHERE provider_id = ? OR id = ?')
      .get(req.params.providerId, req.params.providerId);
    
    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    const builds = getProviderBuilds(provider.id, db);

    res.json(builds.map(b => ({
      id: b.id,
      status: b.status,
      dockerImageTag: b.docker_image_tag,
      dockerImageDigest: b.docker_image_digest,
      errorMessage: b.error_message,
      createdAt: b.created_at,
      startedAt: b.started_at,
      completedAt: b.completed_at,
    })));
  } catch (err) {
    console.error('Error fetching provider builds:', err);
    res.status(500).json({ error: 'Failed to fetch builds', message: err.message });
  }
});

/**
 * DELETE /api/algorithm-providers/:id
 * Deactivate a provider (soft delete)
 */
router.delete('/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    
    const result = db.prepare(`
      UPDATE algorithm_providers 
      SET is_active = 0, updated_at = ? 
      WHERE provider_id = ? OR id = ?
    `).run(new Date().toISOString(), req.params.id, req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    res.json({ success: true, message: 'Provider deactivated' });
  } catch (err) {
    console.error('Error deactivating provider:', err);
    res.status(500).json({ error: 'Failed to deactivate provider', message: err.message });
  }
});

export default router;
