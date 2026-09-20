import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { MobileCard } from '../cards';

const MENU = [
  { to: '/vehicles', label: 'Fleet & Vehicles', icon: '🚚', roles: ['admin', 'fleet_manager', 'dispatcher'] },
  { to: '/reservations', label: 'Reservations', icon: '📝', roles: ['admin', 'fleet_manager', 'dispatcher'] },
  { to: '/dispatch', label: 'Dispatch', icon: '🛰️', roles: ['admin', 'fleet_manager', 'dispatcher'] },
  { to: '/drivers', label: 'Drivers', icon: '🧑‍✈️', roles: ['admin', 'fleet_manager', 'dispatcher'] },
  { to: '/trips', label: 'Trips', icon: '🛣️', roles: ['admin', 'fleet_manager', 'dispatcher'] },
  { to: '/routes', label: 'Route Planning', icon: '🗺️', roles: ['admin', 'fleet_manager', 'dispatcher'] },
  { to: '/tracking', label: 'Vehicle Tracking', icon: '📍', roles: ['admin', 'fleet_manager', 'dispatcher'] },
  { to: '/fuel', label: 'Fuel Management', icon: '⛽', roles: ['admin', 'fleet_manager', 'dispatcher', 'driver'] },
  { to: '/costs', label: 'Transport Costs', icon: '💰', roles: ['admin', 'fleet_manager'] },
  { to: '/reports', label: 'Reports', icon: '📑', roles: ['admin', 'fleet_manager'] },
  { to: '/notifications', label: 'Notifications', icon: '🔔', roles: ['admin', 'fleet_manager', 'dispatcher', 'driver'] },
  { to: '/settings', label: 'Settings', icon: '⚙️', roles: ['admin', 'fleet_manager'] },
];

/**
 * Mobile profile / menu screen — replaces the desktop sidebar on phones.
 * Avatar, name, role, email, account info, module menu, logout.
 */
export default function MobileProfile() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'SL';

  const signOut = () => { logout(); nav('/login'); };

  return (
    <div className="space-y-4 w-full max-w-full overflow-hidden">
      <MobileCard>
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-[#6023d5] text-white flex items-center justify-center font-extrabold text-lg shadow-sm shrink-0" aria-hidden="true">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-extrabold text-slate-900 truncate">{user?.name || '—'}</p>
            <p className="text-xs text-slate-500 capitalize font-medium">{(user?.role || '—').replace('_', ' ')}</p>
            <p className="text-xs text-slate-400 truncate">{user?.email || '—'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
          <div className="bg-slate-50 rounded-xl p-2.5">
            <p className="text-slate-400 font-semibold">Account ID</p>
            <p className="font-bold text-slate-800">#{user?.id ?? '—'}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-2.5">
            <p className="text-slate-400 font-semibold">Status</p>
            <p className="font-bold text-emerald-600">Active</p>
          </div>
        </div>
      </MobileCard>

      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">Menu</p>
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
          {MENU.filter((m) => m.roles.includes(user?.role)).map((m, i, arr) => (
            <button
              key={m.to}
              type="button"
              onClick={() => nav(m.to)}
              className={`w-full flex items-center gap-3 px-4 min-h-[48px] text-sm font-semibold text-slate-700 active:bg-slate-50 transition ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}
            >
              <span className="text-lg" aria-hidden="true">{m.icon}</span>
              <span className="flex-1 text-left truncate">{m.label}</span>
              <span className="text-slate-300 font-bold" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={signOut}
        className="w-full min-h-[48px] rounded-2xl bg-rose-600 text-white text-sm font-bold active:bg-rose-700 active:scale-[0.99] transition"
      >
        🚪 Sign Out
      </button>
    </div>
  );
}
