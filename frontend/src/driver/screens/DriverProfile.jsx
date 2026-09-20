import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

/**
 * Driver profile — own driver record, license, contact, assigned
 * vehicle, account info. Logout only; no admin settings exposed.
 */
export default function DriverProfile() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/drivers/me');
        setProfile(data.data);
      } catch { /* show account basics */ }
    })();
  }, []);

  const initials = (profile?.full_name || user?.name || 'DR')
    .split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const signOut = () => { logout(); nav('/login'); };

  return (
    <div className="space-y-4 w-full max-w-full overflow-hidden">
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 text-center">
        <div className="w-20 h-20 rounded-full bg-[#6023d5] text-white flex items-center justify-center font-extrabold text-2xl shadow-md mx-auto" aria-hidden="true">
          {initials}
        </div>
        <p className="font-extrabold text-slate-900 text-lg mt-3 break-words">{profile?.full_name || user?.name}</p>
        <p className="text-xs text-slate-500 font-semibold">Driver ID: {profile?.driver_code || `#${profile?.id || '—'}`}</p>
        <p className="text-xs text-slate-400 capitalize">{(user?.role || 'driver').replace('_', ' ')}</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4">
        <div className="text-sm text-slate-600 space-y-2 break-words">
          <p>🪪 License: <b className="text-slate-800">{profile?.license_number || '—'}</b>{profile?.license_expiry ? ` (expires ${profile.license_expiry})` : ''}</p>
          <p>📞 Contact: <b className="text-slate-800">{profile?.contact_number || user?.phone || '—'}</b></p>
          <p>✉️ Email: <b className="text-slate-800">{user?.email || '—'}</b></p>
          <p>🚚 Assigned vehicle: <b className="text-slate-800">{profile?.assigned_vehicle_plate || 'None'} ({profile?.assigned_vehicle_status || '—'})</b></p>
          <p>🛣️ Trips: <b className="text-slate-800">{profile?.total_trips ?? 0} total • {profile?.completed_trips ?? 0} completed</b></p>
          <p>⭐ Rating: <b className="text-slate-800">{profile?.performance_rating ?? '—'}</b></p>
        </div>
      </div>

      <button
        type="button"
        onClick={signOut}
        className="w-full min-h-[52px] rounded-2xl bg-rose-600 text-white text-base font-extrabold active:bg-rose-700 active:scale-[0.99] transition"
      >
        🚪 LOG OUT
      </button>
    </div>
  );
}
