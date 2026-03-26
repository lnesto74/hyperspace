#!/bin/bash
# LS Lidar Configuration Packet Capture Script
# 
# This script captures all UDP packets to/from the LS Lidar
# while you configure it with LeiShen View software.
#
# Usage:
#   1. Run this script on the edge server (or any machine on the same network)
#   2. Open LeiShen View on Windows and connect to the LiDAR
#   3. Change the IP address in LeiShen View
#   4. Press Ctrl+C to stop capture
#   5. Share the output with me to analyze the protocol

LIDAR_IP="${1:-192.168.1.203}"
OUTPUT_FILE="/tmp/lslidar_config_capture.pcap"
TEXT_OUTPUT="/tmp/lslidar_config_capture.txt"

echo "========================================"
echo " LS Lidar Configuration Packet Capture"
echo "========================================"
echo ""
echo "LiDAR IP: $LIDAR_IP"
echo "Output:   $OUTPUT_FILE"
echo ""
echo "Instructions:"
echo "1. Keep this script running"
echo "2. Open LeiShen View on your Windows PC"
echo "3. Connect to the LiDAR at $LIDAR_IP"
echo "4. Change any setting (IP, destination, etc.)"
echo "5. Press Ctrl+C here to stop capture"
echo ""
echo "Starting capture... (Press Ctrl+C to stop)"
echo ""

# Capture all UDP traffic to/from the LiDAR
# -w saves to pcap file, -X shows hex dump
sudo tcpdump -i any "host $LIDAR_IP and udp" -w "$OUTPUT_FILE" -v &
TCPDUMP_PID=$!

# Also capture to text for quick analysis
sudo tcpdump -i any "host $LIDAR_IP and udp" -X -c 1000 > "$TEXT_OUTPUT" 2>&1 &
TEXT_PID=$!

# Wait for Ctrl+C
trap "echo ''; echo 'Stopping capture...'; sudo kill $TCPDUMP_PID $TEXT_PID 2>/dev/null; echo 'Done!'" INT

wait $TCPDUMP_PID

echo ""
echo "========================================"
echo "Capture complete!"
echo ""
echo "Files saved:"
echo "  PCAP:  $OUTPUT_FILE"
echo "  Text:  $TEXT_OUTPUT"
echo ""
echo "To view the hex dump of config packets:"
echo "  cat $TEXT_OUTPUT | grep -A 20 'length [0-9]*$' | head -100"
echo ""
echo "To find packets SENT TO the LiDAR (config commands):"
echo "  tcpdump -r $OUTPUT_FILE -X 'dst host $LIDAR_IP' | head -200"
echo "========================================"
