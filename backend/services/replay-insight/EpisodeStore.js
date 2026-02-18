/**
 * EpisodeStore
 * 
 * Own lightweight SQLite database for Replay Insight episodes.
 * Completely isolated from the main Hyperspace DB — read-only access to main DB,
 * writes only to its own replay_insight.db.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../../database/replay_insight.db');

export class EpisodeStore {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.initTables();
  }

  initTables() {
    this.db.exec(`
      -- Detected behavior episodes
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        venue_id TEXT NOT NULL,
        episode_type TEXT NOT NULL,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        entities_json TEXT,
        features_json TEXT,
        kpi_deltas_json TEXT,
        confidence REAL NOT NULL DEFAULT 0,
        score REAL NOT NULL DEFAULT 0,
        title TEXT,
        business_summary TEXT,
        recommended_actions_json TEXT,
        replay_window_json TEXT,
        representative_tracks_json TEXT,
        detection_run_ts INTEGER NOT NULL,
        period TEXT DEFAULT 'day',
        is_archived INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Baseline statistics for thresholding
      CREATE TABLE IF NOT EXISTS baselines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venue_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_id TEXT,
        metric TEXT NOT NULL,
        hour_of_day INTEGER,
        day_of_week INTEGER,
        rolling_median REAL,
        rolling_iqr REAL,
        rolling_mean REAL,
        rolling_std REAL,
        sample_count INTEGER DEFAULT 0,
        last_updated INTEGER NOT NULL,
        UNIQUE(venue_id, scope, scope_id, metric, hour_of_day, day_of_week)
      );

      -- Story recipes (demo playlists)
      CREATE TABLE IF NOT EXISTS story_recipes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        persona TEXT NOT NULL,
        description TEXT,
        steps_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_episodes_venue_type ON episodes(venue_id, episode_type);
      CREATE INDEX IF NOT EXISTS idx_episodes_venue_time ON episodes(venue_id, start_ts);
      CREATE INDEX IF NOT EXISTS idx_episodes_venue_period ON episodes(venue_id, period, detection_run_ts);
      CREATE INDEX IF NOT EXISTS idx_episodes_score ON episodes(venue_id, score DESC);
      CREATE INDEX IF NOT EXISTS idx_baselines_lookup ON baselines(venue_id, scope, scope_id, metric);
    `);

    console.log('[ReplayInsight] Episode store initialized');
  }

  // ─── Episode CRUD ───

  insertEpisode(episode) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO episodes (
        id, venue_id, episode_type, start_ts, end_ts, scope,
        entities_json, features_json, kpi_deltas_json,
        confidence, score, title, business_summary,
        recommended_actions_json, replay_window_json,
        representative_tracks_json, detection_run_ts, period
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      episode.id,
      episode.venue_id,
      episode.episode_type,
      episode.start_ts,
      episode.end_ts,
      episode.scope || 'global',
      JSON.stringify(episode.entities || {}),
      JSON.stringify(episode.features || {}),
      JSON.stringify(episode.kpi_deltas || {}),
      episode.confidence || 0,
      episode.score || 0,
      episode.title || null,
      episode.business_summary || null,
      JSON.stringify(episode.recommended_actions || []),
      JSON.stringify(episode.replay_window || {}),
      JSON.stringify(episode.representative_tracks || []),
      episode.detection_run_ts || Date.now(),
      episode.period || 'day'
    );
  }

  insertEpisodes(episodes) {
    const insertMany = this.db.transaction((eps) => {
      for (const ep of eps) {
        this.insertEpisode(ep);
      }
    });
    insertMany(episodes);
  }

  getEpisode(episodeId) {
    const row = this.db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
    return row ? this._deserializeEpisode(row) : null;
  }

  getEpisodes(venueId, { period, startTs, endTs, episodeType, limit = 20, minScore = 0 } = {}) {
    let sql = 'SELECT * FROM episodes WHERE venue_id = ? AND is_archived = 0';
    const params = [venueId];

    if (period) {
      sql += ' AND period = ?';
      params.push(period);
    }
    if (startTs) {
      sql += ' AND end_ts >= ?';
      params.push(startTs);
    }
    if (endTs) {
      sql += ' AND start_ts <= ?';
      params.push(endTs);
    }
    if (episodeType) {
      sql += ' AND episode_type = ?';
      params.push(episodeType);
    }
    if (minScore > 0) {
      sql += ' AND score >= ?';
      params.push(minScore);
    }

    sql += ' ORDER BY score DESC, start_ts DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => this._deserializeEpisode(r));
  }

  getTimelineMarkers(venueId, startTs, endTs) {
    const rows = this.db.prepare(`
      SELECT id, episode_type, start_ts, end_ts, scope, title, confidence, score
      FROM episodes
      WHERE venue_id = ? AND end_ts >= ? AND start_ts <= ? AND is_archived = 0
      ORDER BY start_ts ASC
    `).all(venueId, startTs, endTs);

    return rows.map(r => ({
      id: r.id,
      episode_type: r.episode_type,
      start_ts: r.start_ts,
      end_ts: r.end_ts,
      scope: r.scope,
      title: r.title,
      confidence: r.confidence,
      score: r.score,
    }));
  }

  getEpisodesByKpi(venueId, kpiId, episodeTypes, { limit = 5 } = {}) {
    if (!episodeTypes || episodeTypes.length === 0) return [];

    const placeholders = episodeTypes.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT * FROM episodes
      WHERE venue_id = ? AND episode_type IN (${placeholders}) AND is_archived = 0
      ORDER BY score DESC, start_ts DESC
      LIMIT ?
    `).all(venueId, ...episodeTypes, limit);

    return rows.map(r => this._deserializeEpisode(r));
  }

  // ─── Baseline CRUD ───

  upsertBaseline(baseline) {
    this.db.prepare(`
      INSERT INTO baselines (
        venue_id, scope, scope_id, metric, hour_of_day, day_of_week,
        rolling_median, rolling_iqr, rolling_mean, rolling_std,
        sample_count, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(venue_id, scope, scope_id, metric, hour_of_day, day_of_week)
      DO UPDATE SET
        rolling_median = excluded.rolling_median,
        rolling_iqr = excluded.rolling_iqr,
        rolling_mean = excluded.rolling_mean,
        rolling_std = excluded.rolling_std,
        sample_count = excluded.sample_count,
        last_updated = excluded.last_updated
    `).run(
      baseline.venue_id,
      baseline.scope,
      baseline.scope_id || null,
      baseline.metric,
      baseline.hour_of_day ?? null,
      baseline.day_of_week ?? null,
      baseline.rolling_median,
      baseline.rolling_iqr,
      baseline.rolling_mean,
      baseline.rolling_std,
      baseline.sample_count,
      baseline.last_updated || Date.now()
    );
  }

  getBaseline(venueId, scope, scopeId, metric, hourOfDay = null, dayOfWeek = null) {
    return this.db.prepare(`
      SELECT * FROM baselines
      WHERE venue_id = ? AND scope = ? AND (scope_id = ? OR (scope_id IS NULL AND ? IS NULL))
        AND metric = ?
        AND (hour_of_day = ? OR (hour_of_day IS NULL AND ? IS NULL))
        AND (day_of_week = ? OR (day_of_week IS NULL AND ? IS NULL))
    `).get(venueId, scope, scopeId, scopeId, metric, hourOfDay, hourOfDay, dayOfWeek, dayOfWeek);
  }

  // ─── Story Recipes ───

  getRecipes() {
    const rows = this.db.prepare('SELECT * FROM story_recipes ORDER BY name').all();
    return rows.map(r => ({ ...r, steps: JSON.parse(r.steps_json) }));
  }

  getRecipe(recipeId) {
    const row = this.db.prepare('SELECT * FROM story_recipes WHERE id = ?').get(recipeId);
    return row ? { ...row, steps: JSON.parse(row.steps_json) } : null;
  }

  upsertRecipe(recipe) {
    this.db.prepare(`
      INSERT OR REPLACE INTO story_recipes (id, name, persona, description, steps_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(recipe.id, recipe.name, recipe.persona, recipe.description || null, JSON.stringify(recipe.steps));
  }

  // ─── Cleanup ───

  archiveOldEpisodes(olderThanMs = 30 * 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db.prepare(`
      UPDATE episodes SET is_archived = 1 WHERE detection_run_ts < ? AND is_archived = 0
    `).run(cutoff);
    return result.changes;
  }

  // ─── Internal ───

  _deserializeEpisode(row) {
    return {
      id: row.id,
      venue_id: row.venue_id,
      episode_type: row.episode_type,
      start_ts: row.start_ts,
      end_ts: row.end_ts,
      scope: row.scope,
      entities: JSON.parse(row.entities_json || '{}'),
      features: JSON.parse(row.features_json || '{}'),
      kpi_deltas: JSON.parse(row.kpi_deltas_json || '{}'),
      confidence: row.confidence,
      score: row.score,
      title: row.title,
      business_summary: row.business_summary,
      recommended_actions: JSON.parse(row.recommended_actions_json || '[]'),
      replay_window: JSON.parse(row.replay_window_json || '{}'),
      representative_tracks: JSON.parse(row.representative_tracks_json || '[]'),
      detection_run_ts: row.detection_run_ts,
      period: row.period,
      created_at: row.created_at,
    };
  }

  close() {
    this.db.close();
  }
}

export default EpisodeStore;
