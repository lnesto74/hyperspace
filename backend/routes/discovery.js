import { Router } from 'express';

export default function discoveryRoutes(tailscaleService, mockGenerator) {
  const router = Router();

  // Trigger a network scan
  router.get('/scan', async (req, res) => {
    try {
      const result = await tailscaleService.scan();
      res.json(result);
    } catch (error) {
      console.error('Scan error:', error);
      res.status(500).json({ 
        error: 'Scan failed', 
        message: error.message,
        devices: [],
      });
    }
  });

  // Get cached device status
  router.get('/status', (req, res) => {
    const status = tailscaleService.getStatus();
    res.json(status);
  });

  // Get specific device
  router.get('/devices/:id', (req, res) => {
    const device = tailscaleService.getDeviceById(req.params.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    res.json(device);
  });

  return router;
}
