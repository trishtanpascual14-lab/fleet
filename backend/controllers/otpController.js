const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { compareOtp, canResend, createOtp, getActiveOtp, maskEmail, OTP_RESEND_COOLDOWN_SEC, OTP_EXPIRES_MINUTES } = require('../utils/otp');
const { sendOtpEmail } = require('../utils/mailer');

const JWT_SECRET = process.env.JWT_SECRET || 'smartfleet_capstone_secret_2026';
const PRE_AUTH_EXPIRES = process.env.JWT_PRE_AUTH_EXPIRES_IN || '10m';
const FINAL_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

// helpers: extract user id from pre-auth token (verified via auth middleware)
// For verify/resend we need to allow both pre-auth and also email in body as fallback for resend edge?
// But spec: prevent OTP verification for another user's account. So token-bound.

function formatExpires(iso) {
  return new Date(iso).toISOString();
}

exports.verifyOtp = async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.id) return res.status(401).json({ success: false, message: 'Unauthorized' });
    // must be pre-auth token
    if (!user.preAuth) {
      return res.status(400).json({ success: false, message: 'Already authenticated. Please login again if needed.' });
    }
    let { otp } = req.body || {};
    if (!otp) return res.status(400).json({ success: false, message: 'OTP is required' });
    otp = String(otp).trim().replace(/\s/g, '');
    if (!/^\d{6}$/.test(otp)) return res.status(400).json({ success: false, message: 'OTP must be exactly 6 digits' });

    const record = await getActiveOtp(user.id);
    if (!record) {
      return res.status(400).json({ success: false, message: 'OTP expired or not found. Please request a new code.' });
    }
    if (record.attempts >= record.max_attempts) {
      return res.status(429).json({ success: false, message: 'Maximum attempts exceeded. Please request a new OTP.' });
    }
    if (new Date(record.expires_at) <= new Date()) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new code.' });
    }

    const ok = await compareOtp(otp, record.otp_hash);
    if (!ok) {
      await db.query('UPDATE otp_verifications SET attempts = attempts + 1 WHERE id=?', [record.id]);
      const remaining = record.max_attempts - (record.attempts + 1);
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP code.',
        attemptsRemaining: Math.max(0, remaining),
      });
    }

    // mark verified
    await db.query('UPDATE otp_verifications SET verified_at = NOW(), attempts = attempts + 1 WHERE id=?', [record.id]);

    // fetch full user
    const [rows] = await db.query('SELECT id,name,email,role,driver_id,phone,is_active FROM users WHERE id=? AND is_active=1', [user.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });
    const fullUser = rows[0];

    const token = jwt.sign(
      { id: fullUser.id, email: fullUser.email, role: fullUser.role, name: fullUser.name, driver_id: fullUser.driver_id || null, otp_verified: true },
      JWT_SECRET,
      { expiresIn: FINAL_EXPIRES }
    );

    // invalidate other active otps
    await db.query('UPDATE otp_verifications SET expires_at = NOW() WHERE user_id=? AND verified_at IS NULL', [user.id]);

    return res.json({ success: true, message: 'OTP verified', data: { token, user: fullUser } });
  } catch (e) {
    console.error('verifyOtp error:', e);
    return res.status(500).json({ success: false, message: 'OTP verification failed' });
  }
};

exports.resendOtp = async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.id) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!user.preAuth) return res.status(400).json({ success: false, message: 'Already authenticated' });

    const check = await canResend(user.id);
    if (!check.allowed) {
      return res.status(429).json({ success: false, message: `Please wait ${check.remaining}s before resending.`, retryAfter: check.remaining });
    }

    const [uRows] = await db.query('SELECT email, name FROM users WHERE id=?', [user.id]);
    if (!uRows.length) return res.status(404).json({ success: false, message: 'User not found' });
    const email = uRows[0].email;

    const { otp, record } = await createOtp(user.id);
    try {
      await sendOtpEmail(email, otp, OTP_EXPIRES_MINUTES);
    } catch (mailErr) {
      console.error('Resend mail failed:', mailErr.message);
      // still return success - OTP generated, dev fallback logged
    }

    // issue new pre-auth token with fresh jti (to prevent old token reuse after resend? keep same user but rotate)
    const newPreToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name, driver_id: user.driver_id || null, preAuth: true, otp_required: true },
      JWT_SECRET,
      { expiresIn: PRE_AUTH_EXPIRES }
    );

    return res.json({
      success: true,
      message: 'OTP resent successfully',
      data: {
        preAuthToken: newPreToken,
        maskedEmail: maskEmail(email),
        expiresAt: formatExpires(record.expires_at),
        expiresIn: OTP_EXPIRES_MINUTES * 60,
      },
    });
  } catch (e) {
    console.error('resendOtp error:', e);
    return res.status(500).json({ success: false, message: 'Failed to resend OTP' });
  }
};

// Optional: status endpoint to get masked email + remaining time for polling
exports.otpStatus = async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.preAuth) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const record = await getActiveOtp(user.id);
    if (!record) return res.json({ success: true, data: { hasActive: false } });
    const remaining = Math.max(0, Math.floor((new Date(record.expires_at).getTime() - Date.now()) / 1000));
    return res.json({
      success: true,
      data: {
        hasActive: true,
        maskedEmail: maskEmail(user.email),
        expiresAt: formatExpires(record.expires_at),
        expiresIn: remaining,
        attempts: record.attempts,
        maxAttempts: record.max_attempts,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to load OTP status' });
  }
};
