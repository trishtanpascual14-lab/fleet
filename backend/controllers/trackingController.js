const db = require('../config/db');
const { createAuditLog, AUDIT_ACTIONS } = require('../utils/audit');

// POST /api/tracking/location  (IoT ingest — API key optional, open for devices)
exports.ingest = async (req, res) => {
  try {
    // accepts speed OR speed_kmh; driver_id optional (auto-filled from active trip when missing)
    const { vehicle_id, driver_id = null, trip_id = null, latitude, longitude, speed_kmh = null, speed = null, heading = null, status = null } = req.body;
    if (!vehicle_id || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: 'vehicle_id, latitude and longitude required' });
    }
    const [[v]] = await db.query('SELECT id FROM vehicles WHERE id=?', [vehicle_id]);
    if (!v) return res.status(404).json({ success: false, message: 'Vehicle not found' });
    const spd = speed_kmh !== null && speed_kmh !== undefined ? speed_kmh : (speed || 0);
    let drv = driver_id;
    let trp = trip_id;
    // never trust driver_id from a driver client — bind to the JWT identity
    if (req.user && req.user.role === 'driver') {
      if (!req.user.driver_id) return res.status(403).json({ success: false, message: 'No driver profile linked to this account' });
      drv = req.user.driver_id;
    }
    if (!drv || !trp) {
      const [[at]] = await db.query(
        "SELECT driver_id, id FROM trips WHERE vehicle_id=? AND trip_status IN ('Scheduled','Dispatched','In Transit') ORDER BY id DESC LIMIT 1", [vehicle_id]);
      if (at) { if (!drv) drv = at.driver_id; if (!trp) trp = at.id; }
    }
    if (!drv) {
      const [[d]] = await db.query('SELECT id FROM drivers WHERE assigned_vehicle_id=? LIMIT 1', [vehicle_id]);
      if (d) drv = d.id;
    }
    const [r] = await db.query(
      'INSERT INTO vehicle_locations (vehicle_id,driver_id,trip_id,latitude,longitude,speed_kmh,heading_deg,status) VALUES (?,?,?,?,?,?,?,?)',
      [vehicle_id, drv, trp, latitude, longitude, spd, heading === null || heading === undefined || heading === '' ? null : +heading, status]
    );
    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.TRACKING.LOCATION_INGESTED,
      module: 'tracking',
      recordId: r.insertId,
      newValues: { vehicle_id, driver_id: drv, trip_id: trp, latitude, longitude, speed_kmh: spd, heading_deg: heading, status }
    });
    // keep ACTIVE SOS in sync with live GPS — move SOS marker without refresh
    try {
      const io = req.app.get('io') || null;
      if (io) io.emit('tracking:location', { vehicle_id, driver_id: drv, trip_id: trp, latitude, longitude, speed_kmh: spd, status });
      const sosWhere = ['status=?'];
      const sosP = ['ACTIVE'];
      if (drv) { sosWhere.push('driver_id=?'); sosP.push(drv); }
      else { sosWhere.push('vehicle_id=?'); sosP.push(vehicle_id); }
      const [[activeSos]] = await db.query(`SELECT id FROM sos_alerts WHERE ${sosWhere.join(' AND ')} ORDER BY id DESC LIMIT 1`, sosP);
      if (activeSos) {
        await db.query('UPDATE sos_alerts SET latitude=?, longitude=? WHERE id=?', [latitude, longitude, activeSos.id]);
        const [[full]] = await db.query(
          `SELECT s.*, d.full_name AS driver_name, d.driver_code, v.vehicle_code, v.plate_number, v.status AS vehicle_status,
            t.trip_code, t.trip_status FROM sos_alerts s
           JOIN drivers d ON d.id=s.driver_id JOIN vehicles v ON v.id=s.vehicle_id
           LEFT JOIN trips t ON t.id=s.trip_id WHERE s.id=?`,
          [activeSos.id]
        );
        if (io && full) io.emit('sos:location-updated', full);
      }
    } catch (e) { console.error('sos live-sync failed:', e.message); }
    res.status(201).json({ success: true, message: 'Location recorded', data: { id: r.insertId } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to record location', error: e.message }); }
};

// GET /api/tracking/vehicles — latest location per vehicle + driver assignment
exports.vehicles = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT v.id, v.plate_number, v.vehicle_code, v.vehicle_type, v.fuel_type, v.status,
        (SELECT t.trip_code FROM trips t WHERE t.vehicle_id=v.id AND t.trip_status IN ('Scheduled','Dispatched','In Transit') ORDER BY t.id DESC LIMIT 1) AS current_trip,
        (SELECT t.id FROM trips t WHERE t.vehicle_id=v.id AND t.trip_status IN ('Scheduled','Dispatched','In Transit') ORDER BY t.id DESC LIMIT 1) AS current_trip_id,
        (SELECT t.driver_id FROM trips t WHERE t.vehicle_id=v.id AND t.trip_status IN ('Scheduled','Dispatched','In Transit') ORDER BY t.id DESC LIMIT 1) AS active_driver_id,
        COALESCE(ad.full_name, ld.full_name) AS driver_name,
        COALESCE(ad.contact_number, ld.contact_number) AS driver_contact,
        COALESCE(ad.id, ld.id) AS driver_id,
        l.id AS tracking_id, l.latitude, l.longitude, l.speed_kmh, l.recorded_at, l.status AS gps_status
       FROM vehicles v
       LEFT JOIN vehicle_locations l ON l.id=(SELECT MAX(id) FROM vehicle_locations WHERE vehicle_id=v.id)
       LEFT JOIN drivers ld ON ld.id=l.driver_id
       LEFT JOIN drivers ad ON ad.assigned_vehicle_id=v.id AND ad.status IN ('Assigned','On Trip')
       LEFT JOIN trips at ON at.id=(SELECT MAX(id) FROM trips WHERE vehicle_id=v.id AND trip_status IN ('Scheduled','Dispatched','In Transit'))
       LEFT JOIN drivers td ON td.id=at.driver_id
       ORDER BY v.id`
    );
    // prefer active-trip driver when present
    const [tripDrivers] = await db.query(
      `SELECT t.vehicle_id, d.id AS driver_id, d.full_name AS driver_name, d.contact_number AS driver_contact
       FROM trips t JOIN drivers d ON d.id=t.driver_id
       WHERE t.trip_status IN ('Scheduled','Dispatched','In Transit')`
    );
    const tdMap = {};
    for (const td of tripDrivers) tdMap[td.vehicle_id] = td;
    for (const r of rows) {
      const td = tdMap[r.id];
      if (td) { r.driver_id = td.driver_id; r.driver_name = td.driver_name; r.driver_contact = td.driver_contact; }
    }
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch tracking data' }); }
};

// GET /api/tracking/vehicle/:id
exports.history = async (req, res) => {
  try {
    // drivers may only read GPS history of their own assigned vehicle/trips
    if (req.user.role === 'driver') {
      if (!req.user.driver_id) return res.status(403).json({ success: false, message: 'No driver profile linked to this account' });
      const [[ok]] = await db.query(
        'SELECT 1 AS ok FROM drivers WHERE id=? AND assigned_vehicle_id=? UNION SELECT 1 FROM trips WHERE driver_id=? AND vehicle_id=? LIMIT 1',
        [req.user.driver_id, req.params.id, req.user.driver_id, req.params.id]);
      if (!ok) return res.status(403).json({ success: false, message: 'Forbidden: vehicle not assigned to this driver' });
    }
    const [rows] = await db.query(
      `SELECT l.*, l.id AS tracking_id, d.full_name AS driver_name FROM vehicle_locations l
       LEFT JOIN drivers d ON d.id=l.driver_id WHERE l.vehicle_id=? ORDER BY l.recorded_at DESC LIMIT 100`, [req.params.id]);
    const [[v]] = await db.query('SELECT * FROM vehicles WHERE id=?', [req.params.id]);
    let driver = null;
    if (v) {
      const [[at]] = await db.query(
        `SELECT d.id, d.full_name, d.contact_number FROM trips t JOIN drivers d ON d.id=t.driver_id
         WHERE t.vehicle_id=? AND t.trip_status IN ('Scheduled','Dispatched','In Transit') ORDER BY t.id DESC LIMIT 1`, [req.params.id]);
      driver = at || null;
    }
    res.json({ success: true, data: { vehicle: v || null, driver, history: rows } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch vehicle history' }); }
};

// POST /api/tracking/simulate — generate mock points for demo (no hardware needed)
exports.simulate = async (req, res) => {
  try {
    const [vehicles] = await db.query("SELECT id FROM vehicles WHERE status IN ('Dispatched','In Transit','Reserved')");
    const list = vehicles.length ? vehicles : await db.query('SELECT id FROM vehicles LIMIT 5').then((r) => r[0]);
    const base = [14.5995, 120.9842];
    let n = 0;
    for (const v of list) {
      const lat = base[0] + (Math.random() - 0.5) * 0.4;
      const lon = base[1] + (Math.random() - 0.5) * 0.4;
      const [[trip]] = await db.query("SELECT id FROM trips WHERE vehicle_id=? AND trip_status IN ('Dispatched','In Transit') ORDER BY id DESC LIMIT 1", [v.id]);
      await db.query('INSERT INTO vehicle_locations (vehicle_id,trip_id,latitude,longitude,speed_kmh,status) VALUES (?,?,?,?,?,?)',
        [v.id, trip ? trip.id : null, lat.toFixed(6), lon.toFixed(6), (20 + Math.random() * 60).toFixed(1), 'moving']);
      n++;
    }
    res.json({ success: true, message: `Simulated ${n} location updates`, data: { count: n } });
  } catch (e) { res.status(500).json({ success: false, message: 'Simulation failed', error: e.message }); }
};
