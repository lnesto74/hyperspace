import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'hyperspace-dev-secret-change-in-production';

/**
 * Auth middleware — verifies JWT token from Authorization header.
 * Attaches req.user = { id, email, name, role }
 * If no token or invalid, returns 401.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Superadmin-only middleware — must be used AFTER requireAuth.
 */
export function requireSuperadmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
}

/**
 * Optional auth — attaches req.user if token present, but doesn't block.
 * Useful for routes that work for both authenticated and unauthenticated users.
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    // Invalid token, just proceed without user
  }
  next();
}

export { JWT_SECRET };
