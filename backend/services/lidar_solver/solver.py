#!/usr/bin/env python3
"""
LiDAR Placement Solver using OR-Tools CP-SAT
Implements k-coverage optimization for LiDAR sensor placement.
"""

import json
import math
import random
from typing import List, Dict, Tuple, Optional, Set
from dataclasses import dataclass, field
from ortools.sat.python import cp_model
import numpy as np
from shapely.geometry import Point, Polygon, LineString
from shapely.ops import unary_union


@dataclass
class LidarModel:
    hfov_deg: float = 360.0
    vfov_deg: float = 30.0
    range_m: float = 10.0
    dome_mode: bool = True


@dataclass
class PlannerSettings:
    mount_y_m: float = 3.0
    sample_spacing_m: float = 0.75
    candidate_spacing_m: float = 2.0
    keepout_distance_m: float = 0.5
    overlap_mode: str = "everywhere"  # "everywhere" | "critical_only" | "percent_target"
    k_required: int = 2
    overlap_target_pct: float = 0.8
    los_enabled: bool = False
    los_cell_m: float = 0.25
    yaw_step_deg: float = 30.0
    max_sensors: int = 50
    solver_time_limit_s: float = 10.0
    seed: int = 42


@dataclass
class Candidate:
    idx: int
    x: float
    z: float
    yaw_deg: float
    covered_points: List[int] = field(default_factory=list)


@dataclass
class SamplePoint:
    idx: int
    x: float
    z: float
    is_critical: bool = False


@dataclass
class SolverResult:
    success: bool
    selected_positions: List[Dict]
    num_sensors: int
    coverage_pct: float
    k_coverage_pct: float
    overlap_mode: str
    k_required: int
    warnings: List[str] = field(default_factory=list)
    seed: int = 42
    solver_status: str = ""
    iterations: int = 1


def compute_effective_radius(model: LidarModel, mount_height: float) -> float:
    """
    Compute effective floor coverage radius from VFOV and mount height.
    
    For dome-mode (360° HFOV) LiDARs that scan horizontally:
    - The effective radius is typically the horizontal range, not VFOV-limited
    - VFOV only affects the vertical slice, not horizontal floor coverage
    
    For downward-facing LiDARs (non-dome):
    - r_v = h * tan(VFOV/2)
    - r_eff = min(range_m, r_v)
    """
    if model.dome_mode or model.hfov_deg >= 360:
        # Dome LiDARs scan horizontally - use range directly
        # Apply a reasonable floor coverage factor (sensor doesn't see directly below)
        # Typical tracking LiDAR covers from ~1m to range_m on floor
        return model.range_m * 0.9  # 90% of max range for floor coverage
    else:
        # Downward-facing or partial HFOV - VFOV limits floor coverage
        alpha_rad = math.radians(model.vfov_deg / 2)
        r_vfov = mount_height * math.tan(alpha_rad)
        return min(model.range_m, r_vfov)


def point_in_polygon(px: float, pz: float, polygon: List[Dict]) -> bool:
    """Ray casting point-in-polygon test."""
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, zi = polygon[i]['x'], polygon[i]['z']
        xj, zj = polygon[j]['x'], polygon[j]['z']
        if ((zi > pz) != (zj > pz)) and (px < (xj - xi) * (pz - zi) / (zj - zi) + xi):
            inside = not inside
        j = i
    return inside


