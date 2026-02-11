#!/bin/bash
set -e

# Source ROS2 setup
source /opt/ros/humble/setup.bash
source /ros2_ws/install/setup.bash

# Start rosbridge in background
ros2 launch rosbridge_server rosbridge_websocket_launch.xml port:=9090 &

# Wait for rosbridge to start
sleep 2

# Run rslidar_sdk node directly (without rviz)
echo "[entrypoint] Starting rslidar_sdk node..."
ros2 run rslidar_sdk rslidar_sdk_node
