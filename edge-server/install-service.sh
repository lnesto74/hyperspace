#!/bin/bash

# Edge LiDAR Server - Install as systemd service
# Run this on Ulisse to auto-start on boot

echo "🔧 Installing Edge LiDAR Server as systemd service..."

# Create systemd service file
sudo tee /etc/systemd/system/edge-lidar.service > /dev/null << 'EOF'
[Unit]
Description=Edge LiDAR Trajectory Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/home/ulisse/edge-server
ExecStartPre=/snap/bin/docker compose down
ExecStart=/snap/bin/docker compose up
ExecStop=/snap/bin/docker compose down
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable edge-lidar.service

# Start the service now
sudo systemctl start edge-lidar.service

echo ""
echo "✅ Edge LiDAR service installed!"
echo ""
echo "📝 Commands:"
echo "   Start:   sudo systemctl start edge-lidar"
echo "   Stop:    sudo systemctl stop edge-lidar"
echo "   Status:  sudo systemctl status edge-lidar"
echo "   Logs:    sudo journalctl -u edge-lidar -f"
echo ""
echo "🚀 Service will auto-start on boot!"
