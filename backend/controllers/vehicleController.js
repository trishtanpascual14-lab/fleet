const db = require('../config/db');
const { code, notify } = require('../utils/helpers');
const { createAuditLog, auditRecordView, AUDIT_ACTIONS } = require('../utils/audit');
const { FUEL_TYPES: VEHICLE_FUEL_TYPES, isFuelType: isVehicleFuelType } = require('../utils/fuelTypes');

exports.list = async (req, res) => {
  try {
    const { search = '', status = '', page = 1, limit = 20, sort = 'id', order = 'DESC', archived = '' } = req.query;
    const where = []; const p = [];
    // Archive filter: by default show only active (archived_at IS NULL)
    if (archived === '1' || archived === 'true') where.push('archived_at IS NOT NULL');
    else if (archived === 'all') { /* no filter */ }
    else where.push('archived_at IS NULL');
    if (search) { where.push('(plate_number LIKE ? OR vehicle_code LIKE ? OR vehicle_type LIKE ?)'); p.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (status) { where.push('status=?'); p.push(status); }
    const safeSort = ['id', 'plate_number', 'vehicle_type', 'status', 'capacity'].includes(sort) ? sort : 'id';
    const safeOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [[{ c }]] = await db.query(`SELECT COUNT(*) c FROM vehicles ${whereSql}`, p);
    const off = (Math.max(1, +page) - 1) * +limit;
    const [rows] = await db.query(`SELECT * FROM vehicles ${whereSql} ORDER BY ${safeSort} ${safeOrder} LIMIT ? OFFSET ?`, [...p, +limit, off]);
    res.json({ success: true, data: rows, pagination: { total: c, page: +page, limit: +limit } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch vehicles', error: e.message }); }
};

exports.available = async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM vehicles WHERE status='Available' AND archived_at IS NULL ORDER BY plate_number");
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch available vehicles' }); }
};

exports.get = async (req, res) => {
  try {
    // drivers may only read their assigned vehicle (or one from their own trips)
    if (req.user.role === 'driver') {
      if (!req.user.driver_id) return res.status(403).json({ success: false, message: 'No driver profile linked to this account' });
      const [[ok]] = await db.query(
        'SELECT 1 AS ok FROM drivers WHERE id=? AND assigned_vehicle_id=? UNION SELECT 1 FROM trips WHERE driver_id=? AND vehicle_id=? LIMIT 1',
        [req.user.driver_id, req.params.id, req.user.driver_id, req.params.id]);
      if (!ok) return res.status(403).json({ success: false, message: 'Forbidden: vehicle not assigned to this driver' });
    }
    const [[v]] = await db.query('SELECT * FROM vehicles WHERE id=?', [req.params.id]);
    if (!v) return res.status(404).json({ success: false, message: 'Vehicle not found' });
    const [trips] = await db.query('SELECT trip_code,trip_status,delivery_status,pickup_location,destination FROM trips WHERE vehicle_id=? ORDER BY id DESC LIMIT 10', [req.params.id]);
    const [loc] = await db.query('SELECT * FROM vehicle_locations WHERE vehicle_id=? ORDER BY recorded_at DESC LIMIT 1', [req.params.id]);
    auditRecordView(req, {
      module: 'vehicles', resource: 'Vehicle', recordId: v.id,
      description: `Viewed vehicle ${v.plate_number || v.vehicle_code || `#${v.id}`}`,
      metadata: { plate_number: v.plate_number || null, vehicle_code: v.vehicle_code || null },
    });
    res.json({ success: true, data: { ...v, recentTrips: trips, lastLocation: loc[0] || null } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch vehicle' }); }
};

exports.create = async (req, res) => {
  try {
    const { plate_number, vehicle_type, fuel_type = 'Diesel', capacity = 0, registration_number = null, registration_expiry = null, status = 'Available', notes = null, vehicle_code } = req.body;
    if (!plate_number || !vehicle_type) return res.status(400).json({ success: false, message: 'Plate number and vehicle type required' });
    if (fuel_type && !isVehicleFuelType(fuel_type)) return res.status(400).json({ success: false, message: `Fuel type must be one of: ${VEHICLE_FUEL_TYPES.join(', ')}` });
    const [r] = await db.query(
      'INSERT INTO vehicles (vehicle_code,plate_number,vehicle_type,fuel_type,capacity,registration_number,registration_expiry,status,notes) VALUES (?,?,?,?,?,?,?,?,?)',
      [vehicle_code || code('VEH'), plate_number, vehicle_type, fuel_type || 'Diesel', capacity, registration_number, registration_expiry || null, status, notes]
    );
    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.VEHICLES.CREATED,
      module: 'vehicles',
      recordId: r.insertId,
      newValues: { vehicle_code: vehicle_code || code('VEH'), plate_number, vehicle_type, fuel_type: fuel_type || 'Diesel', capacity, registration_number, registration_expiry, status, notes }
    });
    await notify({ targetRole: 'fleet_manager', title: 'New vehicle added', message: `Vehicle ${plate_number} added to fleet`, linkType: 'vehicle', linkId: r.insertId });
    res.status(201).json({ success: true, message: 'Vehicle successfully created', data: { id: r.insertId } });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Duplicate plate number or vehicle code' });
    res.status(500).json({ success: false, message: 'Failed to create vehicle', error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    if (req.body.fuel_type !== undefined && req.body.fuel_type !== null && req.body.fuel_type !== '' && !isVehicleFuelType(req.body.fuel_type)) {
      return res.status(400).json({ success: false, message: `Fuel type must be one of: ${VEHICLE_FUEL_TYPES.join(', ')}` });
    }
    
    const [[oldVehicle]] = await db.query('SELECT * FROM vehicles WHERE id=?', [req.params.id]);
    if (!oldVehicle) return res.status(404).json({ success: false, message: 'Vehicle not found' });

    const allowed = ['plate_number', 'vehicle_type', 'fuel_type', 'capacity', 'registration_number', 'registration_expiry', 'status', 'notes'];
    const f = [], p = [];
    for (const k of allowed) if (req.body[k] !== undefined) { f.push(`${k}=?`); p.push(req.body[k] === '' ? null : req.body[k]); }
    if (!f.length) return res.status(400).json({ success: false, message: 'Nothing to update' });
    p.push(req.params.id);
    await db.query(`UPDATE vehicles SET ${f.join(',')} WHERE id=? AND archived_at IS NULL`, p);

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.VEHICLES.UPDATED,
      module: 'vehicles',
      recordId: req.params.id,
      oldValues: oldVehicle,
      newValues: req.body
    });

    if (req.body.status === 'Maintenance') await notify({ targetRole: 'fleet_manager', title: 'Vehicle under maintenance', message: `Vehicle #${req.params.id} set to Maintenance`, linkType: 'vehicle', linkId: +req.params.id });
    res.json({ success: true, message: 'Vehicle updated' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Duplicate plate number' });
    res.status(500).json({ success: false, message: 'Failed to update vehicle', error: e.message });
  }
};

// Archive (soft delete) - preserves history
exports.archive = async (req, res) => {
  try {
    const [[oldVehicle]] = await db.query('SELECT * FROM vehicles WHERE id=?', [req.params.id]);
    if (!oldVehicle) return res.status(404).json({ success: false, message: 'Vehicle not found' });

    const [[act]] = await db.query("SELECT COUNT(*) c FROM trips WHERE vehicle_id=? AND trip_status IN ('Scheduled','Dispatched','In Transit')", [req.params.id]);
    if (act.c > 0) return res.status(400).json({ success: false, message: 'Cannot archive vehicle with active trips' });
    const [r] = await db.query('UPDATE vehicles SET archived_at=NOW() WHERE id=? AND archived_at IS NULL', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ success: false, message: 'Vehicle not found or already archived' });

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.VEHICLES.ARCHIVED,
      module: 'vehicles',
      recordId: req.params.id,
      oldValues: oldVehicle,
      newValues: { archived: true }
    });

    res.json({ success: true, message: 'Vehicle archived' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to archive vehicle' }); }
};

exports.restore = async (req, res) => {
  try {
    const [[oldVehicle]] = await db.query('SELECT * FROM vehicles WHERE id=?', [req.params.id]);
    if (!oldVehicle) return res.status(404).json({ success: false, message: 'Vehicle not found' });

    const [r] = await db.query('UPDATE vehicles SET archived_at=NULL WHERE id=? AND archived_at IS NOT NULL', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ success: false, message: 'Vehicle not found or not archived' });

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.VEHICLES.RESTORED,
      module: 'vehicles',
      recordId: req.params.id,
      oldValues: { archived: true },
      newValues: oldVehicle
    });

    res.json({ success: true, message: 'Vehicle restored' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to restore vehicle' }); }
};

// Keep DELETE for backwards compatibility - now does soft archive
exports.remove = async (req, res) => {
  return exports.archive(req, res);
};

// POST /api/vehicles/:id/report — driver vehicle-status/problem report.
exports.report = async (req, res) => {
  try {
    const { status = null, description = '', latitude = null, longitude = null } = req.body;
    const [[v]] = await db.query('SELECT * FROM vehicles WHERE id=?', [req.params.id]);
    if (!v) return res.status(404).json({ success: false, message: 'Vehicle not found' });
    if (req.user.role === 'driver') {
      if (!req.user.driver_id) return res.status(403).json({ success: false, message: 'No driver profile linked to this account' });
      const [[ok]] = await db.query(
        'SELECT 1 AS ok FROM drivers WHERE id=? AND assigned_vehicle_id=? UNION SELECT 1 FROM trips WHERE driver_id=? AND vehicle_id=? LIMIT 1',
        [req.user.driver_id, req.params.id, req.user.driver_id, req.params.id]);
      if (!ok) return res.status(403).json({ success: false, message: 'Forbidden: vehicle not assigned to this driver' });
    }
    const valid = ['Available', 'In Use', 'Maintenance', 'Problem Reported'];
    if (status && !valid.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    const loc = latitude != null && longitude != null ? ` at ${latitude}, ${longitude}` : '';
    const { notify } = require('../utils/helpers');
    await notify({
      targetRole: 'fleet_manager',
      title: `Vehicle report: ${v.plate_number}`,
      message: `${req.user.name || 'Driver'} reported ${status || 'a problem'} for ${v.plate_number}${description ? ` — ${description}` : ''}${loc}`,
      linkType: 'vehicle', linkId: v.id,
    });
    res.status(201).json({ success: true, message: 'Report sent to fleet team' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to send report', error: e.message }); }
};
