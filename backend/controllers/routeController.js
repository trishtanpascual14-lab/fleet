const db = require('../config/db');
const { code, notify } = require('../utils/helpers');
const { planRoute, searchPlaces, resolvePoint, navigateRoute } = require('../utils/routeService');

const VALID_STATUS = ['Planned', 'Optimized', 'Assigned', 'In Transit', 'Completed', 'Cancelled'];
const VALID_PRIORITY = ['Low', 'Normal', 'High', 'Urgent'];
const INVALID_MSG = 'Please select a valid location from the search suggestions.';

function parseStops(stops) {
  const arr = Array.isArray(stops) ? stops : String(stops || '').split(',');
  return arr.map((s) => {
    if (s && typeof s === 'object') return { name: String(s.name || s.location || '').trim(), lat: +s.lat, lon: +s.lon };
    return String(s || '').trim();
  }).filter((s) => (typeof s === 'object' ? s.name : s));
}

function normPoint(v) {
  if (v && typeof v === 'object') return { name: String(v.name || '').trim(), lat: +v.lat, lon: +v.lon };
  return String(v || '').trim();
}

async function vehicleContext(vehicleId) {
  if (!vehicleId) return {};
  const [[v]] = await db.query('SELECT id, plate_number, vehicle_type, capacity FROM vehicles WHERE id=?', [vehicleId]);
  if (!v) return { missing: true };
  return { vehicleType: v.vehicle_type, capacityKg: +v.capacity || 0, plate: v.plate_number };
}

// GET /api/routes/resolve?name= — resolve one saved name to {name,lat,lon}
exports.resolve = async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'Location name is required' });
    try {
      const [rows] = await db.query('SELECT name, address, latitude, longitude FROM places WHERE is_active=1 AND (name=? OR name LIKE ?) LIMIT 1', [name, `%${name}%`]);
      if (rows.length) return res.json({ success: true, data: { name: rows[0].name, address: rows[0].address, lat: +rows[0].latitude, lon: +rows[0].longitude, source: 'local' } });
    } catch { /* fall through to built-in list */ }
    const p = resolvePoint(name);
    if (!p) return res.status(404).json({ success: false, message: INVALID_MSG });
    res.json({ success: true, data: { name: p.name, address: p.name, lat: p.lat, lon: p.lon, source: 'local' } });
  } catch (e) { res.status(500).json({ success: false, message: 'Location resolve failed' }); }
};

