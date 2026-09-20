const db = require('../config/db');
const { code } = require('../utils/helpers');

exports.list = async (req, res) => {
  try {
    const { page = 1, limit = 20, from = '', to = '', archived = '' } = req.query;
    const where = []; const p = [];
    if (archived === '1' || archived === 'true') where.push('c.archived_at IS NOT NULL');
    else if (archived === 'all') { /* no filter */ }
    else where.push('c.archived_at IS NULL');
    if (from) { where.push('c.cost_date>=?'); p.push(from); }
    if (to) { where.push('c.cost_date<=?'); p.push(to); }
    const [[{ c }]] = await db.query(`SELECT COUNT(*) c FROM transportation_costs c WHERE ${where.join(' AND ')}`, p);
    const off = (Math.max(1, +page) - 1) * +limit;
    const [rows] = await db.query(
      `SELECT c.*, v.plate_number, t.trip_code FROM transportation_costs c
       LEFT JOIN vehicles v ON v.id=c.vehicle_id LEFT JOIN trips t ON t.id=c.trip_id
       WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT ? OFFSET ?`, [...p, +limit, off]);
    res.json({ success: true, data: rows, pagination: { total: c, page: +page, limit: +limit } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch costs' }); }
};

exports.summary = async (req, res) => {
  try {
    const [[t]] = await db.query('SELECT COALESCE(SUM(fuel_cost),0) fuel, COALESCE(SUM(driver_cost),0) driver, COALESCE(SUM(toll_cost),0) toll, COALESCE(SUM(maintenance_cost),0) maint, COALESCE(SUM(other_costs),0) other, COALESCE(SUM(total_cost),0) total, COUNT(*) n FROM transportation_costs');
    const [perVehicle] = await db.query('SELECT v.plate_number, SUM(c.total_cost) total FROM transportation_costs c LEFT JOIN vehicles v ON v.id=c.vehicle_id GROUP BY c.vehicle_id ORDER BY total DESC LIMIT 10');
    const [trend] = await db.query("SELECT DATE_FORMAT(cost_date,'%Y-%m') m, SUM(total_cost) total FROM transportation_costs GROUP BY m ORDER BY m DESC LIMIT 12");
    res.json({ success: true, data: { totals: t, perVehicle, trend: trend.reverse() } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch cost summary' }); }
};

exports.create = async (req, res) => {
  try {
    const { trip_id = null, vehicle_id = null, driver_id = null, fuel_cost = 0, driver_cost = 0, toll_cost = 0, maintenance_cost = 0, other_costs = 0, cost_date, remarks = null } = req.body;
    if (!cost_date) return res.status(400).json({ success: false, message: 'Cost date required' });
    const total = +((+fuel_cost) + (+driver_cost) + (+toll_cost) + (+maintenance_cost) + (+other_costs)).toFixed(2);
    const [r] = await db.query(
      'INSERT INTO transportation_costs (cost_code,trip_id,vehicle_id,driver_id,fuel_cost,driver_cost,toll_cost,maintenance_cost,other_costs,total_cost,cost_date,remarks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [code('COST'), trip_id, vehicle_id, driver_id, fuel_cost, driver_cost, toll_cost, maintenance_cost, other_costs, total, cost_date, remarks]
    );
    res.status(201).json({ success: true, message: 'Cost record created', data: { id: r.insertId, total_cost: total } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to create cost record', error: e.message }); }
};

exports.update = async (req, res) => {
  try {
    const [[old]] = await db.query('SELECT * FROM transportation_costs WHERE id=?', [req.params.id]);
    if (!old) return res.status(404).json({ success: false, message: 'Record not found' });
    const g = (k) => (req.body[k] !== undefined ? +req.body[k] : +old[k]);
    const total = +(g('fuel_cost') + g('driver_cost') + g('toll_cost') + g('maintenance_cost') + g('other_costs')).toFixed(2);
    const allowed = ['trip_id', 'vehicle_id', 'driver_id', 'fuel_cost', 'driver_cost', 'toll_cost', 'maintenance_cost', 'other_costs', 'cost_date', 'remarks'];
    const f = ['total_cost=?'], p = [total];
    for (const k of allowed) if (req.body[k] !== undefined) { f.push(`${k}=?`); p.push(req.body[k]); }
    p.push(req.params.id);
    await db.query(`UPDATE transportation_costs SET ${f.join(',')} WHERE id=?`, p);
    res.json({ success: true, message: 'Cost record updated', data: { total_cost: total } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to update cost record' }); }
};

exports.archive = async (req, res) => {
  try { const [r]=await db.query('UPDATE transportation_costs SET archived_at=NOW() WHERE id=? AND archived_at IS NULL', [req.params.id]); if(r.affectedRows===0) return res.status(404).json({success:false,message:'Cost record not found or already archived'}); res.json({ success: true, message: 'Cost record archived' }); }
  catch (e) { res.status(500).json({ success: false, message: 'Failed to archive cost record' }); }
};
exports.restore = async (req, res) => {
  try { const [r]=await db.query('UPDATE transportation_costs SET archived_at=NULL WHERE id=? AND archived_at IS NOT NULL', [req.params.id]); if(r.affectedRows===0) return res.status(404).json({success:false,message:'Cost record not found or not archived'}); res.json({ success: true, message: 'Cost record restored' }); }
  catch(e){ res.status(500).json({ success: false, message: 'Failed to restore cost record' }); }
};
exports.remove = async (req, res) => { return exports.archive(req,res); };
