# ROS2 LiDAR Driver for Edge Server

This Docker setup provides ROS2 with the RoboSense LiDAR driver and rosbridge for WebSocket streaming to the Hyperspace frontend.

## Architecture

```
LiDAR (UDP 6699/7788) → ROS2 rslidar_sdk → /rslidar_points topic → rosbridge (WS 9090) → Frontend
```

## Prerequisites

- Docker and Docker Compose installed on edge server
- LiDAR connected to edge server network
- LiDAR configured to send packets to edge server IP

## Quick Start

### 1. Configure LiDAR Model

Edit `config/rslidar.yaml` and set your LiDAR model:

```yaml
lidar:
  - driver:
      lidar_type: RS16  # Options: RS16, RS32, RSBP, RS128, RS80, RSM1, RSHELIOS
```

### 2. Build and Start

```bash
cd /path/to/edge-server/ros
docker-compose up -d --build
```

### 3. Verify ROS is Running

```bash
# Check container is running
docker ps

# View logs
docker logs ros-lidar -f

# Check topics are publishing
docker exec ros-lidar ros2 topic list
docker exec ros-lidar ros2 topic hz /rslidar_points
```

### 4. Connect from Frontend

1. Open Point Cloud Viewer in Hyperspace
2. Select **ROS** streaming mode
3. Click **Stream** to start

The frontend connects to `ws://{EDGE_IP}:9090` via rosbridge.

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 6699 | UDP | LiDAR MSOP packets (point data) |
| 7788 | UDP | LiDAR DIFOP packets (config) |
| 9090 | TCP/WS | rosbridge WebSocket |

## Configuration Options

### rslidar.yaml

```yaml
common:
  msg_source: 1                    # 1=live LiDAR, 2=PCAP file
  send_point_cloud_ros: true       # Publish to ROS topic

lidar:
  - driver:
      lidar_type: RS16             # LiDAR model
      msop_port: 6699              # MSOP UDP port
      difop_port: 7788             # DIFOP UDP port
      min_distance: 0.2            # Min range filter (meters)
      max_distance: 200            # Max range filter (meters)
    ros:
      ros_frame_id: rslidar        # TF frame ID
      ros_send_point_cloud_topic: /rslidar_points
```

## Troubleshooting

### No points showing

1. Check LiDAR is sending packets:
   ```bash
   docker exec ros-lidar tcpdump -i any udp port 6699 -c 5
   ```

2. Check driver is receiving:
   ```bash
   docker logs ros-lidar 2>&1 | grep -i error
   ```

3. Check topic is publishing:
   ```bash
   docker exec ros-lidar ros2 topic echo /rslidar_points --once
   ```

### Rosbridge not connecting

1. Check port 9090 is accessible:
   ```bash
   curl -v http://edge-ip:9090
   ```

2. Check rosbridge is running:
   ```bash
   docker exec ros-lidar ps aux | grep rosbridge
   ```

### Point cloud looks wrong

- Check `lidar_type` matches your hardware
- Check `min_distance` and `max_distance` filters
- Verify LiDAR is mounted correctly (check coordinate frame)

## Comparison: ROS vs Node.js Driver

| Feature | ROS2 Driver | Node.js Driver |
|---------|-------------|----------------|
| Setup | Docker + ROS | Docker + Node |
| Dependencies | ~2GB image | ~200MB image |
| LiDAR support | All RoboSense | RS16/RS32 tested |
| Debugging | rviz, rosbag | Console logs |
| SLAM/Perception | ROS ecosystem | Manual implementation |
| Performance | Optimized C++ | JavaScript |

## Running Both Drivers

You can run both the Node.js and ROS drivers simultaneously. They both listen on UDP ports 6699/7788, but since Docker uses host networking, only one can bind to these ports at a time.

To switch between drivers:

```bash
# Stop Node.js driver
cd ../
docker-compose stop

# Start ROS driver
cd ros/
docker-compose up -d

# Or vice versa
```

## Advanced: Recording with rosbag

```bash
# Start recording
docker exec ros-lidar ros2 bag record /rslidar_points -o /data/recording

# Stop with Ctrl+C

# Play back
docker exec ros-lidar ros2 bag play /data/recording
```

The `/data` directory is mounted from `./data` on the host.
