import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { useAuth } from '../context/AuthContext';

/**
 * SOS ALERTS side panel — plugs into existing Tracking/Notifications pages.
 * No redesign: red high-priority cards, newest ACTIVE first, VIEW LOCATION
 * jumps to the tracking map and focuses the driver.
 */
export default function SosPanel({ onLocate = null }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const [active, setActive] = useState([]);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState('active');
  const [busy, setBusy] = useState(null);

  const load = async () => {
    try {
      const [{ data: a }, { data: h }] = await Promise.all([
        api.get('/sos?status=ACTIVE'),
        api.get('/sos?status=ALL'),
      ]);
      setActive(a.data || []);
      setHistory((h.data || []).filter((x) => x.status !== 'ACTIVE'));
    } catch { /* ignore */ }
  };

  useEffect(() => {
    load();
    const s = getSocket();
    const refresh = () => load();
    const onCreated = () => load();
    const onMoved = (sos) => {
      setActive((prev) => {
        const i = prev.findIndex((x) => x.id === sos.id);
        if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], ...sos }; return next; }
        return [sos, ...prev];
      });
    };
    const onGone = (p) => setActive((prev) => prev.filter((x) => x.id !== (p?.id ?? p)));
    s.on('sos:created', onCreated);
    s.on('sos:location-updated', onMoved);
    s.on('sos:resolved', onGone);
    s.on('sos:cancelled', onGone);
    s.on('notifications:updated', refresh);
    const t = setInterval(load, 20000); // fallback polling — socket is primary
    return () => {
      s.off('sos:created', onCreated);
      s.off('sos:location-updated', onMoved);
      s.off('sos:resolved', onGone);
      s.off('sos:cancelled', onGone);
      s.off('notifications:updated', refresh);
      clearInterval(t);
    };
  }, []);

  const locate = (sos) => {
    if (onLocate) onLocate(sos);
    else nav(`/tracking?focusSos=${sos.id}`);
  };

  const resolve = async (sos) => {
    if (!confirm(`Mark SOS from ${sos.driver_name} as RESOLVED?`)) return;
    setBusy(sos.id);
    try {
      await api.patch(`/sos/${sos.id}/resolve`);
      load();
    } catch (e) { alert(e.response?.data?.message || 'Resolve failed'); }
    finally { setBusy(null); }
  };

  const list = tab === 'active' ? active : history.slice(0, 20);

  return (
    <div className="border-2 border-rose-200 rounded-xl overflow-hidden bg-white">
      <div className="bg-rose-600 text-white px-3 py-2 font-extrabold text-sm flex items-center gap-2">
        🚨 SOS ALERTS
        {active.length > 0 && <span className="ml-auto bg-white text-rose-700 text-xs font-extrabold rounded-full px-2 py-0.5 animate-pulse">{active.length} ACTIVE</span>}
      </div>
      <div className="flex text-xs font-bold border-b">
        <button className={`flex-1 py-1.5 ${tab === 'active' ? 'text-rose-700 border-b-2 border-rose-600' : 'text-slate-400'}`} onClick={() => setTab('active')}>ACTIVE</button>
        <button className={`flex-1 py-1.5 ${tab === 'history' ? 'text-rose-700 border-b-2 border-rose-600' : 'text-slate-400'}`} onClick={() => setTab('history')}>HISTORY</button>
      </div>
      <div className="max-h-[380px] overflow-auto p-2 space-y-2">
        {list.map((s) => (
          <div key={s.id} className={`border rounded-lg p-2 text-xs ${s.status === 'ACTIVE' ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-slate-50 opacity-80'}`}>
            <div className="flex items-center gap-1.5 font-extrabold text-slate-800">
              {s.status === 'ACTIVE' ? <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse" /> : <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />}
              {s.status === 'ACTIVE' ? '🔴 ACTIVE SOS' : `⚪ ${s.status}`}
              <span className="ml-auto font-normal text-slate-400">{s.triggered_at || s.created_at}</span>
            </div>
            <div className="mt-1 space-y-0.5 text-slate-700">
              <p>Driver: <b>{s.driver_name}</b></p>
              <p>Vehicle: <b>{s.plate_number || s.vehicle_code}</b></p>
              <p>Trip: <b>{s.trip_code || (s.trip_id ? `#${s.trip_id}` : '—')}</b></p>
              <p>Location: {s.latitude}, {s.longitude}</p>
              {s.status !== 'ACTIVE' && <p>Resolved: {s.resolved_at || '—'}{s.resolved_by_name ? ` by ${s.resolved_by_name}` : ''}</p>}
            </div>
            <div className="flex gap-1.5 mt-2">
              <button onClick={() => locate(s)} className="flex-1 rounded-lg bg-slate-900 text-white font-bold py-1.5 active:scale-[0.99] transition">VIEW LOCATION</button>
              {s.status === 'ACTIVE' && can('admin', 'fleet_manager', 'dispatcher') && (
                <button disabled={busy === s.id} onClick={() => resolve(s)} className="flex-1 rounded-lg bg-emerald-600 text-white font-bold py-1.5 active:scale-[0.99] transition disabled:opacity-50">
                  {busy === s.id ? '…' : 'RESOLVE'}
                </button>
              )}
            </div>
          </div>
        ))}
        {!list.length && <p className="text-xs text-slate-400 text-center py-4">{tab === 'active' ? 'No active SOS alerts.' : 'No SOS history yet.'}</p>}
      </div>
    </div>
  );
}
