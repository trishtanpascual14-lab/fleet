const db = require('../config/db');

// Central notification helper: creates notifications for roles and/or users.
async function notify({ userId = null, targetRole = 'all', title, message, linkType = 'none', linkId = null }) {
  try {
    await db.query(
      'INSERT INTO notifications (user_id, target_role, title, message, link_type, link_id) VALUES (?,?,?,?,?,?)',
      [userId, targetRole, title, message, linkType, linkId]
    );
  } catch (e) {
    console.error('notify failed:', e.message);
  }
}

function code(prefix) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const rand = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${rand}`;
}

module.exports = { notify, code };
