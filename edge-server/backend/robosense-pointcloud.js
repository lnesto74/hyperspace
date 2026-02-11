/**
 * RoboSense MSOP Point Cloud Capture
 * 
 * Captures and decodes MSOP (Main data Stream Output Protocol) packets
 * from RoboSense LiDAR sensors to extract XYZ point cloud data.
 * 
 * MSOP packet structure (RS-LiDAR-16/32):
 * - Header: 0x55 0xAA 0x05 0x0A 0x5A 0xA5 0x50 0xA0 (8 bytes)
 * - Blocks: 12 blocks x 100 bytes each
 * - Each block: 2 bytes azimuth + 32 channels x 3 bytes (distance + intensity)
 * - Tail: timestamp, temperature, etc.
 */

import dgram from 'dgram';

const MSOP_PORT = 6699;
const MSOP_HEADER = Buffer.from([0x55, 0xAA, 0x05, 0x0A, 0x5A, 0xA5, 0x50, 0xA0]);

// RS-LiDAR-16 vertical angles (degrees) for each channel
const RS16_VERTICAL_ANGLES = [
  -15, 1, -13, 3, -11, 5, -9, 7,
  -7, 9, -5, 11, -3, 13, -1, 15
];

// RS-LiDAR-32 vertical angles
const RS32_VERTICAL_ANGLES = [
  -25, -14.19, -7.58, -4.58, -2.66, -1.29, -0.32, 0.34,
  0.84, 1.24, 1.59, 1.89, 2.17, 2.43, 2.67, 2.90,
  3.12, 3.33, 3.54, 3.74, 3.94, 4.14, 4.34, 4.54,
  4.74, 4.94, 5.15, 5.36, 5.58, 5.81, 6.05, 6.31
];

// Distance resolution (meters per unit)
const DISTANCE_RESOLUTION = 0.005; // 5mm

// Debug: log first packet header
let debugLogged = false;

/**
 * Decode a single MSOP packet into XYZ points
 */
function decodeMsopPacket(buffer, verticalAngles = RS16_VERTICAL_ANGLES) {
  const points = [];
  
  // Debug: log first packet to understand structure
  if (!debugLogged && buffer.length > 0) {
    debugLogged = true;
    console.log(`[PointCloud DEBUG] Packet length: ${buffer.length}`);
    console.log(`[PointCloud DEBUG] Header (first 16 bytes): ${buffer.slice(0, 16).toString('hex')}`);
    console.log(`[PointCloud DEBUG] Expected header: ${MSOP_HEADER.toString('hex')}`);
  }
  
  // Validate header - try multiple known RoboSense headers
  const hasStandardHeader = buffer.length >= 1248 && buffer.slice(0, 8).equals(MSOP_HEADER);
  
  // RS-Helios header: 0x55 0xAA 0x05 0x5A
  const HELIOS_HEADER = Buffer.from([0x55, 0xAA, 0x05, 0x5A]);
  const hasHeliosHeader = buffer.length >= 1248 && buffer.slice(0, 4).equals(HELIOS_HEADER);
  
  // RS-Bpearl/M1 header: 0x55 0xAA 0x05 0x0A
  const BPEARL_HEADER = Buffer.from([0x55, 0xAA, 0x05, 0x0A]);
  const hasBpearlHeader = buffer.length >= 1248 && buffer.slice(0, 4).equals(BPEARL_HEADER);
  
  if (!hasStandardHeader && !hasHeliosHeader && !hasBpearlHeader) {
    return points;
  }
  
  const numChannels = verticalAngles.length;
  const bytesPerChannel = 3; // 2 bytes distance + 1 byte intensity
  const blockSize = 2 + (numChannels * bytesPerChannel); // 2 bytes azimuth + channel data
  
  // Parse 12 blocks
  for (let block = 0; block < 12; block++) {
    const blockOffset = 8 + (block * 100); // Header is 8 bytes, each block is 100 bytes
    
    if (blockOffset + 100 > buffer.length) break;
    
    // Azimuth (0.01 degree resolution)
    const azimuthRaw = buffer.readUInt16LE(blockOffset);
    const azimuth = azimuthRaw * 0.01 * (Math.PI / 180); // Convert to radians
    
    // Parse channels
    for (let ch = 0; ch < numChannels; ch++) {
      const chOffset = blockOffset + 2 + (ch * bytesPerChannel);
      
      // Distance (5mm resolution)
      const distanceRaw = buffer.readUInt16LE(chOffset);
      const distance = distanceRaw * DISTANCE_RESOLUTION;
      
      // Intensity
      const intensity = buffer.readUInt8(chOffset + 2);
      
      // Skip invalid points
      if (distance < 0.1 || distance > 200) continue;
      
      // Vertical angle for this channel
      const verticalAngle = verticalAngles[ch] * (Math.PI / 180);
      
      // Convert spherical to Cartesian coordinates
      const x = distance * Math.cos(verticalAngle) * Math.sin(azimuth);
      const y = distance * Math.cos(verticalAngle) * Math.cos(azimuth);
      const z = distance * Math.sin(verticalAngle);
      
      points.push({ x, y, z, intensity, channel: ch });
    }
  }
  
  return points;
}

