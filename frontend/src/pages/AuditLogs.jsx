import { useState, useEffect } from 'react';
import api from '../services/api';
import { format } from 'date-fns';
import { Modal } from '../components/ui';

// Friendly labels for known audit payload keys (fuel first, then generic).
const FIELD_LABELS = {
  fuel_code: 'Fuel Transaction ID',
  vehicle_id: 'Vehicle',
  plate_number: 'Vehicle',
  driver_id: 'Driver',
  trip_id: 'Trip',
  record_date: 'Date',
  fuel_type: 'Fuel Type',
  liters: 'Liters',
  price_per_liter: 'Price/Liter',
  total_cost: 'Total Cost',
  odometer_reading: 'Odometer',
  fuel_station: 'Fuel Station',
  receipt_reference: 'Receipt/Reference',
  notes: 'Notes',
  created_by: 'Created By',
  archived: 'Archived',
  name: 'Name',
  email: 'Email',
  role: 'Role',
};
const PESO_KEYS = new Set(['price_per_liter', 'total_cost']);

const prettyKey = (k) => FIELD_LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const isNA = (v) => v === null || v === undefined || v === '';
const showVal = (v) => (isNA(v) ? 'N/A' : String(v));
const fmtPeso = (k, v) => (PESO_KEYS.has(k) && v !== null && v !== undefined && v !== '' && !isNaN(Number(v)) ? `₱${v}` : showVal(v));

