import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { JWT_SECRET, requireAuth } from '../middleware/auth.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || 'ln@ulisse.tech';
const JWT_EXPIRES_IN = '7d';

export default function authRoutes(db) {
  const router = Router();
  const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

  // POST /api/auth/google — exchange Google ID token for JWT
  router.post('/google', async (req, res) => {
    try {
      const { credential } = req.body;
      if (!credential) {
        return res.status(400).json({ error: 'Google credential is required' });
      }

      // Verify the Google ID token
      let payload;
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload();
      } catch (verifyErr) {
        console.error('[Auth] Google token verification failed:', verifyErr.message);
        return res.status(401).json({ error: 'Invalid Google token' });
      }

      const { sub: googleId, email, name, picture } = payload;

      // Check if user is allowed (only superadmin email for now)
      const isSuperadmin = email.toLowerCase() === SUPERADMIN_EMAIL.toLowerCase();
      
      // Check if user exists in DB
      let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

      if (!user) {
        // Only allow superadmin to create account for now
        if (!isSuperadmin) {
          return res.status(403).json({ error: 'Access denied. Contact your administrator.' });
        }

        // Create new user
        const userId = uuidv4();
        const role = 'superadmin';
        db.prepare(`
          INSERT INTO users (id, email, name, picture, google_id, role, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(userId, email, name, picture, googleId, role);

        user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        console.log(`[Auth] Created superadmin user: ${email}`);
      } else {
        // Update name/picture/google_id on each login
        db.prepare(`
          UPDATE users SET name = ?, picture = ?, google_id = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(name, picture, googleId, user.id);

        // Ensure superadmin role is assigned if matching email
        if (isSuperadmin && user.role !== 'superadmin') {
          db.prepare('UPDATE users SET role = ? WHERE id = ?').run('superadmin', user.id);
          user.role = 'superadmin';
        }

        // Check if non-superadmin user is approved
        if (!isSuperadmin && user.role === 'pending') {
          return res.status(403).json({ error: 'Your account is pending approval.' });
        }
      }

      // Generate JWT
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          name: user.name || name,
          picture: user.picture || picture,
          role: user.role,
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name || name,
          picture: user.picture || picture,
          role: user.role,
        },
      });
    } catch (error) {
      console.error('[Auth] Login error:', error);
      res.status(500).json({ error: 'Authentication failed' });
    }
  });

  // GET /api/auth/me — get current user from JWT
  router.get('/me', requireAuth, (req, res) => {
    try {
      const user = db.prepare('SELECT id, email, name, picture, role, created_at FROM users WHERE id = ?').get(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ user });
    } catch (error) {
      console.error('[Auth] Get me error:', error);
      res.status(500).json({ error: 'Failed to get user info' });
    }
  });

  return router;
}