/**
 * Capture a single frame of point cloud data from a specific LiDAR IP
 * Returns a promise with an array of XYZ points
 */
export function capturePointCloudSnapshot(lidarIp, options = {}) {
  const {
    duration = 100, // ms - capture window (100ms = ~1 rotation at 10Hz)
    maxPoints = 50000, // Max points to return
    downsample = 1, // Keep every Nth point
    model = 'RS16', // LiDAR model: RS16 or RS32
  } = options;
  
  const verticalAngles = model === 'RS32' ? RS32_VERTICAL_ANGLES : RS16_VERTICAL_ANGLES;
  
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const allPoints = [];
    let packetsReceived = 0;
    
    socket.on('message', (msg, rinfo) => {
      // Only process packets from the target LiDAR
      if (rinfo.address !== lidarIp) return;
      
      packetsReceived++;
      const points = decodeMsopPacket(msg, verticalAngles);
      
      // Downsample if needed
      for (let i = 0; i < points.length; i += downsample) {
        if (allPoints.length < maxPoints) {
          allPoints.push(points[i]);
        }
      }
    });
    
    socket.on('error', (err) => {
      console.error('[PointCloud] Socket error:', err.message);
      socket.close();
      reject(err);
    });
    
    // Bind to MSOP port
    socket.bind(MSOP_PORT, '0.0.0.0', () => {
      console.log(`[PointCloud] Capturing from ${lidarIp} on port ${MSOP_PORT}...`);
    });
    
    // Capture for specified duration
    setTimeout(() => {
      socket.close();
      console.log(`[PointCloud] Captured ${allPoints.length} points from ${packetsReceived} packets`);
      resolve({
        success: true,
        lidarIp,
        pointCount: allPoints.length,
        packetsReceived,
        points: allPoints,
      });
    }, duration);
  });
}

/**
 * Start continuous point cloud streaming via callback
 */
export function startPointCloudStream(lidarIp, onFrame, options = {}) {
  const {
    frameInterval = 100, // ms between frames
    maxPointsPerFrame = 20000,
    downsample = 2,
    model = 'RS16',
  } = options;
  
  const verticalAngles = model === 'RS32' ? RS32_VERTICAL_ANGLES : RS16_VERTICAL_ANGLES;
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let framePoints = [];
  let isRunning = true;
  
  socket.on('message', (msg, rinfo) => {
    if (!isRunning || rinfo.address !== lidarIp) return;
    
    const points = decodeMsopPacket(msg, verticalAngles);
    for (let i = 0; i < points.length; i += downsample) {
      if (framePoints.length < maxPointsPerFrame) {
        framePoints.push(points[i]);
      }
    }
  });
  
  socket.on('error', (err) => {
    console.error('[PointCloud] Stream error:', err.message);
  });
  
  socket.bind(MSOP_PORT, '0.0.0.0', () => {
    console.log(`[PointCloud] Streaming from ${lidarIp}...`);
  });
  
  // Emit frames at regular intervals
  const frameTimer = setInterval(() => {
    if (framePoints.length > 0) {
      onFrame({
        lidarIp,
        pointCount: framePoints.length,
        points: framePoints,
        timestamp: Date.now(),
      });
      framePoints = [];
    }
  }, frameInterval);
  
  // Return stop function
  return () => {
    isRunning = false;
    clearInterval(frameTimer);
    socket.close();
    console.log(`[PointCloud] Stream stopped for ${lidarIp}`);
  };
}

/**
 * Convert points array to compact binary format for efficient transfer
 * Format: Float32Array with [x, y, z, intensity, x, y, z, intensity, ...]
 */
export function pointsToBuffer(points) {
  const floatsPerPoint = 4; // x, y, z, intensity
  const buffer = new Float32Array(points.length * floatsPerPoint);
  
  for (let i = 0; i < points.length; i++) {
    const offset = i * floatsPerPoint;
    buffer[offset] = points[i].x;
    buffer[offset + 1] = points[i].y;
    buffer[offset + 2] = points[i].z;
    buffer[offset + 3] = points[i].intensity / 255; // Normalize to 0-1
  }
  
  return Buffer.from(buffer.buffer);
}

/**
 * Convert points to PLY format string (for debugging/export)
 */
export function pointsToPly(points) {
  let ply = `ply
format ascii 1.0
element vertex ${points.length}
property float x
property float y
property float z
property uchar intensity
end_header
`;
  
  for (const p of points) {
    ply += `${p.x.toFixed(4)} ${p.y.toFixed(4)} ${p.z.toFixed(4)} ${p.intensity}\n`;
  }
  
  return ply;
}

export default {
  capturePointCloudSnapshot,
  startPointCloudStream,
  pointsToBuffer,
  pointsToPly,
};
