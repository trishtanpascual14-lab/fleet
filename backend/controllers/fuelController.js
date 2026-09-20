const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const { code, notify } = require('../utils/helpers');
const { createAuditLog, auditRecordView, AUDIT_ACTIONS } = require('../utils/audit');
const { UPLOAD_DIR, saveReceiptFile, deleteReceiptFile } = require('../utils/receiptUpload');
const { FUEL_TYPES: VALID_FUEL_TYPES, isFuelType } = require('../utils/fuelTypes');

// Cached fuel_records column set — the receipt/ocr columns come from
// database/migrate-fuel-receipt.sql and may be absent on old databases.
// The insert below only references columns that actually exist.
let fuelColsCache = null;
async function getFuelColumns() {
  if (!fuelColsCache) {
    const [rows] = await db.query('SHOW COLUMNS FROM fuel_records');
    fuelColsCache = new Set(rows.map((r) => r.Field));
  }
  return fuelColsCache;
}

// Strict server-side validation — OCR values from the client are untrusted.
function validateFuelInput(b) {
  const errors = {};
  const vehicle_id = b.vehicle_id === '' || b.vehicle_id === undefined ? null : +b.vehicle_id;
  if (!vehicle_id || !Number.isInteger(vehicle_id) || vehicle_id <= 0) errors.vehicle_id = 'Vehicle is required.';
  const record_date = b.record_date ? String(b.record_date).slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record_date) || Number.isNaN(new Date(`${record_date}T00:00:00`).getTime())) {
    errors.record_date = 'A valid transaction date (YYYY-MM-DD) is required.';
  }
  const fuel_type = b.fuel_type ? String(b.fuel_type).trim() : 'Diesel';
  if (!isFuelType(fuel_type)) errors.fuel_type = `Fuel type must be one of: ${VALID_FUEL_TYPES.join(', ')}.`;
  const liters = b.liters === '' || b.liters === undefined ? NaN : +b.liters;
  if (!Number.isFinite(liters) || liters <= 0) errors.liters = 'Liters must be numeric and greater than 0.';
  else if (liters > 10000) errors.liters = 'Liters value is unrealistically large.';
  const price = b.price_per_liter === '' || b.price_per_liter === undefined ? NaN : +b.price_per_liter;
  if (!Number.isFinite(price) || price <= 0) errors.price_per_liter = 'Price per liter must be numeric and greater than 0.';
  else if (price > 100000) errors.price_per_liter = 'Price per liter value is unrealistically large.';
  let odometer_reading = null;
  if (b.odometer_reading !== '' && b.odometer_reading !== undefined && b.odometer_reading !== null) {
    odometer_reading = +b.odometer_reading;
    if (!Number.isInteger(odometer_reading) || odometer_reading < 0) errors.odometer_reading = 'Odometer must be a non-negative whole number.';
  }
  const cleanText = (v, max) => {
    if (v === undefined || v === null) return null;
    const s = String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
    return s === '' ? null : s;
  };
  const fuel_station = cleanText(b.fuel_station, 150);
  const rawRef = b.receipt_reference === undefined || b.receipt_reference === null ? '' : String(b.receipt_reference).trim();
  let receipt_reference = cleanText(b.receipt_reference, 100);
  if (rawRef.length > 100) {
    errors.receipt_reference = 'Receipt reference must be at most 100 characters.';
  } else if (receipt_reference && !/^[A-Za-z0-9][A-Za-z0-9\-/#.\s]{0,99}$/.test(receipt_reference)) {
    errors.receipt_reference = 'Receipt reference must start with a letter or digit and be at most 100 characters.';
  }
  const notes = cleanText(b.notes, 1000);
  return { errors, values: { vehicle_id, record_date, fuel_type, liters, price_per_liter: price, odometer_reading, fuel_station, receipt_reference, notes } };
}

