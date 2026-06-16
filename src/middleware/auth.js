import { verify } from '../lib/jwt.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing bearer token' });
  }
  try {
    const decoded = verify(header.slice(7));
    req.auth = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'unauthenticated' });
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}
