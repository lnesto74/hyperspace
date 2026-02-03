import { Router } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = join(__dirname, '..', 'uploads', 'logos');
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for logo upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const venueId = req.params.venueId || 'default';
    const ext = file.originalname.split('.').pop();
    cb(null, `logo-${venueId}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPEG, SVG, and WebP images are allowed'));
    }
  },
});

export default function createWhiteLabelRoutes(db) {
  const router = Router();

  // Get white label settings for a venue
  router.get('/venues/:venueId/white-label', (req, res) => {
    try {
      const { venueId } = req.params;
      
      const settings = db.prepare(`
        SELECT * FROM white_label_settings WHERE venue_id = ?
      `).get(venueId);
      
      if (!settings) {
        // Return defaults
        return res.json({
          venueId,
          logoUrl: null,
          logoWidth: 200,
          logoOpacity: 1,
          showBranding: true,
          primaryColor: '#3b82f6',
          accentColor: '#f59e0b',
        });
      }
      
      res.json({
        venueId: settings.venue_id,
        logoUrl: settings.logo_url,
        logoWidth: settings.logo_width,
        logoOpacity: settings.logo_opacity,
        showBranding: settings.show_branding === 1,
        primaryColor: settings.primary_color,
        accentColor: settings.accent_color,
      });
    } catch (err) {
      console.error('Failed to get white label settings:', err);
      res.status(500).json({ error: 'Failed to get white label settings' });
    }
  });

  // Update white label settings
  router.put('/venues/:venueId/white-label', (req, res) => {
    try {
      const { venueId } = req.params;
      const { logoWidth, logoOpacity, showBranding, primaryColor, accentColor } = req.body;
      
      db.prepare(`
        INSERT INTO white_label_settings (venue_id, logo_width, logo_opacity, show_branding, primary_color, accent_color, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(venue_id) DO UPDATE SET
          logo_width = excluded.logo_width,
          logo_opacity = excluded.logo_opacity,
          show_branding = excluded.show_branding,
          primary_color = excluded.primary_color,
          accent_color = excluded.accent_color,
          updated_at = datetime('now')
      `).run(venueId, logoWidth || 200, logoOpacity || 1, showBranding ? 1 : 0, primaryColor || '#3b82f6', accentColor || '#f59e0b');
      
      const settings = db.prepare(`SELECT * FROM white_label_settings WHERE venue_id = ?`).get(venueId);
      
      res.json({
        venueId: settings.venue_id,
        logoUrl: settings.logo_url,
        logoWidth: settings.logo_width,
        logoOpacity: settings.logo_opacity,
        showBranding: settings.show_branding === 1,
        primaryColor: settings.primary_color,
        accentColor: settings.accent_color,
      });
    } catch (err) {
      console.error('Failed to update white label settings:', err);
      res.status(500).json({ error: 'Failed to update white label settings' });
    }
  });

  // Upload logo
  router.post('/venues/:venueId/white-label/logo', upload.single('logo'), (req, res) => {
    try {
      const { venueId } = req.params;
      
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const logoUrl = `/api/uploads/logos/${req.file.filename}`;
      
      // Upsert settings with logo URL
      db.prepare(`
        INSERT INTO white_label_settings (venue_id, logo_url, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(venue_id) DO UPDATE SET
          logo_url = excluded.logo_url,
          updated_at = datetime('now')
      `).run(venueId, logoUrl);
      
      res.json({ logoUrl, filename: req.file.filename });
    } catch (err) {
      console.error('Failed to upload logo:', err);
      res.status(500).json({ error: 'Failed to upload logo' });
    }
  });

  // Delete logo
  router.delete('/venues/:venueId/white-label/logo', (req, res) => {
    try {
      const { venueId } = req.params;
      
      // Get current logo
      const settings = db.prepare(`SELECT logo_url FROM white_label_settings WHERE venue_id = ?`).get(venueId);
      
      if (settings?.logo_url) {
        // Delete file
        const filename = settings.logo_url.split('/').pop();
        const filepath = join(uploadsDir, filename);
        if (existsSync(filepath)) {
          unlinkSync(filepath);
        }
        
        // Clear logo URL
        db.prepare(`UPDATE white_label_settings SET logo_url = NULL, updated_at = datetime('now') WHERE venue_id = ?`).run(venueId);
      }
      
      res.json({ success: true });
    } catch (err) {
      console.error('Failed to delete logo:', err);
      res.status(500).json({ error: 'Failed to delete logo' });
    }
  });

  return router;
}
