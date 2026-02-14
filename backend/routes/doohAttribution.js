/**
 * DOOH Attribution API Routes
 * 
 * PEBLE™ - Post-Exposure Behavioral Lift Engine
 * 
 * All routes are behind FEATURE_DOOH_ATTRIBUTION feature flag.
 * 
 * Endpoints:
 * - GET/POST/PUT/DELETE /api/dooh-attribution/campaigns
 * - POST /api/dooh-attribution/run
 * - GET /api/dooh-attribution/kpis
 * - GET /api/dooh-attribution/debug/events
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DoohAttributionEngine, DEFAULT_CAMPAIGN_PARAMS } from '../services/dooh_attribution/DoohAttributionEngine.js';
import { ShelfAnalyticsAdapter } from '../services/dooh_attribution/ShelfAnalyticsAdapter.js';

const router = Router();

// Feature flag check middleware
const checkFeatureFlag = (req, res, next) => {
  if (process.env.FEATURE_DOOH_ATTRIBUTION !== 'true') {
    return res.status(404).json({ error: 'DOOH Attribution feature not enabled. Set FEATURE_DOOH_ATTRIBUTION=true' });
  }
  next();
};

router.use(checkFeatureFlag);

// ============================================
// CAMPAIGNS ENDPOINTS
// ============================================

/**
 * GET /api/dooh-attribution/campaigns - List campaigns for a venue
 */
router.get('/campaigns', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'venueId query parameter is required' });
    }

    const rows = db.prepare(`
      SELECT * FROM dooh_campaigns WHERE venue_id = ? ORDER BY created_at DESC
    `).all(venueId);

    const campaigns = rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      name: row.name,
      screenIds: JSON.parse(row.screen_ids_json),
      target: JSON.parse(row.target_json),
      params: JSON.parse(row.params_json),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({ campaigns, count: campaigns.length });
  } catch (err) {
    console.error('❌ Failed to fetch DOOH campaigns:', err.message);
    res.status(500).json({ error: 'Failed to fetch campaigns', message: err.message });
  }
});

/**
 * GET /api/dooh-attribution/campaigns/:id - Get a single campaign
 */
router.get('/campaigns/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;

    const row = db.prepare('SELECT * FROM dooh_campaigns WHERE id = ?').get(id);

    if (!row) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = {
      id: row.id,
      venueId: row.venue_id,
      name: row.name,
      screenIds: JSON.parse(row.screen_ids_json),
      target: JSON.parse(row.target_json),
      params: JSON.parse(row.params_json),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.json(campaign);
  } catch (err) {
    console.error('❌ Failed to fetch DOOH campaign:', err.message);
    res.status(500).json({ error: 'Failed to fetch campaign', message: err.message });
  }
});

/**
 * POST /api/dooh-attribution/campaigns - Create a new campaign
 */
