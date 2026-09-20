import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Clean mobile header: page title + notification bell + avatar.
 * No desktop search bar, Live badge, Cloud Status or Last Backup.
 */
export default function MobileHeader({ title }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'SL';

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200/80">
      <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto w-full">
        <h1 className="text-base font-extrabold text-slate-900 tracking-tight truncate flex-1">
          {title}
        </h1>
        <button
          type="button"
          onClick={() => nav('/notifications')}
          aria-label="Open notifications"
          className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-lg active:scale-95 transition"
        >
          🔔
        </button>
        <button
          type="button"
          onClick={() => nav('/profile')}
          aria-label="Open profile"
          className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-[#6023d5] text-white flex items-center justify-center font-bold text-sm shadow-sm active:scale-95 transition"
        >
          {initials}
        </button>
      </div>
    </header>
  );
}
