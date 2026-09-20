const db = require('../config/db');

const SENSITIVE_FIELDS = [
  'password',
  'otp',
  'otp_hash',
  'token',
  'access_token',
  'refresh_token',
  'session_secret',
  'jwt_secret',
  'authorization',
  'cookie',
  'set-cookie',
];

function sanitizeValues(values) {
  if (!values || typeof values !== 'object') return values;
  const sanitized = { ...values };
  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some(f => lowerKey.includes(f))) {
      sanitized[key] = '[REDACTED]';
    } else if (sanitized[key] && typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeValues(sanitized[key]);
    }
  }
  return sanitized;
}

function getClientIp(req) {
  return req.ip ||
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers?.['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    'unknown';
}

function getUserAgent(req) {
  return req.headers?.['user-agent'] || 'unknown';
}

function getRoute(req) {
  // Server-side request path only — never trust client-supplied routes.
  const raw = req?.originalUrl || req?.url || '';
  return String(raw).split('?')[0].slice(0, 255) || null;
}

function getMethod(req) {
  const m = req?.method ? String(req.method).toUpperCase().slice(0, 10) : null;
  return m || null;
}

// Columns for the activity trail (database/migrate-audit-activity.sql).
// Cached per process; inserts only reference columns that actually exist so
// old databases keep working and existing logs are never broken.
let auditColsCache = null;
async function getAuditColumns() {
  if (!auditColsCache) {
    const [rows] = await db.query('SHOW COLUMNS FROM audit_logs');
    auditColsCache = new Set(rows.map((r) => r.Field));
  }
  return auditColsCache;
}

async function createAuditLog({ req, action, module, resource = null, recordId = null, description = null, route = null, method = null, metadata = null, oldValues = null, newValues = null }) {
  try {
    const userId = req?.user?.id || null;
    const ipAddress = req ? getClientIp(req) : 'system';
    const userAgent = req ? getUserAgent(req) : 'system';
    // Server-derived request context — the frontend can suggest what was
    // opened, but WHO/WHEN/WHERE always come from the authenticated session.
    const finalRoute = (route || getRoute(req) || null);
    const finalMethod = (method || getMethod(req) || null);

    const sanitizedOld = oldValues ? sanitizeValues(oldValues) : null;
    const sanitizedNew = newValues ? sanitizeValues(newValues) : null;
    const sanitizedMeta = metadata ? sanitizeValues(metadata) : null;

    const cols = await getAuditColumns();
    const names = ['user_id', 'action', 'module'];
    const vals = [userId, action, module];
    const put = (name, value) => { if (cols.has(name) && value !== undefined) { names.push(name); vals.push(value); } };
    put('resource', resource ? String(resource).slice(0, 100) : null);
    put('record_id', recordId);
    put('description', description ? String(description).slice(0, 500) : null);
    put('route', finalRoute ? String(finalRoute).slice(0, 255) : null);
    put('method', finalMethod);
    put('old_values', sanitizedOld ? JSON.stringify(sanitizedOld) : null);
    put('new_values', sanitizedNew ? JSON.stringify(sanitizedNew) : null);
    put('ip_address', ipAddress);
    put('user_agent', userAgent);
    put('metadata', sanitizedMeta ? JSON.stringify(sanitizedMeta).slice(0, 8000) : null);

    const placeholders = names.map(() => '?').join(',');
    const [result] = await db.query(
      `INSERT INTO audit_logs (${names.join(',')}) VALUES (${placeholders})`,
      vals
    );

    return { success: true, auditId: result.insertId };
  } catch (error) {
    console.error('Audit log creation failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Fire-and-forget RECORD_VIEW for single-record reads. Never delays or
// breaks the response it annotates.
function auditRecordView(req, { module, resource, recordId = null, description = null, metadata = null }) {
  try {
    const p = createAuditLog({
      req,
      action: AUDIT_ACTIONS.VIEW.RECORD_VIEW,
      module,
      resource: resource || null,
      recordId,
      description,
      metadata,
    });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* auditing must never break reads */ }
}

const AUDIT_ACTIONS = {
  AUTH: {
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGIN_FAILED: 'LOGIN_FAILED',
    LOGOUT: 'LOGOUT',
  },
  USERS: {
    CREATED: 'USER_CREATED',
    UPDATED: 'USER_UPDATED',
    ARCHIVED: 'USER_ARCHIVED',
    RESTORED: 'USER_RESTORED',
  },
  VEHICLES: {
    CREATED: 'VEHICLE_CREATED',
    UPDATED: 'VEHICLE_UPDATED',
    ARCHIVED: 'VEHICLE_ARCHIVED',
    RESTORED: 'VEHICLE_RESTORED',
  },
  DRIVERS: {
    CREATED: 'DRIVER_CREATED',
    UPDATED: 'DRIVER_UPDATED',
    ARCHIVED: 'DRIVER_ARCHIVED',
    RESTORED: 'DRIVER_RESTORED',
  },
  RESERVATIONS: {
    CREATED: 'RESERVATION_CREATED',
    UPDATED: 'RESERVATION_UPDATED',
    APPROVED: 'RESERVATION_APPROVED',
    REJECTED: 'RESERVATION_REJECTED',
    ARCHIVED: 'RESERVATION_ARCHIVED',
    RESTORED: 'RESERVATION_RESTORED',
  },
  TRIPS: {
    CREATED: 'TRIP_CREATED',
    UPDATED: 'TRIP_UPDATED',
    STATUS_CHANGED: 'TRIP_STATUS_CHANGED',
    ARCHIVED: 'TRIP_ARCHIVED',
    RESTORED: 'TRIP_RESTORED',
  },
  ROUTES: {
    CREATED: 'ROUTE_CREATED',
    UPDATED: 'ROUTE_UPDATED',
    STATUS_CHANGED: 'ROUTE_STATUS_CHANGED',
    ARCHIVED: 'ROUTE_ARCHIVED',
    RESTORED: 'ROUTE_RESTORED',
  },
  FUEL: {
    CREATED: 'FUEL_TRANSACTION_CREATED',
    UPDATED: 'FUEL_TRANSACTION_UPDATED',
    ARCHIVED: 'FUEL_TRANSACTION_ARCHIVED',
    RECEIPT_UPLOADED: 'FUEL_RECEIPT_UPLOADED',
  },
  COSTS: {
    CREATED: 'COST_CREATED',
    UPDATED: 'COST_UPDATED',
    ARCHIVED: 'COST_ARCHIVED',
  },
  SOS: {
    TRIGGERED: 'SOS_TRIGGERED',
    VIEWED: 'SOS_VIEWED',
    RESOLVED: 'SOS_RESOLVED',
    CANCELLED: 'SOS_CANCELLED',
  },
  TRACKING: {
    LOCATION_INGESTED: 'TRACKING_LOCATION_INGESTED',
  },
  SETTINGS: {
    UPDATED: 'SETTINGS_UPDATED',
  },
  VIEW: {
    MODULE_VIEW: 'MODULE_VIEW',
    RECORD_VIEW: 'RECORD_VIEW',
  },
};

module.exports = {
  createAuditLog,
  auditRecordView,
  getAuditColumns,
  sanitizeValues,
  getClientIp,
  getUserAgent,
  AUDIT_ACTIONS,
};