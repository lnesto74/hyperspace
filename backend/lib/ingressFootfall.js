/**
 * Ingress footfall denominator.
 *
 * Entrance / traffic ROIs are counted via live perimeter-edge crossing (~10Hz MQTT trail),
 * written to ingress_perimeter_crossings and mirrored as zero-duration zone_visits.
 * COUNT(*) = one row per crossing event (no dwell, no dedup).
 */
export const INGRESS_VISIT_COUNT_SQL = 'COUNT(*)';