def sample_points_in_polygon(
    polygon: List[Dict],
    spacing_m: float,
    seed: int,
    obstacles: Optional[List[List[Dict]]] = None
) -> List[SamplePoint]:
    """
    Generate sample points inside polygon using jittered grid.
    Excludes points inside obstacle polygons.
    """
    random.seed(seed)
    np.random.seed(seed)
    
    xs = [v['x'] for v in polygon]
    zs = [v['z'] for v in polygon]
    min_x, max_x = min(xs), max(xs)
    min_z, max_z = min(zs), max(zs)
    
    # Create shapely polygon for faster operations
    poly = Polygon([(v['x'], v['z']) for v in polygon])
    
    # Create obstacle polygons
    obstacle_polys = []
    if obstacles:
        for obs in obstacles:
            if len(obs) >= 3:
                try:
                    obs_poly = Polygon([(v['x'], v['z']) for v in obs])
                    if obs_poly.is_valid:
                        obstacle_polys.append(obs_poly)
                except:
                    pass
    
    # Merge obstacles
    obstacle_union = unary_union(obstacle_polys) if obstacle_polys else None
    
    points = []
    idx = 0
    jitter = spacing_m * 0.25
    
    x = min_x + spacing_m / 2
    while x <= max_x:
        z = min_z + spacing_m / 2
        while z <= max_z:
            # Add jitter for more uniform coverage
            jx = x + random.uniform(-jitter, jitter)
            jz = z + random.uniform(-jitter, jitter)
            
            pt = Point(jx, jz)
            
            # Check if inside main polygon and outside obstacles
            if poly.contains(pt):
                if obstacle_union is None or not obstacle_union.contains(pt):
                    points.append(SamplePoint(idx=idx, x=jx, z=jz))
                    idx += 1
            
            z += spacing_m
        x += spacing_m
    
    return points


def mark_critical_points(
    points: List[SamplePoint],
    critical_polygon: Optional[List[Dict]] = None,
    boundary_band_m: float = 0.0
) -> None:
    """Mark points as critical if inside critical polygon or within boundary band."""
    if critical_polygon and len(critical_polygon) >= 3:
        crit_poly = Polygon([(v['x'], v['z']) for v in critical_polygon])
        for pt in points:
            if crit_poly.contains(Point(pt.x, pt.z)):
                pt.is_critical = True


def generate_candidates(
    polygon: List[Dict],
    spacing_m: float,
    keepout_m: float,
    model: LidarModel,
    seed: int,
    obstacles: Optional[List[List[Dict]]] = None
) -> List[Candidate]:
    """
    Generate candidate sensor positions with yaw angles.
    For 360° HFOV, only yaw=0. For partial HFOV, generate multiple yaw candidates.
    """
    random.seed(seed)
    
    xs = [v['x'] for v in polygon]
    zs = [v['z'] for v in polygon]
    min_x, max_x = min(xs), max(xs)
    min_z, max_z = min(zs), max(zs)
    
    # Create shapely polygon
    poly = Polygon([(v['x'], v['z']) for v in polygon])
    
    # Inflate obstacles by keepout distance
    obstacle_buffers = []
    if obstacles:
        for obs in obstacles:
            if len(obs) >= 3:
                try:
                    obs_poly = Polygon([(v['x'], v['z']) for v in obs])
                    if obs_poly.is_valid:
                        buffered = obs_poly.buffer(keepout_m)
                        obstacle_buffers.append(buffered)
                except:
                    pass
    
    obstacle_union = unary_union(obstacle_buffers) if obstacle_buffers else None
    
    # Determine yaw candidates
    if model.hfov_deg >= 360 or model.dome_mode:
        yaw_angles = [0.0]
    else:
        yaw_step = 30.0  # Default step
        yaw_angles = list(np.arange(0, 360, yaw_step))
    
    candidates = []
    idx = 0
    
    x = min_x + spacing_m / 2
    while x <= max_x:
        z = min_z + spacing_m / 2
        while z <= max_z:
            pt = Point(x, z)
            
            # Check if inside polygon and not in obstacle keepout zone
            if poly.contains(pt):
                valid = True
                if obstacle_union and obstacle_union.contains(pt):
                    valid = False
                
                if valid:
                    for yaw in yaw_angles:
                        candidates.append(Candidate(idx=idx, x=x, z=z, yaw_deg=yaw))
                        idx += 1
            
            z += spacing_m
        x += spacing_m
    
    return candidates


def smallest_angle_diff(a: float, b: float) -> float:
    """Compute smallest angle difference between two angles in degrees."""
    diff = (a - b + 180) % 360 - 180
    return abs(diff)