router.post('/campaigns', (req, res) => {
  try {
    const db = req.app.get('db');
    const {
      venueId,
      name,
      screenIds,
      target,
      params = {},
      enabled = true,
    } = req.body;

    if (!venueId || !name || !screenIds || !target) {
      return res.status(400).json({ 
        error: 'venueId, name, screenIds, and target are required' 
      });
    }

    if (!Array.isArray(screenIds) || screenIds.length === 0) {
      return res.status(400).json({ error: 'screenIds must be a non-empty array' });
    }

    if (!target.type || !target.ids || !Array.isArray(target.ids)) {
      return res.status(400).json({ 
        error: 'target must have type and ids array' 
      });
    }

    const validTypes = ['shelf', 'category', 'brand', 'sku', 'slot'];
    if (!validTypes.includes(target.type)) {
      return res.status(400).json({ 
        error: `target.type must be one of: ${validTypes.join(', ')}` 
      });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const mergedParams = { ...DEFAULT_CAMPAIGN_PARAMS, ...params };

    db.prepare(`
      INSERT INTO dooh_campaigns (
        id, venue_id, name, screen_ids_json, target_json, params_json,
        enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, venueId, name,
      JSON.stringify(screenIds),
      JSON.stringify(target),
      JSON.stringify(mergedParams),
      enabled ? 1 : 0, now, now
    );

    res.status(201).json({
      success: true,
      campaign: {
        id,
        venueId,
        name,
        screenIds,
        target,
        params: mergedParams,
        enabled,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (err) {
    console.error('❌ Failed to create DOOH campaign:', err.message);
    res.status(500).json({ error: 'Failed to create campaign', message: err.message });
  }
});

/**
 * PUT /api/dooh-attribution/campaigns/:id - Update a campaign
 */
router.put('/campaigns/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;
    const {
      name,
      screenIds,
      target,
      params,
      enabled,
    } = req.body;

    const existing = db.prepare('SELECT * FROM dooh_campaigns WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (screenIds !== undefined) {
      updates.push('screen_ids_json = ?');
      values.push(JSON.stringify(screenIds));
    }
    if (target !== undefined) {
      updates.push('target_json = ?');
      values.push(JSON.stringify(target));
    }
    if (params !== undefined) {
      const existingParams = JSON.parse(existing.params_json);
      const mergedParams = { ...existingParams, ...params };
      updates.push('params_json = ?');
      values.push(JSON.stringify(mergedParams));
    }
    if (enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    db.prepare(`UPDATE dooh_campaigns SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    res.json({ success: true, id });
  } catch (err) {
    console.error('❌ Failed to update DOOH campaign:', err.message);
    res.status(500).json({ error: 'Failed to update campaign', message: err.message });
  }
});

/**
 * DELETE /api/dooh-attribution/campaigns/:id - Disable (soft delete) a campaign
 */
router.delete('/campaigns/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;
    const { hard } = req.query;

    if (hard === 'true') {
      db.prepare('DELETE FROM dooh_campaigns WHERE id = ?').run(id);
    } else {
      db.prepare('UPDATE dooh_campaigns SET enabled = 0, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), id);
    }

    res.json({ success: true, id });
  } catch (err) {
    console.error('❌ Failed to delete DOOH campaign:', err.message);
    res.status(500).json({ error: 'Failed to delete campaign', message: err.message });
  }
});

// ============================================
// RUN ENDPOINT
// ============================================

/**
 * POST /api/dooh-attribution/run - Run attribution analysis
 */
router.post('/run', async (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, campaignId, startTs, endTs, bucketMinutes = 15 } = req.body;

    if (!venueId || !campaignId || !startTs || !endTs) {
      return res.status(400).json({ 
        error: 'venueId, campaignId, startTs, and endTs are required' 
      });
    }

    const engine = new DoohAttributionEngine(db);

    // Run attribution analysis
    console.log(`🎯 Running PEBLE™ attribution for campaign ${campaignId}...`);
    const result = await engine.run(venueId, campaignId, startTs, endTs);
    console.log(`✅ Attribution complete: ${result.attributionEvents} events, ${result.controlMatches} controls`);

    // Aggregate KPIs
    console.log(`📊 Aggregating campaign KPIs...`);
    const kpis = engine.aggregateKPIs(venueId, campaignId, startTs, endTs, bucketMinutes);
    console.log(`✅ Aggregated ${kpis.length} KPI buckets`);

    // Get summary
    const summary = engine.getSummaryKPIs(venueId, campaignId, startTs, endTs);

    res.json({
      success: true,
      ...result,
      kpiBuckets: kpis.length,
      summary,
    });
  } catch (err) {
    console.error('❌ Failed to run DOOH attribution:', err.message);
    res.status(500).json({ error: 'Failed to run attribution', message: err.message });
  }
});

// ============================================
// KPIS ENDPOINTS
// ============================================

/**
 * GET /api/dooh-attribution/kpis - Get KPI buckets for a campaign
 */
