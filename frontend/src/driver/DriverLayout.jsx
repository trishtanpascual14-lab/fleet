import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import useModuleViewLog from '../hooks/useModuleViewLog';

const TABS = [
  { to: '/driver/home', label: 'HOME', icon: '🏠' },
  { to: '/driver/trips', label: 'TRIPS', icon: '🛣️' },
  { to: '/driver/map', label: 'MAP', icon: '🗺️' },
  { to: '/driver/fuel', label: 'FUEL', icon: '⛽' },
  { to: '/driver/profile', label: 'PROFILE', icon: '👤' },
];

const TITLES = {
  '/driver/home': 'Driver Home',
  '/driver/trips': 'My Trips',
  '/driver/map': 'Trip Map',
  '/driver/fuel': 'Fuel Record',
  '/driver/profile': 'Profile',
  '/driver/vehicle': 'My Vehicle',
  '/driver/navigate': 'Navigation',
  '/driver/notifications': 'Notifications',
};

/**
 * Driver-only mobile shell: compact header + outlet + one-hand bottom nav.
 * Desktop admin system is untouched; this shell serves /driver/* only.
 */
export default function DriverLayout() {
  const { pathname } = useLocation();
  useModuleViewLog();
  const nav = useNavigate();
  const { user } = useAuth();
  const base = pathname.startsWith('/driver/trips/') ? '/driver/trips'
    : pathname.startsWith('/driver/navigate/') ? '/driver/navigate' : pathname;
  const title = TITLES[base] || TITLES[pathname] || 'Driver';

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'DR';

  return (
    <div className="mobile-safe min-h-screen bg-[#f4f6fa] max-w-full overflow-x-hidden">
      <header className="sticky top-0 z-30 bg-[#6023d5] text-white shadow-md">
        <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto w-full">
          <h1 className="text-base font-extrabold tracking-tight truncate flex-1">{title}</h1>
          <button
            type="button"
            onClick={() => nav('/driver/notifications')}
            aria-label="Open notifications"
            className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-white/15 flex items-center justify-center text-lg active:scale-95 transition"
          >
            🔔
          </button>
          <button
            type="button"
            onClick={() => nav('/driver/profile')}
            aria-label="Open profile"
            className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-white text-[#6023d5] flex items-center justify-center font-extrabold text-sm active:scale-95 transition"
          >
            {initials}
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto w-full px-4 pt-4 pb-28">
        <Outlet />
      </main>

      <nav
        aria-label="Driver primary"
        className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200/80 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-5 max-w-lg mx-auto w-full">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 min-h-[64px] py-2 text-[11px] font-extrabold tracking-wide transition-colors ${
                  isActive ? 'text-[#6023d5]' : 'text-slate-400 active:text-slate-600'
                }`
              }
            >
              <span className="text-2xl leading-none" aria-hidden="true">{t.icon}</span>
              <span>{t.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
