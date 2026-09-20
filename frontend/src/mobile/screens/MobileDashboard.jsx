import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useGreeting } from '../../utils/greeting';
import { MobileCard, MobileStatusCard } from '../cards';
import { StatusBadge } from '../../components/ui';

/**
 * Mobile fleet dashboard — real API data only (no fake records).
 * Greeting + user, assigned vehicle, current trip, today's trips,
 * vehicle status, fuel info, notifications entry.
 */
export default function MobileDashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const greeting = useGreeting();
  const [summary, setSummary] = useState(null);
  const [current, setCurrent] = useState(null);
  const [todayCount, setTodayCount] = useState(0);
  const [notif, setNotif] = useState({ unread: 0, items: [] });

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/dashboard');
        setSummary(data.data);
      } catch { /* offline — cards show empty state */ }
      try {
        let trips = [];
        try {
          const { data } = await api.get('/trips/mine', { params: { limit: 10 } });
          trips = data.data || [];
        } catch {
          const { data } = await api.get('/trips', { params: { limit: 10 } });
          trips = data.data || [];
        }
        const active = trips.find((t) => ['Scheduled', 'Dispatched', 'In Transit', 'Arrived'].includes(t.trip_status)) || trips[0] || null;
        setCurrent(active);
        const today = new Date().toISOString().slice(0, 10);
        setTodayCount(trips.filter((t) => (t.departure_datetime || t.created_at || '').slice(0, 10) === today).length);
      } catch { /* ignore */ }
      try {
        const { data } = await api.get('/notifications', { params: { limit: 3 } });
        setNotif({ unread: data.unread || 0, items: data.data || [] });
      } catch { /* ignore */ }
    })();
  }, []);

  const v = summary?.vehicles || {};
  const fuel = summary?.fuel || {};

  return (
    <div className="space-y-4 w-full max-w-full overflow-hidden">
      <div>
        <p className="text-sm font-medium text-slate-500">{greeting},</p>
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight break-words">{user?.name || 'System Administrator'}</h2>
        <p className="text-xs text-slate-400 capitalize font-medium">{(user?.role || '').replace('_', ' ')}</p>
      </div>

      <MobileCard>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Assigned Vehicle</p>
        {current ? (
          <div className="mt-1.5">
            <p className="text-lg font-extrabold text-slate-900 truncate">{current.vehicle_code || current.plate_number || 'Truck'}</p>
            <p className="text-sm font-semibold text-[#6023d5]">{current.plate_number || '—'}</p>
            <p className="text-xs text-slate-500 mt-1">Status: <b className="text-slate-700">{current.vehicle_status || v.status || 'Active'}</b></p>
          </div>
        ) : (
          <p className="text-sm text-slate-400 mt-1.5">No assigned vehicle yet.</p>
        )}
      </MobileCard>

      <MobileCard>
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Current Trip</p>
          {current && <span className="ml-auto shrink-0"><StatusBadge value={current.trip_status} /></span>}
        </div>
        {current ? (
          <div className="mt-1.5">
            <p className="text-sm font-bold text-slate-800 break-words">{current.pickup_location} → {current.destination}</p>
            <button
              type="button"
              onClick={() => nav('/trips')}
              className="mt-3 w-full min-h-[44px] rounded-xl bg-[#6023d5] text-white text-sm font-bold active:bg-[#4f22c6] active:scale-[0.99] transition"
            >
              VIEW TRIP
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-400 mt-1.5">No current trip.</p>
        )}
      </MobileCard>

      <div className="grid grid-cols-2 gap-3">
        <MobileStatusCard icon="🛣️" label="Today's Trips" value={String(todayCount)} to="/trips" />
        <MobileStatusCard icon="🚚" label="Vehicles" value={String(v.total ?? '—')} sub={`${v.available ?? 0} available`} to="/vehicles" />
        <MobileStatusCard icon="⛽" label="Fuel Cost" value={fuel.cost != null ? `₱${Number(fuel.cost).toLocaleString()}` : '—'} sub={fuel.liters != null ? `${fuel.liters} L used` : ''} to="/fuel" />
        <MobileStatusCard icon="🔔" label="Notifications" value={String(notif.unread)} sub={notif.unread ? 'unread alerts' : 'all caught up'} to="/notifications" />
      </div>

      {notif.items.length > 0 && (
        <MobileCard>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Latest Alerts</p>
          <div className="space-y-2">
            {notif.items.map((n) => (
              <p key={n.id} className="text-xs text-slate-600 break-words border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                <b className="text-slate-800">{n.title}</b> — {n.message}
              </p>
            ))}
          </div>
        </MobileCard>
      )}
    </div>
  );
}
