"""Tracklet aggregation SQL shared by 40_tracklets.py (real data) and 95_validate.py (artificially fragmented data).
`src` must yield: id, ts, wx, wz, h, bh, wvx, wvz, ci, cj  (venue metres, roi raster cell)."""


def tracklet_sql(src: str, split_ms: int, move_mps: float, roi_cells: str = "jl.roi_cells") -> str:
    return f"""
WITH r AS ({src}),
w AS (
  SELECT r.*, c.roi_id, c.roi_group,
         ts - lag(ts) OVER win AS dt,
         sqrt((wx - lag(wx) OVER win)^2 + (wz - lag(wz) OVER win)^2) AS step,
         lead(wx, 10) OVER win AS wx_l10, lead(wz, 10) OVER win AS wz_l10,
         lag(wx, 10) OVER win AS wx_g10, lag(wz, 10) OVER win AS wz_g10
  FROM r LEFT JOIN {roi_cells} c USING (ci, cj)
  WINDOW win AS (PARTITION BY id ORDER BY ts)),
s AS (
  SELECT *, sum(CASE WHEN dt IS NULL OR dt > {split_ms} THEN 1 ELSE 0 END) OVER (PARTITION BY id ORDER BY ts ROWS UNBOUNDED PRECEDING) AS seg,
         CASE WHEN dt IS NOT NULL AND dt <= {split_ms} AND dt > 0 THEN step / (dt/1000.0) END AS spd
  FROM w)
SELECT id, seg, count(*) n, min(ts) t0, max(ts) t1, (max(ts)-min(ts))/1000.0 dur_s,
       arg_min(wx, ts) x0, arg_min(wz, ts) z0, arg_max(wx, ts) x1, arg_max(wz, ts) z1,
       sqrt((arg_max(wx, ts)-arg_min(wx, ts))^2 + (arg_max(wz, ts)-arg_min(wz, ts))^2) disp_m,
       sum(CASE WHEN dt <= {split_ms} THEN step END) path_m,
       greatest(max(wx)-min(wx), max(wz)-min(wz)) extent_m,
       sqrt(var_pop(wx) + var_pop(wz)) spatial_sd_m,
       quantile_cont(spd, 0.5) med_spd, quantile_cont(spd, 0.95) p95_spd, max(spd) max_spd,
       avg(CASE WHEN spd > {move_mps} THEN 1.0 ELSE 0.0 END) moving_frac,
       quantile_cont(dt, 0.5) FILTER (WHERE dt <= {split_ms}) med_dt, max(dt) FILTER (WHERE dt <= {split_ms}) max_dt_in,
       count(*) FILTER (WHERE dt > 200 AND dt <= {split_ms}) n_microgaps,
       degrees(atan2(arg_min(wz_l10, ts) - arg_min(wz, ts), arg_min(wx_l10, ts) - arg_min(wx, ts))) head0_deg,
       degrees(atan2(arg_max(wz, ts) - arg_max(wz_g10, ts), arg_max(wx, ts) - arg_max(wx_g10, ts))) head1_deg,
       arg_min(wvx, ts) vx0, arg_min(wvz, ts) vz0, arg_max(wvx, ts) vx1, arg_max(wvz, ts) vz1,
       avg(h) mean_h, avg(bh) mean_bh, stddev_pop(bh) sd_bh,
       arg_min(roi_id, ts) roi0, arg_max(roi_id, ts) roi1, arg_min(roi_group, ts) grp0, arg_max(roi_group, ts) grp1,
       count(DISTINCT roi_id) n_rois,
       count(*) FILTER (WHERE roi_group = 'ENTRANCE') n_entr, count(*) FILTER (WHERE roi_group = 'CHECKOUT_QUEUE') n_queue,
       count(*) FILTER (WHERE roi_group = 'CHECKOUT_SERVICE') n_service, count(*) FILTER (WHERE roi_group = 'SHELF_ENGAGEMENT') n_shelf,
       list(DISTINCT roi_id) FILTER (WHERE roi_id IS NOT NULL) rois_visited
FROM s GROUP BY id, seg"""
