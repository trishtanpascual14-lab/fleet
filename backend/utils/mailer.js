const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.MAIL_HOST;
  const port = parseInt(process.env.MAIL_PORT || '587', 10);
  const user = process.env.MAIL_USERNAME;
  const pass = process.env.MAIL_PASSWORD;
  if (!host || !user || !pass) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return transporter;
}

async function sendOtpEmail(to, otp, expiresMinutes = 5) {
  const fromAddr = process.env.MAIL_FROM_ADDRESS || process.env.MAIL_USERNAME || 'no-reply@fleet.local';
  const fromName = process.env.MAIL_FROM_NAME || 'Financial Management System';
  const transporterInst = getTransporter();

  const subject = 'Your Financial Management System OTP Verification Code';
  const html = `
  <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px">
    <div style="background:#6023d5;color:#fff;padding:16px 20px;border-radius:12px;text-align:center;margin-bottom:20px">
      <h1 style="margin:0;font-size:18px;font-weight:800">Financial Management System</h1>
      <p style="margin:4px 0 0;font-size:12px;opacity:0.9">Smart Fleet Distribution Management</p>
    </div>
    <p style="color:#334155;font-size:14px">Hello,</p>
    <p style="color:#334155;font-size:14px">Your OTP verification code is:</p>
    <div style="text-align:center;margin:20px 0">
      <span style="display:inline-block;letter-spacing:8px;font-size:28px;font-weight:800;color:#6023d5;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:12px 24px">${otp}</span>
    </div>
    <p style="color:#475569;font-size:13px">This code will expire in <strong>${expiresMinutes} minutes</strong>.</p>
    <p style="color:#475569;font-size:13px">If you did not request this verification code, please ignore this email.</p>
    <p style="color:#dc2626;font-size:12px;font-weight:600;margin-top:16px">Do not share this code with anyone. Our team will never ask for your OTP.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
    <p style="color:#94a3b8;font-size:11px;text-align:center">© ${new Date().getFullYear()} ${fromName}. This is an automated message, please do not reply.</p>
  </div>`;

  const text = `Financial Management System\n\nYour OTP verification code is: ${otp}\n\nThis code will expire in ${expiresMinutes} minutes.\nIf you did not request this verification code, please ignore this email.\nDo not share this code with anyone.`;

  if (!transporterInst) {
    // Dev fallback: log OTP to console when mail not configured
    console.log(`[OTP DEV] To: ${to} | OTP: ${otp} | Expires: ${expiresMinutes}m (MAIL not configured - set MAIL_HOST etc in .env)`);
    return { dev: true };
  }

  await transporterInst.sendMail({
    from: `"${fromName}" <${fromAddr}>`,
    to,
    subject,
    text,
    html,
  });
  return { dev: false };
}

module.exports = { sendOtpEmail, getTransporter };
