/**
 * LS Lidar (Leishen) MSOP Point Cloud Capture
 * 
 * Captures and decodes MSOP packets from LS Lidar C16/C32 sensors.
 * 
 * Packet structure (LS Lidar C16):
 * - Header: 0xFF 0xEE (2 bytes)
 * - Azimuth blocks with distance/intensity data
 * - Total packet size: 1212 bytes
 * 
 * Ports:
 * - MSOP (point data): 2369
 * - Default destination port: 2345
 */

import dgram from 'dgram';

// LS Lidar ports (different from RoboSense)
export const LSLIDAR_MSOP_PORT = 2369;
export const LSLIDAR_DEST_PORT = 2345;
export const LSLIDAR_CONFIG_PORT = 2368;

// LS Lidar config packet header (reverse-engineered from LeiShen View)
const LSLIDAR_CONFIG_HEADER = Buffer.from([0xAA, 0x00, 0xFF, 0x11, 0x22, 0x22, 0xAA, 0xAA]);

// LS Lidar header magic bytes
const LSLIDAR_HEADER = Buffer.from([0xFF, 0xEE]);

// LS Lidar C16 vertical angles (degrees) for each channel
const LSC16_VERTICAL_ANGLES = [
  -15, -13, -11, -9, -7, -5, -3, -1,
  1, 3, 5, 7, 9, 11, 13, 15
];

// LS Lidar C32 vertical angles
const LSC32_VERTICAL_ANGLES = [
  -16, -15, -14, -13, -12, -11, -10, -9,
  -8, -7, -6, -5, -4, -3, -2, -1,
  0, 1, 2, 3, 4, 5, 6, 7,
  8, 9, 10, 11, 12, 13, 14, 15
];

// Distance resolution (meters per unit) - typically 0.25cm = 0.0025m
const DISTANCE_RESOLUTION = 0.0025;

// Debug flag
let debugLogged = false;

/**
 * Get vertical angles for the specified LS Lidar model
 */
function getVerticalAngles(model) {
  switch (model.toUpperCase()) {
    case 'LSC32':
    case 'C32':
      return LSC32_VERTICAL_ANGLES;
    case 'LSC16':
    case 'C16':
    default:
      return LSC16_VERTICAL_ANGLES;
  }
}

/**
 * Decode a single LS Lidar MSOP packet into XYZ points
 * 
 * LS Lidar C16 packet structure (1212 bytes):
 * - Bytes 0-1: Header 0xFF 0xEE
 * - Bytes 2-3: Azimuth (0.01 degree resolution)
 * - Bytes 4+: Channel data blocks
 * 
 * Each firing block contains:
 * - 2 bytes: Azimuth
 * - 16 channels x 4 bytes each (2 bytes distance + 2 bytes intensity)
 */
