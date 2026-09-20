const db = require('../config/db');
const { createAuditLog, AUDIT_ACTIONS } = require('../utils/audit');

function ioOf(req) {
  try { return req.app.get('io') || null; } catch { return null; }
}

function normalizeRole(r) {
  if (!r) return '';
  const v = String(r).trim().toLowerCase();
  if (['super_admin','superadmin','system_admin','system administrator','administrator','admin'].includes(v)) return 'admin';
  if (['fleet_manager','fleet manager','fleet-manager','fleetmanager'].includes(v)) return 'fleet_manager';
  return v;
}
async function enriched(list) {
  return list;
}

// GET /api/sos?status=ACTIVE|RESOLVED|CANCELLED|ALL
exports.list = async (req, res) => {
  try {
    const { status = 'ALL' } = req.query;
    const where = ['1=1'];
    const p = [];
    if (normalizeRole(req.user.role) === 'driver') {
      if (!req.user.driver_id) return res.json({ success: true, data: [] });
      where.push('s.driver_id=?');
      p.push(req.user.driver_id);
    }
    if (status && status !== 'ALL') {
      where.push('s.status=?');
      p.push(status);
    }
    const [rows] = await db.query(
      `SELECT s.*, d.full_name AS driver_name, d.driver_code, d.contact_number AS driver_contact,
        v.vehicle_code, v.plate_number, v.status AS vehicle_status,
        t.trip_code, t.trip_status, t.pickup_location, t.destination,
        u.name AS resolved_by_name
       FROM sos_alerts s
       JOIN drivers d ON d.id=s.driver_id
       JOIN vehicles v ON v.id=s.vehicle_id
       LEFT JOIN trips t ON t.id=s.trip_id
       LEFT JOIN users u ON u.id=s.resolved_by
       WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT 100`,
      p
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch SOS alerts', error: e.message }); }
};

// GET /api/sos/:id
exports.get = async (req, res) => {
  try {
    const [[s]] = await db.query(
      `SELECT s.*, d.full_name AS driver_name, d.driver_code, d.contact_number AS driver_contact,
        v.vehicle_code, v.plate_number, v.status AS vehicle_status,
        t.trip_code, t.trip_status, t.pickup_location, t.destination,
        u.name AS resolved_by_name
       FROM sos_alerts s
       JOIN drivers d ON d.id=s.driver_id
       JOIN vehicles v ON v.id=s.vehicle_id
       LEFT JOIN trips t ON t.id=s.trip_id
       LEFT JOIN users u ON u.id=s.resolved_by
       WHERE s.id=?`,
      [req.params.id]
    );
    if (!s) return res.status(404).json({ success: false, message: 'SOS not found' });
    if (normalizeRole(req.user.role) === 'driver' && s.driver_id !== req.user.driver_id) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.SOS.VIEWED,
      module: 'sos',
      recordId: req.params.id,
      newValues: { sos_id: req.params.id }
    });
    res.json({ success: true, data: s });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch SOS', error: e.message }); }
};

// POST /api/sos  { latitude, longitude, trip_id? } — driver only, auto-captures rest
exports.create = async (req, res) => {
  try {
    if (normalizeRole(req.user.role) !== 'driver') {
      return res.status(403).json({ success: false, message: 'Only drivers can trigger SOS' });
    }
    if (!req.user.driver_id) return res.status(403).json({ success: false, message: 'No driver profile linked' });
    const driverId = req.user.driver_id;
    let { latitude, longitude, trip_id = null } = req.body;

    // block duplicate ACTIVE SOS per driver — return existing
    const [[existing]] = await db.query(
      `SELECT s.*, d.full_name AS driver_name, v.vehicle_code, v.plate_number, t.trip_code
       FROM sos_alerts s JOIN drivers d ON d.id=s.driver_id
       JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN trips t ON t.id=s.trip_id
       WHERE s.driver_id=? AND s.status='ACTIVE' ORDER BY s.id DESC LIMIT 1`,
      [driverId]
    );
    if (existing) return res.status(200).json({ success: true, message: 'SOS already active', data: existing, duplicate: true });

    // resolve active trip / vehicle automatically
    const [[trip]] = await db.query(
      `SELECT t.*, v.status AS vehicle_status FROM trips t JOIN vehicles v ON v.id=t.vehicle_id
       WHERE t.driver_id=? AND t.trip_status IN ('Scheduled','Dispatched','In Transit','Arrived')
       ORDER BY t.id DESC LIMIT 1`,
      [driverId]
    );
    let vehicleId = trip ? trip.vehicle_id : null;
    let tripId = trip_id || (trip ? trip.id : null);
    if (!vehicleId) {
      const [[d]] = await db.query('SELECT assigned_vehicle_id FROM drivers WHERE id=?', [driverId]);
      vehicleId = d ? d.assigned_vehicle_id : null;
    }
    if (!vehicleId) return res.status(400).json({ success: false, message: 'No active trip or assigned vehicle found' });

    // fallback to latest known GPS if client sent none (never invent coordinates)
    if (latitude === undefined || longitude === undefined || latitude === '' || longitude === '') {
      const [[last]] = await db.query(
        'SELECT latitude, longitude FROM vehicle_locations WHERE vehicle_id=? ORDER BY id DESC LIMIT 1',
        [vehicleId]
      );
      if (!last) return res.status(400).json({ success: false, message: 'Current location unavailable — enable GPS and try again' });
      latitude = last.latitude;
      longitude = last.longitude;
    }

    const [[drv]] = await db.query('SELECT full_name FROM drivers WHERE id=?', [driverId]);
    const [[veh]] = await db.query('SELECT vehicle_code, plate_number FROM vehicles WHERE id=?', [vehicleId]);
    let tripCode = null;
    if (tripId) {
      const [[t]] = await db.query('SELECT trip_code FROM trips WHERE id=?', [tripId]);
      tripCode = t ? t.trip_code : null;
    } else if (trip) tripCode = trip.trip_code;

    const [r] = await db.query(
      'INSERT INTO sos_alerts (driver_id, vehicle_id, trip_id, latitude, longitude, status) VALUES (?,?,?,?,?,?)',
      [driverId, vehicleId, tripId, latitude, longitude, 'ACTIVE']
    );

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.SOS.TRIGGERED,
      module: 'sos',
      recordId: r.insertId,
      newValues: { driver_id: driverId, vehicle_id: vehicleId, trip_id: tripId, latitude, longitude, status: 'ACTIVE' }
    });

    const [[sos]] = await db.query(
      `SELECT s.*, d.full_name AS driver_name, d.driver_code, v.vehicle_code, v.plate_number, v.status AS vehicle_status,
        t.trip_code, t.trip_status FROM sos_alerts s
       JOIN drivers d ON d.id=s.driver_id JOIN vehicles v ON v.id=s.vehicle_id
       LEFT JOIN trips t ON t.id=s.trip_id WHERE s.id=?`,
      [r.insertId]
    );

    // notify admin / fleet_manager / dispatcher (reuse existing notifications table)
    const title = '🚨 SOS ALERT';
    const timeStr = new Date(sos.triggered_at || Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const msg = `Driver: ${sos.driver_name} | Vehicle: ${sos.plate_number || sos.vehicle_code} | Trip: ${sos.trip_code || (tripId ? `#${tripId}` : '—')} — Emergency alert received. Location: ${sos.latitude}, ${sos.longitude}. Time: ${timeStr}`;
    for (const role of ['admin', 'fleet_manager', 'dispatcher']) {
      await db.query(
        'INSERT INTO notifications (user_id, target_role, title, message, link_type, link_id) VALUES (NULL,?,?,?,?,?)',
        [role, title, msg, 'sos', r.insertId]
      );
    }

    const io = ioOf(req);
    if (io) {
      io.to('role:admin').to('role:fleet_manager').to('role:dispatcher').emit('sos:created', sos);
      io.emit('notifications:updated', { link_type: 'sos', link_id: r.insertId });
    }

    res.status(201).json({ success: true, message: 'SOS sent', data: sos });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to send SOS', error: e.message }); }
};

// PATCH /api/sos/:id/resolve — admin / fleet_manager / dispatcher
exports.resolve = async (req, res) => {
  try {
    if (!['admin', 'fleet_manager', 'dispatcher'].includes(normalizeRole(req.user.role))) {
      return res.status(403).json({ success: false, message: 'Forbidden: insufficient role' });
    }
    const [[s]] = await db.query('SELECT * FROM sos_alerts WHERE id=?', [req.params.id]);
    if (!s) return res.status(404).json({ success: false, message: 'SOS not found' });
    await db.query("UPDATE sos_alerts SET status='RESOLVED', resolved_at=NOW(), resolved_by=? WHERE id=?", [req.user.id, req.params.id]);

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.SOS.RESOLVED,
      module: 'sos',
      recordId: req.params.id,
      oldValues: { status: s.status },
      newValues: { status: 'RESOLVED', resolved_by: req.user.id }
    });

    const [[updated]] = await db.query(
      `SELECT s.*, d.full_name AS driver_name, v.vehicle_code, v.plate_number, t.trip_code, u.name AS resolved_by_name
       FROM sos_alerts s JOIN drivers d ON d.id=s.driver_id JOIN vehicles v ON v.id=s.vehicle_id
       LEFT JOIN trips t ON t.id=s.trip_id LEFT JOIN users u ON u.id=s.resolved_by WHERE s.id=?`,
      [req.params.id]
    );
    const io = ioOf(req);
    if (io) { io.emit('sos:resolved', updated); io.emit('notifications:updated', { link_type: 'sos', link_id: +req.params.id }); }
    res.json({ success: true, message: 'SOS resolved', data: updated || { id: +req.params.id } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to resolve SOS', error: e.message }); }
};

// PATCH /api/sos/:id/cancel — driver (own) or MD roles
exports.cancel = async (req, res) => {
  try {
    const [[s]] = await db.query('SELECT * FROM sos_alerts WHERE id=?', [req.params.id]);
    if (!s) return res.status(404).json({ success: false, message: 'SOS not found' });
    if (normalizeRole(req.user.role) === 'driver' && s.driver_id !== req.user.driver_id) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (!['admin', 'fleet_manager', 'dispatcher', 'driver'].includes(normalizeRole(req.user.role))) {
      return res.status(403).json({ success: false, message: 'Forbidden: insufficient role' });
    }
    await db.query("UPDATE sos_alerts SET status='CANCELLED', resolved_at=NOW(), resolved_by=? WHERE id=?", [req.user.id, req.params.id]);

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.SOS.CANCELLED,
      module: 'sos',
      recordId: req.params.id,
      oldValues: { status: s.status },
      newValues: { status: 'CANCELLED', cancelled_by: req.user.id }
    });

    const io = ioOf(req);
    if (io) io.emit('sos:cancelled', { id: +req.params.id });
    res.json({ success: true, message: 'SOS cancelled' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to cancel SOS', error: e.message }); }
};
