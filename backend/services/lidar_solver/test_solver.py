#!/usr/bin/env python3
"""
Unit tests for the LiDAR placement solver.
Tests effective radius, HFOV wedge, sampling, LOS, and solver feasibility.
"""

import unittest
import math
import json
from solver import (
    compute_effective_radius,
    point_in_polygon,
    sample_points_in_polygon,
    generate_candidates,
    smallest_angle_diff,
    check_los_blocked,
    build_obstacle_grid,
    compute_coverage_sets,
    solve_lidar_placement,
    LidarModel,
    PlannerSettings,
    SamplePoint,
    Candidate
)
import numpy as np


class TestEffectiveRadius(unittest.TestCase):
    """Test effective radius calculation from VFOV + mount height."""
    
    def test_basic_calculation(self):
        """Test r_eff = min(range, h * tan(VFOV/2))"""
        model = LidarModel(vfov_deg=60, range_m=20)
        # h=3, VFOV=60 => alpha=30deg => tan(30)=0.577 => r_v = 3*0.577 = 1.73
        r_eff = compute_effective_radius(model, mount_height=3.0)
        expected_r_v = 3.0 * math.tan(math.radians(30))
        self.assertAlmostEqual(r_eff, expected_r_v, places=2)
    
    def test_range_limited(self):
        """Test when range is smaller than VFOV-limited radius."""
        model = LidarModel(vfov_deg=90, range_m=5)
        # h=10, VFOV=90 => alpha=45deg => tan(45)=1 => r_v = 10
        # range=5 < r_v=10, so r_eff = 5
        r_eff = compute_effective_radius(model, mount_height=10.0)
        self.assertEqual(r_eff, 5.0)
    
    def test_vfov_limited(self):
        """Test when VFOV-limited radius is smaller than range."""
        model = LidarModel(vfov_deg=30, range_m=50)
        # h=3, VFOV=30 => alpha=15deg => tan(15)=0.268 => r_v = 0.804
        r_eff = compute_effective_radius(model, mount_height=3.0)
        expected_r_v = 3.0 * math.tan(math.radians(15))
        self.assertAlmostEqual(r_eff, expected_r_v, places=2)
        self.assertLess(r_eff, 50)


class TestHfovWedge(unittest.TestCase):
    """Test HFOV wedge angle calculations."""
    
    def test_smallest_angle_diff_same(self):
        """Angles that are the same should have diff=0."""
        self.assertEqual(smallest_angle_diff(45, 45), 0)
    
    def test_smallest_angle_diff_180(self):
        """Opposite angles should have diff=180."""
        self.assertEqual(smallest_angle_diff(0, 180), 180)
        self.assertEqual(smallest_angle_diff(90, 270), 180)
    
    def test_smallest_angle_diff_wrap(self):
        """Test angle wrapping around 360."""
        self.assertAlmostEqual(smallest_angle_diff(10, 350), 20, places=1)
        self.assertAlmostEqual(smallest_angle_diff(350, 10), 20, places=1)
    
    def test_smallest_angle_diff_negative(self):
        """Test with negative angles."""
        self.assertAlmostEqual(smallest_angle_diff(-10, 10), 20, places=1)


class TestPointInPolygon(unittest.TestCase):
    """Test point-in-polygon algorithm."""
    
    def setUp(self):
        self.square = [
            {'x': 0, 'z': 0},
            {'x': 10, 'z': 0},
            {'x': 10, 'z': 10},
            {'x': 0, 'z': 10}
        ]
    
    def test_point_inside(self):
        """Point clearly inside should return True."""
        self.assertTrue(point_in_polygon(5, 5, self.square))
        self.assertTrue(point_in_polygon(1, 1, self.square))
        self.assertTrue(point_in_polygon(9, 9, self.square))
    
    def test_point_outside(self):
        """Point clearly outside should return False."""
        self.assertFalse(point_in_polygon(-1, 5, self.square))
        self.assertFalse(point_in_polygon(11, 5, self.square))
        self.assertFalse(point_in_polygon(5, -1, self.square))
        self.assertFalse(point_in_polygon(5, 11, self.square))


