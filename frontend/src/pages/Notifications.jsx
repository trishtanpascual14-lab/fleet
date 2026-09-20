import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { Empty, Toast } from '../components/ui';
import SosPanel from '../components/SosPanel';
import { useAuth } from '../context/AuthContext';

export default function Notifications() {
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useState(null);
  const nav = useNavigate();
  const { can } = useAuth();
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };
  const load = async () => { const { data } = await api.get('/notifications?limit=50'); setRows(data.data); };
  useEffect(() => {
    load();
    const s = getSocket();
    const onUpd = (p) => {
      load();
      if (p?.link_type === 'sos') show('🚨 SOS alert received');
    };
    const onSos = () => { load(); show('🚨 SOS ALERT received'); };
    s.on('notifications:updated', onUpd);
    s.on('sos:created', onSos);
    const t = setInterval(load, 20000);
    return () => { s.off('notifications:updated', onUpd); s.off('sos:created', onSos); clearInterval(t); };
  }, []);

  const open = async (n) => {
    await api.put(`/notifications/${n.id}/read`);
    if (n.link_type === 'sos' && n.link_id) nav(`/tracking?focusSos=${n.link_id}`);
    else if (n.link_type === 'trip') nav(n.link_id ? '/trips' : '/trips');
    else if (n.link_type === 'reservation') nav('/reservations');
    else if (n.link_type === 'vehicle') nav('/vehicles');
    else if (n.link_type === 'driver') nav('/drivers');
    else if (n.link_type === 'fuel') nav('/fuel');
    load();
  };
  const all = async () => { await api.put('/notifications/read-all'); show('All marked as read'); load(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold">Notifications</h2>
        <button className="btn-gray btn ml-auto" onClick={all}>Mark all as read</button>
      </div>
      {can('admin', 'fleet_manager', 'dispatcher') && (
        <div className="max-w-md"><SosPanel /></div>
      )}
      <div className="card space-y-2">
        {rows.map((n) => {
          const isSos = n.link_type === 'sos';
          return (
          <button key={n.id} onClick={() => open(n)} className={`w-full text-left border rounded-lg px-3 py-2 hover:bg-slate-50 ${isSos ? 'border-rose-400 bg-rose-50' : n.is_read ? 'opacity-60' : 'border-blue-300 bg-blue-50/50'}`}>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{n.title}</span>
              {isSos && <span className="badge bg-rose-600 text-white animate-pulse">SOS — tap to locate</span>}
              {!n.is_read && !isSos && <span className="badge bg-blue-600 text-white">new</span>}
              <span className="ml-auto text-xs text-slate-400">{n.created_at}</span>
            </div>
            <p className="text-sm text-slate-600">{n.message}</p>
          </button>
          );
        })}
        {!rows.length && <Empty msg="No notifications" />}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
