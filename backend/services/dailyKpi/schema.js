/** SQLite tables for the daily raw-LiDAR KPI job. */

export const DAILY_KPI_DDL = `
CREATE TABLE IF NOT EXISTS daily_kpi (
  venue_id TEXT NOT NULL,
  day TEXT NOT NULL,
  kpi_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  value REAL,
  unit TEXT,
  label TEXT NOT NULL CHECK(label IN ('MEASURED','ESTIMATED')),
  method TEXT,
  status TEXT NOT NULL CHECK(status IN ('ok','unreliable')),
  status_reason TEXT,
  payload_json TEXT,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (venue_id, day, kpi_id, slot)
);

CREATE TABLE IF NOT EXISTS daily_kpi_checks (
  venue_id TEXT NOT NULL,
  day TEXT NOT NULL,
  check_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  detail TEXT,
  PRIMARY KEY (venue_id, day, check_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_kpi_venue_day ON daily_kpi(venue_id, day);
CREATE INDEX IF NOT EXISTS idx_daily_kpi_checks_venue_day ON daily_kpi_checks(venue_id, day);
`;

export function ensureDailyKpiTables(db) {
  db.exec(DAILY_KPI_DDL);
  return db;
}
