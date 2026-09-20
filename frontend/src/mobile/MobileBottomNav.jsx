import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/trips', label: 'Trips', icon: '🛣️' },
  { to: '/vehicles', label: 'Vehicle', icon: '🚚' },
  { to: '/tracking', label: 'Map', icon: '📍' },
  { to: '/profile', label: 'Me', icon: '👤' },
];

/**
 * Bottom tab bar for phones. Each target is ≥ 44×44px with safe-area padding.
 */
export default function MobileBottomNav() {
  return (
    <nav
      aria-label="Mobile primary"
      className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200/80 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-5 max-w-lg mx-auto w-full">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 min-h-[60px] py-2 text-[11px] font-semibold transition-colors ${
                isActive ? 'text-[#6023d5]' : 'text-slate-400 active:text-slate-600'
              }`
            }
          >
            <span className="text-xl leading-none" aria-hidden="true">
              {t.icon}
            </span>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
