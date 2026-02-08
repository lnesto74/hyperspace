#!/usr/bin/env python3
"""
Flask server for LiDAR placement solver.
Exposes the OR-Tools CP-SAT solver via HTTP API.
"""

import os
from flask import Flask, request, jsonify
from solver import solve_lidar_placement

app = Flask(__name__)

# Port from environment or default
PORT = int(os.environ.get('LIDAR_SOLVER_PORT', 3002))


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok', 'service': 'lidar-solver'})


@app.route('/solve', methods=['POST'])
def solve():
    """
    Solve LiDAR placement problem.
    
    Request body (JSON):
    {
        "roi_polygon": [{x, z}, ...],
        "obstacles": [[{x, z}, ...], ...],
        "critical_polygon": [{x, z}, ...] (optional),
        "model": {hfov_deg, vfov_deg, range_m, dome_mode},
        "settings": {
            mount_y_m, sample_spacing_m, candidate_spacing_m,
            keepout_distance_m, overlap_mode, k_required,
            overlap_target_pct, los_enabled, los_cell_m,
            yaw_step_deg, max_sensors, solver_time_limit_s, seed
        }
    }
    """
    try:
        params = request.get_json()
        if not params:
            return jsonify({'success': False, 'error': 'No JSON body provided'}), 400
        
        result = solve_lidar_placement(params)
        return jsonify(result)
    
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500


if __name__ == '__main__':
    print(f"🧮 LiDAR Solver Service starting on port {PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=False)
