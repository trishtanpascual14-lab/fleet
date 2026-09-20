const db = require('../config/db');

// Run one dashboard query independently so a single failing metric
// never crashes the whole dashboard. Returns `fallback` on error and
// logs the REAL exception server-side for diagnosis.
async function metric(db, name, sql, fallback) {
  try {
    const [rows] = await db.query(sql);
    return rows;
  } catch (e) {
    console.error(`Dashboard metric "${name}" failed:`, e.message);
    return fallback;
  }
}
const first = (rows, fallback) => (Array.isArray(rows) && rows.length ? rows[0] : fallback);

// GET /api/dashboard — all cards + chart datasets from real records
exports.stats = async (req, res) => {
  try {
    const v = first(await metric(db, 'vehicles', `SELECT COUNT(*) total,
      SUM(status='Available') available, SUM(status='In Transit') intransit,
      SUM(status='Maintenance') maint, SUM(status IN ('Reserved','Dispatched')) inuse FROM vehicles WHERE archived_at IS NULL`,
      []), { total: 0, available: 0, intransit: 0, maint: 0, inuse: 0 });
    const d = first(await metric(db, 'drivers', `SELECT COUNT(*) total, SUM(status='Available') available,
      SUM(status IN ('Assigned','On Trip')) active FROM drivers WHERE archived_at IS NULL`,
      []), { total: 0, available: 0, active: 0 });
    const t = first(await metric(db, 'trips', `SELECT COUNT(*) total, SUM(trip_status IN ('Scheduled','Dispatched','In Transit','Arrived')) active,
      SUM(trip_status='Completed') done, SUM(trip_status='Dispatched') dispatched FROM trips WHERE archived_at IS NULL`,
      []), { total: 0, active: 0, done: 0, dispatched: 0 });
    const r = first(await metric(db, 'reservations', `SELECT COUNT(*) total, SUM(status='Pending') pending,
      SUM(status IN ('Pending','Approved','Reserved')) ready, SUM(status='Completed') done FROM reservations WHERE archived_at IS NULL`,
      []), { total: 0, pending: 0, ready: 0, done: 0 });
    const f = first(await metric(db, 'fuel', 'SELECT COUNT(*) total, COALESCE(SUM(liters),0) liters, COALESCE(SUM(total_cost),0) cost FROM fuel_records WHERE archived_at IS NULL',
      []), { total: 0, liters: 0, cost: 0 });
    const c = first(await metric(db, 'transportCosts', `SELECT COUNT(*) count, COALESCE(SUM(total_cost),0) total,
      COALESCE(SUM(CASE WHEN DATE_FORMAT(cost_date,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m') THEN total_cost ELSE 0 END),0) monthTotal FROM transportation_costs WHERE archived_at IS NULL`,
      []), { count: 0, total: 0, monthTotal: 0 });
    const rt = first(await metric(db, 'routes', `SELECT COUNT(*) total, SUM(status='Planned') planned,
      SUM(status IN ('Optimized','Assigned','In Transit')) active FROM routes WHERE archived_at IS NULL`,
      []), { total: 0, planned: 0, active: 0 });
    const tr = first(await metric(db, 'tracking', `SELECT COUNT(DISTINCT vehicle_id) tracked,
      COUNT(DISTINCT CASE WHEN recorded_at >= DATE_SUB(NOW(), INTERVAL 60 MINUTE) THEN vehicle_id END) online FROM vehicle_locations`,
      []), { tracked: 0, online: 0 });
    const dl = first(await metric(db, 'delivery', `SELECT COUNT(*) total, SUM(delivery_status='Delivered') ok FROM trips`,
      []), { total: 0, ok: 0 });
    const util = await metric(db, 'utilization', 'SELECT status, COUNT(*) n FROM vehicles GROUP BY status', []);
    const fuelTrend = await metric(db, 'fuelTrend', "SELECT DATE_FORMAT(record_date,'%Y-%m') m, SUM(liters) liters, COUNT(*) txns FROM fuel_records GROUP BY m ORDER BY m DESC LIMIT 6", []);
    const costTrend = await metric(db, 'costTrend', "SELECT DATE_FORMAT(cost_date,'%Y-%m') m, SUM(total_cost) total, COUNT(*) txns FROM transportation_costs GROUP BY m ORDER BY m DESC LIMIT 6", []);
    const tripPerf = await metric(db, 'tripPerf', 'SELECT trip_status, COUNT(*) n FROM trips GROUP BY trip_status', []);
    const expiry = await metric(db, 'expiries', `SELECT 'vehicle' kind, plate_number label, registration_expiry expiry FROM vehicles
      WHERE registration_expiry IS NOT NULL AND registration_expiry <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
      UNION ALL SELECT 'driver', full_name, license_expiry FROM drivers
      WHERE license_expiry IS NOT NULL AND license_expiry <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) LIMIT 10`, []);
    res.json({ success: true, data: {
      vehicles: v, drivers: d.total, driversDetail: d, trips: t, pendingReservations: r.pending,
      reservations: r, dispatch: { ready: +(r.ready || 0), active: +(t.dispatched || 0) },
      routes: rt, tracking: { tracked: +(tr.tracked || 0), online: +(tr.online || 0), offline: +(tr.tracked || 0) - +(tr.online || 0) },
      fuel: f, transportCost: c.total, costs: c,
      reports: { available: 6, types: ['fleet', 'drivers', 'trips', 'fuel', 'costs', 'delivery'] },
      deliveryRate: dl.total ? +((dl.ok / dl.total) * 100).toFixed(1) : 0,
      charts: { utilization: util, fuelTrend: fuelTrend.reverse(), costTrend: costTrend.reverse(), tripPerf },
      expiries: expiry
    }});
  } catch (e) {
    console.error('Dashboard API error:', e);
    res.status(500).json({ success: false, message: 'Failed to load dashboard', error: e.message });
  }
};
