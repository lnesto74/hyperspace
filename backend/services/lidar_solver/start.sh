#!/bin/bash
# Start the LiDAR solver service

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if venv exists, create if not
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

# Start the server
export LIDAR_SOLVER_PORT=${LIDAR_SOLVER_PORT:-3002}
echo "Starting LiDAR Solver on port $LIDAR_SOLVER_PORT"
python server.py