def check_los_blocked(
    cx: float, cz: float,
    px: float, pz: float,
    obstacle_grid: Optional[np.ndarray],
    grid_bounds: Optional[Dict],
    cell_size: float
) -> bool:
    """Check if line of sight is blocked by obstacles using ray marching."""
    if obstacle_grid is None:
        return False
    
    dx = px - cx
    dz = pz - cz
    dist = math.sqrt(dx * dx + dz * dz)
    if dist < 0.01:
        return False
    
    steps = int(dist / (cell_size * 0.5)) + 1
    for i in range(1, steps):
        t = i / steps
        x = cx + dx * t
        z = cz + dz * t
        
        col = int((x - grid_bounds['min_x']) / cell_size)
        row = int((z - grid_bounds['min_z']) / cell_size)
        
        if 0 <= row < obstacle_grid.shape[0] and 0 <= col < obstacle_grid.shape[1]:
            if obstacle_grid[row, col]:
                return True
    
    return False


def build_obstacle_grid(
    polygon: List[Dict],
    obstacles: List[List[Dict]],
    cell_size: float
) -> Tuple[np.ndarray, Dict]:
    """Build occupancy grid for LOS checking."""
    xs = [v['x'] for v in polygon]
    zs = [v['z'] for v in polygon]
    min_x, max_x = min(xs), max(xs)
    min_z, max_z = min(zs), max(zs)
    
    width = int((max_x - min_x) / cell_size) + 1
    height = int((max_z - min_z) / cell_size) + 1
    
    grid = np.zeros((height, width), dtype=bool)
    bounds = {'min_x': min_x, 'max_x': max_x, 'min_z': min_z, 'max_z': max_z}
    
    # Mark obstacle cells
    for obs in obstacles:
        if len(obs) >= 3:
            obs_poly = Polygon([(v['x'], v['z']) for v in obs])
            if not obs_poly.is_valid:
                continue
            
            for row in range(height):
                for col in range(width):
                    cx = min_x + (col + 0.5) * cell_size
                    cz = min_z + (row + 0.5) * cell_size
                    if obs_poly.contains(Point(cx, cz)):
                        grid[row, col] = True
    
    return grid, bounds


def compute_coverage_sets(
    candidates: List[Candidate],
    points: List[SamplePoint],
    model: LidarModel,
    r_eff: float,
    los_enabled: bool,
    obstacle_grid: Optional[np.ndarray],
    grid_bounds: Optional[Dict],
    los_cell_m: float
) -> None:
    """
    Precompute which points each candidate covers.
    Updates candidate.covered_points in place.
    """
    for c in candidates:
        c.covered_points = []
        for p in points:
            dx = p.x - c.x
            dz = p.z - c.z
            dist = math.sqrt(dx * dx + dz * dz)
            
            # Range constraint
            if dist > r_eff:
                continue
            
            # HFOV constraint
            if model.hfov_deg < 360 and not model.dome_mode:
                angle_to_p = math.degrees(math.atan2(dz, dx))
                if smallest_angle_diff(angle_to_p, c.yaw_deg) > model.hfov_deg / 2:
                    continue
            
            # LOS constraint
            if los_enabled and obstacle_grid is not None:
                if check_los_blocked(c.x, c.z, p.x, p.z, obstacle_grid, grid_bounds, los_cell_m):
                    continue
            
            c.covered_points.append(p.idx)


