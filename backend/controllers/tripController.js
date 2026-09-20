const db = require('../config/db');
const { code, notify } = require('../utils/helpers');
const { calculateRoute } = require('../utils/routeService');
const { createAuditLog, auditRecordView, AUDIT_ACTIONS } = require('../utils/audit');

const ACTIVE = "trip_status IN ('Scheduled','Dispatched','In Transit')";

async function refreshDriverStats(conn, driverId) {
  const [[t]] = await conn.query('SELECT COUNT(*) c FROM trips WHERE driver_id=?', [driverId]);
  const [[c]] = await conn.query("SELECT COUNT(*) c FROM trips WHERE driver_id=? AND trip_status='Completed'", [driverId]);
  const rating = t.c ? +((c.c / t.c) * 5).toFixed(2) : 0;
  await conn.query('UPDATE drivers SET total_trips=?, completed_trips=?, performance_rating=? WHERE id=?', [t.c, c.c, rating, driverId]);
}

exports.list = async (req, res) => {
  try {
    const { search = '', status = '', page = 1, limit = 20, archived = '' } = req.query;
    const where = []; const p = [];
    if (archived === '1' || archived === 'true') where.push('t.archived_at IS NOT NULL');
    else if (archived === 'all') { /* no filter */ }
    else where.push('t.archived_at IS NULL');
    if (search) { where.push('(t.trip_code LIKE ? OR t.pickup_location LIKE ? OR t.destination LIKE ?)'); p.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (status) { where.push('t.trip_status=?'); p.push(status); }
    if (req.user.role === 'driver') {
      if (!req.user.driver_id) return res.json({ success: true, data: [], pagination: { total: 0, page: 1, limit: +limit } });
      where.push('t.driver_id=?'); p.push(req.user.driver_id);
    }
    const [[{ c }]] = await db.query(`SELECT COUNT(*) c FROM trips t WHERE ${where.join(' AND ')}`, p);
    const off = (Math.max(1, +page) - 1) * +limit;
    const [rows] = await db.query(
      `SELECT t.*, v.plate_number, v.vehicle_type, d.full_name AS driver_name
       FROM trips t JOIN vehicles v ON v.id=t.vehicle_id JOIN drivers d ON d.id=t.driver_id
       WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT ? OFFSET ?`, [...p, +limit, off]);
    res.json({ success: true, data: rows, pagination: { total: c, page: +page, limit: +limit } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch trips', error: e.message }); }
};

exports.myTrips = async (req, res) => {
  try {
    if (!req.user.driver_id) return res.json({ success: true, data: [] });
    const [rows] = await db.query(
      `SELECT t.*, v.plate_number, v.vehicle_type, d.full_name AS driver_name FROM trips t
       JOIN vehicles v ON v.id=t.vehicle_id JOIN drivers d ON d.id=t.driver_id
       WHERE t.driver_id=? ORDER BY t.id DESC`, [req.user.driver_id]);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch my trips' }); }
};

exports.get = async (req, res) => {
  try {
    const [[t]] = await db.query(
      `SELECT t.*, v.plate_number, v.vehicle_type, v.fuel_type AS vehicle_fuel_type, d.full_name AS driver_name,
        r.route_code, r.origin AS route_origin, r.destination AS route_destination,
        r.origin_lat, r.origin_lng, r.destination_lat, r.destination_lng FROM trips t
       JOIN vehicles v ON v.id=t.vehicle_id JOIN drivers d ON d.id=t.driver_id LEFT JOIN routes r ON r.id=t.route_id WHERE t.id=?`, [req.params.id]);
    if (!t) return res.status(404).json({ success: false, message: 'Trip not found' });
    // drivers may only read their own trips
    if (req.user.role === 'driver' && t.driver_id !== req.user.driver_id) {
      return res.status(403).json({ success: false, message: 'Forbidden: trip assigned to another driver' });
    }
    const [fuel] = await db.query('SELECT * FROM fuel_records WHERE trip_id=?', [req.params.id]);
    const [cost] = await db.query('SELECT * FROM transportation_costs WHERE trip_id=?', [req.params.id]);
    const [loc] = await db.query('SELECT * FROM vehicle_locations WHERE trip_id=? ORDER BY recorded_at DESC LIMIT 5', [req.params.id]);
    auditRecordView(req, {
      module: 'trips', resource: 'Trip', recordId: t.id,
      description: `Viewed trip ${t.trip_code || `#${t.id}`}`,
      metadata: { trip_code: t.trip_code || null },
    });
    res.json({ success: true, data: { ...t, fuel, cost: cost[0] || null, locations: loc } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch trip' }); }
};

exports.create = async (req, res) => {
  const conn = await db.getConnection();
  try {
    let { reservation_id = null, route_id = null, vehicle_id, driver_id, pickup_location, destination, stops = '', distance_km = null, estimated_time_min = null, departure_datetime = null, notes = null } = req.body;
    if (!vehicle_id || !driver_id || !pickup_location || !destination) return res.status(400).json({ success: false, message: 'Vehicle, driver, pickup and destination required' });
    await conn.beginTransaction();
    const [[v]] = await conn.query('SELECT * FROM vehicles WHERE id=? FOR UPDATE', [vehicle_id]);
    if (!v) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Vehicle not found' }); }
    const [[d]] = await conn.query('SELECT * FROM drivers WHERE id=? FOR UPDATE', [driver_id]);
    if (!d) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Driver not found' }); }
    const [[av]] = await conn.query(`SELECT COUNT(*) c FROM trips WHERE vehicle_id=? AND ${ACTIVE}`, [vehicle_id]);
    if (av.c > 0 || !['Available', 'Reserved'].includes(v.status)) { await conn.rollback(); return res.status(400).json({ success: false, message: 'Vehicle is not available (already on an active trip)' }); }
    const [[ad]] = await conn.query(`SELECT COUNT(*) c FROM trips WHERE driver_id=? AND ${ACTIVE}`, [driver_id]);
    if (ad.c > 0 || !['Available', 'Assigned'].includes(d.status)) { await conn.rollback(); return res.status(400).json({ success: false, message: 'Driver is not available (already on an active trip)' }); }
    // auto route calculation when distance missing
    const stopArr = typeof stops === 'string' ? stops.split(',').map((s) => s.trim()).filter(Boolean) : stops;
    if (!distance_km || !estimated_time_min) {
      const calc = await calculateRoute(pickup_location, destination, stopArr);
      distance_km = distance_km || calc.distanceKm;
      estimated_time_min = estimated_time_min || calc.estimatedMin;
    }
    const [r] = await conn.query(
      `INSERT INTO trips (trip_code,reservation_id,route_id,vehicle_id,driver_id,pickup_location,destination,stops,distance_km,estimated_time_min,departure_datetime,notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code('TRIP'), reservation_id, route_id, vehicle_id, driver_id, pickup_location, destination, Array.isArray(stopArr) ? stopArr.join(', ') : stops, distance_km, estimated_time_min, departure_datetime, notes]
    );
    await conn.query("UPDATE vehicles SET status='Dispatched' WHERE id=?", [vehicle_id]);
    await conn.query("UPDATE drivers SET status='On Trip', assigned_vehicle_id=? WHERE id=?", [vehicle_id, driver_id]);
    if (reservation_id) await conn.query("UPDATE reservations SET status='Dispatched' WHERE id=?", [reservation_id]);
    await refreshDriverStats(conn, driver_id);
    await conn.commit();
    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.TRIPS.CREATED,
      module: 'trips',
      recordId: r.insertId,
      newValues: { trip_code: code('TRIP'), reservation_id, route_id, vehicle_id, driver_id, pickup_location, destination, stops: Array.isArray(stopArr) ? stopArr.join(', ') : stops, distance_km, estimated_time_min, departure_datetime, notes }
    });
    await notify({ targetRole: 'fleet_manager', title: 'Trip dispatched', message: `Trip ${pickup_location} → ${destination} dispatched`, linkType: 'trip', linkId: r.insertId });
    const [[drv]] = await db.query('SELECT user_id FROM drivers WHERE id=?', [driver_id]);
    // driver-specific notification via broadcast to driver role + message containing trip
    await notify({ userId: drv.user_id || null, targetRole: 'driver', title: 'Trip assigned', message: `Trip has been assigned to you: ${pickup_location} → ${destination}`, linkType: 'trip', linkId: r.insertId });
    res.status(201).json({ success: true, message: 'Trip created and dispatched', data: { id: r.insertId } });
  } catch (e) { await conn.rollback(); res.status(500).json({ success: false, message: 'Failed to create trip', error: e.message }); }
  finally { conn.release(); }
};

// PATCH /:id/status { trip_status, delivery_status }
exports.setStatus = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { trip_status, delivery_status } = req.body;
    await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT * FROM trips WHERE id=? FOR UPDATE', [req.params.id]);
    if (!t) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Trip not found' }); }
    // drivers may only update their own trips, and only drive forward:
    // Scheduled/Dispatched -> In Transit -> Arrived -> Completed
    if (req.user.role === 'driver') {
      if (t.driver_id !== req.user.driver_id) { await conn.rollback(); return res.status(403).json({ success: false, message: 'Forbidden: trip assigned to another driver' }); }
      if (trip_status && !['In Transit', 'Arrived', 'Completed'].includes(trip_status)) {
        await conn.rollback(); return res.status(403).json({ success: false, message: 'Drivers may only start, arrive or complete trips' });
      }
    }
    const oldStatus = t.trip_status;
    if (trip_status) {
      const valid = ['Scheduled', 'Dispatched', 'In Transit', 'Arrived', 'Completed', 'Cancelled'];
      if (!valid.includes(trip_status)) { await conn.rollback(); return res.status(400).json({ success: false, message: 'Invalid trip status' }); }
      const upd = { trip_status };
      if (trip_status === 'In Transit') {
        if (!t.departure_datetime) upd.departure_datetime = new Date();
        await conn.query("UPDATE vehicles SET status='In Transit' WHERE id=?", [t.vehicle_id]);
        await conn.query("UPDATE drivers SET status='On Trip', assigned_vehicle_id=? WHERE id=?", [t.vehicle_id, t.driver_id]);
      }
      if (trip_status === 'Completed' || trip_status === 'Cancelled') {
        upd.arrival_datetime = new Date();
        await conn.query("UPDATE vehicles SET status='Available' WHERE id=?", [t.vehicle_id]);
        await conn.query("UPDATE drivers SET status='Available' WHERE id=?", [t.driver_id]);
        if (t.reservation_id) await conn.query('UPDATE reservations SET status=? WHERE id=?', [trip_status === 'Completed' ? 'Completed' : 'Cancelled', t.reservation_id]);
        if (trip_status === 'Completed' && !delivery_status) upd.delivery_status = 'Delivered';
      }
      const keys = Object.keys(upd); const vals = Object.values(upd);
      await conn.query(`UPDATE trips SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, [...vals, t.id]);
      await refreshDriverStats(conn, t.driver_id);
      await notify({ targetRole: 'all', title: 'Trip status changed', message: `Trip ${t.trip_code} is now ${trip_status}`, linkType: 'trip', linkId: t.id });
      // auto-create cost row on completion
      if (trip_status === 'Completed') {
        const [[f]] = await conn.query('SELECT COALESCE(SUM(total_cost),0) s FROM fuel_records WHERE trip_id=?', [t.id]);
        const total = +f.s;
        const [[ex]] = await conn.query('SELECT id FROM transportation_costs WHERE trip_id=?', [t.id]);
        if (!ex) await conn.query("INSERT INTO transportation_costs (cost_code,trip_id,vehicle_id,driver_id,fuel_cost,total_cost,cost_date,remarks) VALUES (?,?,?,?,?,?,CURDATE(),'Auto-generated on trip completion')", [code('COST'), t.id, t.vehicle_id, t.driver_id, total, total]);
      }
    }
    if (delivery_status) {
      const valid = ['Pending', 'Out for Delivery', 'Delivered', 'Failed'];
      if (!valid.includes(delivery_status)) { await conn.rollback(); return res.status(400).json({ success: false, message: 'Invalid delivery status' }); }
      await conn.query('UPDATE trips SET delivery_status=? WHERE id=?', [delivery_status, t.id]);
      if (delivery_status === 'Delivered') await notify({ targetRole: 'all', title: 'Delivery completed', message: `Trip ${t.trip_code} delivered`, linkType: 'trip', linkId: t.id });
    }
    await conn.commit();

    // Audit log for status change
    if (trip_status) {
      let auditAction = AUDIT_ACTIONS.TRIPS.UPDATED;
      if (trip_status === 'Cancelled') auditAction = AUDIT_ACTIONS.TRIPS.STATUS_CHANGED;
      await createAuditLog({
        req,
        action: auditAction,
        module: 'trips',
        recordId: req.params.id,
        oldValues: { trip_status: oldStatus },
        newValues: { trip_status }
      });
    }

    res.json({ success: true, message: 'Trip updated' });
  } catch (e) { await conn.rollback(); res.status(500).json({ success: false, message: 'Failed to update trip', error: e.message }); }
  finally { conn.release(); }
};

exports.update = async (req, res) => {
  try {
    const [[oldTrip]] = await db.query('SELECT * FROM trips WHERE id=?', [req.params.id]);
    if (!oldTrip) return res.status(404).json({ success: false, message: 'Trip not found' });

    const allowed = ['pickup_location', 'destination', 'stops', 'distance_km', 'estimated_time_min', 'departure_datetime', 'arrival_datetime', 'notes'];
    const f = [], p = [];
    for (const k of allowed) if (req.body[k] !== undefined) { f.push(`${k}=?`); p.push(req.body[k]); }
    if (!f.length) return res.status(400).json({ success: false, message: 'Nothing to update' });
    p.push(req.params.id);
    await db.query(`UPDATE trips SET ${f.join(',')} WHERE id=?`, p);

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.TRIPS.UPDATED,
      module: 'trips',
      recordId: req.params.id,
      oldValues: oldTrip,
      newValues: req.body
    });

    res.json({ success: true, message: 'Trip updated' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to update trip' }); }
};

exports.archive = async (req, res) => {
  try {
    const [[oldTrip]] = await db.query('SELECT * FROM trips WHERE id=?', [req.params.id]);
    if (!oldTrip) return res.status(404).json({ success: false, message: 'Trip not found' });
    if (['Scheduled','Dispatched','In Transit'].includes(oldTrip.trip_status)) return res.status(400).json({ success: false, message: 'Cannot archive trip with active status' });
    await db.query('UPDATE trips SET archived_at=NOW() WHERE id=?', [req.params.id]);

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.TRIPS.ARCHIVED,
      module: 'trips',
      recordId: req.params.id,
      oldValues: oldTrip,
      newValues: { archived: true }
    });

    res.json({ success: true, message: 'Trip archived' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to archive trip' }); }
};
exports.restore = async (req, res) => {
  try {
    const [[oldTrip]] = await db.query('SELECT * FROM trips WHERE id=?', [req.params.id]);
    if (!oldTrip) return res.status(404).json({ success: false, message: 'Trip not found' });
    const [r]=await db.query('UPDATE trips SET archived_at=NULL WHERE id=? AND archived_at IS NOT NULL', [req.params.id]);
    if(r.affectedRows===0) return res.status(404).json({success:false,message:'Trip not found or not archived'});

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.TRIPS.RESTORED,
      module: 'trips',
      recordId: req.params.id,
      oldValues: { archived: true },
      newValues: oldTrip
    });

    res.json({ success: true, message: 'Trip restored' });
  } catch(e){ res.status(500).json({ success: false, message: 'Failed to restore trip' }); }
};
exports.remove = async (req, res) => { return exports.archive(req,res); };
