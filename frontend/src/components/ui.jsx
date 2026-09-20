import { useNavigate } from 'react-router-dom';

const COLOR_MAP = {
  purple: { bg: 'bg-purple-100/80', text: 'text-[#6023d5]', border: 'border-purple-200/50' },
  blue: { bg: 'bg-blue-100/80', text: 'text-blue-600', border: 'border-blue-200/50' },
  emerald: { bg: 'bg-emerald-100/80', text: 'text-emerald-600', border: 'border-emerald-200/50' },
  amber: { bg: 'bg-amber-100/80', text: 'text-amber-600', border: 'border-amber-200/50' },
  indigo: { bg: 'bg-indigo-100/80', text: 'text-indigo-600', border: 'border-indigo-200/50' },
  red: { bg: 'bg-rose-100/80', text: 'text-rose-600', border: 'border-rose-200/50' },
  yellow: { bg: 'bg-yellow-100/80', text: 'text-yellow-700', border: 'border-yellow-200/50' },
  cyan: { bg: 'bg-cyan-100/80', text: 'text-cyan-600', border: 'border-cyan-200/50' },
  // Backward compatibility with legacy Tailwind class keys
  'bg-blue-600': { bg: 'bg-blue-100/80', text: 'text-blue-600', border: 'border-blue-200/50' },
  'bg-emerald-500': { bg: 'bg-emerald-100/80', text: 'text-emerald-600', border: 'border-emerald-200/50' },
  'bg-amber-500': { bg: 'bg-amber-100/80', text: 'text-amber-600', border: 'border-amber-200/50' },
  'bg-orange-500': { bg: 'bg-orange-100/80', text: 'text-orange-600', border: 'border-orange-200/50' },
  'bg-teal-500': { bg: 'bg-teal-100/80', text: 'text-teal-600', border: 'border-teal-200/50' },
  'bg-indigo-500': { bg: 'bg-indigo-100/80', text: 'text-indigo-600', border: 'border-indigo-200/50' },
  'bg-emerald-600': { bg: 'bg-emerald-100/80', text: 'text-emerald-600', border: 'border-emerald-200/50' },
  'bg-yellow-500': { bg: 'bg-yellow-100/80', text: 'text-yellow-700', border: 'border-yellow-200/50' },
  'bg-red-500': { bg: 'bg-rose-100/80', text: 'text-rose-600', border: 'border-rose-200/50' },
  'bg-purple-600': { bg: 'bg-purple-100/80', text: 'text-[#6023d5]', border: 'border-purple-200/50' },
  'bg-cyan-500': { bg: 'bg-cyan-100/80', text: 'text-cyan-600', border: 'border-cyan-200/50' },
};

export function StatCard({ title, value, sub, color = 'purple', to, trend, trendDown, icon }) {
  const nav = useNavigate();
  const c = COLOR_MAP[color] || COLOR_MAP.purple;
  const clickable = Boolean(to);
  
  return (
    <button 
      onClick={() => to && nav(to)} 
      aria-label={`${title}: ${value}${sub ? `, ${sub}` : ''}${clickable ? ` — open ${title}` : ''}`}
      className="card text-left w-full flex flex-col justify-between p-5 hover:border-purple-300/80 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 focus-visible:border-purple-400"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-lg ${c.bg} ${c.text} transition-transform group-hover:scale-105`}>
          {icon || '💎'}
        </div>
        <div className="flex items-center gap-2">
          {trend && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${
              trendDown 
                ? 'bg-rose-50 text-rose-600 border-rose-200/60' 
                : 'bg-emerald-50 text-emerald-600 border-emerald-200/60'
            }`}>
              {trendDown ? '↘' : '↗'} {trend}
            </span>
          )}
          {clickable && (
            <span aria-hidden="true" className="text-lg font-bold text-slate-300 group-hover:text-[#6023d5] group-hover:translate-x-0.5 transition-all">
              ›
            </span>
          )}
        </div>
      </div>

      <div>
        <p className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">{value}</p>
        <p className="text-xs font-semibold text-slate-500 mt-1">{title}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5 font-medium">{sub}</p>}
      </div>
    </button>
  );
}

const BADGE_STYLES = {
  Available: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  Reserved: 'bg-amber-50 text-amber-700 border-amber-200/80',
  Dispatched: 'bg-blue-50 text-blue-700 border-blue-200/80',
  'In Transit': 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
  Maintenance: 'bg-rose-50 text-rose-700 border-rose-200/80',
  Inactive: 'bg-slate-100 text-slate-600 border-slate-200/80',
  Pending: 'bg-amber-50 text-amber-700 border-amber-200/80',
  Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  Rejected: 'bg-rose-50 text-rose-700 border-rose-200/80',
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  Cancelled: 'bg-slate-100 text-slate-600 border-slate-200/80',
  Scheduled: 'bg-purple-50 text-purple-700 border-purple-200/80',
  Arrived: 'bg-cyan-50 text-cyan-700 border-cyan-200/80',
  Delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  Failed: 'bg-rose-50 text-rose-700 border-rose-200/80',
  'Out for Delivery': 'bg-blue-50 text-blue-700 border-blue-200/80',
  Assigned: 'bg-blue-50 text-blue-700 border-blue-200/80',
  'On Trip': 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
  'Off Duty': 'bg-slate-100 text-slate-600 border-slate-200/80',
  Planned: 'bg-slate-100 text-slate-700 border-slate-200/80',
  Active: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  Optimized: 'bg-purple-50 text-purple-700 border-purple-200/80',
  Low: 'bg-slate-100 text-slate-600 border-slate-200/80',
  Normal: 'bg-blue-50 text-blue-700 border-blue-200/80',
  High: 'bg-amber-50 text-amber-700 border-amber-200/80',
  Urgent: 'bg-rose-50 text-rose-700 border-rose-200/80',
};

export const StatusBadge = ({ value }) => (
  <span className={`badge border ${BADGE_STYLES[value] || 'bg-slate-100 text-slate-600 border-slate-200/80'}`}>
    {value}
  </span>
);

export function Empty({ msg = 'No records found' }) {
  return (
    <div className="text-center py-12 text-slate-400 text-sm flex flex-col items-center justify-center gap-2">
      <span className="text-3xl">📦</span>
      <p className="font-medium text-slate-500">{msg}</p>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-all" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-2xl border border-slate-100 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-hidden flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h3 className="font-bold text-slate-800 text-lg">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-700 hover:bg-slate-200 flex items-center justify-center font-bold text-base transition">✕</button>
        </div>
        <div className="p-6 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`fixed bottom-5 right-5 z-[60] px-5 py-3.5 rounded-2xl shadow-xl text-sm font-semibold text-white flex items-center gap-2 transition-all transform animate-bounce ${toast.type === 'error' ? 'bg-rose-600' : 'bg-emerald-600'}`}>
      <span>{toast.type === 'error' ? '⚠️' : '✅'}</span>
      <span>{toast.msg}</span>
    </div>
  );
}

export function Pager({ pagination, onPage }) {
  if (!pagination || pagination.total <= pagination.limit) return null;
  const pages = Math.ceil(pagination.total / pagination.limit);
  return (
    <div className="flex items-center gap-3 justify-end mt-4 text-sm font-medium">
      <button className="btn-gray btn text-xs py-1.5" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>Prev</button>
      <span className="text-slate-500 text-xs">Page {pagination.page} of {pages} ({pagination.total} total)</span>
      <button className="btn-gray btn text-xs py-1.5" disabled={pagination.page >= pages} onClick={() => onPage(pagination.page + 1)}>Next</button>
    </div>
  );
}

