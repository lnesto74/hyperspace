# ROS2 Humble with RoboSense LiDAR driver and rosbridge
FROM ros:humble-ros-base

# Install dependencies
RUN apt-get update && apt-get install -y \
    ros-humble-rosbridge-server \
    ros-humble-pcl-ros \
    ros-humble-pcl-conversions \
    libpcap-dev \
    libyaml-cpp-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create workspace
WORKDIR /ros2_ws/src

# Clone RoboSense message definitions and SDK with submodules
RUN git clone https://github.com/RoboSense-LiDAR/rslidar_msg.git && \
    git clone --recurse-submodules https://github.com/RoboSense-LiDAR/rslidar_sdk.git

# Configure rslidar_sdk for ROS2
RUN cd rslidar_sdk && \
    sed -i 's/set(COMPILE_METHOD CATKIN)/set(COMPILE_METHOD COLCON)/' CMakeLists.txt && \
    sed -i 's/set(POINT_TYPE XYZI)/set(POINT_TYPE XYZIRT)/' CMakeLists.txt

# Build workspace
WORKDIR /ros2_ws
RUN . /opt/ros/humble/setup.sh && \
    colcon build --symlink-install

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 9090

ENTRYPOINT ["/entrypoint.sh"]