def solve_k_coverage(
    candidates: List[Candidate],
    points: List[SamplePoint],
    settings: PlannerSettings
) -> Tuple[List[int], str, bool]:
    """
    Solve the k-coverage set cover problem using OR-Tools CP-SAT.
    Returns list of selected candidate indices.
    """
    model = cp_model.CpModel()
    
    # Variables: x_c for each candidate (1 if selected, 0 otherwise)
    x = {}
    for c in candidates:
        x[c.idx] = model.NewBoolVar(f'x_{c.idx}')
    
    # Build point -> covering candidates map
    point_covers: Dict[int, List[int]] = {p.idx: [] for p in points}
    for c in candidates:
        for p_idx in c.covered_points:
            point_covers[p_idx].append(c.idx)
    
    # Constraints based on overlap mode
    critical_indices = {p.idx for p in points if p.is_critical}
    all_indices = {p.idx for p in points}
    
    if settings.overlap_mode == "everywhere":
        # All points need k-coverage
        for p_idx in all_indices:
            covering = point_covers[p_idx]
            if covering:
                model.Add(sum(x[c_idx] for c_idx in covering) >= settings.k_required)
            else:
                # Point cannot be covered - make constraint relaxable
                pass
    
    elif settings.overlap_mode == "critical_only":
        # Critical points need k-coverage, others need 1-coverage
        for p_idx in all_indices:
            covering = point_covers[p_idx]
            if not covering:
                continue
            if p_idx in critical_indices:
                model.Add(sum(x[c_idx] for c_idx in covering) >= settings.k_required)
            else:
                model.Add(sum(x[c_idx] for c_idx in covering) >= 1)
    
    elif settings.overlap_mode == "percent_target":
        # At least overlap_target_pct of points need k-coverage
        # All points need at least 1-coverage
        y = {}  # y_p = 1 if point p is k-covered
        for p in points:
            covering = point_covers[p.idx]
            if not covering:
                continue
            
            # 1-coverage for all
            model.Add(sum(x[c_idx] for c_idx in covering) >= 1)
            
            # k-coverage indicator
            y[p.idx] = model.NewBoolVar(f'y_{p.idx}')
            # y_p => sum >= k_required
            model.Add(sum(x[c_idx] for c_idx in covering) >= settings.k_required).OnlyEnforceIf(y[p.idx])
        
        # At least target% of points must be k-covered
        target_count = int(settings.overlap_target_pct * len(points))
        if y:
            model.Add(sum(y.values()) >= target_count)
    
    # Objective: minimize number of sensors
    model.Minimize(sum(x.values()))
    
    # Solve
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = settings.solver_time_limit_s
    solver.parameters.random_seed = settings.seed
    
    status = solver.Solve(model)
    
    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        selected = [c.idx for c in candidates if solver.Value(x[c.idx]) == 1]
        status_str = "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE"
        return selected, status_str, True
    else:
        return [], solver.StatusName(status), False


def prune_redundant_sensors(
    selected_indices: List[int],
    candidates: List[Candidate],
    points: List[SamplePoint],
    settings: PlannerSettings
) -> List[int]:
    """
    Remove redundant sensors while maintaining coverage constraints.
    """
    candidate_map = {c.idx: c for c in candidates}
    selected = set(selected_indices)
    
    # Try removing each sensor
    for idx in list(selected):
        # Temporarily remove
        test_selected = selected - {idx}
        
        # Check if constraints still satisfied
        coverage_count = {p.idx: 0 for p in points}
        for c_idx in test_selected:
            for p_idx in candidate_map[c_idx].covered_points:
                coverage_count[p_idx] += 1
        
        valid = True
        for p in points:
            if settings.overlap_mode == "everywhere":
                if coverage_count[p.idx] < settings.k_required:
                    valid = False
                    break
            elif settings.overlap_mode == "critical_only":
                req = settings.k_required if p.is_critical else 1
                if coverage_count[p.idx] < req:
                    valid = False
                    break
            else:  # percent_target - just check 1-coverage
                if coverage_count[p.idx] < 1:
                    valid = False
                    break
        
        if valid:
            selected = test_selected
    
    return list(selected)


def refine_yaw_angles(
    selected_indices: List[int],
    candidates: List[Candidate],
    points: List[SamplePoint],
    model: LidarModel,
    r_eff: float
) -> Dict[int, float]:
    """
    For partial HFOV sensors, optimize yaw to maximize coverage.
    Returns map of candidate index to refined yaw.
    """
    if model.hfov_deg >= 360 or model.dome_mode:
        return {}
    
    refined_yaw = {}
    candidate_map = {c.idx: c for c in candidates}
    
    # Group candidates by position
    positions = {}
    for idx in selected_indices:
        c = candidate_map[idx]
        key = (round(c.x, 4), round(c.z, 4))
        if key not in positions:
            positions[key] = []
        positions[key].append(c)
    
    # For each position, find best yaw
    for pos, pos_candidates in positions.items():
        best_yaw = pos_candidates[0].yaw_deg
        best_coverage = len(pos_candidates[0].covered_points)
        
        for c in pos_candidates:
            if len(c.covered_points) > best_coverage:
                best_coverage = len(c.covered_points)
                best_yaw = c.yaw_deg
        
        for c in pos_candidates:
            refined_yaw[c.idx] = best_yaw
    
    return refined_yaw


