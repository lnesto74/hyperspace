#!/bin/bash

# Edge LiDAR Server - Uninstall systemd service

echo "🛑 Uninstalling Edge LiDAR Server service..."

sudo systemctl stop edge-lidar.service 2>/dev/null
sudo systemctl disable edge-lidar.service 2>/dev/null
sudo rm /etc/systemd/system/edge-lidar.service 2>/dev/null
sudo systemctl daemon-reload

echo "✅ Service uninstalled"