class TestSamplingDeterminism(unittest.TestCase):
    """Test that sampling is deterministic with same seed."""
    
    def test_same_seed_same_points(self):
        """Same seed should produce identical points."""
        polygon = [
            {'x': 0, 'z': 0},
            {'x': 20, 'z': 0},
            {'x': 20, 'z': 15},
            {'x': 0, 'z': 15}
        ]
        
        points1 = sample_points_in_polygon(polygon, spacing_m=1.0, seed=42)
        points2 = sample_points_in_polygon(polygon, spacing_m=1.0, seed=42)
        
        self.assertEqual(len(points1), len(points2))
        for p1, p2 in zip(points1, points2):
            self.assertAlmostEqual(p1.x, p2.x, places=6)
            self.assertAlmostEqual(p1.z, p2.z, places=6)
    
    def test_different_seed_different_points(self):
        """Different seeds should produce different jittered points."""
        polygon = [
            {'x': 0, 'z': 0},
            {'x': 20, 'z': 0},
            {'x': 20, 'z': 15},
            {'x': 0, 'z': 15}
        ]
        
        points1 = sample_points_in_polygon(polygon, spacing_m=1.0, seed=42)
        points2 = sample_points_in_polygon(polygon, spacing_m=1.0, seed=123)
        
        # Same count but different positions due to jitter
        self.assertEqual(len(points1), len(points2))
        # At least some points should differ
        diffs = sum(1 for p1, p2 in zip(points1, points2) 
                   if abs(p1.x - p2.x) > 0.01 or abs(p1.z - p2.z) > 0.01)
        self.assertGreater(diffs, 0)


class TestLosRaymarch(unittest.TestCase):
    """Test line-of-sight ray marching."""
    
    def test_no_obstacle_clear_los(self):
        """Without obstacles, LOS should not be blocked."""
        blocked = check_los_blocked(0, 0, 10, 10, None, None, 0.25)
        self.assertFalse(blocked)
    
    def test_obstacle_blocks_los(self):
        """Obstacle in path should block LOS."""
        # Create a 10x10 grid with obstacle in center
        grid = np.zeros((10, 10), dtype=bool)
        grid[4:6, 4:6] = True  # 2x2 obstacle at center
        bounds = {'min_x': 0, 'max_x': 10, 'min_z': 0, 'max_z': 10}
        
        # Ray from (0,0) to (9,9) should be blocked by center obstacle
        blocked = check_los_blocked(0, 0, 9, 9, grid, bounds, 1.0)
        self.assertTrue(blocked)
    
    def test_obstacle_not_in_path(self):
        """Obstacle not in ray path should not block."""
        grid = np.zeros((10, 10), dtype=bool)
        grid[0:2, 8:10] = True  # Obstacle in corner
        bounds = {'min_x': 0, 'max_x': 10, 'min_z': 0, 'max_z': 10}
        
        # Ray from (5,5) to (5,0) should not be blocked
        blocked = check_los_blocked(5, 5, 5, 0, grid, bounds, 1.0)
        self.assertFalse(blocked)


