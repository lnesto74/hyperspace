export type KpiLabel = 'MEASURED' | 'ESTIMATED';
export type KpiStatus = 'ok' | 'unreliable';

export interface DailyKpiRow {
  kpi_id: string;
  slot: string;
  value: number | null;
  unit: string | null;
  label: KpiLabel;
  method: string | null;
  status: KpiStatus;
  status_reason: string | null;
  payload?: unknown;
}

export interface DailyKpiCheck {
  check_id: string;
  passed: boolean;
  detail: string | null;
}

export interface DailyKpiPayload {
  venue_id: string;
  day: string;
  timezone?: string;
  store_hours_local?: [string, string];
  headline?: {
    entrances?: number | null;
    visit_min?: number | null;
    people_mean?: number | null;
    people_max?: number | null;
    queue_wait_min_per_entrance?: number | null;
    service_min_per_entrance?: number | null;
  };
  kpis: DailyKpiRow[];
  checks: DailyKpiCheck[];
  people_mean_by_slot?: Record<string, number>;
  source?: string;
}

export interface DailyKpiRangeDay {
  day: string;
  venue_id: string;
  [kpiId: string]: unknown;
}
