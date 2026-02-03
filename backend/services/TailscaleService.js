import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const POLL_INTERVAL = parseInt(process.env.TAILSCALE_POLL_INTERVAL) || 30000;
const HOSTNAME_PATTERNS = ['concentrator', 'lidar', 'sensor', 'server'];
const SHOW_ALL_DEVICES = process.env.SHOW_ALL_TAILSCALE_DEVICES === 'true';

export class TailscaleService extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
    this.pollInterval = null;
    this.lastScanTime = null;
    this.isScanning = false;
  }

  async scan() {
    if (this.isScanning) {
      return { devices: this.getDevices(), cached: true };
    }

    this.isScanning = true;
    const startTime = Date.now();

    try {
      const { stdout } = await execAsync('tailscale status --json');
      const status = JSON.parse(stdout);
      
      const newDevices = new Map();

      // Process peers
      if (status.Peer) {
        for (const [id, peer] of Object.entries(status.Peer)) {
          // Check if hostname matches our patterns
          const hostname = peer.HostName?.toLowerCase() || '';
          const matchesPattern = HOSTNAME_PATTERNS.some(p => hostname.includes(p));
          
          // Show all devices if configured, otherwise filter by pattern
          if (SHOW_ALL_DEVICES || matchesPattern || peer.Tags?.includes('tag:lidar')) {
            const device = {
              id: id,
              hostname: peer.HostName || peer.DNSName?.split('.')[0] || 'unknown',
              ipAddress: peer.TailscaleIPs?.[0] || '',
              tailscaleIp: peer.TailscaleIPs?.[0] || '',
              status: peer.Online ? 'online' : 'offline',
              lastSeen: peer.LastSeen || new Date().toISOString(),
              os: peer.OS || '',
            };

            newDevices.set(id, device);

            // Check for status changes
            const existing = this.devices.get(id);
            if (!existing || existing.status !== device.status) {
              this.emit('device_status', device);
            }
          }
        }
      }

      this.devices = newDevices;
      this.lastScanTime = new Date().toISOString();
      
      const duration = Date.now() - startTime;
      console.log(`🔍 Tailscale scan complete: ${newDevices.size} devices found (${duration}ms)`);

      this.emit('scan_complete', {
        devices: this.getDevices(),
        scanTime: this.lastScanTime,
        duration,
      });

      return {
        devices: this.getDevices(),
        scanTime: this.lastScanTime,
        duration,
      };
    } catch (error) {
      console.error('❌ Tailscale scan failed:', error.message);
      
      // If tailscale command fails, return mock devices in mock mode
      if (process.env.MOCK_LIDAR === 'true') {
        return this.getMockDevices();
      }
      
      throw error;
    } finally {
      this.isScanning = false;
    }
  }

  getMockDevices() {
    const mockDevices = [
      {
        id: 'mock-lidar-001',
        hostname: 'concentrator-entrance',
        ipAddress: '100.64.0.101',
        tailscaleIp: '100.64.0.101',
        status: 'online',
        lastSeen: new Date().toISOString(),
        os: 'linux',
      },
      {
        id: 'mock-lidar-002',
        hostname: 'concentrator-checkout',
        ipAddress: '100.64.0.102',
        tailscaleIp: '100.64.0.102',
        status: 'online',
        lastSeen: new Date().toISOString(),
        os: 'linux',
      },
      {
        id: 'mock-lidar-003',
        hostname: 'lidar-aisle-1',
        ipAddress: '100.64.0.103',
        tailscaleIp: '100.64.0.103',
        status: 'offline',
        lastSeen: new Date(Date.now() - 3600000).toISOString(),
        os: 'linux',
      },
    ];

    mockDevices.forEach(d => this.devices.set(d.id, d));
    this.lastScanTime = new Date().toISOString();

    return {
      devices: mockDevices,
      scanTime: this.lastScanTime,
      duration: 0,
      mock: true,
    };
  }

  getDevices() {
    return Array.from(this.devices.values());
  }

  getDeviceById(id) {
    return this.devices.get(id);
  }

  getStatus() {
    return {
      devices: this.getDevices(),
      lastScanTime: this.lastScanTime,
      isScanning: this.isScanning,
      pollInterval: POLL_INTERVAL,
    };
  }

  startPolling() {
    if (this.pollInterval) return;
    
    console.log(`🔄 Starting Tailscale polling (every ${POLL_INTERVAL}ms)`);
    this.scan(); // Initial scan
    this.pollInterval = setInterval(() => this.scan(), POLL_INTERVAL);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('🛑 Tailscale polling stopped');
    }
  }
}