exports.list = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20, from = '', to = '', vehicle_id = '', driver_id = '', fuel_type = '', archived = '' } = req.query;
    const where = []; const p = [];
    if (archived === '1' || archived === 'true') where.push('f.archived_at IS NOT NULL');
    else if (archived === 'all') { /* no filter */ }
    else where.push('f.archived_at IS NULL');
    if (search) { where.push('(f.fuel_code LIKE ? OR v.plate_number LIKE ? OR f.fuel_station LIKE ? OR f.receipt_reference LIKE ?)'); p.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    if (from) { where.push('f.record_date>=?'); p.push(from); }
    if (to) { where.push('f.record_date<=?'); p.push(to); }
    if (vehicle_id) { where.push('f.vehicle_id=?'); p.push(vehicle_id); }
    if (driver_id) { where.push('f.driver_id=?'); p.push(driver_id); }
    if (fuel_type) { where.push('f.fuel_type=?'); p.push(fuel_type); }
    // drivers may only list their own fuel records
    if (req.user.role === 'driver') {
      if (!req.user.driver_id) return res.json({ success: true, data: [], pagination: { total: 0, page: 1, limit: +limit } });
      where.push('f.driver_id=?'); p.push(req.user.driver_id);
    }
    const [[{ c }]] = await db.query(`SELECT COUNT(*) c FROM fuel_records f JOIN vehicles v ON v.id=f.vehicle_id WHERE ${where.join(' AND ')}`, p);
    const off = (Math.max(1, +page) - 1) * +limit;
    const [rows] = await db.query(
      `SELECT f.*, v.plate_number, v.fuel_type AS vehicle_fuel_type, d.full_name AS driver_name, t.trip_code, u.name AS created_by_name FROM fuel_records f
       JOIN vehicles v ON v.id=f.vehicle_id LEFT JOIN drivers d ON d.id=f.driver_id LEFT JOIN trips t ON t.id=f.trip_id
       LEFT JOIN users u ON u.id=f.created_by
       WHERE ${where.join(' AND ')} ORDER BY f.id DESC LIMIT ? OFFSET ?`, [...p, +limit, off]);
    res.json({ success: true, data: rows, pagination: { total: c, page: +page, limit: +limit } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch fuel records' }); }
};

exports.get = async (req, res) => {
  try {
    const [[f]] = await db.query(
      `SELECT f.*, v.plate_number, v.fuel_type AS vehicle_fuel_type, d.full_name AS driver_name, t.trip_code, u.name AS created_by_name FROM fuel_records f
       JOIN vehicles v ON v.id=f.vehicle_id LEFT JOIN drivers d ON d.id=f.driver_id LEFT JOIN trips t ON t.id=f.trip_id
       LEFT JOIN users u ON u.id=f.created_by WHERE f.id=?`, [req.params.id]);
    if (!f) return res.status(404).json({ success: false, message: 'Fuel record not found' });
    if (req.user.role === 'driver' && f.driver_id !== req.user.driver_id) {
      return res.status(403).json({ success: false, message: 'Forbidden: fuel record of another driver' });
    }
    auditRecordView(req, {
      module: 'fuel', resource: 'Fuel Transaction', recordId: f.id,
      description: `Viewed fuel transaction ${f.fuel_code || `#${f.id}`}`,
      metadata: { fuel_code: f.fuel_code || null },
    });
    res.json({ success: true, data: f });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch fuel record' }); }
};

exports.summary = async (req, res) => {
  try {
    const [[t]] = await db.query('SELECT COALESCE(SUM(liters),0) liters, COALESCE(SUM(total_cost),0) cost, COUNT(*) n, COALESCE(AVG(total_cost),0) avg_cost FROM fuel_records');
    const [perVehicle] = await db.query('SELECT v.plate_number, SUM(f.liters) liters, SUM(f.total_cost) cost FROM fuel_records f JOIN vehicles v ON v.id=f.vehicle_id GROUP BY v.id ORDER BY cost DESC LIMIT 10');
    const [trend] = await db.query("SELECT DATE_FORMAT(record_date,'%Y-%m') m, SUM(liters) liters, SUM(total_cost) cost FROM fuel_records GROUP BY m ORDER BY m DESC LIMIT 12");
    const [[s]] = await db.query("SELECT setting_value FROM settings WHERE setting_key='fuel_high_cost_threshold'");
    const threshold = +(s ? s.setting_value : 5000);
    const [waste] = await db.query('SELECT f.*, v.plate_number FROM fuel_records f JOIN vehicles v ON v.id=f.vehicle_id WHERE f.total_cost > ? ORDER BY f.total_cost DESC LIMIT 20', [threshold]);
    res.json({ success: true, data: { totals: t, perVehicle, trend: trend.reverse(), wastage: waste, threshold } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch fuel summary' }); }
};

exports.create = async (req, res) => {
  let savedReceipt = null;
  try {
    let { driver_id = null, trip_id = null } = req.body;
    const { errors, values } = validateFuelInput(req.body || {});
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }
    const { vehicle_id, record_date, fuel_type, liters, price_per_liter, odometer_reading, fuel_station, receipt_reference, notes } = values;
    // drivers record fuel only for themselves and their authorized vehicle
    if (req.user && req.user.role === 'driver') {
      if (!req.user.driver_id) return res.status(403).json({ success: false, message: 'No driver profile linked to this account' });
      driver_id = req.user.driver_id;
      const [[d]] = await db.query('SELECT assigned_vehicle_id FROM drivers WHERE id=?', [driver_id]);
      const [[own]] = await db.query('SELECT id FROM trips WHERE driver_id=? AND vehicle_id=? LIMIT 1', [driver_id, vehicle_id]);
      if ((!d || +d.assigned_vehicle_id !== +vehicle_id) && !own) {
        return res.status(403).json({ success: false, message: 'Vehicle not assigned to this driver' });
      }
    }
    if (trip_id !== null && trip_id !== undefined && trip_id !== '') {
      trip_id = +trip_id;
      if (!Number.isInteger(trip_id) || trip_id <= 0) return res.status(400).json({ success: false, message: 'Validation failed', errors: { trip_id: 'Invalid trip.' } });
    } else {
      trip_id = null;
    }
    // Validate + persist the receipt image (if attached) before inserting.
    // Requires the receipt_* columns (database/migrate-fuel-receipt.sql):
    // fail loudly instead of silently dropping the customer's receipt.
    const cols = await getFuelColumns();
    const hasReceiptCols = cols.has('receipt_path') && cols.has('receipt_original_name')
      && cols.has('receipt_mime') && cols.has('receipt_size') && cols.has('receipt_uploaded_at');
    if (req.file && !hasReceiptCols) {
      return res.status(500).json({ success: false, message: 'Database missing receipt columns — run database/migrate-fuel-receipt.sql' });
    }
    if (req.file) {
      try {
        savedReceipt = saveReceiptFile(req.file);
      } catch (e) {
        return res.status(e.statusCode || 400).json({ success: false, message: 'Validation failed', errors: { receipt: e.message } });
      }
    }
    // OCR extraction snapshot (JSON ≤ 8 KB) — what the scanner detected at
    // save time, kept even if the user corrected fields afterwards.
    let ocr_snapshot = null;
    if (typeof req.body.ocr_snapshot === 'string' && req.body.ocr_snapshot.length > 0 && req.body.ocr_snapshot.length <= 8000 && cols.has('ocr_snapshot')) {
      try {
        const o = JSON.parse(req.body.ocr_snapshot);
        if (o && typeof o === 'object' && o.receipt && typeof o.receipt === 'object') ocr_snapshot = req.body.ocr_snapshot;
      } catch { /* not valid JSON — ignore */ }
    }
    const total = +(liters * price_per_liter).toFixed(2);
    let insertId;
    try {
      // Only reference columns that exist (old DBs without the migration).
      const colNames = ['fuel_code', 'vehicle_id', 'driver_id', 'trip_id', 'record_date', 'fuel_type', 'liters', 'price_per_liter', 'total_cost', 'odometer_reading', 'fuel_station', 'receipt_reference', 'notes'];
      const colVals = [code('FUEL'), vehicle_id, driver_id, trip_id, record_date, fuel_type, liters, price_per_liter, total, odometer_reading, fuel_station, receipt_reference, notes];
      if (savedReceipt) {
        if (cols.has('receipt_path')) { colNames.push('receipt_path'); colVals.push(savedReceipt.receipt_path); }
        if (cols.has('receipt_original_name')) { colNames.push('receipt_original_name'); colVals.push(savedReceipt.receipt_original_name); }
        if (cols.has('receipt_mime')) { colNames.push('receipt_mime'); colVals.push(savedReceipt.receipt_mime); }
        if (cols.has('receipt_size')) { colNames.push('receipt_size'); colVals.push(savedReceipt.receipt_size); }
        if (cols.has('receipt_uploaded_at')) { colNames.push('receipt_uploaded_at'); colVals.push(new Date()); }
      }
      if (ocr_snapshot !== null && cols.has('ocr_snapshot')) { colNames.push('ocr_snapshot'); colVals.push(ocr_snapshot); }
      if (cols.has('created_by')) { colNames.push('created_by'); colVals.push(req.user ? req.user.id : null); }
      const placeholders = colNames.map(() => '?').join(',');
      const [r] = await db.query(
        `INSERT INTO fuel_records (${colNames.join(',')}) VALUES (${placeholders})`,
        colVals
      );
      insertId = r.insertId;
    } catch (e) {
      if (savedReceipt) deleteReceiptFile(savedReceipt.receipt_path); // no orphan files
      throw e;
    }
    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.FUEL.CREATED,
      module: 'fuel',
      recordId: insertId,
      newValues: { fuel_code: code('FUEL'), vehicle_id, driver_id, trip_id, record_date, fuel_type, liters, price_per_liter, total_cost: total, odometer_reading, fuel_station, receipt_reference, notes, receipt: savedReceipt, created_by: req.user ? req.user.id : null }
    });
    const [[s]] = await db.query("SELECT setting_value FROM settings WHERE setting_key='fuel_high_cost_threshold'");
    if (+(s ? s.setting_value : 5000) && total > +(s.setting_value)) {
      await notify({ targetRole: 'fleet_manager', title: 'High fuel consumption', message: `Fuel record ₱${total} exceeds threshold`, linkType: 'fuel', linkId: insertId });
    }
    res.status(201).json({ success: true, message: 'Fuel transaction saved successfully.', data: { id: insertId, total_cost: total, receipt: savedReceipt } });
  } catch (e) {
    if (savedReceipt) deleteReceiptFile(savedReceipt.receipt_path);
    res.status(500).json({ success: false, message: 'Failed to create fuel record', error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const [[old]] = await db.query('SELECT * FROM fuel_records WHERE id=?', [req.params.id]);
    if (!old) return res.status(404).json({ success: false, message: 'Record not found' });
    const liters = req.body.liters !== undefined ? +req.body.liters : +old.liters;
    const price = req.body.price_per_liter !== undefined ? +req.body.price_per_liter : +old.price_per_liter;
    const total = +(liters * price).toFixed(2);
    const allowed = ['vehicle_id', 'driver_id', 'trip_id', 'record_date', 'fuel_type', 'liters', 'price_per_liter', 'odometer_reading', 'fuel_station', 'receipt_reference', 'notes'];
    const f = ['total_cost=?'], p = [total];
    for (const k of allowed) if (req.body[k] !== undefined) { f.push(`${k}=?`); p.push(req.body[k]); }
    p.push(req.params.id);
    await db.query(`UPDATE fuel_records SET ${f.join(',')} WHERE id=?`, p);

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.FUEL.UPDATED,
      module: 'fuel',
      recordId: req.params.id,
      oldValues: old,
      newValues: req.body
    });

    res.json({ success: true, message: 'Fuel record updated', data: { total_cost: total } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to update fuel record' }); }
};

exports.archive = async (req, res) => {
  try { 
    const [[oldFuel]] = await db.query('SELECT * FROM fuel_records WHERE id=?', [req.params.id]);
    if (!oldFuel) return res.status(404).json({ success: false, message: 'Fuel record not found' });
    
    const [r]=await db.query('UPDATE fuel_records SET archived_at=NOW() WHERE id=? AND archived_at IS NULL', [req.params.id]); 
    if(r.affectedRows===0) return res.status(404).json({success:false,message:'Fuel record not found or already archived'});

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.FUEL.ARCHIVED,
      module: 'fuel',
      recordId: req.params.id,
      oldValues: oldFuel,
      newValues: { archived: true }
    });

    res.json({ success: true, message: 'Fuel record archived' }); 
  }
  catch (e) { res.status(500).json({ success: false, message: 'Failed to archive fuel record' }); }
};
exports.restore = async (req, res) => {
  try { 
    const [[oldFuel]] = await db.query('SELECT * FROM fuel_records WHERE id=?', [req.params.id]);
    if (!oldFuel) return res.status(404).json({ success: false, message: 'Fuel record not found' });
    
    const [r]=await db.query('UPDATE fuel_records SET archived_at=NULL WHERE id=? AND archived_at IS NOT NULL', [req.params.id]); 
    if(r.affectedRows===0) return res.status(404).json({success:false,message:'Fuel record not found or not archived'});

    await createAuditLog({
      req,
      action: AUDIT_ACTIONS.FUEL.ARCHIVED,
      module: 'fuel',
      recordId: req.params.id,
      oldValues: { archived: true },
      newValues: oldFuel
    });

    res.json({ success: true, message: 'Fuel record restored' }); 
  }
  catch(e){ res.status(500).json({ success: false, message: 'Failed to restore fuel record' }); }
};
// GET /fuel/:id/receipt — view/download the attached receipt image (authenticated).
// Use ?download=1 for a download (Content-Disposition: attachment).
exports.receipt = async (req, res) => {
  try {
    const [[f]] = await db.query('SELECT id, driver_id, receipt_path, receipt_original_name, receipt_mime FROM fuel_records WHERE id=?', [req.params.id]);
    if (!f || !f.receipt_path) return res.status(404).json({ success: false, message: 'Receipt attachment not found' });
    if (req.user.role === 'driver' && f.driver_id !== req.user.driver_id) {
      return res.status(403).json({ success: false, message: 'Forbidden: fuel record of another driver' });
    }
    // Attachment opened from the Audit Log Details modal — record who viewed
    // which file, when, and from which audit record (server-side trail).
    if (req.query.context === 'audit') {
      auditRecordView(req, {
        module: 'fuel',
        resource: 'Fuel Receipt',
        recordId: f.id,
        description: `Viewed receipt attachment ${f.receipt_original_name || f.receipt_path} for fuel transaction #${f.id} (via audit log #${req.query.audit_id || 'N/A'})`,
        metadata: {
          file_name: f.receipt_original_name || null,
          file_path: f.receipt_path || null,
          audit_id: req.query.audit_id !== undefined ? String(req.query.audit_id).slice(0, 20) : null,
        },
      });
    }
    const abs = path.join(UPLOAD_DIR, path.basename(String(f.receipt_path)));
    if (!abs.startsWith(UPLOAD_DIR) || !fs.existsSync(abs)) {
      return res.status(404).json({ success: false, message: 'Receipt file missing on server' });
    }
    if (f.receipt_mime) res.type(f.receipt_mime);
    if (req.query.download === '1') {
      const safe = String(f.receipt_original_name || `receipt-${f.id}`).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100) || `receipt-${f.id}`;
      res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
    }
    res.sendFile(abs);
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to load receipt attachment' }); }
};
exports.remove = async (req, res) => { return exports.archive(req,res); };
