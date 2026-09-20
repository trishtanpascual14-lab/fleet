const db = require('../config/db');
const { code, notify } = require('../utils/helpers');
const { 
  getCurrentDateTimeISO, 
  getCurrentDateTimeComponents,
  validatePickupDatetime, 
  validateDropoffDate
} = require('../utils/dateTime');
const { createAuditLog, auditRecordView, AUDIT_ACTIONS } = require('../utils/audit');

// Workflow: Route Planning creates routes first; reservations SELECT an
// existing route. Pickup/Destination are derived from the route server-side
// (single source of truth) — never typed manually.
async function loadRoute(routeId) {
  const [[rt]] = await db.query('SELECT * FROM routes WHERE id=?', [routeId]);
  return rt || null;
}

function routeMapPoints(route, stops) {
  const pts = [];
  if (route.origin_lat !== null && route.origin_lat !== undefined) {
    pts.push({ name: route.origin, lat: +route.origin_lat, lon: +route.origin_lng, kind: 'origin', order: 0 });
  }
  (stops || []).forEach((s, i) => {
    if (s.latitude !== null && s.latitude !== undefined) {
      pts.push({ name: s.location, lat: +s.latitude, lon: +s.longitude, kind: 'stop', order: i + 1 });
    }
  });
  if (route.destination_lat !== null && route.destination_lat !== undefined) {
    pts.push({ name: route.destination, lat: +route.destination_lat, lon: +route.destination_lng, kind: 'destination', order: (stops || []).length + 1 });
  }
  return pts;
}

const ACTIVE_VEH = "SELECT COUNT(*) c FROM trips WHERE vehicle_id=? AND trip_status IN ('Scheduled','Dispatched','In Transit')";
const ACTIVE_DRV = "SELECT COUNT(*) c FROM trips WHERE driver_id=? AND trip_status IN ('Scheduled','Dispatched','In Transit')";

