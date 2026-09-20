const db = require('../config/db');
const { code } = require('../utils/helpers');
const { createAuditLog, auditRecordView, AUDIT_ACTIONS } = require('../utils/audit');

exports.list = async (req, res) => {
  try {
    const { search = '', status = '', page = 1, limit = 20, archived = '' } = req.query;
    const where = []; const p = [];
    if (archived === '1' || archived === 'true') where.push('d.archived_at IS NOT NULL');
    else if (archived === 'all') { /* no filter */ }
    else where.push('d.archived_at IS NULL');
    if (search) { where.push('(d.full_name LIKE ? OR d.license_number LIKE ? OR d.driver_code LIKE ? OR u.email LIKE ?)'); p.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    if (status) { where.push('d.status=?'); p.push(status); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [[{ c }]] = await db.query(`SELECT COUNT(*) c FROM drivers d LEFT JOIN users u ON u.id=d.user_id ${whereSql}`, p);
    const off = (Math.max(1, +page) - 1) * +limit;
    const [rows] = await db.query(
      `SELECT d.*, v.plate_number AS assigned_vehicle_plate,
        u.id AS user_account_id, u.name AS user_account_name, u.email AS user_email,
        u.role AS user_role, u.is_active AS user_is_active
       FROM drivers d
       LEFT JOIN vehicles v ON v.id=d.assigned_vehicle_id
       LEFT JOIN users u ON u.id=d.user_id
       ${whereSql} ORDER BY d.id DESC LIMIT ? OFFSET ?`,
      [...p, +limit, off]
    );
    res.json({ success: true, data: rows, pagination: { total: c, page: +page, limit: +limit } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch drivers', error: e.message }); }
};

// GET /api/drivers/eligible-users — active Driver-role users NOT yet linked to a driver profile.
exports.eligibleUsers = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 50 } = req.query;
    const where = ["u.role='driver'", 'u.is_active=1', 'u.archived_at IS NULL'];
    const p = [];
    where.push(`NOT EXISTS (SELECT 1 FROM drivers d WHERE d.user_id=u.id AND d.archived_at IS NULL)`);
    where.push(`(u.driver_id IS NULL OR NOT EXISTS (SELECT 1 FROM drivers d2 WHERE d2.id=u.driver_id AND d2.archived_at IS NULL))`);
    if (search) { where.push('(u.name LIKE ? OR u.email LIKE ?)'); p.push(`%${search}%`, `%${search}%`); }
    const [[{ c }]] = await db.query(`SELECT COUNT(*) c FROM users u WHERE ${where.join(' AND ')}`, p);
    const off = (Math.max(1, +page) - 1) * +limit;
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.phone, u.is_active, u.created_at
       FROM users u WHERE ${where.join(' AND ')} ORDER BY u.name ASC LIMIT ? OFFSET ?`,
      [...p, +limit, off]
    );
    res.json({ success: true, data: rows, pagination: { total: c, page: +page, limit: +limit } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch eligible driver accounts', error: e.message }); }
};

exports.available = async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM drivers WHERE status='Available' AND archived_at IS NULL ORDER BY full_name");
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch available drivers' }); }
};

exports.get = async (req, res) => {
  try {
    if (req.user.role === 'driver' && +req.params.id !== +req.user.driver_id) {
      return res.status(403).json({ success: false, message: 'Forbidden: another driver profile' });
    }
    const [[d]] = await db.query(
      `SELECT d.*, v.plate_number AS assigned_vehicle_plate,
        u.id AS user_account_id, u.name AS user_account_name, u.email AS user_email,
        u.role AS user_role, u.is_active AS user_is_active
       FROM drivers d LEFT JOIN vehicles v ON v.id=d.assigned_vehicle_id
       LEFT JOIN users u ON u.id=d.user_id WHERE d.id=?`, [req.params.id]);
    if (!d) return res.status(404).json({ success: false, message: 'Driver not found' });
    const [trips] = await db.query('SELECT trip_code,trip_status,delivery_status,pickup_location,destination,departure_datetime FROM trips WHERE driver_id=? ORDER BY id DESC LIMIT 20', [req.params.id]);
    auditRecordView(req, {
      module: 'drivers', resource: 'Driver', recordId: d.id,
      description: `Viewed driver ${d.full_name || `#${d.id}`}`,
      metadata: { full_name: d.full_name || null },
    });
    res.json({ success: true, data: { ...d, tripHistory: trips } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch driver' }); }
};

// GET /api/drivers/me — own driver profile for the logged-in driver account
exports.me = async (req, res) => {
  try {
    if (!req.user.driver_id) return res.status(404).json({ success: false, message: 'No driver profile linked to this account' });
    const [[d]] = await db.query(
      `SELECT d.*, v.plate_number AS assigned_vehicle_plate, v.vehicle_code AS assigned_vehicle_code,
        v.vehicle_type AS assigned_vehicle_type, v.fuel_type AS assigned_vehicle_fuel, v.status AS assigned_vehicle_status
       FROM drivers d LEFT JOIN vehicles v ON v.id=d.assigned_vehicle_id WHERE d.id=?`, [req.user.driver_id]);
    if (!d) return res.status(404).json({ success: false, message: 'Driver not found' });
    res.json({ success: true, data: d });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch driver profile' }); }
};

exports.create = async (req, res) => {
  try {
    let { full_name, contact_number = null, license_number, license_expiry = null, status = 'Available', assigned_vehicle_id = null, driver_code, user_id = null } = req.body;
    if (user_id !== null && user_id !== undefined && user_id !== '') {
      const [[u]] = await db.query('SELECT id,name,email,role,is_active,driver_id FROM users WHERE id=? AND archived_at IS NULL', [user_id]);
      if (!u) return res.status(400).json({ success: false, message: 'Selected user account does not exist' });
      if (u.role !== 'driver') return res.status(400).json({ success: false, message: 'Selected user is not a Driver account' });
      if (!u.is_active) return res.status(400).json({ success: false, message: 'Selected user account is deactivated' });
      const [[dup1]] = await db.query('SELECT id FROM drivers WHERE user_id=? AND archived_at IS NULL', [user_id]);
      if (dup1) return res.status(409).json({ success: false, message: 'This user account is already linked to a driver profile' });
      if (u.driver_id) {
        const [[dex]] = await db.query('SELECT id FROM drivers WHERE id=? AND archived_at IS NULL', [u.driver_id]);
        if (dex) return res.status(409).json({ success: false, message: 'This user account is already linked to a driver profile' });
      }
      full_name = u.name;
    }
    if (!full_name || !license_number) return res.status(400).json({ success: false, message: 'Full name and license number required' });
    const [r] = await db.query(
      'INSERT INTO drivers (driver_code,full_name,contact_number,license_number,license_expiry,status,assigned_vehicle_id,user_id) VALUES (?,?,?,?,?,?,?,?)',
      [driver_code || code('DRV'), full_name, contact_number, license_number, license_expiry || null, status, assigned_vehicle_id || null, user_id || null]
    );
    if (user_id) {
      await db.query('UPDATE users SET driver_id=? WHERE id=?', [r.insertId, user_id]);
    }
    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.DRIVERS.CREATED,
      module: 'drivers',
      recordId: r.insertId,
      newValues: { driver_code: driver_code || code('DRV'), full_name, contact_number, license_number, license_expiry, status, assigned_vehicle_id, user_id }
    });
    res.status(201).json({ success: true, message: 'Driver created', data: { id: r.insertId } });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Duplicate license number, driver code, or user account' });
    res.status(500).json({ success: false, message: 'Failed to create driver', error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const [[oldDriver]] = await db.query('SELECT * FROM drivers WHERE id=?', [req.params.id]);
    if (!oldDriver) return res.status(404).json({ success: false, message: 'Driver not found' });

    if (req.body.user_id !== undefined) {
      const newUid = req.body.user_id === '' ? null : req.body.user_id;
      const [[cur]] = await db.query('SELECT id,user_id FROM drivers WHERE id=?', [req.params.id]);
      if (!cur) return res.status(404).json({ success: false, message: 'Driver not found' });
      if (newUid !== cur.user_id) {
        if (cur.user_id) await db.query('UPDATE users SET driver_id=NULL WHERE id=? AND driver_id=?', [cur.user_id, req.params.id]);
        if (newUid) {
          const [[u]] = await db.query('SELECT id,role,is_active,driver_id FROM users WHERE id=? AND archived_at IS NULL', [newUid]);
          if (!u) return res.status(400).json({ success: false, message: 'Selected user account does not exist' });
          if (u.role !== 'driver') return res.status(400).json({ success: false, message: 'Selected user is not a Driver account' });
          if (!u.is_active) return res.status(400).json({ success: false, message: 'Selected user account is deactivated' });
          const [[dup]] = await db.query('SELECT id FROM drivers WHERE user_id=? AND id<>? AND archived_at IS NULL', [newUid, req.params.id]);
          if (dup) return res.status(409).json({ success: false, message: 'This user account is already linked to a driver profile' });
          if (u.driver_id && +u.driver_id !== +req.params.id) {
            const [[dex]] = await db.query('SELECT id FROM drivers WHERE id=? AND archived_at IS NULL', [u.driver_id]);
            if (dex) return res.status(409).json({ success: false, message: 'This user account is already linked to a driver profile' });
          }
          await db.query('UPDATE drivers SET user_id=? WHERE id=?', [newUid, req.params.id]);
          await db.query('UPDATE users SET driver_id=? WHERE id=?', [req.params.id, newUid]);
        } else {
          await db.query('UPDATE drivers SET user_id=NULL WHERE id=?', [req.params.id]);
        }
      }
    }
    const allowed = ['full_name', 'contact_number', 'license_number', 'license_expiry', 'status', 'assigned_vehicle_id', 'performance_rating'];
    const f = [], p = [];
    for (const k of allowed) if (req.body[k] !== undefined) { f.push(`${k}=?`); p.push(req.body[k] === '' ? null : req.body[k]); }
    if (!f.length && req.body.user_id !== undefined) {
      await createAuditLog({
        req,
        action: AUDIT_ACTIONS.DRIVERS.UPDATED,
        module: 'drivers',
        recordId: req.params.id,
        oldValues: oldDriver,
        newValues: { user_id: req.body.user_id }
      });
      return res.json({ success: true, message: 'Driver account link updated' });
    }
    if (!f.length) return res.status(400).json({ success: false, message: 'Nothing to update' });
    p.push(req.params.id);
    await db.query(`UPDATE drivers SET ${f.join(',')} WHERE id=? AND archived_at IS NULL`, p);

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.DRIVERS.UPDATED,
      module: 'drivers',
      recordId: req.params.id,
      oldValues: oldDriver,
      newValues: req.body
    });

    res.json({ success: true, message: 'Driver updated' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Duplicate license number' });
    res.status(500).json({ success: false, message: 'Failed to update driver', error: e.message });
  }
};

exports.archive = async (req, res) => {
  try {
    const [[oldDriver]] = await db.query('SELECT * FROM drivers WHERE id=?', [req.params.id]);
    if (!oldDriver) return res.status(404).json({ success: false, message: 'Driver not found' });

    const [[act]] = await db.query("SELECT COUNT(*) c FROM trips WHERE driver_id=? AND trip_status IN ('Scheduled','Dispatched','In Transit')", [req.params.id]);
    if (act.c > 0) return res.status(400).json({ success: false, message: 'Cannot archive driver with active trips' });
    await db.query('UPDATE users SET driver_id=NULL WHERE driver_id=?', [req.params.id]);
    const [r] = await db.query('UPDATE drivers SET archived_at=NOW() WHERE id=? AND archived_at IS NULL', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ success: false, message: 'Driver not found or already archived' });

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.DRIVERS.ARCHIVED,
      module: 'drivers',
      recordId: req.params.id,
      oldValues: oldDriver,
      newValues: { archived: true }
    });

    res.json({ success: true, message: 'Driver archived' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to archive driver', error: e.message }); }
};

exports.restore = async (req, res) => {
  try {
    const [[oldDriver]] = await db.query('SELECT * FROM drivers WHERE id=?', [req.params.id]);
    if (!oldDriver) return res.status(404).json({ success: false, message: 'Driver not found' });

    const [r] = await db.query('UPDATE drivers SET archived_at=NULL WHERE id=? AND archived_at IS NOT NULL', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ success: false, message: 'Driver not found or not archived' });

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.DRIVERS.RESTORED,
      module: 'drivers',
      recordId: req.params.id,
      oldValues: { archived: true },
      newValues: oldDriver
    });

    res.json({ success: true, message: 'Driver restored' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to restore driver' }); }
};

exports.remove = async (req, res) => { return exports.archive(req, res); };