class TestSolverFeasibility(unittest.TestCase):
    """Test that solver produces feasible solutions."""
    
    def test_simple_square_coverage(self):
        """Solver should find solution for simple square."""
        params = {
            'roi_polygon': [
                {'x': 0, 'z': 0},
                {'x': 10, 'z': 0},
                {'x': 10, 'z': 10},
                {'x': 0, 'z': 10}
            ],
            'obstacles': [],
            'model': {
                'hfov_deg': 360,
                'vfov_deg': 60,
                'range_m': 8,
                'dome_mode': True
            },
            'settings': {
                'mount_y_m': 3.0,
                'sample_spacing_m': 1.0,
                'candidate_spacing_m': 3.0,
                'overlap_mode': 'everywhere',
                'k_required': 1,
                'solver_time_limit_s': 5.0,
                'seed': 42
            }
        }
        
        result = solve_lidar_placement(params)
        
        self.assertTrue(result['success'])
        self.assertGreater(result['num_sensors'], 0)
        self.assertGreater(result['coverage_pct'], 0.9)
    
    def test_k2_coverage(self):
        """Solver should find solution with k=2 coverage."""
        params = {
            'roi_polygon': [
                {'x': 0, 'z': 0},
                {'x': 15, 'z': 0},
                {'x': 15, 'z': 15},
                {'x': 0, 'z': 15}
            ],
            'obstacles': [],
            'model': {
                'hfov_deg': 360,
                'vfov_deg': 60,
                'range_m': 10,
                'dome_mode': True
            },
            'settings': {
                'mount_y_m': 3.0,
                'sample_spacing_m': 1.0,
                'candidate_spacing_m': 4.0,
                'overlap_mode': 'everywhere',
                'k_required': 2,
                'solver_time_limit_s': 10.0,
                'seed': 42
            }
        }
        
        result = solve_lidar_placement(params)
        
        self.assertTrue(result['success'])
        self.assertGreater(result['num_sensors'], 1)  # Need more sensors for k=2
        self.assertGreater(result['k_coverage_pct'], 0.8)
    
    def test_with_obstacles(self):
        """Solver should handle obstacles correctly."""
        params = {
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
                'vfov_deg': 60,
                'range_m': 10,
                'dome_mode': True
            },
            'settings': {
                'mount_y_m': 3.0,
                'sample_spacing_m': 1.0,
                'candidate_spacing_m': 3.0,
                'keepout_distance_m': 0.5,
                'overlap_mode': 'everywhere',
                'k_required': 2,
                'solver_time_limit_s': 10.0,
                'seed': 42
            }
        }
        
        result = solve_lidar_placement(params)
        
        self.assertTrue(result['success'])
        self.assertGreater(result['num_sensors'], 0)
    
    def test_deterministic_results(self):
        """Same inputs should produce identical placements."""
        params = {
            'roi_polygon': [
                {'x': 0, 'z': 0},
                {'x': 12, 'z': 0},
                {'x': 12, 'z': 12},
                {'x': 0, 'z': 12}
            ],
            'obstacles': [],
            'model': {
                'hfov_deg': 360,
                'vfov_deg': 60,
                'range_m': 8,
                'dome_mode': True
            },
            'settings': {
                'mount_y_m': 3.0,
                'sample_spacing_m': 1.0,
                'candidate_spacing_m': 4.0,
                'overlap_mode': 'everywhere',
                'k_required': 2,
                'solver_time_limit_s': 5.0,
                'seed': 12345
            }
        }
        
        result1 = solve_lidar_placement(params)
        result2 = solve_lidar_placement(params)
        
        self.assertEqual(result1['num_sensors'], result2['num_sensors'])
        self.assertEqual(len(result1['selected_positions']), len(result2['selected_positions']))
        
        for p1, p2 in zip(result1['selected_positions'], result2['selected_positions']):
            self.assertAlmostEqual(p1['x'], p2['x'], places=4)
            self.assertAlmostEqual(p1['z'], p2['z'], places=4)


class TestPartialHfov(unittest.TestCase):
    """Test handling of partial HFOV (non-360°) sensors."""
    
    def test_partial_hfov_generates_yaw_candidates(self):
        """Partial HFOV should generate multiple yaw candidates per position."""
        polygon = [
            {'x': 0, 'z': 0},
            {'x': 10, 'z': 0},
            {'x': 10, 'z': 10},
            {'x': 0, 'z': 10}
        ]
        
        model_360 = LidarModel(hfov_deg=360, dome_mode=True)
        model_90 = LidarModel(hfov_deg=90, dome_mode=False)
        
        candidates_360 = generate_candidates(polygon, 5.0, 0.5, model_360, 42, [])
        candidates_90 = generate_candidates(polygon, 5.0, 0.5, model_90, 42, [])
        
        # 360° should have fewer candidates (1 yaw per position)
        # 90° should have more candidates (multiple yaws per position)
        self.assertGreater(len(candidates_90), len(candidates_360))


if __name__ == '__main__':
    unittest.main()