// GET /api/routes/by-reservation/:reservationId — the reservation's own route
// (Pickup → Destination only). Generates + saves it on demand if missing.
exports.byReservation = async (req, res) => {
  try {
    const [[rv]] = await db.query('SELECT * FROM reservations WHERE id=?', [req.params.reservationId]);
    if (!rv) return res.status(404).json({ success: false, message: 'Reservation not found' });
    if (!rv.pickup_location || !rv.destination) {
      return res.status(400).json({ success: false, message: 'Reservation has no Pickup Location or Destination yet' });
    }
    let [routes] = await db.query('SELECT * FROM routes WHERE reservation_id=? ORDER BY id DESC', [req.params.reservationId]);
    if (!routes.length) {
      let plan;
      try {
        plan = await planRoute(rv.pickup_location, rv.destination, []);
      } catch (inv) {
        return res.status(422).json({ success: false, message: `${INVALID_MSG} ("${inv.invalid}" was not recognized)` });
      }
      const [ins] = await db.query(
        `INSERT INTO routes (route_code,origin,destination,origin_lat,origin_lng,destination_lat,destination_lng,
          vehicle_id,driver_id,reservation_id,priority,total_distance_km,estimated_time_min,estimated_fuel_liters,estimated_cost,route_info,status,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [code('RTE'), plan.origin.name, plan.destination.name, plan.origin.lat, plan.origin.lon,
          plan.destination.lat, plan.destination.lon, rv.vehicle_id, rv.driver_id, rv.id, 'Normal',
          plan.distanceKm, plan.estimatedMin, plan.fuel.liters, plan.cost.total, plan.info, 'Planned', req.user.id]
      );
      routes = [{ id: ins.insertId }];
    }
    // return full detail via existing get logic
    req.params.id = routes[0].id;
    return exports.get(req, res);
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to load reservation route', error: e.message }); }
};

// GET /api/routes/places?q= — autocomplete: local SME places + OSM Nominatim
exports.places = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, data: [] });
    let local = [];
    try {
      const [rows] = await db.query('SELECT name, address, latitude, longitude FROM places WHERE is_active=1 AND (name LIKE ? OR address LIKE ?) LIMIT 6', [`%${q}%`, `%${q}%`]);
      local = rows;
    } catch { /* fall back to built-in list */ }
    const data = await searchPlaces(q, local);
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: 'Location search failed', error: e.message }); }
};

// POST /api/routes/calculate { origin, destination, stops[], vehicle_id, cargo_kg }
// origin/destination/stops may be {name,lat,lon} (from autocomplete) or known place names.
exports.calculate = async (req, res) => {
  try {
    const { origin, destination, stops = [], vehicle_id = null, cargo_kg = null } = req.body;
    const errs = {};
    if (!origin || !(typeof origin === 'object' ? origin.name : String(origin).trim())) errs.origin = 'Starting Location is required';
    if (!destination || !(typeof destination === 'object' ? destination.name : String(destination).trim())) errs.destination = 'Destination is required';
    if (Object.keys(errs).length) return res.status(400).json({ success: false, message: 'Validation failed', errors: errs });
    const arr = parseStops(stops);
    const ctx = await vehicleContext(vehicle_id);
    if (vehicle_id && ctx.missing) return res.status(404).json({ success: false, message: 'Selected vehicle not found' });
    try {
      const plan = await planRoute(normPoint(origin), normPoint(destination), arr, { ...ctx, cargoKg: cargo_kg });
      plan.vehicle_id = vehicle_id;
      plan.cargoKg = cargo_kg;
      res.json({ success: true, data: plan });
    } catch (inv) {
      return res.status(422).json({ success: false, message: `${INVALID_MSG} ("${inv.invalid}" was not recognized)`, invalid: inv.invalid || null });
    }
  } catch (e) { res.status(500).json({ success: false, message: 'Route calculation failed', error: e.message }); }
};

// POST /api/routes/navigate { from: { lat, lng }, to: { lat, lng } }
// Driver turn-by-turn leg over the real road network (OSRM, via backend).
// Any authenticated role may route coordinates; trip ownership is enforced
// separately by the trips endpoints.
exports.navigate = async (req, res) => {
  try {
    const { from, to } = req.body || {};
    const ok = (p) => p && Number.isFinite(+p.lat) && Number.isFinite(+(p.lng ?? p.lon));
    if (!ok(from) || !ok(to)) {
      return res.status(400).json({ success: false, message: 'from.lat/lng and to.lat/lng are required' });
    }
    const leg = await navigateRoute(
      { lat: +from.lat, lon: +(from.lng ?? from.lon) },
      { lat: +to.lat, lon: +(to.lng ?? to.lon) }
    );
    if (!leg) return res.status(422).json({ success: false, message: 'Unable to calculate route.' });
    res.json({ success: true, data: leg });
  } catch (e) { res.status(500).json({ success: false, message: 'Route calculation failed', error: e.message }); }
};

exports.list = async (req, res) => {
  try {
    const { search = '', status = '', page = 1, limit = 20, reservation_id = '', archived = '' } = req.query;
    const where = []; const p = [];
    if (archived === '1' || archived === 'true') where.push('r.archived_at IS NOT NULL');
    else if (archived === 'all') { /* no filter */ }
    else where.push('r.archived_at IS NULL');
    if (search) { where.push('(r.route_code LIKE ? OR r.origin LIKE ? OR r.destination LIKE ?)'); p.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (status) { where.push('r.status=?'); p.push(status); }
    if (reservation_id) { where.push('r.reservation_id=?'); p.push(reservation_id); }
    const [[{ c }]] = await db.query(`SELECT COUNT(*) c FROM routes r WHERE ${where.join(' AND ')}`, p);
    const off = (Math.max(1, +page) - 1) * +limit;
    const [rows] = await db.query(
      `SELECT r.*, v.plate_number, v.vehicle_type, d.full_name AS driver_name, rv.reservation_code
       FROM routes r LEFT JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN drivers d ON d.id=r.driver_id
       LEFT JOIN reservations rv ON rv.id=r.reservation_id
       WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...p, +limit, off]);
    for (const r of rows) {
      const [stops] = await db.query('SELECT * FROM route_stops WHERE route_id=? ORDER BY stop_order', [r.id]);
      r.stops = stops;
    }
    res.json({ success: true, data: rows, pagination: { total: c, page: +page, limit: +limit } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch routes', error: e.message }); }
};

function storedOrResolve(name, lat, lon) {
  if (lat !== null && lat !== undefined && lon !== null && lon !== undefined) return { lat: +lat, lon: +lon };
  const p = resolvePoint(name);
  return p ? { lat: p.lat, lon: p.lon } : null;
}

exports.get = async (req, res) => {
  try {
    const [[r]] = await db.query(
      `SELECT r.*, v.plate_number, v.vehicle_type, v.capacity, d.full_name AS driver_name, rv.reservation_code
       FROM routes r LEFT JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN drivers d ON d.id=r.driver_id
       LEFT JOIN reservations rv ON rv.id=r.reservation_id WHERE r.id=?`, [req.params.id]);
    if (!r) return res.status(404).json({ success: false, message: 'Route not found' });
    const [stops] = await db.query('SELECT * FROM route_stops WHERE route_id=? ORDER BY stop_order', [req.params.id]);
    r.stops = stops;
    const oc = storedOrResolve(r.origin, r.origin_lat, r.origin_lng);
    const dc = storedOrResolve(r.destination, r.destination_lat, r.destination_lng);
    const pts = [];
    if (oc) pts.push({ name: r.origin, lat: oc.lat, lon: oc.lon, kind: 'origin', order: 0 });
    stops.forEach((s, i) => {
      const c = storedOrResolve(s.location, s.latitude, s.longitude);
      if (c) pts.push({ name: s.location, lat: c.lat, lon: c.lon, kind: 'stop', order: i + 1 });
    });
    if (dc) pts.push({ name: r.destination, lat: dc.lat, lon: dc.lon, kind: 'destination', order: stops.length + 1 });
    r.mapPoints = pts;
    r.geometry = pts.length > 1 ? pts.map((p) => [p.lat, p.lon]) : [];
    const [trips] = await db.query('SELECT id, trip_code, trip_status FROM trips WHERE route_id=?', [req.params.id]);
    r.linkedTrips = trips;
    res.json({ success: true, data: r });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch route', error: e.message }); }
};

exports.create = async (req, res) => {
  try {
    let { route_name = null, origin, destination, stops = [], vehicle_id = null, driver_id = null, reservation_id = null,
      departure_date = null, departure_time = null, priority = 'Normal',
      total_distance_km = null, estimated_time_min = null, estimated_fuel_liters = null,
      estimated_cost = null, route_info = null, status = 'Optimized', cargo_kg = null } = req.body;
    const oN = normPoint(origin), dN = normPoint(destination);
    const errs = {};
    if (!route_name || !String(route_name).trim()) errs.route_name = 'Route Name is required';
    // NOTE: vehicle/driver/cargo/departure are reservation concerns, not route
    // concerns — they are optional here and assigned in the Reservation System.
    if (!oN || !oN.name) errs.origin = 'Starting Location is required';
    if (!dN || !dN.name) errs.destination = 'Destination is required';
    if (!VALID_PRIORITY.includes(priority)) errs.priority = 'Invalid priority level';
    if (status && !VALID_STATUS.includes(status)) errs.status = 'Invalid route status';
    if (reservation_id) {
      const [[rv]] = await db.query('SELECT id FROM reservations WHERE id=?', [reservation_id]);
      if (!rv) errs.reservation_id = 'Linked reservation not found';
    }
    if (Object.keys(errs).length) return res.status(400).json({ success: false, message: 'Validation failed', errors: errs });
    const arr = parseStops(stops);
    let plan = null;
    if (!total_distance_km || !estimated_time_min || estimated_fuel_liters === null || estimated_cost === null) {
      const ctx = await vehicleContext(vehicle_id);
      try {
        plan = await planRoute(oN, dN, arr, { ...ctx, cargoKg: cargo_kg });
      } catch (inv) {
        return res.status(422).json({ success: false, message: `${INVALID_MSG} ("${inv.invalid}" was not recognized)` });
      }
      total_distance_km = total_distance_km || plan.distanceKm;
      estimated_time_min = estimated_time_min || plan.estimatedMin;
      estimated_fuel_liters = estimated_fuel_liters === null ? plan.fuel.liters : estimated_fuel_liters;
      estimated_cost = estimated_cost === null ? plan.cost.total : estimated_cost;
      route_info = route_info || plan.info;
    }
    // store optimized order with real coordinates
    const finalStops = plan ? plan.orderedStops : arr.map((s) => (typeof s === 'object' ? s : { name: s }));
    const oPt = plan ? plan.origin : resolvePoint(oN);
    const dPt = plan ? plan.destination : resolvePoint(dN);
    if (!oPt || !dPt) return res.status(422).json({ success: false, message: INVALID_MSG });
    const [r] = await db.query(
      `INSERT INTO routes (route_code,route_name,origin,destination,origin_lat,origin_lng,destination_lat,destination_lng,
        vehicle_id,driver_id,reservation_id,departure_date,departure_time,priority,
        total_distance_km,estimated_time_min,estimated_fuel_liters,estimated_cost,route_info,status,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code('RTE'), String(route_name).trim(), oPt.name || oN.name, dPt.name || dN.name, oPt.lat, oPt.lon, dPt.lat, dPt.lon,
        vehicle_id, driver_id, reservation_id, departure_date || null, departure_time || null, priority,
        total_distance_km, estimated_time_min, estimated_fuel_liters, estimated_cost, route_info, status, req.user.id]
    );
    for (let i = 0; i < finalStops.length; i++) {
      const s = finalStops[i];
      const nm = typeof s === 'object' ? (s.name || '') : String(s);
      const c = (s && typeof s === 'object' && isFinite(+s.lat)) ? { lat: +s.lat, lon: +s.lon } : resolvePoint(nm);
      await db.query('INSERT INTO route_stops (route_id,stop_order,location,latitude,longitude) VALUES (?,?,?,?,?)',
        [r.insertId, i + 1, nm, c ? c.lat : null, c ? c.lon : null]);
    }
    await notify({ targetRole: 'fleet_manager', title: 'Route planned', message: `${oPt.name} → ${dPt.name} (${total_distance_km} km) saved`, linkType: 'none', linkId: null });
    const [[drv]] = await db.query('SELECT user_id FROM drivers WHERE id=?', [driver_id]);
    await notify({ userId: drv && drv.user_id ? drv.user_id : null, targetRole: 'driver', title: 'Route assigned', message: `Route ${oPt.name} → ${dPt.name} assigned to you`, linkType: 'none', linkId: null });
    res.status(201).json({ success: true, message: 'Route saved', data: { id: r.insertId, total_distance_km, estimated_time_min, estimated_fuel_liters, estimated_cost } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to save route', error: e.message }); }
};

exports.update = async (req, res) => {
  try {
    const [[old]] = await db.query('SELECT * FROM routes WHERE id=?', [req.params.id]);
    if (!old) return res.status(404).json({ success: false, message: 'Route not found' });
    const allowed = ['route_name', 'vehicle_id', 'driver_id', 'departure_date', 'departure_time', 'priority',
      'total_distance_km', 'estimated_time_min', 'estimated_fuel_liters', 'estimated_cost', 'route_info', 'status'];
    const f = [], p = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        if (k === 'status' && !VALID_STATUS.includes(req.body[k])) return res.status(400).json({ success: false, message: 'Invalid route status' });
        if (k === 'priority' && !VALID_PRIORITY.includes(req.body[k])) return res.status(400).json({ success: false, message: 'Invalid priority level' });
        f.push(`${k}=?`); p.push(req.body[k] === '' ? null : req.body[k]);
      }
    }
    // origin/destination may be {name,lat,lon} or names — store coords too
    for (const [key, latK, lonK] of [['origin', 'origin_lat', 'origin_lng'], ['destination', 'destination_lat', 'destination_lng']]) {
      if (req.body[key] !== undefined) {
        const n = normPoint(req.body[key]);
        const nm = typeof n === 'object' ? n.name : n;
        if (!nm) return res.status(400).json({ success: false, message: `${key === 'origin' ? 'Starting Location' : 'Destination'} is required` });
        f.push(`${key}=?`); p.push(nm);
        const c = typeof n === 'object' && isFinite(n.lat) ? { lat: n.lat, lon: n.lon } : resolvePoint(nm);
        if (!c) return res.status(422).json({ success: false, message: INVALID_MSG });
        f.push(`${latK}=?`, `${lonK}=?`); p.push(c.lat, c.lon);
      }
    }
    if (req.body.stops !== undefined) {
      const arr = parseStops(req.body.stops);
      await db.query('DELETE FROM route_stops WHERE route_id=?', [req.params.id]);
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        const nm = typeof s === 'object' ? s.name : String(s);
        const c = (s && typeof s === 'object' && isFinite(+s.lat)) ? { lat: +s.lat, lon: +s.lon } : resolvePoint(nm);
        if (!c) return res.status(422).json({ success: false, message: `${INVALID_MSG} ("${nm}" was not recognized)` });
        await db.query('INSERT INTO route_stops (route_id,stop_order,location,latitude,longitude) VALUES (?,?,?,?,?)',
          [req.params.id, i + 1, nm, c.lat, c.lon]);
      }
    }
    if (f.length) { p.push(req.params.id); await db.query(`UPDATE routes SET ${f.join(',')} WHERE id=?`, p); }
    await notify({ targetRole: 'fleet_manager', title: 'Route updated', message: `Route ${old.route_code} was updated`, linkType: 'none', linkId: null });
    res.json({ success: true, message: 'Route updated' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to update route', error: e.message }); }
};

// POST /api/routes/:id/recalculate — recompute from stored locations + coords
exports.recalculate = async (req, res) => {
  try {
    const [[r]] = await db.query('SELECT * FROM routes WHERE id=?', [req.params.id]);
    if (!r) return res.status(404).json({ success: false, message: 'Route not found' });
    const [stops] = await db.query('SELECT location, latitude, longitude FROM route_stops WHERE route_id=? ORDER BY stop_order', [req.params.id]);
    const oN = (r.origin_lat !== null && r.origin_lng !== null) ? { name: r.origin, lat: +r.origin_lat, lon: +r.origin_lng } : r.origin;
    const dN = (r.destination_lat !== null && r.destination_lng !== null) ? { name: r.destination, lat: +r.destination_lat, lon: +r.destination_lng } : r.destination;
    const sN = stops.map((s) => (s.latitude !== null && s.longitude !== null) ? { name: s.location, lat: +s.latitude, lon: +s.longitude } : s.location);
    const ctx = await vehicleContext(r.vehicle_id);
    let plan;
    try {
      plan = await planRoute(oN, dN, sN, ctx);
    } catch (inv) {
      return res.status(422).json({ success: false, message: `${INVALID_MSG} ("${inv.invalid}" was not recognized)` });
    }
    await db.query('UPDATE routes SET origin_lat=?, origin_lng=?, destination_lat=?, destination_lng=?, total_distance_km=?, estimated_time_min=?, estimated_fuel_liters=?, estimated_cost=?, route_info=?, status=? WHERE id=?',
      [plan.origin.lat, plan.origin.lon, plan.destination.lat, plan.destination.lon,
        plan.distanceKm, plan.estimatedMin, plan.fuel.liters, plan.cost.total, plan.info, 'Optimized', req.params.id]);
    await db.query('DELETE FROM route_stops WHERE route_id=?', [req.params.id]);
    for (let i = 0; i < plan.orderedStops.length; i++) {
      const s = plan.orderedStops[i];
      await db.query('INSERT INTO route_stops (route_id,stop_order,location,latitude,longitude) VALUES (?,?,?,?,?)',
        [req.params.id, i + 1, s.name, s.lat, s.lon]);
    }
    res.json({ success: true, message: 'Route recalculated and optimized', data: plan });
  } catch (e) { res.status(500).json({ success: false, message: 'Recalculation failed', error: e.message }); }
};

exports.setStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!VALID_STATUS.includes(status)) return res.status(400).json({ success: false, message: 'Invalid route status' });
    await db.query('UPDATE routes SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ success: true, message: `Route marked as ${status}` });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to update status' }); }
};

exports.archive = async (req, res) => {
  try {
    const [[linked]] = await db.query('SELECT COUNT(*) c FROM trips WHERE route_id=? AND archived_at IS NULL', [req.params.id]);
    if (linked.c > 0) return res.status(400).json({ success: false, message: 'Cannot archive route linked to active trips' });
    const [r]=await db.query('UPDATE routes SET archived_at=NOW() WHERE id=? AND archived_at IS NULL', [req.params.id]);
    if(r.affectedRows===0) return res.status(404).json({success:false,message:'Route not found or already archived'});
    res.json({ success: true, message: 'Route archived' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to archive route', error: e.message }); }
};
exports.restore = async (req, res) => {
  try { const [r]=await db.query('UPDATE routes SET archived_at=NULL WHERE id=? AND archived_at IS NOT NULL', [req.params.id]); if(r.affectedRows===0) return res.status(404).json({success:false,message:'Route not found or not archived'}); res.json({ success: true, message: 'Route restored' }); }
  catch(e){ res.status(500).json({ success: false, message: 'Failed to restore route' }); }
};
exports.remove = async (req, res) => { return exports.archive(req,res); };
