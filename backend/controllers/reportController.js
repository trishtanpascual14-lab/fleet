const db = require('../config/db');

// GET /api/reports/:type?from=&to=
exports.generate = async (req, res) => {
  try {
    const { type } = req.params;
    const { from = '2000-01-01', to = '2100-01-01' } = req.query;
    let data = null;
    if (type === 'fleet') {
      const [rows] = await db.query(`SELECT v.*, COUNT(t.id) trips, SUM(t.trip_status='Completed') completed
        FROM vehicles v LEFT JOIN trips t ON t.vehicle_id=v.id GROUP BY v.id ORDER BY trips DESC`);
      data = rows;
    } else if (type === 'drivers') {
      const [rows] = await db.query(`SELECT d.*, COUNT(t.id) trips, SUM(t.trip_status='Completed') completed,
        SUM(t.trip_status='Cancelled') cancelled FROM drivers d LEFT JOIN trips t ON t.driver_id=d.id GROUP BY d.id`);
      data = rows;
    } else if (type === 'trips') {
      const [rows] = await db.query(`SELECT t.*, v.plate_number, d.full_name driver_name FROM trips t
        JOIN vehicles v ON v.id=t.vehicle_id JOIN drivers d ON d.id=t.driver_id
        WHERE DATE(t.created_at) BETWEEN ? AND ? ORDER BY t.id DESC`, [from, to]);
      data = rows;
    } else if (type === 'fuel') {
      const [rows] = await db.query(`SELECT f.*, v.plate_number FROM fuel_records f JOIN vehicles v ON v.id=f.vehicle_id
        WHERE f.record_date BETWEEN ? AND ? ORDER BY f.record_date DESC`, [from, to]);
      data = rows;
    } else if (type === 'costs') {
      const [rows] = await db.query(`SELECT c.*, v.plate_number, t.trip_code FROM transportation_costs c
        LEFT JOIN vehicles v ON v.id=c.vehicle_id LEFT JOIN trips t ON t.id=c.trip_id
        WHERE c.cost_date BETWEEN ? AND ? ORDER BY c.cost_date DESC`, [from, to]);
      data = rows;
    } else if (type === 'delivery') {
      const [rows] = await db.query(`SELECT trip_code,pickup_location,destination,trip_status,delivery_status,departure_datetime,arrival_datetime,driver_id,vehicle_id
        FROM trips WHERE DATE(created_at) BETWEEN ? AND ?`, [from, to]);
      const total = rows.length, ok = rows.filter((r) => r.delivery_status === 'Delivered').length;
      data = { rows, total, delivered: ok, failed: rows.filter((r) => r.delivery_status === 'Failed').length, onTimeRate: total ? +((ok / total) * 100).toFixed(1) : 0 };
    } else if (type === 'settings') {
      const [rows] = await db.query('SELECT * FROM settings');
      data = rows;
    } else {
      return res.status(400).json({ success: false, message: 'Unknown report type' });
    }
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to generate report', error: e.message }); }
};

exports.getSettings = async (req, res) => {
  const [rows] = await db.query('SELECT * FROM settings');
  res.json({ success: true, data: rows });
};

exports.saveSettings = async (req, res) => {
  try {
    for (const [k, v] of Object.entries(req.body)) {
      await db.query('INSERT INTO settings (setting_key,setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [k, String(v)]);
    }
    res.json({ success: true, message: 'Settings saved' });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to save settings' }); }
};
