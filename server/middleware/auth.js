// middleware/auth.js — JWT verification + role guards
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;

// ── Token verification ───────────────────────────────────────────────────────
export function requireAuth(userTypes = ['operator_user', 'client_user', 'employee']) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }
    const token = header.slice(7);
    try {
      const payload = jwt.verify(token, SECRET);

      if (!userTypes.includes(payload.userType)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      // Attach decoded payload for downstream handlers
      req.user = payload;

      // Build RLS context for db.query()
      req.dbCtx = {};
      if (payload.userType === 'operator_user') req.dbCtx.operatorId  = payload.operatorId;
      if (payload.userType === 'client_user')   req.dbCtx.clientId    = payload.clientId;
      if (payload.userType === 'employee')      req.dbCtx.employeeId  = payload.employeeId;

      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

// Convenience guards
export const requireOperator = requireAuth(['operator_user']);
export const requireClient   = requireAuth(['operator_user', 'client_user']);
export const requireEmployee = requireAuth(['operator_user', 'client_user', 'employee']);

// ── Client scope guard ───────────────────────────────────────────────────────
// Ensures the client_id in the URL param belongs to the authenticated operator.
export function scopeToClient(req, res, next) {
  const { clientId } = req.params;
  if (!clientId) return next();

  if (req.user.userType === 'operator_user') {
    // Operator can access any client — DB query will enforce ownership via RLS
    req.dbCtx.clientId = clientId;
    return next();
  }
  if (req.user.userType === 'client_user') {
    if (req.user.clientId !== clientId) {
      return res.status(403).json({ error: 'Access denied to this client' });
    }
    return next();
  }
  return res.status(403).json({ error: 'Insufficient permissions' });
}

// ── Token issuer ─────────────────────────────────────────────────────────────
export function issueToken(payload, expiresIn = process.env.JWT_EXPIRES_IN ?? '8h') {
  return jwt.sign(payload, SECRET, { expiresIn });
}
