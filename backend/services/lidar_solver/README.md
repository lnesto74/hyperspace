# LiDAR Placement Solver

A Python microservice using OR-Tools CP-SAT for optimal LiDAR sensor placement with k-coverage guarantees.

## Features

- **K-coverage optimization**: Ensure every floor point is seen by at least k sensors
- **HFOV support**: Both 360° dome and partial HFOV sensors with yaw optimization
- **VFOV-aware radius**: Computes effective floor coverage from mount height and VFOV
- **Obstacle handling**: Respects keepout zones and optional LOS occlusion
- **Multiple overlap modes**:
  - `everywhere`: k-coverage for all points
  - `critical_only`: k-coverage for critical zones, 1-coverage elsewhere
  - `percent_target`: Target percentage of points with k-coverage
- **Deterministic results**: Same seed + inputs = identical placements

## Installation

```bash
cd /path/to/backend/services/lidar_solver

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

## Running the Server

```bash
# Using the start script
./start.sh

# Or manually
source venv/bin/activate
export LIDAR_SOLVER_PORT=3002
python server.py
```

The server runs on port 3002 by default (configurable via `LIDAR_SOLVER_PORT` env var).

## API Endpoints

### `GET /health`
Health check endpoint.

### `POST /solve`
Solve LiDAR placement problem.

**Request Body:**
```json
{
  "roi_polygon": [{"x": 0, "z": 0}, {"x": 20, "z": 0}, {"x": 20, "z": 15}, {"x": 0, "z": 15}],
  "obstacles": [[{"x": 5, "z": 5}, {"x": 8, "z": 5}, {"x": 8, "z": 8}, {"x": 5, "z": 8}]],
  "critical_polygon": null,
  "model": {
    "hfov_deg": 360,
    "vfov_deg": 30,
    "range_m": 10,
    "dome_mode": true
  },
  "settings": {
    "mount_y_m": 3.0,
    "sample_spacing_m": 0.75,
    "candidate_spacing_m": 2.0,
    "keepout_distance_m": 0.5,
    "overlap_mode": "everywhere",
    "k_required": 2,
    "overlap_target_pct": 0.8,
    "los_enabled": false,
    "los_cell_m": 0.25,
    "yaw_step_deg": 30,
    "max_sensors": 50,
    "solver_time_limit_s": 10,
    "seed": 42
  }
}
```

**Response:**
```json
{
  "success": true,
  "selected_positions": [
    {"x": 5.0, "z": 5.0, "yaw": 0},
    {"x": 15.0, "z": 10.0, "yaw": 0}
  ],
  "num_sensors": 2,
  "coverage_pct": 0.98,
  "k_coverage_pct": 0.95,
  "overlap_mode": "everywhere",
  "k_required": 2,
  "warnings": [],
  "seed": 42,
  "solver_status": "OPTIMAL"
}
```

## Running Tests

```bash
source venv/bin/activate
python -m pytest test_solver.py -v
# Or
python test_solver.py
```

## Algorithm Overview

1. **Sample points**: Generate floor sample points inside ROI polygon (jittered grid)
2. **Generate candidates**: Create candidate sensor positions + yaw angles
3. **Compute coverage**: Precompute which candidates cover which points (range, HFOV, LOS)
4. **Solve CP-SAT**: Minimize sensors while satisfying k-coverage constraints
5. **Post-process**: Prune redundant sensors, refine yaw angles

## Effective Radius Calculation

For a sensor mounted at height `h` with vertical FOV `VFOV_deg`:
- `alpha = VFOV_deg / 2` (half angle in radians)
- `r_vfov = h * tan(alpha)` (VFOV-limited radius)
- `r_eff = min(range_m, r_vfov)` (effective floor coverage radius)

## Integration with Hyperspace Backend

The Node.js backend calls this service via HTTP:

```javascript
const response = await fetch('http://localhost:3002/solve', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(params)
});
```

Set `LIDAR_SOLVER_URL` environment variable to configure the solver URL.
Set `FEATURE_LIDAR_SOLVER=false` to disable the solver and use fallback greedy algorithm.
