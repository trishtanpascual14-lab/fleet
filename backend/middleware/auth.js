const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'smartfleet_capstone_secret_2026');
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

// OTP temporarily disabled - requireFullAuth now just passes (no pre-auth tokens issued)
// Kept for future re-enable
function requireFullAuth(req, res, next) {
  // Previously blocked preAuth tokens; now all tokens are full auth
  // if (req.user && req.user.preAuth) return 403
  next();
}

// OTP temporarily disabled - kept for future
function requirePreAuth(req, res, next) {
  // if (!req.user || !req.user.preAuth) return 403
  return res.status(403).json({ success: false, message: 'OTP verification temporarily disabled' });
}

function normalizeRole(r) {
  if (!r) return '';
  const v = String(r).trim().toLowerCase();
  if (['super_admin','superadmin','system_admin','system administrator','administrator','admin'].includes(v)) return 'admin';
  if (['fleet_manager','fleet manager','fleet-manager','fleetmanager'].includes(v)) return 'fleet_manager';
  return v;
}
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const userRole = normalizeRole(req.user.role);
    const allowed = roles.map(normalizeRole);
    if (!allowed.includes(userRole)) {
      return res.status(403).json({ success: false, message: 'Forbidden: insufficient role' });
    }
    next();
  };
}

module.exports = { auth, authorize, requireFullAuth, requirePreAuth };
