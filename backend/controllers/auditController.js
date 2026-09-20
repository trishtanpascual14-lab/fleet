const db = require('../config/db');
const { createAuditLog, auditRecordView, getAuditColumns, AUDIT_ACTIONS } = require('../utils/audit');

// Modules the frontend may report as opened. Everything else is rejected —
// the record itself (user, role, IP, route, method, timestamp) is always
// server-derived from the authenticated session, never from the client.
const MODULE_VIEW_ALLOWLIST = {
  dashboard: { module: 'dashboard', resource: 'Dashboard', description: 'Opened Dashboard module' },
  vehicles: { module: 'vehicles', resource: 'Fleet & Vehicles', description: 'Opened Fleet & Vehicles module' },
  reservations: { module: 'reservations', resource: 'Reservations', description: 'Opened Reservations module' },
  dispatch: { module: 'dispatch', resource: 'Dispatch', description: 'Opened Dispatch module' },
  drivers: { module: 'drivers', resource: 'Drivers', description: 'Opened Drivers module' },
  trips: { module: 'trips', resource: 'Trips', description: 'Opened Trips module' },
  routes: { module: 'routes', resource: 'Route Planning', description: 'Opened Route Planning module' },
  tracking: { module: 'tracking', resource: 'Vehicle Tracking', description: 'Opened Vehicle Tracking module' },
  fuel: { module: 'fuel', resource: 'Fuel Management', description: 'Opened Fuel Management module' },
  costs: { module: 'costs', resource: 'Transport Costs', description: 'Opened Transport Costs module' },
  reports: { module: 'reports', resource: 'Reports', description: 'Opened Reports module' },
  notifications: { module: 'notifications', resource: 'Notifications', description: 'Opened Notifications module' },
  users: { module: 'users', resource: 'Users', description: 'Opened Users module' },
  settings: { module: 'settings', resource: 'Settings', description: 'Opened Settings module' },
  archive: { module: 'archive', resource: 'Archive', description: 'Opened Archive module' },
  audit: { module: 'audit', resource: 'Audit Logs', description: 'Opened Audit Logs module' },
};

// POST /audit-logs/module-view { module } — records a module open.
// The client only names the module; WHO/WHEN/WHERE come from the session.
exports.moduleView = async (req, res) => {
  try {
    const key = String(req.body?.module || '').trim().toLowerCase();
    const entry = MODULE_VIEW_ALLOWLIST[key];
    if (!entry) return res.status(400).json({ success: false, message: 'Unknown module.' });
    const r = await createAuditLog({
      req,
      action: AUDIT_ACTIONS.VIEW.MODULE_VIEW,
      module: entry.module,
      resource: entry.resource,
      description: entry.description,
      metadata: { client_route: typeof req.body?.route === 'string' ? req.body.route.slice(0, 255) : null },
    });
    if (!r.success) return res.status(500).json({ success: false, message: 'Failed to record module view' });
    res.status(201).json({ success: true, data: { id: r.auditId } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to record module view', error: e.message }); }
};

// Never let one malformed JSON row break the whole response.
function safeParse(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return v; }
}

exports.list = async (req, res) => {
  try {
    const { 
      search = '', 
      action = '', 
      module = '', 
      user_id = '', 
      from = '', 
      to = '', 
      page = 1, 
      limit = 50 
    } = req.query;

    const where = ['1=1'];
    const p = [];

    if (search) {
      const cols = await getAuditColumns();
      if (cols.has('description') && cols.has('resource')) {
        where.push('(JSON_UNQUOTE(JSON_EXTRACT(new_values, "$.email")) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(old_values, "$.email")) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(new_values, "$.name")) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(old_values, "$.name")) LIKE ? OR al.description LIKE ? OR al.resource LIKE ? OR al.action LIKE ?)');
        p.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      } else {
        where.push('(JSON_UNQUOTE(JSON_EXTRACT(new_values, "$.email")) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(old_values, "$.email")) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(new_values, "$.name")) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(old_values, "$.name")) LIKE ?)');
        p.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
    }
    if (action) { where.push('al.action=?'); p.push(action); }
    if (module) { where.push('al.module=?'); p.push(module); }
    if (user_id) { where.push('al.user_id=?'); p.push(user_id); }
    if (from) { where.push('DATE(al.created_at)>=?'); p.push(from); }
    if (to) { where.push('DATE(al.created_at)<=?'); p.push(to); }

    const whereSql = where.join(' AND ');
    const [[{ c }]] = await db.query(`SELECT COUNT(*) c FROM audit_logs al WHERE ${whereSql}`, p);
    const off = (Math.max(1, +page) - 1) * +limit;

    const [rows] = await db.query(
      `SELECT al.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM audit_logs al
       LEFT JOIN users u ON u.id=al.user_id
       WHERE ${whereSql} ORDER BY al.id DESC LIMIT ? OFFSET ?`,
      [...p, +limit, off]
    );

    // Parse JSON fields for display
    const parsedRows = rows.map(row => ({
      ...row,
      old_values: safeParse(row.old_values),
      new_values: safeParse(row.new_values),
      metadata: safeParse(row.metadata !== undefined ? row.metadata : null)
    }));

    res.json({ success: true, data: parsedRows, pagination: { total: c, page: +page, limit: +limit } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch audit logs', error: e.message }); }
};

exports.get = async (req, res) => {
  try {
    const [[log]] = await db.query(
      `SELECT al.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM audit_logs al
       LEFT JOIN users u ON u.id=al.user_id
       WHERE al.id=?`,
      [req.params.id]
    );
    if (!log) return res.status(404).json({ success: false, message: 'Audit log not found' });

    auditRecordView(req, {
      module: 'audit',
      resource: 'Audit Logs',
      recordId: log.id,
      description: `Viewed audit log #${log.id} (${log.action})`,
      metadata: { viewed_action: log.action, viewed_module: log.module },
    });

    res.json({ 
      success: true, 
      data: {
        ...log,
        old_values: safeParse(log.old_values),
        new_values: safeParse(log.new_values),
        metadata: safeParse(log.metadata !== undefined ? log.metadata : null)
      }
    });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch audit log', error: e.message }); }
};

exports.getActions = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
    res.json({ success: true, data: rows.map(r => r.action) });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch actions', error: e.message }); }
};

exports.getModules = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT DISTINCT module FROM audit_logs ORDER BY module');
    res.json({ success: true, data: rows.map(r => r.module) });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch modules', error: e.message }); }
};

exports.getStats = async (req, res) => {
  try {
    const [total] = await db.query('SELECT COUNT(*) as count FROM audit_logs');
    const [byModule] = await db.query('SELECT module, COUNT(*) as count FROM audit_logs GROUP BY module ORDER BY count DESC');
    const [byAction] = await db.query('SELECT action, COUNT(*) as count FROM audit_logs GROUP BY action ORDER BY count DESC LIMIT 20');
    const [byUser] = await db.query(
      `SELECT u.name, u.email, u.role, COUNT(*) as count 
       FROM audit_logs al JOIN users u ON u.id=al.user_id 
       GROUP BY u.id ORDER BY count DESC LIMIT 10`
    );
    const [byDay] = await db.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count 
       FROM audit_logs 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) 
       GROUP BY DATE(created_at) ORDER BY date DESC`
    );

    res.json({ success: true, data: { total: total[0].count, byModule, byAction, byUser, byDay } });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed to fetch stats', error: e.message }); }
};