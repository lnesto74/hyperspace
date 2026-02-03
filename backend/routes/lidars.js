import { Router } from 'express';

export default function lidarsRoutes(connectionManager, tailscaleService, mockGenerator) {
  const router = Router();

  // Get all discovered LiDAR devices
  router.get('/', (req, res) => {
    const devices = tailscaleService.getDevices();
    const connectedIds = connectionManager.getConnectedDevices();
    
    // Enhance devices with connection status
    const enhanced = devices.map(device => ({
      ...device,
      connected: connectedIds.includes(device.id),
    }));

    res.json(enhanced);
  });

  // Get specific device status
  router.get('/:id/status', (req, res) => {
    const device = tailscaleService.getDeviceById(req.params.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const connectionStatus = connectionManager.getStatus(req.params.id);
    
    res.json({
      ...device,
      connection: connectionStatus,
    });
  });

  // Connect to a LiDAR device
  router.post('/:id/connect', async (req, res) => {
    try {
      const device = tailscaleService.getDeviceById(req.params.id);
      
      // In mock mode, simulate connection
      if (process.env.MOCK_LIDAR === 'true') {
        console.log(`🎭 Mock connecting to device ${req.params.id}`);
        return res.json({ 
          success: true, 
          message: 'Connected (mock mode)',
          mock: true,
        });
      }

      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      if (device.status !== 'online') {
        return res.status(400).json({ error: 'Device is offline' });
      }

      const result = await connectionManager.connect(req.params.id, device.tailscaleIp);
      res.json(result);
    } catch (error) {
      console.error('Connect error:', error);
      res.status(500).json({ error: 'Connection failed', message: error.message });
    }
  });

  // Disconnect from a LiDAR device
  router.post('/:id/disconnect', (req, res) => {
    try {
      // In mock mode, simulate disconnection
      if (process.env.MOCK_LIDAR === 'true') {
        console.log(`🎭 Mock disconnecting from device ${req.params.id}`);
        return res.json({ 
          success: true, 
          message: 'Disconnected (mock mode)',
          mock: true,
        });
      }

      const result = connectionManager.disconnect(req.params.id);
      res.json(result);
    } catch (error) {
      console.error('Disconnect error:', error);
      res.status(500).json({ error: 'Disconnect failed', message: error.message });
    }
  });

  return router;
}
