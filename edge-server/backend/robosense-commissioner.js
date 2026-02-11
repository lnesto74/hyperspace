/**
 * RoboSense LiDAR IP Commissioner
 * 
 * RoboSense uses UDP protocol on port 7788 (DIFOP) for configuration.
 * The DIFOP packet contains device info and can be used to change settings.
 * 
 * Protocol (based on reverse engineering):
 * - DIFOP packets are broadcast on port 7788
 * - Configuration commands are sent to the LiDAR's IP on port 7788
 * - Packet starts with 0xA5 0xFF 0x00 0x5A header
 */

import dgram from 'dgram';
import http from 'http';

// RoboSense DIFOP port
const DIFOP_PORT = 7788;
const MSOP_PORT = 6699;

// Packet header for RoboSense
const RS_HEADER = Buffer.from([0xA5, 0xFF, 0x00, 0x5A]);
const RS_TAIL = Buffer.from([0x0F, 0xF0]);

/**
 * Listen for DIFOP packets to discover LiDAR info
 */
export function listenForDifop(timeout = 5000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const devices = [];
    
    socket.on('message', (msg, rinfo) => {
      console.log(`[RoboSense] Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
      
      // Check for RoboSense header
      if (msg.length >= 4 && msg[0] === 0xA5 && msg[1] === 0xFF) {
        const deviceInfo = parseDifopPacket(msg, rinfo.address);
        if (deviceInfo) {
          devices.push(deviceInfo);
          console.log(`[RoboSense] Found device:`, deviceInfo);
        }
      }
    });
    
    socket.on('error', (err) => {
      console.error('[RoboSense] Socket error:', err);
      socket.close();
      reject(err);
    });
    
    socket.bind(DIFOP_PORT, '0.0.0.0', () => {
      console.log(`[RoboSense] Listening for DIFOP packets on port ${DIFOP_PORT}...`);
    });
    
    setTimeout(() => {
      socket.close();
      resolve(devices);
    }, timeout);
  });
}

/**
 * Parse DIFOP packet to extract device info
 * 
 * Based on captured packet analysis:
 * Header:     a5ff005a (bytes 0-3)
 * Protocol:   11115555 0258 (bytes 4-9)
 * LiDAR IP:   c0a801c8 (bytes 10-13) = 192.168.1.200
 * Dest IP:    c0a80166 (bytes 14-17) = 192.168.1.102
 * MAC:        starts at byte 18
 */
function parseDifopPacket(buffer, sourceIp) {
  try {
    if (buffer.length < 24) {
      return { ip: sourceIp, raw: buffer.toString('hex').substring(0, 80) };
    }
    
    // Extract LiDAR IP (bytes 10-13)
    const lidarIp = `${buffer[10]}.${buffer[11]}.${buffer[12]}.${buffer[13]}`;
    
    // Extract Destination IP (bytes 14-17)
    const destIp = `${buffer[14]}.${buffer[15]}.${buffer[16]}.${buffer[17]}`;
    
    // Extract MAC (bytes 18-23)
    const mac = Array.from(buffer.slice(18, 24))
      .map(b => b.toString(16).padStart(2, '0'))
      .join(':');
    
    // Try to find MSOP/DIFOP ports (usually after MAC)
    let msopPort = 6699;
    let difopPort = 7788;
    if (buffer.length >= 28) {
      msopPort = buffer.readUInt16BE(24);
      difopPort = buffer.readUInt16BE(26);
    }
    
    return {
      ip: sourceIp,
      lidarIp,
      destIp,
      mac,
      msopPort,
      difopPort,
      packetLength: buffer.length,
      headerHex: buffer.slice(0, 30).toString('hex'),
    };
  } catch (err) {
    console.error('[RoboSense] Error parsing DIFOP:', err);
    return { ip: sourceIp, error: err.message };
  }
}

/**
 * Set LiDAR IP via HTTP POST to Parameter_Setting.html
 * Uses minimal form data that works (tested with curl)
 */
export async function setLidarIpViaHttp(currentIp, newIp, newDestIp = '192.168.1.102') {
  console.log(`[RoboSense] Attempting HTTP config: ${currentIp} -> ${newIp}`);
  
  // Use minimal form data that we know works from curl testing
  const formBody = `SrcIp=${newIp}&SrcMask=255.255.255.0&SrcGateWay=192.168.1.1&DstIp=${newDestIp}&MPort=6699&DPort=7788&save_param=Save`;
  
  return new Promise((resolve) => {
    const options = {
      hostname: currentIp,
      port: 80,
      path: '/Parameter_Setting.html',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formBody),
      },
      timeout: 30000, // 30 second timeout (LiDAR reboots)
    };
    
    console.log(`[RoboSense] Sending POST to ${currentIp}...`);
    
    const req = http.request(options, (res) => {
      console.log(`[RoboSense] Response status: ${res.statusCode}`);
      
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`[RoboSense] Config update complete`);
        resolve({ 
          success: true, 
          message: `IP changed from ${currentIp} to ${newIp}. LiDAR is rebooting.`,
          previousIp: currentIp,
          newIp,
          newDestIp,
        });
      });
    });
    
    req.on('error', (err) => {
      // Connection reset/timeout often means LiDAR is rebooting - that's success!
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'EPIPE') {
        console.log(`[RoboSense] LiDAR rebooting (${err.code}) - config likely applied`);
        resolve({ 
          success: true, 
          message: `IP change sent. LiDAR is rebooting to ${newIp}.`,
          previousIp: currentIp,
          newIp,
          newDestIp,
          rebootDetected: true,
        });
      } else {
        console.error('[RoboSense] Request error:', err.message);
        resolve({ success: false, message: err.message });
      }
    });
    
    req.on('timeout', () => {
      console.log(`[RoboSense] Request timeout - LiDAR likely rebooting`);
      req.destroy();
      resolve({ 
        success: true, 
        message: `IP change sent. LiDAR is rebooting to ${newIp}.`,
        previousIp: currentIp,
        newIp,
        newDestIp,
        rebootDetected: true,
      });
    });
    
    req.write(formBody);
    req.end();
  });
}

/**
 * Get current LiDAR network config via HTTP
 * RoboSense uses /setting_data.json endpoint
 */
export async function getLidarConfigViaHttp(ip) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`http://${ip}/setting_data.json`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      return { 
        success: true, 
        config: {
          deviceIp: data.SrcIp,
          deviceMask: data.SrcMask,
          deviceGateway: data.SrcGateWay,
          destinationIp: data.DstIp,
          msopPort: data.MPort,
          difopPort: data.DPort,
        },
        raw: data,
      };
    }
  } catch (err) {
    console.error('[RoboSense] Error getting config:', err.message);
  }
  
  return { success: false };
}

