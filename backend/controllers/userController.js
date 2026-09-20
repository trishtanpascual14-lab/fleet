const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { createAuditLog, AUDIT_ACTIONS } = require('../utils/audit');

exports.list = async (req, res) => {
  try {
    const { search = '', role = '', active = '', page = 1, limit = 20, archived = '' } = req.query;
    const where = []; const p = [];
    if (archived === '1' || archived === 'true') where.push('u.archived_at IS NOT NULL');
    else if (archived === 'all') { /* no filter */ }
    else where.push('u.archived_at IS NULL');
    if (search) { where.push('(u.name LIKE ? OR u.email LIKE ?)'); p.push(`%${search}%`, `%${search}%`); }
    if (role) { where.push('u.role=?'); p.push(role); }
    if (active !== '') { where.push('u.is_active=?'); p.push(['1', 'true', 1, true].includes(active) ? 1 : 0); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [[{ c }]] = await db.query(`SELECT COUNT(*) c FROM users u ${whereSql}`, p);
    const off = (Math.max(1, +page) - 1) * +limit;
    const [rows] = await db.query(
      `SELECT u.id,u.name,u.email,u.role,u.driver_id,u.phone,u.is_active,u.created_at,u.archived_at,
        d.id AS driver_profile_id, d.driver_code AS driver_profile_code, d.status AS driver_profile_status
       FROM users u LEFT JOIN drivers d ON d.id=u.driver_id WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [...p, +limit, off]);
    res.json({ success: true, data: rows, pagination: { total: c, page: +page, limit: +limit } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch users', error: e.message }); }
};

exports.get = async (req, res) => {
  try {
    const [[u]] = await db.query(
      `SELECT u.id,u.name,u.email,u.role,u.driver_id,u.phone,u.is_active,u.created_at,u.archived_at,
        d.id AS driver_profile_id, d.driver_code AS driver_profile_code, d.status AS driver_profile_status,
        d.license_number AS driver_license_number
       FROM users u LEFT JOIN drivers d ON d.id=u.driver_id WHERE u.id=?`, [req.params.id]);
    if (!u) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: u });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch user', error: e.message }); }
};

exports.create = async (req, res) => {
  try {
    const { name, email, password, role = 'dispatcher', driver_id = null, phone = null } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Name, email and password required' });
    const hash = await bcrypt.hash(password, 10);
    const [r] = await db.query('INSERT INTO users (name,email,password,role,driver_id,phone) VALUES (?,?,?,?,?,?)', [name, email, hash, role, driver_id, phone]);
    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.USERS.CREATED,
      module: 'users',
      recordId: r.insertId,
      newValues: { name, email, role, driver_id, phone }
    });
    res.status(201).json({ success: true, message: 'User created', data: { id: r.insertId } });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Email already exists' });
    res.status(500).json({ success: false, message: 'Failed to create user', error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { name, role, phone, is_active, password, driver_id } = req.body;
    
    const [[oldUser]] = await db.query('SELECT name,email,role,phone,is_active,driver_id FROM users WHERE id=?', [req.params.id]);
    if (!oldUser) return res.status(404).json({ success: false, message: 'User not found' });

    const fields = [], p = [];
    if (name !== undefined) { fields.push('name=?'); p.push(name); }
    if (role !== undefined) { fields.push('role=?'); p.push(role); }
    if (phone !== undefined) { fields.push('phone=?'); p.push(phone); }
    if (is_active !== undefined) { fields.push('is_active=?'); p.push(is_active); }
    if (driver_id !== undefined) { fields.push('driver_id=?'); p.push(driver_id); }
    if (password) { fields.push('password=?'); p.push(await bcrypt.hash(password, 10)); }
    if (!fields.length) return res.status(400).json({ success: false, message: 'Nothing to update' });
    p.push(req.params.id);
    await db.query(`UPDATE users SET ${fields.join(',')} WHERE id=? AND archived_at IS NULL`, p);

    const newValues = { name, role, phone, is_active, driver_id };
    if (password) newValues.password = '[REDACTED]';

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.USERS.UPDATED,
      module: 'users',
      recordId: req.params.id,
      oldValues: oldUser,
      newValues
    });

    res.json({ success: true, message: 'User updated' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to update user', error: e.message }); }
};

exports.archive = async (req, res) => {
  try {
    const [[oldUser]] = await db.query('SELECT name,email,role,phone,is_active,driver_id FROM users WHERE id=?', [req.params.id]);
    if (!oldUser) return res.status(404).json({ success: false, message: 'User not found' });

    const [r] = await db.query('UPDATE users SET archived_at=NOW() WHERE id=? AND archived_at IS NULL', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ success: false, message: 'User not found or already archived' });

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.USERS.ARCHIVED,
      module: 'users',
      recordId: req.params.id,
      oldValues: oldUser,
      newValues: { archived: true }
    });

    res.json({ success: true, message: 'User archived' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to archive user', error: e.message }); }
};

exports.restore = async (req, res) => {
  try {
    const [[oldUser]] = await db.query('SELECT name,email,role,phone,is_active,driver_id FROM users WHERE id=?', [req.params.id]);
    if (!oldUser) return res.status(404).json({ success: false, message: 'User not found' });

    const [r] = await db.query('UPDATE users SET archived_at=NULL WHERE id=? AND archived_at IS NOT NULL', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ success: false, message: 'User not found or not archived' });

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.USERS.RESTORED,
      module: 'users',
      recordId: req.params.id,
      oldValues: { archived: true },
      newValues: oldUser
    });

    res.json({ success: true, message: 'User restored' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to restore user' }); }
};

exports.remove = async (req, res) => { return exports.archive(req, res); };