function decodeLslidarPacket(buffer, verticalAngles = LSC16_VERTICAL_ANGLES) {
  const points = [];
  
  // Debug: log first packet
  if (!debugLogged && buffer.length > 0) {
    debugLogged = true;
    console.log(`[LSLidar DEBUG] Packet length: ${buffer.length}`);
    console.log(`[LSLidar DEBUG] Header (first 8 bytes): ${buffer.slice(0, 8).toString('hex')}`);
  }
  
  // Validate header
  if (buffer.length < 100) return points;
  
  // Check for LS Lidar header 0xFFEE
  const hasLsHeader = buffer[0] === 0xFF && buffer[1] === 0xEE;
  if (!hasLsHeader) {
    // Try alternate header detection
    if (buffer[0] !== 0xFF) return points;
  }
  
  const numChannels = verticalAngles.length;
  
  // LS Lidar C16 packet structure:
  // After 2-byte header, data is organized in firing blocks
  // Each block: 2 bytes azimuth + (numChannels * 4 bytes) channel data
  // Channel data: 2 bytes distance (little endian) + 2 bytes intensity
  
  const headerSize = 2;
  const bytesPerChannel = 4; // 2 distance + 2 intensity
  const blockSize = 2 + (numChannels * bytesPerChannel); // azimuth + channels
  
  // Calculate number of blocks in packet
  const dataSize = buffer.length - headerSize;
  const numBlocks = Math.floor(dataSize / blockSize);
  
  for (let block = 0; block < numBlocks; block++) {
    const blockOffset = headerSize + (block * blockSize);
    
    if (blockOffset + blockSize > buffer.length) break;
    
    // Read azimuth (0.01 degree resolution, little endian)
    const azimuthRaw = buffer.readUInt16LE(blockOffset);
    const azimuth = (azimuthRaw * 0.01) * (Math.PI / 180); // Convert to radians
    
    // Parse channels
    for (let ch = 0; ch < numChannels; ch++) {
      const chOffset = blockOffset + 2 + (ch * bytesPerChannel);
      
      if (chOffset + bytesPerChannel > buffer.length) break;
      
      // Distance (little endian, in 0.25cm units)
      const distanceRaw = buffer.readUInt16LE(chOffset);
      const distance = distanceRaw * DISTANCE_RESOLUTION;
      
      // Intensity (little endian)
      const intensity = buffer.readUInt16LE(chOffset + 2) & 0xFF;
      
      // Skip invalid points
      if (distance < 0.1 || distance > 150) continue;
      
      // Vertical angle for this channel
      const verticalAngle = verticalAngles[ch] * (Math.PI / 180);
      
      // Convert spherical to Cartesian coordinates
      const cosVert = Math.cos(verticalAngle);
      const x = distance * cosVert * Math.sin(azimuth);
      const y = distance * cosVert * Math.cos(azimuth);
      const z = distance * Math.sin(verticalAngle);
      
      points.push({ x, y, z, intensity, channel: ch });
    }
  }
  
  return points;
}

/**
 * Capture a single frame of point cloud data from LS Lidar
 */
export function captureLslidarSnapshot(lidarIp, options = {}) {
  const {
    duration = 100,
    maxPoints = 100000,
    downsample = 1,
    model = 'C16',
    listenPort = LSLIDAR_DEST_PORT,
  } = options;
  
  const verticalAngles = getVerticalAngles(model);
  
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const allPoints = [];
    let packetsReceived = 0;
    
    socket.on('message', (msg, rinfo) => {
      // Accept packets from any source for now (LS Lidar might not match expected IP)
      // if (rinfo.address !== lidarIp) return;
      
      packetsReceived++;
      const points = decodeLslidarPacket(msg, verticalAngles);
      
      for (let i = 0; i < points.length; i += downsample) {
        if (allPoints.length < maxPoints) {
          allPoints.push(points[i]);
        }
      }
    });
    
    socket.on('error', (err) => {
      console.error('[LSLidar] Socket error:', err.message);
      socket.close();
      reject(err);
    });
    
    // Bind to the destination port the LiDAR sends to
    socket.bind(listenPort, '0.0.0.0', () => {
      console.log(`[LSLidar] Capturing from ${lidarIp} on port ${listenPort}...`);
    });
    
    // Capture for specified duration
    setTimeout(() => {
      socket.close();
      console.log(`[LSLidar] Captured ${allPoints.length} points from ${packetsReceived} packets`);
      resolve({
        success: allPoints.length > 0,
        lidarIp,
        pointCount: allPoints.length,
        packetsReceived,
        points: allPoints,
      });
    }, duration);
  });
}

/**
 * Start continuous point cloud streaming
 */
