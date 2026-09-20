const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');

const OTP_EXPIRES_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SEC = 60;

function generateOtp() {
  // secure 6-digit
  const n = crypto.randomInt(100000, 1000000);
  return String(n);
}

async function hashOtp(otp) {
  return bcrypt.hash(otp, 10);
}

async function compareOtp(otp, hash) {
  return bcrypt.compare(otp, hash);
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  if (local.length <= 1) return `*${'*'.repeat(5)}@${domain}`;
  const masked = local[0] + '*'.repeat(Math.min(6, local.length - 1));
  return `${masked}@${domain}`;
}

async function ensureOtpTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS otp_verifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      otp_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 5,
      verified_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_otp_user (user_id),
      INDEX idx_otp_expires (expires_at)
    ) ENGINE=InnoDB;
  `);
}

async function invalidatePreviousOtps(userId) {
  // expire any active OTPs
  await db.query(
    `UPDATE otp_verifications SET expires_at = NOW() WHERE user_id=? AND verified_at IS NULL AND expires_at > NOW()`,
    [userId]
  );
}

async function canResend(userId) {
  const [rows] = await db.query(
    `SELECT created_at FROM otp_verifications WHERE user_id=? AND verified_at IS NULL ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  if (!rows.length) return { allowed: true, remaining: 0 };
  const last = new Date(rows[0].created_at);
  const diff = (Date.now() - last.getTime()) / 1000;
  if (diff < OTP_RESEND_COOLDOWN_SEC) {
    return { allowed: false, remaining: Math.ceil(OTP_RESEND_COOLDOWN_SEC - diff) };
  }
  return { allowed: true, remaining: 0 };
}

async function createOtp(userId) {
  await ensureOtpTable();
  await invalidatePreviousOtps(userId);
  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  // Use DB server time to avoid timezone drift (UTC vs local)
  await db.query(
    `INSERT INTO otp_verifications (user_id, otp_hash, expires_at, attempts, max_attempts) VALUES (?,?, DATE_ADD(NOW(), INTERVAL ? MINUTE),?,?)`,
    [userId, otpHash, OTP_EXPIRES_MINUTES, 0, OTP_MAX_ATTEMPTS]
  );
  const [rows] = await db.query(`SELECT id, expires_at FROM otp_verifications WHERE user_id=? ORDER BY id DESC LIMIT 1`, [userId]);
  const expiresAt = new Date(rows[0].expires_at);
  return { otp, otpHash, record: rows[0], expiresAt };
}

async function getActiveOtp(userId) {
  await ensureOtpTable();
  const [rows] = await db.query(
    `SELECT * FROM otp_verifications WHERE user_id=? AND verified_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

module.exports = {
  OTP_EXPIRES_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SEC,
  generateOtp,
  hashOtp,
  compareOtp,
  maskEmail,
  ensureOtpTable,
  invalidatePreviousOtps,
  canResend,
  createOtp,
  getActiveOtp,
};