router.get('/kpis', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, campaignId, startTs, endTs, bucketMinutes } = req.query;

    if (!campaignId || !startTs || !endTs) {
      return res.status(400).json({ error: 'campaignId, startTs, and endTs are required' });
    }

    let query = `
      SELECT * FROM dooh_campaign_kpis
      WHERE campaign_id = ? AND bucket_start_ts >= ? AND bucket_start_ts <= ?
    `;
    const params = [campaignId, parseInt(startTs), parseInt(endTs)];

    if (bucketMinutes) {
      query += ' AND bucket_minutes = ?';
      params.push(parseInt(bucketMinutes));
    }

    query += ' ORDER BY bucket_start_ts ASC';

    const rows = db.prepare(query).all(...params);

    const buckets = rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      campaignId: row.campaign_id,
      bucketStartTs: row.bucket_start_ts,
      bucketMinutes: row.bucket_minutes,
      exposedCount: row.exposed_count,
      controlsCount: row.controls_count,
      pExposed: row.p_exposed,
      pControl: row.p_control,
      liftAbs: row.lift_abs,
      liftRel: row.lift_rel,
      medianTtaExposed: row.median_tta_exposed,
      medianTtaControl: row.median_tta_control,
      ttaAccel: row.tta_accel,
      meanEngagementDwellExposed: row.mean_engagement_dwell_exposed,
      meanEngagementDwellControl: row.mean_engagement_dwell_control,
      engagementLiftS: row.engagement_lift_s,
      meanAqsExposed: row.mean_aqs_exposed,
      meanDciExposed: row.mean_dci_exposed,
      meanDciControl: row.mean_dci_control,
      confidenceMean: row.confidence_mean,
      cesScore: row.ces_score,
      aarScore: row.aar_score,
      createdAt: row.created_at,
    }));

    // Calculate summary
    const engine = new DoohAttributionEngine(db);
    const summary = engine.getSummaryKPIs(
      venueId || buckets[0]?.venueId,
      campaignId,
      parseInt(startTs),
      parseInt(endTs)
    );

    res.json({ buckets, count: buckets.length, summary });
  } catch (err) {
    console.error('❌ Failed to fetch DOOH attribution KPIs:', err.message);
    res.status(500).json({ error: 'Failed to fetch KPIs', message: err.message });
  }
});

/**
 * GET /api/dooh-attribution/kpis/latest - Get the most recent computed KPIs for a campaign
 * This returns cached results from the last analysis run
 */
router.get('/kpis/latest', (req, res) => {
  try {
    const db = req.app.get('db');
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId is required' });
    }

    // Get the most recent KPI bucket for this campaign
    const latestBucket = db.prepare(`
      SELECT * FROM dooh_campaign_kpis
      WHERE campaign_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(campaignId);

    if (!latestBucket) {
      return res.json({ 
        hasData: false, 
        message: 'No analysis has been run yet. Click "Run Analysis" to compute KPIs.' 
      });
    }

    // Get time range of the last analysis
    const timeRange = db.prepare(`
      SELECT MIN(bucket_start_ts) as startTs, MAX(bucket_start_ts) as endTs, COUNT(*) as buckets
      FROM dooh_campaign_kpis
      WHERE campaign_id = ? AND created_at = ?
    `).get(campaignId, latestBucket.created_at);

    // Get attribution events summary
    const eventsSummary = db.prepare(`
      SELECT 
        COUNT(*) as totalEvents,
        SUM(converted) as conversions,
        AVG(aqs) as avgAqs,
        AVG(confidence) as avgConfidence,
        AVG(dci_value) as avgDci,
        MIN(exposure_start_ts) as firstEvent,
        MAX(exposure_end_ts) as lastEvent
      FROM dooh_attribution_events
      WHERE campaign_id = ?
    `).get(campaignId);

    // Get control matches count
    const controlsCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM dooh_control_matches cm
      JOIN dooh_attribution_events ae ON cm.attribution_event_id = ae.id
      WHERE ae.campaign_id = ?
    `).get(campaignId);

    // Calculate summary KPIs from all attribution events
    const engine = new DoohAttributionEngine(db);
    const summary = engine.getSummaryKPIs(
      latestBucket.venue_id,
      campaignId,
      timeRange.startTs,
      timeRange.endTs + (latestBucket.bucket_minutes * 60 * 1000)
    );

    res.json({
      hasData: true,
      lastAnalyzedAt: latestBucket.created_at,
      timeRange: {
        startTs: timeRange.startTs,
        endTs: timeRange.endTs + (latestBucket.bucket_minutes * 60 * 1000),
        buckets: timeRange.buckets,
      },
      stats: {
        totalExposures: eventsSummary.totalEvents || 0,
        conversions: eventsSummary.conversions || 0,
        conversionRate: eventsSummary.totalEvents > 0 
          ? ((eventsSummary.conversions / eventsSummary.totalEvents) * 100).toFixed(1)
          : 0,
        controlMatches: controlsCount.count || 0,
        avgAqs: eventsSummary.avgAqs || 0,
        avgConfidence: eventsSummary.avgConfidence || 0,
      },
      summary,
    });
  } catch (err) {
    console.error('❌ Failed to fetch latest DOOH attribution KPIs:', err.message);
    res.status(500).json({ error: 'Failed to fetch latest KPIs', message: err.message });
  }
});

