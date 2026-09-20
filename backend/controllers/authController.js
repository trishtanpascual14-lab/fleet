const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createAuditLog, AUDIT_ACTIONS } = require('../utils/audit');
// OTP temporarily disabled - kept for future re-enable
// const { createOtp, maskEmail, OTP_EXPIRES_MINUTES } = require('../utils/otp');
// const { sendOtpEmail } = require('../utils/mailer');

const JWT_SECRET = process.env.JWT_SECRET || 'smartfleet_capstone_secret_2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// in-memory login rate limiting (per IP + email)
const loginAttempts = new Map();
function checkLoginRateLimit(key) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const max = 10;
  let entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + windowMs };
  entry.count += 1;
  loginAttempts.set(key, entry);
  if (entry.count > max) {
    const retry = Math.ceil((entry.resetAt - now) / 1000);
    return { limited: true, retryAfter: retry };
  }
  return { limited: false };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts.entries()) if (now > v.resetAt) loginAttempts.delete(k);
}, 60 * 1000).unref();

exports.login = async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });
    email = String(email).trim().toLowerCase();
    password = String(password);

    // basic sanitization / validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 3 || password.length > 128) {
      return res.status(400).json({ success: false, message: 'Invalid email or password' });
    }

    // rate limiting per IP + email (prevent brute force)
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const rlKey = `${ip}:${email}`;
    const rl = checkLoginRateLimit(rlKey);
    if (rl.limited) {
      return res.status(429).json({ success: false, message: `Too many login attempts. Try again in ${rl.retryAfter}s.`, retryAfter: rl.retryAfter });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE email=? AND is_active=1', [email]);
    if (!rows.length) {
      await createAuditLog({
        req,
        action: AUDIT_ACTIONS.AUTH.LOGIN_FAILED,
        module: 'auth',
        newValues: { email, reason: 'user_not_found' }
      });
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      await createAuditLog({
        req,
        action: AUDIT_ACTIONS.AUTH.LOGIN_FAILED,
        module: 'auth',
        newValues: { email, reason: 'invalid_password' }
      });
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // OTP temporarily disabled - direct authentication
    // Fetch full user record for token payload
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name, driver_id: user.driver_id || null },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Return user without password
    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      driver_id: user.driver_id || null,
      phone: user.phone,
      is_active: user.is_active,
    };

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.AUTH.LOGIN_SUCCESS,
      module: 'auth',
      recordId: user.id,
      newValues: { email: user.email, role: user.role }
    });

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: safeUser,
      },
    });
  } catch (e) {
    console.error('Login failed:', e);
    res.status(500).json({ success: false, message: 'Login failed', error: e.message });
  }
};

exports.me = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id,name,email,role,driver_id,phone,is_active FROM users WHERE id=?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to load profile' }); }
};

exports.logout = async (req, res) => {
  await createAuditLog({
    req,
    action: AUDIT_ACTIONS.AUTH.LOGOUT,
    module: 'auth',
    recordId: req.user?.id || null,
    newValues: { email: req.user?.email }
  });
  res.json({ success: true, message: 'Logged out' });
};