// A stored receipt attachment object (fuel audit payloads carry
// new_values.receipt = { receipt_path, receipt_original_name, ... }).
function findReceipt(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const r = obj.receipt;
  if (r && typeof r === 'object' && (r.receipt_path || r.receipt_original_name)) return r;
  return null;
}

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 50 });
  const [filters, setFilters] = useState({
    search: '',
    action: '',
    module: '',
    user_id: '',
    from: '',
    to: ''
  });
  const [actions, setActions] = useState([]);
  const [modules, setModules] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  // Receipt preview state — always visible feedback, never a dead button.
  const [preview, setPreview] = useState(null); // { url, kind: 'image'|'pdf'|'downloaded', name, mime }
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const fetchLogs = async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString(),
        ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v))
      });
      const res = await api.get(`/audit-logs?${params}`);
      setLogs(res.data.data);
      setPagination(prev => ({ ...prev, total: res.data.pagination.total, page: res.data.pagination.page }));
    } catch (e) {
      console.error('Failed to fetch audit logs:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchActions = async () => {
    try {
      const res = await api.get('/audit-logs/actions');
      setActions(res.data.data);
    } catch (e) {
      console.error('Failed to fetch actions:', e);
    }
  };

  const fetchModules = async () => {
    try {
      const res = await api.get('/audit-logs/modules');
      setModules(res.data.data);
    } catch (e) {
      console.error('Failed to fetch modules:', e);
    }
  };

  useEffect(() => {
    fetchLogs(1);
    fetchActions();
    fetchModules();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchLogs(filters.page || 1), 300);
    return () => clearTimeout(timer);
  }, [filters, pagination.limit]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handlePageChange = (page) => {
    setPagination(prev => ({ ...prev, page }));
    fetchLogs(page);
  };

  // Fetch the EXACT record behind the clicked row — never reuse another row's data.
  const handleViewLog = async (log) => {
    const id = log?.id;
    if (id === null || id === undefined) return;
    setSelectedLog(null);
    setDetailError('');
    setDetailLoading(true);
    setShowModal(true);
    closePreview();
    try {
      const res = await api.get(`/audit-logs/${id}`);
      setSelectedLog(res.data.data);
    } catch (e) {
      setDetailError(e.response?.data?.message || 'Failed to load audit log details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedLog(null);
    setDetailError('');
    closePreview();
  };

  // Revokes the blob URL and clears all preview UI state.
  const closePreview = () => {
    setPreview((p) => {
      if (p?.url) { try { URL.revokeObjectURL(p.url); } catch { /* ignore */ } }
      return null;
    });
    setPreviewError('');
    setPreviewLoading(false);
  };

  // Receipt open: always produces a visible response. The file endpoint needs
  // the Bearer token, so fetch as blob (never a plain unauthenticated link,
  // never the bare filename as URL). Images open in a lightbox, PDFs in the
  // browser viewer (inline fallback if the popup is blocked), anything else
  // downloads. Missing files show "Attachment unavailable".
  const openReceipt = async () => {
    const log = selectedLog;
    const stored = findReceipt(log?.new_values) || findReceipt(log?.old_values);
    const fuelId = log?.module === 'fuel' ? log?.record_id : null;
    if (!fuelId) {
      setPreviewError('Attachment unavailable for this record.');
      return;
    }
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await api.get(
        `/fuel/${fuelId}/receipt?context=audit&audit_id=${log.id}`,
        { responseType: 'blob' }
      );
      const mime = res.headers['content-type'] || stored?.receipt_mime || 'application/octet-stream';
      const name = stored?.receipt_original_name || stored?.receipt_path || `receipt-${fuelId}`;
      const url = URL.createObjectURL(new Blob([res.data], { type: mime }));
      if (mime.startsWith('image/')) {
        setPreview({ url, kind: 'image', name, mime });
      } else if (mime === 'application/pdf') {
        const w = window.open(url, '_blank', 'noopener');
        if (w) {
          // New tab owns the URL now; revoke our reference later.
          setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 60000);
        } else {
          // Popup blocked — fall back to the inline viewer below.
          setPreview({ url, kind: 'pdf', name, mime });
        }
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = String(name).split('/').pop() || `receipt-${fuelId}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 10000);
        setPreview({ url: null, kind: 'downloaded', name, mime });
      }
    } catch (e) {
      const status = e.response?.status;
      setPreviewError(
        status === 404
          ? 'Attachment unavailable — the file is missing on the server.'
          : 'Could not load the attachment. Please try again.'
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'N/A';
    return format(d, 'yyyy-MM-dd HH:mm:ss');
  };

  const formatTimestamp = (dateStr) => {
    if (!dateStr) return { epoch: 'N/A', long: null };
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { epoch: 'N/A', long: null };
    return { epoch: String(d.getTime()), long: format(d, 'MMMM d, yyyy, h:mm:ss a') };
  };

  const formatDateOnly = (dateStr) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'N/A';
    return format(d, 'yyyy-MM-dd');
  };

  const formatTimeOnly = (dateStr) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'N/A';
    return format(d, 'HH:mm:ss');
  };

  // Metadata may arrive parsed or as a raw JSON string — normalize it.
  const asObject = (v) => {
    if (!v) return null;
    if (typeof v === 'object') return v;
    try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : null; } catch { return null; }
  };

  const formatJson = (obj) => {
    if (obj === null || obj === undefined) return 'N/A';
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  // Readable key→value rows for an audit payload object (skips the nested
  // receipt object — it gets its own Attachment section below).
  const detailRows = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const entries = Object.entries(obj).filter(([k, v]) => k !== 'receipt' && v !== null && v !== undefined && v !== '' && typeof v !== 'object');
    if (!entries.length) return null;
    return entries.map(([k, v]) => ({ label: prettyKey(k), display: fmtPeso(k, v) }));
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
        <div className="flex gap-2">
          <span className="px-3 py-1 text-sm text-gray-600 bg-gray-100 rounded">
            Total: {pagination.total} records
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              placeholder="Search in email, name..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
            <select
              value={filters.action}
              onChange={(e) => handleFilterChange('action', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Actions</option>
              {actions.map(action => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Module</label>
            <select
              value={filters.module}
              onChange={(e) => handleFilterChange('module', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Modules</option>
              {modules.map(module => (
                <option key={module} value={module}>{module}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">User ID</label>
            <input
              type="number"
              value={filters.user_id}
              onChange={(e) => handleFilterChange('user_id', e.target.value)}
              placeholder="User ID"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date From</label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => handleFilterChange('from', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date To</label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => handleFilterChange('to', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            onClick={() => setFilters({ search: '', action: '', module: '', user_id: '', from: '', to: '' })}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading audit logs...</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Module</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Resource</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Record ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => handleViewLog(log)}>
                      <td className="px-4 py-3 text-sm text-gray-900">{log.id}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                          {log.module}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {log.user_name || (log.user_email ? `${log.user_email} (${log.user_role})` : 'System')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{log.resource || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{log.record_id || '-'}</td>
                      <td className="max-w-xs truncate px-4 py-3 text-sm text-gray-500" title={log.description || ''}>{log.description || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{log.ip_address || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDateTime(log.created_at)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleViewLog(log); }}
                          className="text-blue-600 hover:text-blue-900 font-medium"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.total > 0 && (
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  Showing page {pagination.page} of {Math.ceil(pagination.total / pagination.limit)} ({pagination.total} total)
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page === 1}
                    className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page >= Math.ceil(pagination.total / pagination.limit)}
                    className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Audit Log Details modal — read-only, per-record data only */}
      <Modal open={showModal} onClose={closeModal} title={`Audit Log Details${selectedLog ? ` #${selectedLog.id}` : ''}`} wide>
        {detailLoading && (
          <div className="py-10 text-center text-sm text-purple-700 font-medium">Loading audit log details…</div>
        )}
        {!detailLoading && detailError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{detailError}</div>
        )}
        {!detailLoading && !detailError && selectedLog && (() => {
          const log = selectedLog;
          const userLabel = log.user_name || (log.user_email ? `${log.user_email}${log.user_role ? ` (${log.user_role})` : ''}` : 'System');
          const mainValues = log.new_values ?? log.old_values;
          const rows = detailRows(mainValues);
          const receipt = findReceipt(log.new_values) || findReceipt(log.old_values);
          const canOpenReceipt = !!receipt && log.module === 'fuel' && log.record_id !== null && log.record_id !== undefined;
          const ts = formatTimestamp(log.created_at);
          const meta = asObject(log.metadata);
          const clientRoute = meta?.client_route || null;
          const endpoint = [showVal(log.method), showVal(log.route)].some((v) => v === 'N/A')
            ? 'N/A'
            : `${log.method} ${log.route}`;
          const extraMeta = meta
            ? Object.fromEntries(Object.entries(meta).filter(([k]) => k !== 'client_route'))
            : null;
          const hasExtraMeta = extraMeta && Object.keys(extraMeta).length > 0;
          // Grouped WHO / WHAT / WHEN / WHERE / TECHNICAL — each field its
          // own stacked LABEL-over-VALUE cell so nothing collides or wraps
          // across columns.
          const groups = [
            ['Who', [
              ['User', userLabel],
              ['Role', showVal(log.user_role)],
              ['User ID', showVal(log.user_id)],
            ]],
            ['What', [
              ['Action', showVal(log.action)],
              ['Module', showVal(log.module)],
              ['Resource', showVal(log.resource)],
              ['Record ID', showVal(log.record_id)],
              ['Description', showVal(log.description)],
            ]],
            ['When', [
              ['Date', formatDateOnly(log.created_at)],
              ['Exact Time', formatTimeOnly(log.created_at)],
              ['Timestamp', ts.epoch, ts.long],
            ]],
            ['Where', [
              ['IP Address', showVal(log.ip_address)],
              ['Route', showVal(clientRoute || log.route)],
              ['API Endpoint', endpoint],
            ]],
            ['Technical', [
              ['Request Method', showVal(log.method)],
              ['User Agent', showVal(log.user_agent)],
            ]],
          ];
          const cell = 'min-w-0 rounded-lg border border-purple-100/70 bg-white px-3 py-2.5';
          const lab = 'text-[11px] font-extrabold uppercase tracking-wider text-purple-700';
          const val = 'mt-1 text-sm font-medium leading-relaxed text-slate-900 [word-break:break-word] [overflow-wrap:anywhere] [white-space:normal]';
          const renderCell = ([label, value, sub]) => (
            <div key={label} className={cell}>
              <p className={lab}>{label}</p>
              <p className={val}>{value}</p>
              {sub ? <p className="mt-1 text-xs leading-relaxed text-slate-500 [word-break:break-word] [overflow-wrap:anywhere]">{sub}</p> : null}
            </div>
          );
          return (
            <div className="space-y-6 px-1 py-1 text-sm leading-relaxed sm:px-2">
              {groups.map(([gTitle, fields]) => (
                <div key={gTitle}>
                  <p className="mb-3 text-xs font-extrabold uppercase tracking-wider text-purple-700">{gTitle}</p>
                  <div className="grid min-w-0 grid-cols-1 content-start gap-5 rounded-2xl border border-purple-100 bg-purple-50/50 p-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    {fields.map(renderCell)}
                  </div>
                </div>
              ))}
              <div>
                <p className="mb-3 text-xs font-extrabold uppercase tracking-wider text-purple-700">Additional Metadata</p>
                {hasExtraMeta ? (
                  <pre className="max-h-48 min-w-0 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-800 [word-break:break-word] [overflow-wrap:anywhere]">{formatJson(extraMeta)}</pre>
                ) : (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-500">N/A</p>
                )}
              </div>

              <div>
                <p className="mb-3 text-xs font-extrabold uppercase tracking-wider text-purple-700">Details / Description</p>
                {rows ? (
                  <ul className="space-y-2.5">
                    {rows.map((r) => (
                      <li key={r.label} className="min-w-0 rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">{r.label}</p>
                        <p className="mt-1 text-sm font-medium leading-relaxed text-slate-900 [word-break:break-word] [overflow-wrap:anywhere] [white-space:normal]">{r.display}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-500">N/A</p>
                )}
              </div>

              {receipt && (
                <div>
                  <p className="mb-3 text-xs font-extrabold uppercase tracking-wider text-purple-700">Attachment / Receipt</p>
                  <div className="min-w-0 rounded-xl border border-purple-100 bg-white p-4">
                    <p className="text-sm font-semibold leading-relaxed text-slate-800 [word-break:break-word] [overflow-wrap:anywhere] [white-space:normal]">{showVal(receipt.receipt_original_name || receipt.receipt_path)}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {[receipt.receipt_mime, receipt.receipt_size ? `${receipt.receipt_size} bytes` : null].filter(Boolean).join(' • ') || 'N/A'}
                    </p>
                    {canOpenReceipt ? (
                      <button
                        type="button"
                        onClick={openReceipt}
                        disabled={previewLoading}
                        className="mt-3 inline-flex min-h-[44px] items-center rounded-xl bg-purple-700 px-4 text-sm font-bold text-white shadow hover:bg-purple-800 disabled:cursor-wait disabled:opacity-70"
                      >
                        {previewLoading ? 'Loading attachment…' : 'View / Open Receipt'}
                      </button>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">Preview not available for this record.</p>
                    )}
                    {previewError && (
                      <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">{previewError}</p>
                    )}
                    {preview?.kind === 'downloaded' && (
                      <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">Download started{preview.name ? ` — ${preview.name}` : ''}.</p>
                    )}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-3 text-xs font-extrabold uppercase tracking-wider text-purple-700">Old Values</p>
                {log.old_values ? (
                  <details className="min-w-0 rounded-xl border border-slate-200 bg-slate-50">
                    <summary className="cursor-pointer px-4 py-2 text-xs font-bold text-slate-600">Show formatted JSON</summary>
                    <pre className="max-h-64 min-w-0 overflow-auto whitespace-pre-wrap px-4 pb-4 text-xs leading-relaxed text-slate-800 [word-break:break-word] [overflow-wrap:anywhere]">{formatJson(log.old_values)}</pre>
                  </details>
                ) : (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-500">N/A</p>
                )}
              </div>

              <div>
                <p className="mb-3 text-xs font-extrabold uppercase tracking-wider text-purple-700">New Values</p>
                {log.new_values ? (
                  <details className="min-w-0 rounded-xl border border-slate-200 bg-slate-50">
                    <summary className="cursor-pointer px-4 py-2 text-xs font-bold text-slate-600">Show formatted JSON</summary>
                    <pre className="max-h-64 min-w-0 overflow-auto whitespace-pre-wrap px-4 pb-4 text-xs leading-relaxed text-slate-800 [word-break:break-word] [overflow-wrap:anywhere]">{formatJson(log.new_values)}</pre>
                  </details>
                ) : (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-500">N/A</p>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="min-h-[44px] rounded-xl bg-purple-700 px-6 text-sm font-bold text-white shadow hover:bg-purple-800"
                >
                  Close
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Receipt lightbox — above the details modal, own Close controls */}
      {preview && (preview.kind === 'image' || preview.kind === 'pdf') && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/80 p-4"
          onClick={closePreview}
          role="dialog"
          aria-label="Receipt preview"
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
              <h3 className="truncate text-base font-bold text-slate-800">
                Receipt{preview.name ? ` — ${preview.name}` : ''}
              </h3>
              <button
                type="button"
                onClick={closePreview}
                aria-label="Close receipt preview"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base font-bold text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center justify-center overflow-auto bg-slate-50 p-4">
              {preview.kind === 'image' ? (
                <img
                  src={preview.url}
                  alt={preview.name || 'Receipt attachment'}
                  className="h-auto max-h-[68vh] w-auto max-w-full rounded-lg border border-slate-200 object-contain"
                />
              ) : (
                <iframe
                  src={preview.url}
                  title={preview.name || 'Receipt PDF'}
                  className="h-[68vh] w-full rounded-lg border border-slate-200 bg-white"
                />
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <a
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center rounded-xl border border-purple-300 px-4 text-sm font-bold text-purple-800 hover:bg-purple-50"
              >
                Open in new tab
              </a>
              <button
                type="button"
                onClick={closePreview}
                className="min-h-[44px] rounded-xl bg-purple-700 px-6 text-sm font-bold text-white shadow hover:bg-purple-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}