/**
 * GET /api/dooh-attribution/kpis/summary - Get summary KPIs only
 */
router.get('/kpis/summary', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, campaignId, startTs, endTs } = req.query;

    if (!venueId || !campaignId || !startTs || !endTs) {
      return res.status(400).json({ 
        error: 'venueId, campaignId, startTs, and endTs are required' 
      });
    }

    const engine = new DoohAttributionEngine(db);
    const summary = engine.getSummaryKPIs(venueId, campaignId, parseInt(startTs), parseInt(endTs));

    res.json(summary);
  } catch (err) {
    console.error('❌ Failed to fetch DOOH attribution summary:', err.message);
    res.status(500).json({ error: 'Failed to fetch summary', message: err.message });
  }
});

// ============================================
// DEBUG ENDPOINTS
// ============================================

/**
 * GET /api/dooh-attribution/debug/events - Get attribution events for debugging
 */
router.get('/debug/events', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, campaignId, startTs, endTs, includeControls = 'false', limit = 100 } = req.query;

    if (!campaignId || !startTs || !endTs) {
      return res.status(400).json({ error: 'campaignId, startTs, and endTs are required' });
    }

    const rows = db.prepare(`
      SELECT * FROM dooh_attribution_events
      WHERE campaign_id = ? AND exposure_end_ts >= ? AND exposure_end_ts <= ?
      ORDER BY exposure_end_ts DESC
      LIMIT ?
    `).all(campaignId, parseInt(startTs), parseInt(endTs), parseInt(limit));

    const events = rows.map(row => {
      const event = {
        id: row.id,
        venueId: row.venue_id,
        campaignId: row.campaign_id,
        screenId: row.screen_id,
        exposureEventId: row.exposure_event_id,
        trackKey: row.track_key,
        exposureStartTs: row.exposure_start_ts,
        exposureEndTs: row.exposure_end_ts,
        aqs: row.aqs,
        tier: row.tier,
        context: row.context_json ? JSON.parse(row.context_json) : null,
        outcome: row.outcome_json ? JSON.parse(row.outcome_json) : null,
        converted: row.converted === 1,
        ttaS: row.tta_s,
        dciValue: row.dci_value,
        confidence: row.confidence,
        createdAt: row.created_at,
      };

      if (includeControls === 'true') {
        const controls = db.prepare(`
          SELECT * FROM dooh_control_matches WHERE attribution_event_id = ?
        `).all(row.id);

        event.controls = controls.map(ctrl => ({
          id: ctrl.id,
          trackKey: ctrl.control_track_key,
          pseudoExposureTs: ctrl.pseudo_exposure_ts,
          matchDistance: ctrl.match_distance,
          outcome: ctrl.control_outcome_json ? JSON.parse(ctrl.control_outcome_json) : null,
          converted: ctrl.control_converted === 1,
          ttaS: ctrl.control_tta_s,
          dciValue: ctrl.control_dci_value,
        }));
      }

      return event;
    });

    res.json({ events, count: events.length });
  } catch (err) {
    console.error('❌ Failed to fetch DOOH attribution events:', err.message);
    res.status(500).json({ error: 'Failed to fetch events', message: err.message });
  }
});

// ============================================
// TARGET OPTIONS ENDPOINT
// ============================================

/**
 * GET /api/dooh-attribution/target-options - Get available target options for campaign builder
 */
router.get('/target-options', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'venueId query parameter is required' });
    }

    const adapter = new ShelfAnalyticsAdapter(db);
    const options = adapter.getTargetOptions(venueId);

    res.json(options);
  } catch (err) {
    console.error('❌ Failed to fetch target options:', err.message);
    res.status(500).json({ error: 'Failed to fetch target options', message: err.message });
  }
});

/**
 * GET /api/dooh-attribution/params - Get default campaign parameters
 */
router.get('/params', (req, res) => {
  res.json({ defaultParams: DEFAULT_CAMPAIGN_PARAMS });
});

export default router;
