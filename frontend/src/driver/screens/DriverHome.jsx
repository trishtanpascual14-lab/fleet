import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useGreeting } from '../../utils/greeting';
import { StatusBadge } from '../../components/ui';
import SosButton from '../../components/SosButton';

/**
 * Driver home: greeting + driver card + today's assignment + START TRIP.
 * Only the logged-in driver's own data (/drivers/me, /trips/mine).
 */
export default function DriverHome() {
  const { user } = useAuth();
  const nav = useNavigate();
  const greeting = useGreeting();
  const [profile, setProfile] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: p }, { data: t }] = await Promise.all([
          api.get('/drivers/me'),
          api.get('/trips/mine'),
        ]);
        setProfile(p.data);
        const trips = t.data || [];
        const active = trips.find((x) => ['In Transit', 'Arrived', 'Dispatched'].includes(x.trip_status))
          || trips.find((x) => x.trip_status === 'Scheduled')
          || null;
        setAssignment(active);
      } catch { /* empty states below */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-10 h-10 border-4 border-purple-200 border-t-[#6023d5] rounded-full animate-spin" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full max-w-full overflow-hidden">
      <div>
        <p className="text-sm font-medium text-slate-500">{greeting}, {profile?.full_name?.split(' ')[0] || user?.name?.split(' ')[0] || 'Driver'}</p>
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight break-words">{profile?.full_name || user?.name}</h2>
        <p className="text-xs text-slate-400 font-semibold">Driver ID: {profile?.driver_code || `#${profile?.id || '—'}`} • {profile?.status || ''}</p>
      </div>

      <div>
        <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2 px-1">Today's Assignment</p>
        {assignment ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-extrabold text-slate-900 truncate">Trip #{assignment.trip_code || assignment.id}</p>
              <span className="ml-auto shrink-0"><StatusBadge value={assignment.trip_status} /></span>
            </div>
            <div className="text-sm text-slate-600 mt-2 space-y-1 break-words">
              <p>🚚 Vehicle: <b className="text-slate-800">{assignment.plate_number || `#${assignment.vehicle_id}`}</b>{assignment.vehicle_type ? ` (${assignment.vehicle_type})` : ''}</p>
              <p>📍 Destination: <b className="text-slate-800">{assignment.destination}</b></p>
              <p>🕒 Scheduled: {assignment.departure_datetime || '—'}</p>
            </div>
            <button
              type="button"
              onClick={() => nav(`/driver/trips/${assignment.id}`)}
              className="mt-4 w-full min-h-[52px] rounded-2xl bg-[#6023d5] text-white text-base font-extrabold tracking-wide active:bg-[#4f22c6] active:scale-[0.99] transition shadow-lg shadow-purple-200"
            >
              {['In Transit', 'Arrived'].includes(assignment.trip_status) ? '● TRIP IN PROGRESS — OPEN' : 'START TRIP'}
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 text-center">
            <p className="text-3xl" aria-hidden="true">🛣️</p>
            <p className="font-bold text-slate-700 mt-2">No trip assigned</p>
            <p className="text-xs text-slate-400 mt-1">New assignments will appear here.</p>
          </div>
        )}
      </div>

      <SosButton tripId={assignment?.id || null} />

      <button
        type="button"
        onClick={() => nav('/driver/vehicle')}
        className="w-full bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 flex items-center gap-3 min-h-[56px] active:scale-[0.99] transition text-left"
      >
        <span className="w-10 h-10 rounded-2xl bg-purple-100/80 text-[#6023d5] flex items-center justify-center text-lg shrink-0" aria-hidden="true">🚚</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold text-slate-900 truncate">{profile?.assigned_vehicle_plate || 'My Vehicle'}</span>
          <span className="block text-xs text-slate-400">{profile?.assigned_vehicle_status || 'Tap to view vehicle'}</span>
        </span>
        <span className="text-slate-300 font-bold text-lg shrink-0" aria-hidden="true">›</span>
      </button>
    </div>
  );
}
