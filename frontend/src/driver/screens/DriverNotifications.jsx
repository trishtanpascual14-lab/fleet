import { useEffect, useState } from 'react';
import api from '../../services/api';
import { Empty, Toast } from '../../components/ui';

/**
 * Driver notifications — existing notification API is already
 * role-scoped server-side (own + driver + broadcast).
 */
export default function DriverNotifications() {
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get('/notifications', { params: { limit: 30 } });
      setRows(data.data || []);
    } catch (err) {
      setToast({ msg: err.response?.data?.message || 'Failed to load notifications', type: 'error' });
      setTimeout(() => setToast(null), 2500);
    }
  };
  useEffect(() => { load(); }, []);

  const markAll = async () => {
    try { await api.put('/notifications/read-all'); load(); }
    catch { /* ignore */ }
  };

  return (
    <div className="space-y-3 w-full max-w-full overflow-hidden">
      <button type="button" onClick={markAll} className="w-full min-h-[44px] rounded-xl bg-slate-100 text-slate-600 text-xs font-bold active:bg-slate-200 transition">
        Mark all as read
      </button>
      {rows.map((n) => (
        <div key={n.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${n.is_read ? 'border-slate-200/80' : 'border-purple-300'}`}>
          <p className="text-sm font-extrabold text-slate-900 break-words">{!n.is_read && <span className="text-[#6023d5]">● </span>}{n.title}</p>
          <p className="text-xs text-slate-500 mt-1 break-words">{n.message}</p>
          <p className="text-[11px] text-slate-400 mt-1">{n.created_at}</p>
        </div>
      ))}
      {!rows.length && <Empty msg="No notifications" />}
      <Toast toast={toast} />
    </div>
  );
}