/**
 * Probe a specific IP for RoboSense LiDAR
 */
export function probeRoboSense(ip, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let found = false;
    
    socket.on('message', (msg, rinfo) => {
      if (!found && rinfo.address === ip) {
        found = true;
        const info = parseDifopPacket(msg, ip);
        socket.close();
        resolve({ found: true, ...info });
      }
    });
    
    socket.on('error', () => {
      socket.close();
      resolve({ found: false, ip });
    });
    
    // Bind to receive responses
    socket.bind(DIFOP_PORT + 1, () => {
      // Send a probe packet (empty or echo request)
      const probe = Buffer.from([0xA5, 0xFF, 0x00, 0x5A, 0x00, 0x00]);
      socket.send(probe, DIFOP_PORT, ip);
    });
    
    setTimeout(() => {
      if (!found) {
        socket.close();
        resolve({ found: false, ip });
      }
    }, timeout);
  });
}


// CLI test
if (process.argv[1].includes('robosense-commissioner')) {
  console.log('[RoboSense Commissioner] Starting discovery...');
  
  listenForDifop(10000).then(devices => {
    console.log('\n=== Discovery Complete ===');
    console.log(`Found ${devices.length} devices:`);
    devices.forEach((d, i) => {
      console.log(`\n[${i + 1}]`, JSON.stringify(d, null, 2));
    });
  }).catch(err => {
    console.error('Discovery failed:', err);
  });
}