exports.list = async (req, res) => {
  try {
    const { search = '', status = '', page = 1, limit = 20, archived = '' } = req.query;
    if (process.env.NODE_ENV !== 'production') {
      console.log('GET /api/reservations query:', { search, status, page, limit, archived });
    }
    const where = []; const p = [];
    if (archived === '1' || archived === 'true') where.push('r.archived_at IS NOT NULL');
    else if (archived === 'all') { /* no filter */ }
    else where.push('r.archived_at IS NULL');
    if (search) { where.push('(r.reservation_code LIKE ? OR r.pickup_location LIKE ? OR r.destination LIKE ?)'); p.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (status) { where.push('LOWER(r.status)=LOWER(?)'); p.push(status); }
    if (req.user.role === 'driver' && req.user.driver_id) { where.push('r.driver_id=?'); p.push(req.user.driver_id); }
    const [[{ c }]] = await db.query(`SELECT COUNT(*) c FROM reservations r WHERE ${where.join(' AND ')}`, p);
    const off = (Math.max(1, +page) - 1) * +limit;
    const [rows] = await db.query(
      `SELECT r.*, v.plate_number, d.full_name AS driver_name, u.name AS requested_by_name,
        rt.route_name, rt.route_code, rt.total_distance_km AS route_distance_km, rt.estimated_time_min AS route_time_min
       FROM reservations r LEFT JOIN vehicles v ON v.id=r.vehicle_id
       LEFT JOIN drivers d ON d.id=r.driver_id LEFT JOIN users u ON u.id=r.requested_by
       LEFT JOIN routes rt ON rt.id=r.route_id
       WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...p, +limit, off]);
    
    // Standardize dropoff_date / drop_off_date field names on all records
    const mappedRows = rows.map(r => {
      const dropDate = r.dropoff_date ? String(r.dropoff_date).slice(0,10) : (r.dropoff_datetime ? String(r.dropoff_datetime).slice(0,10) : null);
      return {
        ...r,
        dropoff_date: dropDate,
        drop_off_date: dropDate
      };
    });

    res.json({ success: true, data: mappedRows, pagination: { total: c, page: +page, limit: +limit } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch reservations', error: e.message }); }
};

exports.get = async (req, res) => {
  try {
    const [[r]] = await db.query(
      `SELECT r.*, v.plate_number, d.full_name AS driver_name,
        ab.name AS approved_by_name, rb.name AS rejected_by_name FROM reservations r
        LEFT JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN drivers d ON d.id=r.driver_id
        LEFT JOIN users ab ON ab.id=r.approved_by LEFT JOIN users rb ON rb.id=r.rejected_by WHERE r.id=?`, [req.params.id]);
    if (!r) return res.status(404).json({ success: false, message: 'Reservation not found' });
    const dropDate = r.dropoff_date ? String(r.dropoff_date).slice(0,10) : (r.dropoff_datetime ? String(r.dropoff_datetime).slice(0,10) : null);
    r.dropoff_date = dropDate;
    r.drop_off_date = dropDate;

    // The attached route (created first in Route Planning) with map data
    let route = null;
    if (r.route_id) {
      const [[rt]] = await db.query(
        `SELECT rt.*, v.plate_number, d.full_name AS driver_name FROM routes rt
         LEFT JOIN vehicles v ON v.id=rt.vehicle_id LEFT JOIN drivers d ON d.id=rt.driver_id WHERE rt.id=?`, [r.route_id]);
      if (rt) {
        const [stops] = await db.query('SELECT * FROM route_stops WHERE route_id=? ORDER BY stop_order', [rt.id]);
        rt.stops = stops;
        rt.mapPoints = routeMapPoints(rt, stops);
        rt.geometry = rt.mapPoints.length > 1 ? rt.mapPoints.map((p) => [p.lat, p.lon]) : [];
        route = rt;
      }
    }
    r.route = route;
    auditRecordView(req, {
      module: 'reservations', resource: 'Reservation', recordId: r.id,
      description: `Viewed reservation ${r.reservation_code || `#${r.id}`}`,
      metadata: { reservation_code: r.reservation_code || null },
    });
    res.json({ success: true, data: r });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch reservation' }); }
};

// Check if a vehicle has an active reservation on the given date/time
async function checkVehicleAvailability(conn, vehicleId, pickupDatetime, dropoffDate = null, excludeId = null) {
  if (!vehicleId) return true;
  const where = [
    'vehicle_id = ?',
    'status IN (?, ?, ?)',
    'archived_at IS NULL',
    'DATE(pickup_datetime) = DATE(?)'
  ];
  const params = [vehicleId, 'Pending', 'Approved', 'Reserved', pickupDatetime];
  if (excludeId) {
    where.push('id != ?');
    params.push(excludeId);
  }
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(*) c FROM reservations WHERE ${where.join(' AND ')}`,
    params
  );
  return c === 0;
}

// Check if a driver has an active reservation on the given date/time
async function checkDriverAvailability(conn, driverId, pickupDatetime, dropoffDate = null, excludeId = null) {
  if (!driverId) return true;
  const where = [
    'driver_id = ?',
    'status IN (?, ?, ?)',
    'archived_at IS NULL',
    'DATE(pickup_datetime) = DATE(?)'
  ];
  const params = [driverId, 'Pending', 'Approved', 'Reserved', pickupDatetime];
  if (excludeId) {
    where.push('id != ?');
    params.push(excludeId);
  }
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(*) c FROM reservations WHERE ${where.join(' AND ')}`,
    params
  );
  return c === 0;
}

exports.create = async (req, res) => {
  const conn = await db.getConnection();
  try {
    let { 
      vehicle_id = null, 
      driver_id = null, 
      route_id = null, 
      reservation_date,
      pickup_datetime
    } = req.body;
    let dropoff_date = req.body.dropoff_date || req.body.drop_off_date || null;

    if (process.env.NODE_ENV !== 'production') {
      console.log('POST /api/reservations fields:', { vehicle_id, driver_id, route_id, reservation_date, pickup_datetime, dropoff_date });
    }
    
    // Structured validation errors object
    const errors = {};
    if (!route_id) errors.route_id = 'Please select a Route from Route Planning';
    if (!pickup_datetime) errors.pickup_datetime = 'Pickup date and time is required';
    if (!dropoff_date) errors.dropoff_date = 'Drop-off date is required';

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    // Format pickup_datetime consistently (replace T with space and ensure seconds)
    pickup_datetime = String(pickup_datetime).replace('T', ' ');
    if (pickup_datetime.length === 16) pickup_datetime += ':00';

    if (!reservation_date) {
      reservation_date = pickup_datetime.slice(0, 10);
    }
    
    // Validate pickup datetime
    const pickupValidation = validatePickupDatetime(pickup_datetime);
    if (!pickupValidation.valid) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: { pickup_datetime: pickupValidation.message } });
    }

    // Validate dropoff date
    const dropoffValidation = validateDropoffDate(pickup_datetime, dropoff_date);
    if (!dropoffValidation.valid) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: { dropoff_date: dropoffValidation.message } });
    }

    await conn.beginTransaction();

    const [[rt]] = await conn.query('SELECT * FROM routes WHERE id=?', [route_id]);
    if (!rt) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Selected route not found' });
    }
    
    // Pickup/Destination come from the selected route — not typed manually
    const pickup_location = rt.origin;
    const destination = rt.destination;
    
    if (vehicle_id) {
      const [[v]] = await conn.query('SELECT status FROM vehicles WHERE id=?', [vehicle_id]);
      if (!v) {
        await conn.rollback();
        return res.status(404).json({ success: false, message: 'Vehicle not found' });
      }
      if (v.status !== 'Available') {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'Only available vehicles can be reserved' });
      }
      
      const available = await checkVehicleAvailability(conn, vehicle_id, pickup_datetime, dropoff_date);
      if (!available) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'Vehicle is unavailable during the selected reservation period.' });
      }
    }
    if (driver_id) {
      const [[d]] = await conn.query('SELECT status FROM drivers WHERE id=?', [driver_id]);
      if (!d) {
        await conn.rollback();
        return res.status(404).json({ success: false, message: 'Driver not found' });
      }
      if (!['Available'].includes(d.status)) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'Only available drivers can be assigned' });
      }
      
      const available = await checkDriverAvailability(conn, driver_id, pickup_datetime, dropoff_date);
      if (!available) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'Driver is unavailable during the selected reservation period.' });
      }
    }
    const [r] = await conn.query(
      'INSERT INTO reservations (reservation_code,vehicle_id,driver_id,route_id,requested_by,reservation_date,pickup_datetime,dropoff_date,pickup_location,destination) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [code('RES'), vehicle_id, driver_id, route_id, req.user.id, reservation_date, pickup_datetime, dropoff_date, pickup_location, destination]
    );

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.RESERVATIONS.CREATED,
      module: 'Reservations',
      recordId: r.insertId,
      newValues: { reservation_code: code('RES'), vehicle_id, driver_id, route_id, requested_by: req.user.id, reservation_date, pickup_datetime, dropoff_date, pickup_location, destination }
    });

    await conn.commit();

    await notify({ targetRole: 'fleet_manager', title: 'New reservation', message: `New reservation ${pickup_location} → ${destination} needs approval`, linkType: 'reservation', linkId: r.insertId });
    await notify({ targetRole: 'dispatcher', title: 'New reservation', message: `New reservation ${pickup_location} → ${destination}`, linkType: 'reservation', linkId: r.insertId });
    res.status(201).json({ success: true, message: `Reservation created using route ${rt.route_code}`, data: { id: r.insertId, route_id } });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ success: false, message: 'Failed to create reservation', error: e.message });
  } finally {
    conn.release();
  }
};

// PATCH /:id/status { status, vehicle_id?, driver_id? }
exports.setStatus = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { status, vehicle_id, driver_id } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: { status: 'Status is required' } });
    }
    
    const validMap = {
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
      reserved: 'Reserved',
      dispatched: 'Dispatched',
      completed: 'Completed',
      cancelled: 'Cancelled'
    };
    const targetStatus = validMap[String(status).toLowerCase()];
    if (!targetStatus) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: { status: `Invalid status '${status}'. Allowed values: Pending, Approved, Rejected, Reserved, Dispatched, Completed, Cancelled` }
      });
    }

    // REJECT must go through the dedicated endpoint so a rejection reason
    // is always validated and recorded — never via the generic status API.
    if (targetStatus === 'Rejected') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: { status: 'To reject a reservation, use the Reject action with a rejection reason.' }
      });
    }

    await conn.beginTransaction();
    const [[r]] = await conn.query('SELECT * FROM reservations WHERE id=? FOR UPDATE', [req.params.id]);
    if (!r) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }

    // Idempotency: prevent duplicate status changes from repeated requests.
    if (r.status === targetStatus) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: `Reservation is already ${targetStatus.toLowerCase()}` });
    }

    let effectiveVehicleId = vehicle_id || r.vehicle_id;
    let effectiveDriverId = driver_id || r.driver_id;
    if (vehicle_id || driver_id) {
      await conn.query('UPDATE reservations SET vehicle_id=?, driver_id=? WHERE id=?', [effectiveVehicleId || null, effectiveDriverId || null, req.params.id]);
    }

    const oldStatus = r.status;
    // ACCEPT requires no rejection notes; record who accepted and when.
    if (targetStatus === 'Approved') {
      await conn.query('UPDATE reservations SET status=?, approved_by=?, approved_at=NOW() WHERE id=?', [targetStatus, req.user.id, req.params.id]);
    } else {
      await conn.query('UPDATE reservations SET status=? WHERE id=?', [targetStatus, req.params.id]);
    }

    if (targetStatus === 'Approved' || targetStatus === 'Reserved') {
      if (!effectiveVehicleId) {
        const [[firstAvail]] = await conn.query("SELECT id FROM vehicles WHERE status='Available' LIMIT 1");
        if (firstAvail) {
          effectiveVehicleId = firstAvail.id;
          await conn.query('UPDATE reservations SET vehicle_id=? WHERE id=?', [effectiveVehicleId, req.params.id]);
        } else {
          await conn.rollback();
          return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: { vehicle_id: 'Please assign an available vehicle before approving.' }
          });
        }
      }
      await conn.query("UPDATE vehicles SET status='Reserved' WHERE id=?", [effectiveVehicleId]);
      if (effectiveDriverId) await conn.query("UPDATE drivers SET status='Assigned' WHERE id=?", [effectiveDriverId]);
      await notify({ targetRole: 'dispatcher', title: 'Reservation accepted', message: `Reservation ${r.reservation_code} has been accepted.`, linkType: 'reservation', linkId: r.id });
    }
    if (targetStatus === 'Dispatched') {
      if (effectiveVehicleId) await conn.query("UPDATE vehicles SET status='Dispatched' WHERE id=?", [effectiveVehicleId]);
      if (effectiveDriverId) await conn.query("UPDATE drivers SET status='On Trip' WHERE id=?", [effectiveDriverId]);
      await notify({ targetRole: 'driver', title: 'Vehicle dispatched', message: `Reservation ${r.reservation_code} dispatched`, linkType: 'reservation', linkId: r.id });
    }
    if (targetStatus === 'Rejected' || targetStatus === 'Cancelled') {
      if (effectiveVehicleId) {
        const [[a]] = await conn.query(ACTIVE_VEH, [effectiveVehicleId]);
        if (a.c === 0) await conn.query("UPDATE vehicles SET status='Available' WHERE id=?", [effectiveVehicleId]);
      }
      if (effectiveDriverId) {
        const [[a]] = await conn.query(ACTIVE_DRV, [effectiveDriverId]);
        if (a.c === 0) await conn.query("UPDATE drivers SET status='Available' WHERE id=?", [effectiveDriverId]);
      }
      await notify({ targetRole: 'dispatcher', title: `Reservation ${targetStatus.toLowerCase()}`, message: `Reservation ${r.reservation_code} was ${targetStatus.toLowerCase()}`, linkType: 'reservation', linkId: r.id });
    }
    await conn.commit();

    let auditAction = AUDIT_ACTIONS.RESERVATIONS.UPDATED;
    if (targetStatus === 'Approved') auditAction = AUDIT_ACTIONS.RESERVATIONS.APPROVED;
    else if (targetStatus === 'Rejected') auditAction = AUDIT_ACTIONS.RESERVATIONS.REJECTED;
    await createAuditLog({
      req,
      action: auditAction,
      module: 'reservations',
      recordId: req.params.id,
      oldValues: { reservation_code: r.reservation_code, status: oldStatus },
      newValues: targetStatus === 'Approved'
        ? { reservation_code: r.reservation_code, status: targetStatus, approved_by: req.user.id }
        : { reservation_code: r.reservation_code, status: targetStatus }
    });

    res.json({ success: true, message: targetStatus === 'Approved' ? `Reservation ${r.reservation_code} has been accepted.` : `Reservation status updated to ${targetStatus}` });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ success: false, message: 'Failed to update reservation status', error: e.message });
  } finally {
    conn.release();
  }
};

exports.update = async (req, res) => {
  try {
    const [[oldReservation]] = await db.query('SELECT * FROM reservations WHERE id=?', [req.params.id]);
    if (!oldReservation) return res.status(404).json({ success: false, message: 'Reservation not found' });

    const allowed = ['vehicle_id', 'driver_id', 'reservation_date', 'pickup_datetime', 'dropoff_date', 'dropoff_datetime'];
    const f = [], p = [];
    for (const k of allowed) if (req.body[k] !== undefined) { f.push(`${k}=?`); p.push(req.body[k] === '' ? null : req.body[k]); }
    // Changing the route re-derives Pickup/Destination from the new route
    if (req.body.route_id !== undefined) {
      const rt = await loadRoute(req.body.route_id);
      if (!rt && req.body.route_id) return res.status(404).json({ success: false, message: 'Selected route not found' });
      f.push('route_id=?'); p.push(req.body.route_id || null);
      if (rt) { f.push('pickup_location=?', 'destination=?'); p.push(rt.origin, rt.destination); }
    }
    if (req.body.dropoff_date || req.body.pickup_datetime) {
      const [[current]] = await db.query('SELECT pickup_datetime, dropoff_date FROM reservations WHERE id=?', [req.params.id]);
      if (current) {
        const pickup = req.body.pickup_datetime !== undefined ? req.body.pickup_datetime : current.pickup_datetime;
        const dropoffDate = req.body.dropoff_date !== undefined ? req.body.dropoff_date : current.dropoff_date;
        if (dropoffDate) {
          const val = validateDropoffDate(pickup, dropoffDate);
          if (!val.valid) return res.status(400).json({ success: false, message: val.message });
        }
      }
    }
    if (!f.length) return res.status(400).json({ success: false, message: 'Nothing to update' });
    p.push(req.params.id);
    await db.query(`UPDATE reservations SET ${f.join(',')} WHERE id=?`, p);

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.RESERVATIONS.UPDATED,
      module: 'reservations',
      recordId: req.params.id,
      oldValues: oldReservation,
      newValues: req.body
    });

    res.json({ success: true, message: 'Reservation updated' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to update reservation', error: e.message }); }
};

exports.archive = async (req, res) => {
  try { 
    const [[oldReservation]] = await db.query('SELECT * FROM reservations WHERE id=?', [req.params.id]);
    if (!oldReservation) return res.status(404).json({ success: false, message: 'Reservation not found' });
    
    const [r]=await db.query('UPDATE reservations SET archived_at=NOW() WHERE id=? AND archived_at IS NULL', [req.params.id]); 
    if(r.affectedRows===0) return res.status(404).json({success:false,message:'Reservation not found or already archived'});
    
    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.RESERVATIONS.ARCHIVED,
      module: 'reservations',
      recordId: req.params.id,
      oldValues: oldReservation,
      newValues: { archived: true }
    });
    
    res.json({ success: true, message: 'Reservation archived' }); 
  }
  catch (e) { res.status(500).json({ success: false, message: 'Failed to archive reservation', error: e.message }); }
};
exports.restore = async (req, res) => {
  try { 
    const [[oldReservation]] = await db.query('SELECT * FROM reservations WHERE id=?', [req.params.id]);
    if (!oldReservation) return res.status(404).json({ success: false, message: 'Reservation not found' });
    
    const [r]=await db.query('UPDATE reservations SET archived_at=NULL WHERE id=? AND archived_at IS NOT NULL', [req.params.id]); 
    if(r.affectedRows===0) return res.status(404).json({success:false,message:'Reservation not found or not archived'});
    
    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.RESERVATIONS.RESTORED,
      module: 'reservations',
      recordId: req.params.id,
      oldValues: { archived: true },
      newValues: oldReservation
    });
    
    res.json({ success: true, message: 'Reservation restored' }); 
  }
  catch (e) { res.status(500).json({ success: false, message: 'Failed to restore reservation' }); }
};
exports.reject = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const rawNotes = req.body.rejection_notes || req.body.rejection_note || req.body.reason || '';
    if (!rawNotes || typeof rawNotes !== 'string') {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: { rejection_notes: 'Rejection reason is required.' } });
    }
    const trimmedNotes = rawNotes.trim();
    if (!trimmedNotes || trimmedNotes.length < 5) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: { rejection_notes: 'Please provide a valid reason for rejecting this reservation (minimum 5 characters).' } });
    }

    await conn.beginTransaction();
    const [[r]] = await conn.query('SELECT * FROM reservations WHERE id=? FOR UPDATE', [req.params.id]);
    if (!r) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Reservation not found' }); }
    if (r.status === 'Rejected') { await conn.rollback(); return res.status(400).json({ success: false, message: 'Reservation is already rejected' }); }
    if (r.status === 'Completed' || r.status === 'Dispatched') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: `Cannot reject a ${r.status.toLowerCase()} reservation` });
    }

    await conn.query(
      'UPDATE reservations SET status=?, rejection_notes=?, rejected_at=NOW(), rejected_by=? WHERE id=?',
      ['Rejected', trimmedNotes, req.user.id, req.params.id]
    );

    if (r.vehicle_id) {
      const [[a]] = await conn.query(ACTIVE_VEH, [r.vehicle_id]);
      if (a.c === 0) await conn.query("UPDATE vehicles SET status='Available' WHERE id=?", [r.vehicle_id]);
    }
    if (r.driver_id) {
      const [[a]] = await conn.query(ACTIVE_DRV, [r.driver_id]);
      if (a.c === 0) await conn.query("UPDATE drivers SET status='Available' WHERE id=?", [r.driver_id]);
    }

    await conn.commit();

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.RESERVATIONS.REJECTED,
      module: 'reservations',
      recordId: req.params.id,
      oldValues: { reservation_code: r.reservation_code, status: r.status },
      newValues: { reservation_code: r.reservation_code, status: 'Rejected', rejection_notes: trimmedNotes, rejected_by: req.user.id }
    });

    await notify({
      targetRole: 'dispatcher',
      title: 'Reservation rejected',
      message: `Reservation ${r.reservation_code} has been rejected. Reason: ${trimmedNotes}`,
      linkType: 'reservation',
      linkId: r.id
    });

    res.json({ success: true, message: `Reservation ${r.reservation_code} has been rejected.` });
  } catch (e) { await conn.rollback(); res.status(500).json({ success: false, message: 'Failed to reject reservation', error: e.message }); }
  finally { conn.release(); }
};

exports.remove = async (req, res) => { return exports.archive(req,res); };
