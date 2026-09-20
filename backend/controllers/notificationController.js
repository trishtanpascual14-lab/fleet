const db = require('../config/db');

exports.list = async (req, res) => {
  try {
    const { page = 1, limit = 30, unread = '' } = req.query;
    const where = ['1=1']; const p = [];
    // role-scoped visibility: user sees own + role + broadcast
    where.push('(target_role IN (?,?,?) OR user_id=?)');
    p.push('all', req.user.role, req.user.role === 'admin' ? 'admin' : req.user.role, req.user.id);
    if (unread === '1') where.push('is_read=0');
    const [[{ c }]] = await db.query(`SELECT COUNT(*) c FROM notifications WHERE ${where.join(' AND ')}`, p);
    const [[unreadRow]] = await db.query('SELECT COUNT(*) AS c FROM notifications WHERE is_read=0 AND (target_role IN (?,?,?) OR user_id=?)', p.slice(0));
    const u = unreadRow.c;
    const off = (Math.max(1, +page) - 1) * +limit;
    const [rows] = await db.query(`SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`, [...p, +limit, off]);
    res.json({ success: true, data: rows, unread: u, pagination: { total: c, page: +page, limit: +limit } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch notifications' }); }
};

exports.markRead = async (req, res) => {
  try { await db.query('UPDATE notifications SET is_read=1 WHERE id=?', [req.params.id]); res.json({ success: true, message: 'Marked as read' }); }
  catch (e) { res.status(500).json({ success: false, message: 'Failed to update notification' }); }
};

exports.markAll = async (req, res) => {
  try {
    await db.query('UPDATE notifications SET is_read=1 WHERE target_role IN (?,?,?) OR user_id=?', ['all', req.user.role, req.user.role, req.user.id]);
    res.json({ success: true, message: 'All marked as read' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to update notifications' }); }
};