export function startLslidarStream(lidarIp, onFrame, options = {}) {
  const {
    frameInterval = 100,
    maxPointsPerFrame = 100000,
    downsample = 1,
    model = 'C16',
    listenPort = LSLIDAR_DEST_PORT,
  } = options;
  
  const verticalAngles = getVerticalAngles(model);
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let framePoints = [];
  let isRunning = true;
  
  socket.on('message', (msg, rinfo) => {
    if (!isRunning) return;
    
    const points = decodeLslidarPacket(msg, verticalAngles);
    for (let i = 0; i < points.length; i += downsample) {
      if (framePoints.length < maxPointsPerFrame) {
        framePoints.push(points[i]);
      }
    }
  });
  
  socket.on('error', (err) => {
    console.error('[LSLidar] Stream error:', err.message);
  });
  
  socket.bind(listenPort, '0.0.0.0', () => {
    console.log(`[LSLidar] Streaming from ${lidarIp} on port ${listenPort}...`);
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
    console.log(`[LSLidar] Stream stopped for ${lidarIp}`);
  };
}

/**
 * Convert points to compact binary format
 */
export function pointsToBuffer(points) {
  const floatsPerPoint = 4;
  const buffer = new Float32Array(points.length * floatsPerPoint);
  
  for (let i = 0; i < points.length; i++) {
    const offset = i * floatsPerPoint;
    buffer[offset] = points[i].x;
    buffer[offset + 1] = points[i].y;
    buffer[offset + 2] = points[i].z;
    buffer[offset + 3] = points[i].intensity / 255;
  }
  
  return Buffer.from(buffer.buffer);
}

/**
 * Configure LS Lidar IP address via UDP
 * 
 * Protocol reverse-engineered from LeiShen View software:
 * - Send to UDP port 2368
 * - Header: AA 00 FF 11 22 22 AA AA
 * - Followed by config data including new IP, destination IP, MAC, ports
 * 
 * @param {string} currentIp - Current LiDAR IP address
 * @param {string} newIp - New IP address to set
 * @param {string} destinationIp - Where LiDAR should send data (edge server IP)
 * @param {object} options - Additional options (msopPort, difopPort)
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function configureLslidarIp(currentIp, newIp, destinationIp, options = {}) {
  const msopPort = options.msopPort || 2345;
  const difopPort = options.difopPort || 2346;
  
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    
    // Build config packet (1206 bytes like LeiShen View sends)
    const packet = Buffer.alloc(1206);
    
    // Header: AA 00 FF 11 22 22 AA AA
    LSLIDAR_CONFIG_HEADER.copy(packet, 0);
    
    // Command type at offset 8-9: 01 2C (300 in little-endian)
    packet.writeUInt16LE(0x012C, 8);
    
    // New LiDAR IP at offset 10-13
    const newIpParts = newIp.split('.').map(Number);
    packet[10] = newIpParts[0];
    packet[11] = newIpParts[1];
    packet[12] = newIpParts[2];
    packet[13] = newIpParts[3];
    
    // Destination IP at offset 14-17
    const destIpParts = destinationIp.split('.').map(Number);
    packet[14] = destIpParts[0];
    packet[15] = destIpParts[1];
    packet[16] = destIpParts[2];
    packet[17] = destIpParts[3];
    
    // MAC address placeholder at offset 18-23 (zeros - LiDAR ignores this)
    // packet[18-23] already 0x00
    
    // MSOP port at offset 24-25 (big-endian)
    packet.writeUInt16BE(msopPort, 24);
    
    // DIFOP port at offset 26-27 (big-endian)
    packet.writeUInt16BE(difopPort, 26);
    
    // Fill rest with zeros (already done by Buffer.alloc)
    
    // Set marker at offset 0x2C (44) - seen in captures
    packet.writeUInt16LE(0x012C, 0x20);
    
    // Set 0xFF at offset 0xAB (171) - seen in captures  
    packet[0xAB] = 0xFF;
    packet[0xAC] = 0x0B;
    
    // Set 0x01 at offset 0xB5 (181) - seen in captures
    packet[0xB5] = 0x01;
    
    let timeout;
    let sent = false;
    
    socket.on('error', (err) => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error(`Socket error: ${err.message}`));
    });
    
    // Send the config packet
    socket.send(packet, 0, packet.length, LSLIDAR_CONFIG_PORT, currentIp, (err) => {
      if (err) {
        socket.close();
        reject(new Error(`Send error: ${err.message}`));
        return;
      }
      
      sent = true;
      console.log(`[LSLidar] Sent config packet to ${currentIp}:${LSLIDAR_CONFIG_PORT}`);
      console.log(`[LSLidar] New IP: ${newIp}, Destination: ${destinationIp}`);
      
      // Give LiDAR time to process
      timeout = setTimeout(() => {
        socket.close();
        resolve({
          success: true,
          message: `Configuration sent to ${currentIp}. LiDAR should reboot and appear at ${newIp}`,
          newIp,
          destinationIp,
        });
      }, 500);
    });
  });
}

export default {
  captureLslidarSnapshot,
  startLslidarStream,
  pointsToBuffer,
  configureLslidarIp,
  LSLIDAR_MSOP_PORT,
  LSLIDAR_DEST_PORT,
  LSLIDAR_CONFIG_PORT,
};