def compute_coverage_stats(
    selected_indices: List[int],
    candidates: List[Candidate],
    points: List[SamplePoint],
    k_required: int
) -> Tuple[float, float]:
    """Compute coverage and k-coverage percentages."""
    candidate_map = {c.idx: c for c in candidates}
    coverage_count = {p.idx: 0 for p in points}
    
    for idx in selected_indices:
        for p_idx in candidate_map[idx].covered_points:
            coverage_count[p_idx] += 1
    
    covered = sum(1 for c in coverage_count.values() if c >= 1)
    k_covered = sum(1 for c in coverage_count.values() if c >= k_required)
    
    total = len(points)
    coverage_pct = covered / total if total > 0 else 0
    k_coverage_pct = k_covered / total if total > 0 else 0
    
    return coverage_pct, k_coverage_pct


def solve_lidar_placement(params: Dict) -> Dict:
    """
    Main entry point for the solver.
    
    Expected params:
    - roi_polygon: List of {x, z} vertices
    - obstacles: List of obstacle polygons (each is list of {x, z})
    - critical_polygon: Optional list of {x, z} vertices for critical zone
    - model: {hfov_deg, vfov_deg, range_m, dome_mode}
    - settings: PlannerSettings fields
    """
    try:
        # Parse inputs
        roi_polygon = params.get('roi_polygon', [])
        obstacles = params.get('obstacles', [])
        critical_polygon = params.get('critical_polygon')
        
        model_params = params.get('model', {})
        model = LidarModel(
            hfov_deg=model_params.get('hfov_deg', 360),
            vfov_deg=model_params.get('vfov_deg', 30),
            range_m=model_params.get('range_m', 10),
            dome_mode=model_params.get('dome_mode', True)
        )
        
        settings_params = params.get('settings', {})
        settings = PlannerSettings(
            mount_y_m=settings_params.get('mount_y_m', 3.0),
            sample_spacing_m=settings_params.get('sample_spacing_m', 0.75),
            candidate_spacing_m=settings_params.get('candidate_spacing_m', 2.0),
            keepout_distance_m=settings_params.get('keepout_distance_m', 0.5),
            overlap_mode=settings_params.get('overlap_mode', 'everywhere'),
            k_required=settings_params.get('k_required', 2),
            overlap_target_pct=settings_params.get('overlap_target_pct', 0.8),
            los_enabled=settings_params.get('los_enabled', False),
            los_cell_m=settings_params.get('los_cell_m', 0.25),
            yaw_step_deg=settings_params.get('yaw_step_deg', 30.0),
            max_sensors=settings_params.get('max_sensors', 50),
            solver_time_limit_s=settings_params.get('solver_time_limit_s', 10.0),
            seed=settings_params.get('seed', 42)
        )
        
        if len(roi_polygon) < 3:
            return {
                'success': False,
                'error': 'ROI polygon must have at least 3 vertices',
                'selected_positions': [],
                'num_sensors': 0
            }
        
        # Compute effective radius
        r_eff = compute_effective_radius(model, settings.mount_y_m)
        
        # Use the candidate spacing passed from settings (already computed by backend based on effective radius)
        # Don't override with a min - trust the backend's calculation
        candidate_spacing = settings.candidate_spacing_m
        
        print(f"=== SOLVER DEBUG ===")
        print(f"r_eff: {r_eff:.2f}m, candidate_spacing: {candidate_spacing:.2f}m")
        
        # Sample points
        points = sample_points_in_polygon(
            roi_polygon,
            settings.sample_spacing_m,
            settings.seed,
            obstacles
        )
        
        if len(points) == 0:
            return {
                'success': False,
                'error': 'No sample points generated inside ROI',
                'selected_positions': [],
                'num_sensors': 0
            }
        
        # Mark critical points
        if critical_polygon:
            mark_critical_points(points, critical_polygon)
        
        # Generate candidates
        candidates = generate_candidates(
            roi_polygon,
            candidate_spacing,
            settings.keepout_distance_m,
            model,
            settings.seed,
            obstacles
        )
        
        if len(candidates) == 0:
            return {
                'success': False,
                'error': 'No candidate positions generated',
                'selected_positions': [],
                'num_sensors': 0
            }
        
        # Build obstacle grid for LOS
        obstacle_grid = None
        grid_bounds = None
        if settings.los_enabled and obstacles:
            obstacle_grid, grid_bounds = build_obstacle_grid(
                roi_polygon, obstacles, settings.los_cell_m
            )
        
        # Compute coverage sets
        compute_coverage_sets(
            candidates, points, model, r_eff,
            settings.los_enabled, obstacle_grid, grid_bounds, settings.los_cell_m
        )
        
        # Solve k-coverage problem
        warnings = []
        selected_indices, solver_status, success = solve_k_coverage(
            candidates, points, settings
        )
        
        # If infeasible, try relaxing constraints
        if not success:
            warnings.append(f"Initial solve failed ({solver_status}), relaxing to k=1")
            relaxed_settings = PlannerSettings(**settings.__dict__)
            relaxed_settings.k_required = 1
            relaxed_settings.overlap_mode = "everywhere"
            
            selected_indices, solver_status, success = solve_k_coverage(
                candidates, points, relaxed_settings
            )
        
        if not success:
            return {
                'success': False,
                'error': f'Solver failed: {solver_status}',
                'selected_positions': [],
                'num_sensors': 0,
                'warnings': warnings
            }
        
        # Prune redundant sensors
        selected_indices = prune_redundant_sensors(
            selected_indices, candidates, points, settings
        )
        
        # Limit to max sensors
        if len(selected_indices) > settings.max_sensors:
            warnings.append(f"Reduced from {len(selected_indices)} to {settings.max_sensors} sensors")
            selected_indices = selected_indices[:settings.max_sensors]
        
        # Refine yaw angles for partial HFOV sensors
        refined_yaw = refine_yaw_angles(
            selected_indices, candidates, points, model, r_eff
        )
        
        # Build output positions
        candidate_map = {c.idx: c for c in candidates}
        seen_positions = set()
        selected_positions = []
        
        for idx in selected_indices:
            c = candidate_map[idx]
            pos_key = (round(c.x, 4), round(c.z, 4))
            if pos_key in seen_positions:
                continue
            seen_positions.add(pos_key)
            
            yaw = refined_yaw.get(idx, c.yaw_deg)
            selected_positions.append({
                'x': c.x,
                'z': c.z,
                'yaw': yaw
            })
        
        # Compute stats
        coverage_pct, k_coverage_pct = compute_coverage_stats(
            selected_indices, candidates, points, settings.k_required
        )
        
        return {
            'success': True,
            'selected_positions': selected_positions,
            'num_sensors': len(selected_positions),
            'coverage_pct': coverage_pct,
            'k_coverage_pct': k_coverage_pct,
            'overlap_mode': settings.overlap_mode,
            'k_required': settings.k_required,
            'warnings': warnings,
            'seed': settings.seed,
            'solver_status': solver_status,
            'total_sample_points': len(points),
            'total_candidates': len(candidates),
            'effective_radius_m': r_eff
        }
        
    except Exception as e:
        import traceback
        return {
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc(),
            'selected_positions': [],
            'num_sensors': 0
        }


if __name__ == '__main__':
    # Test with a simple square ROI
    test_params = {
        'roi_polygon': [
            {'x': 0, 'z': 0},
            {'x': 20, 'z': 0},
            {'x': 20, 'z': 15},
            {'x': 0, 'z': 15}
        ],
        'obstacles': [
            [{'x': 5, 'z': 5}, {'x': 8, 'z': 5}, {'x': 8, 'z': 8}, {'x': 5, 'z': 8}],
            [{'x': 12, 'z': 7}, {'x': 15, 'z': 7}, {'x': 15, 'z': 10}, {'x': 12, 'z': 10}]
        ],
        'model': {
            'hfov_deg': 360,
            'vfov_deg': 30,
            'range_m': 10,
            'dome_mode': True
        },
        'settings': {
            'mount_y_m': 3.0,
            'sample_spacing_m': 0.75,
            'candidate_spacing_m': 2.0,
            'overlap_mode': 'everywhere',
            'k_required': 2,
            'los_enabled': False,
            'seed': 42
        }
    }
    
    result = solve_lidar_placement(test_params)
    print(json.dumps(result, indent=2))
