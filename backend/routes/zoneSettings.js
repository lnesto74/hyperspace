import { Router } from 'express';

export default function createZoneSettingsRoutes(db, trajectoryStorage) {
  const router = Router();

  /**
   * Get settings for a specific zone
   */
  router.get('/roi/:roiId/settings', (req, res) => {
    try {
      const { roiId } = req.params;
      
      let settings = db.prepare(`
        SELECT * FROM zone_settings WHERE roi_id = ?
      `).get(roiId);
      
      // Return defaults if no settings exist
      if (!settings) {
        settings = {
          roi_id: roiId,
          dwell_threshold_sec: 60,
          engagement_threshold_sec: 120,
          max_occupancy: 50,
          alerts_enabled: 0,
          visit_end_grace_sec: 3,
          min_visit_duration_sec: 1,
          queue_warning_threshold_sec: 60,
          queue_critical_threshold_sec: 120,
          queue_ok_color: '#22c55e',
          queue_warning_color: '#f59e0b',
          queue_critical_color: '#ef4444',
        };
      }
      
      res.json({
        roiId,
        dwellThresholdSec: settings.dwell_threshold_sec,
        engagementThresholdSec: settings.engagement_threshold_sec,
        maxOccupancy: settings.max_occupancy,
        alertsEnabled: settings.alerts_enabled === 1,
        visitEndGraceSec: settings.visit_end_grace_sec,
        minVisitDurationSec: settings.min_visit_duration_sec,
        // Queue-specific settings
        queueWarningThresholdSec: settings.queue_warning_threshold_sec || 60,
        queueCriticalThresholdSec: settings.queue_critical_threshold_sec || 120,
        queueOkColor: settings.queue_ok_color || '#22c55e',
        queueWarningColor: settings.queue_warning_color || '#f59e0b',
        queueCriticalColor: settings.queue_critical_color || '#ef4444',
      });
    } catch (err) {
      console.error('Failed to get zone settings:', err);
      res.status(500).json({ error: 'Failed to get zone settings' });
    }
  });

  /**
   * Update settings for a specific zone
   */
  router.put('/roi/:roiId/settings', (req, res) => {
    try {
      const { roiId } = req.params;
      const {
        dwellThresholdSec,
        engagementThresholdSec,
        maxOccupancy,
        alertsEnabled,
        visitEndGraceSec,
        minVisitDurationSec,
        // Queue-specific settings
        queueWarningThresholdSec,
        queueCriticalThresholdSec,
        queueOkColor,
        queueWarningColor,
        queueCriticalColor,
      } = req.body;
      
      // Get venue_id from ROI
      const roi = db.prepare(`SELECT venue_id FROM regions_of_interest WHERE id = ?`).get(roiId);
      if (!roi) {
        return res.status(404).json({ error: 'ROI not found' });
      }
      
      // Upsert settings (including queue-specific fields)
      db.prepare(`
        INSERT INTO zone_settings (roi_id, venue_id, dwell_threshold_sec, engagement_threshold_sec, max_occupancy, alerts_enabled, visit_end_grace_sec, min_visit_duration_sec, queue_warning_threshold_sec, queue_critical_threshold_sec, queue_ok_color, queue_warning_color, queue_critical_color, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(roi_id) DO UPDATE SET
          dwell_threshold_sec = excluded.dwell_threshold_sec,
          engagement_threshold_sec = excluded.engagement_threshold_sec,
          max_occupancy = excluded.max_occupancy,
          alerts_enabled = excluded.alerts_enabled,
          visit_end_grace_sec = excluded.visit_end_grace_sec,
          min_visit_duration_sec = excluded.min_visit_duration_sec,
          queue_warning_threshold_sec = excluded.queue_warning_threshold_sec,
          queue_critical_threshold_sec = excluded.queue_critical_threshold_sec,
          queue_ok_color = excluded.queue_ok_color,
          queue_warning_color = excluded.queue_warning_color,
          queue_critical_color = excluded.queue_critical_color,
          updated_at = datetime('now')
      `).run(
        roiId,
        roi.venue_id,
        dwellThresholdSec ?? 60,
        engagementThresholdSec ?? 120,
        maxOccupancy ?? 50,
        alertsEnabled ? 1 : 0,
        visitEndGraceSec ?? 3,
        minVisitDurationSec ?? 1,
        queueWarningThresholdSec ?? 60,
        queueCriticalThresholdSec ?? 120,
        queueOkColor ?? '#22c55e',
        queueWarningColor ?? '#f59e0b',
        queueCriticalColor ?? '#ef4444'
      );
      
      console.log(`📊 Zone settings updated for ROI ${roiId}`);
      
      res.json({ success: true, roiId });
    } catch (err) {
      console.error('Failed to update zone settings:', err);
      res.status(500).json({ error: 'Failed to update zone settings' });
    }
  });

  /**
   * Get all alert rules for a zone
   */
  router.get('/roi/:roiId/rules', (req, res) => {
    try {
      const { roiId } = req.params;
      
      const rules = db.prepare(`
        SELECT * FROM zone_alert_rules WHERE roi_id = ? ORDER BY created_at DESC
      `).all(roiId);
      
      res.json(rules.map(r => ({
        id: r.id,
        roiId: r.roi_id,
        ruleName: r.rule_name,
        ruleType: r.rule_type,
        metric: r.metric,
        operator: r.operator,
        thresholdValue: r.threshold_value,
        severity: r.severity,
        enabled: r.enabled === 1,
        messageTemplate: r.message_template,
        createdAt: r.created_at,
      })));
    } catch (err) {
      console.error('Failed to get zone rules:', err);
      res.status(500).json({ error: 'Failed to get zone rules' });
    }
  });

  /**
   * Create a new alert rule for a zone
   */
  router.post('/roi/:roiId/rules', (req, res) => {
    try {
      const { roiId } = req.params;
      const {
        ruleName,
        ruleType,
        metric,
        operator,
        thresholdValue,
        severity,
        enabled,
        messageTemplate,
      } = req.body;
      
      // Get venue_id from ROI
      const roi = db.prepare(`SELECT venue_id FROM regions_of_interest WHERE id = ?`).get(roiId);
      if (!roi) {
        return res.status(404).json({ error: 'ROI not found' });
      }
      
      const result = db.prepare(`
        INSERT INTO zone_alert_rules (roi_id, venue_id, rule_name, rule_type, metric, operator, threshold_value, severity, enabled, message_template)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        roiId,
        roi.venue_id,
        ruleName,
        ruleType || 'threshold',
        metric,
        operator || 'gte',
        thresholdValue,
        severity || 'warning',
        enabled !== false ? 1 : 0,
        messageTemplate || null
      );
      
      console.log(`📊 Alert rule created for ROI ${roiId}: ${ruleName}`);
      
      res.status(201).json({
        id: result.lastInsertRowid,
        roiId,
        ruleName,
        ruleType: ruleType || 'threshold',
        metric,
        operator: operator || 'gte',
        thresholdValue,
        severity: severity || 'warning',
        enabled: enabled !== false,
        messageTemplate,
      });
    } catch (err) {
      console.error('Failed to create zone rule:', err);
      res.status(500).json({ error: 'Failed to create zone rule' });
    }
  });

  /**
   * Update an alert rule
   */
  router.put('/rules/:ruleId', (req, res) => {
    try {
      const { ruleId } = req.params;
      const {
        ruleName,
        ruleType,
        metric,
        operator,
        thresholdValue,
        severity,
        enabled,
        messageTemplate,
      } = req.body;
      
      db.prepare(`
        UPDATE zone_alert_rules SET
          rule_name = COALESCE(?, rule_name),
          rule_type = COALESCE(?, rule_type),
          metric = COALESCE(?, metric),
          operator = COALESCE(?, operator),
          threshold_value = COALESCE(?, threshold_value),
          severity = COALESCE(?, severity),
          enabled = COALESCE(?, enabled),
          message_template = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        ruleName,
        ruleType,
        metric,
        operator,
        thresholdValue,
        severity,
        enabled !== undefined ? (enabled ? 1 : 0) : null,
        messageTemplate,
        ruleId
      );
      
      res.json({ success: true, ruleId });
    } catch (err) {
      console.error('Failed to update zone rule:', err);
      res.status(500).json({ error: 'Failed to update zone rule' });
    }
  });

  /**
   * Delete an alert rule
   */
  router.delete('/rules/:ruleId', (req, res) => {
    try {
      const { ruleId } = req.params;
      
      db.prepare(`DELETE FROM zone_alert_rules WHERE id = ?`).run(ruleId);
      
      res.json({ success: true });
    } catch (err) {
      console.error('Failed to delete zone rule:', err);
      res.status(500).json({ error: 'Failed to delete zone rule' });
    }
  });

  /**
   * Get activity ledger entries
   */
  router.get('/venues/:venueId/ledger', (req, res) => {
    try {
      const { venueId } = req.params;
      const { limit = 100, offset = 0, roiId, severity, acknowledged } = req.query;
      
      let query = `
        SELECT 
          l.*,
          r.name as roi_name,
          r.color as roi_color
        FROM activity_ledger l
        LEFT JOIN regions_of_interest r ON l.roi_id = r.id
        WHERE l.venue_id = ?
      `;
      const params = [venueId];
      
      if (roiId) {
        query += ` AND l.roi_id = ?`;
        params.push(roiId);
      }
      
      if (severity) {
        query += ` AND l.severity = ?`;
        params.push(severity);
      }
      
      if (acknowledged !== undefined) {
        query += ` AND l.acknowledged = ?`;
        params.push(acknowledged === 'true' ? 1 : 0);
      }
      
      query += ` ORDER BY l.timestamp DESC LIMIT ? OFFSET ?`;
      params.push(parseInt(limit), parseInt(offset));
      
      const entries = db.prepare(query).all(...params);
      
      // Get total count
      let countQuery = `SELECT COUNT(*) as total FROM activity_ledger WHERE venue_id = ?`;
      const countParams = [venueId];
      if (roiId) {
        countQuery += ` AND roi_id = ?`;
        countParams.push(roiId);
      }
      const { total } = db.prepare(countQuery).get(...countParams);
      
      res.json({
        entries: entries.map(e => ({
          id: e.id,
          venueId: e.venue_id,
          roiId: e.roi_id,
          roiName: e.roi_name,
          roiColor: e.roi_color,
          ruleId: e.rule_id,
          eventType: e.event_type,
          severity: e.severity,
          title: e.title,
          message: e.message,
          metricName: e.metric_name,
          metricValue: e.metric_value,
          thresholdValue: e.threshold_value,
          acknowledged: e.acknowledged === 1,
          acknowledgedAt: e.acknowledged_at,
          acknowledgedBy: e.acknowledged_by,
          timestamp: e.timestamp,
          createdAt: e.created_at,
        })),
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
      });
    } catch (err) {
      console.error('Failed to get activity ledger:', err);
      res.status(500).json({ error: 'Failed to get activity ledger' });
    }
  });

  /**
   * Acknowledge a ledger entry
   */
  router.put('/ledger/:entryId/acknowledge', (req, res) => {
    try {
      const { entryId } = req.params;
      const { acknowledgedBy } = req.body;
      
      db.prepare(`
        UPDATE activity_ledger SET
          acknowledged = 1,
          acknowledged_at = datetime('now'),
          acknowledged_by = ?
        WHERE id = ?
      `).run(acknowledgedBy || 'system', entryId);
      
      res.json({ success: true });
    } catch (err) {
      console.error('Failed to acknowledge ledger entry:', err);
      res.status(500).json({ error: 'Failed to acknowledge ledger entry' });
    }
  });

  /**
   * Get unacknowledged count for badge display
   */
  router.get('/venues/:venueId/ledger/unacknowledged-count', (req, res) => {
    try {
      const { venueId } = req.params;
      
      const result = db.prepare(`
        SELECT COUNT(*) as count FROM activity_ledger 
        WHERE venue_id = ? AND acknowledged = 0
      `).get(venueId);
      
      res.json({ count: result.count });
    } catch (err) {
      console.error('Failed to get unacknowledged count:', err);
      res.status(500).json({ error: 'Failed to get unacknowledged count' });
    }
  });

  return router;
}
