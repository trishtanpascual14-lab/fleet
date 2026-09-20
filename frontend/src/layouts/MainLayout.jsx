import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import useModuleViewLog from '../hooks/useModuleViewLog';
import { getSocket } from '../services/socket';
import LiveClock from '../components/LiveClock';
import { SidebarLogo } from '../components/Logo';

const NAV_CATEGORIES = [
  {
    category: 'MAIN',
    links: [
      { to: '/', label: 'Dashboard', icon: '📊', roles: ['admin', 'fleet_manager', 'dispatcher', 'driver'] },
      { to: '/vehicles', label: 'Fleet & Vehicles', icon: '🚚', roles: ['admin', 'fleet_manager', 'dispatcher'] },
      { to: '/reservations', label: 'Reservations', icon: '📝', roles: ['admin', 'fleet_manager', 'dispatcher'] },
      { to: '/dispatch', label: 'Dispatch', icon: '🛰️', roles: ['admin', 'fleet_manager', 'dispatcher'] },
      { to: '/drivers', label: 'Drivers', icon: '🧑‍✈️', roles: ['admin', 'fleet_manager', 'dispatcher'] },
      { to: '/trips', label: 'Trips', icon: '🛣️', roles: ['admin', 'fleet_manager', 'dispatcher'] },
      { to: '/my-trips', label: 'My Trips', icon: '🧭', roles: ['driver'] },
    ]
  },
  {
    category: 'PROCUREMENT',
    links: [
      { to: '/routes', label: 'Route Planning', icon: '🗺️', roles: ['admin', 'fleet_manager', 'dispatcher'] },
      { to: '/tracking', label: 'Vehicle Tracking', icon: '📍', roles: ['admin', 'fleet_manager', 'dispatcher'] },
      { to: '/fuel', label: 'Fuel Management', icon: '⛽', roles: ['admin', 'fleet_manager', 'dispatcher', 'driver'] },
      { to: '/costs', label: 'Transport Costs', icon: '💰', roles: ['admin', 'fleet_manager'] },
    ]
  },
  {
    category: 'ANALYTICS & BI',
    links: [
      { to: '/reports', label: 'Reports', icon: '📑', roles: ['admin', 'fleet_manager'] },
      { to: '/notifications', label: 'Notifications', icon: '🔔', roles: ['admin', 'fleet_manager', 'dispatcher', 'driver'] },
    ]
  },
{
      category: 'SYSTEM',
      links: [
        { to: '/users', label: 'Users', icon: '👥', roles: ['admin'] },
        { to: '/settings', label: 'Settings', icon: '⚙️', roles: ['admin', 'fleet_manager'] },
        { to: '/archive', label: 'Archive', icon: '📦', roles: ['admin'] },
        { to: '/audit-logs', label: 'Audit Logs', icon: '📋', roles: ['admin'] },
      ]
    }
];

export default function MainLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  useModuleViewLog();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const loadNotif = async () => {
    try { 
      const { data } = await api.get('/notifications?limit=1'); 
      setUnread(data.unread || 0); 
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadNotif();
    const s = getSocket();
    const onUpd = () => loadNotif();
    s.on('notifications:updated', onUpd);
    s.on('sos:created', onUpd);
    s.on('sos:resolved', onUpd);
    const t = setInterval(loadNotif, 30000);
    return () => { s.off('notifications:updated', onUpd); s.off('sos:created', onUpd); s.off('sos:resolved', onUpd); clearInterval(t); };
  }, []);

  const getActiveTitle = () => {
    for (const cat of NAV_CATEGORIES) {
      const match = cat.links.find((l) => l.to === location.pathname);
      if (match) return match.label;
    }
    return 'Dashboard';
  };

  const initials = user?.name 
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() 
    : 'SL';

  return (
    <div className="min-h-screen flex bg-[#f4f6fa]">
      {/* Sidebar Overlay for Mobile */}
      {open && (
        <div 
          className="fixed inset-0 bg-slate-950/60 z-30 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside className={`bg-[#0f1322] text-white w-64 shrink-0 fixed inset-y-0 z-40 transform transition-transform duration-200 ease-in-out ${open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:static flex flex-col border-r border-slate-800/50 shadow-2xl`}>
        {/* Brand Header */}
        <div className="px-5 py-4 flex items-center gap-3 border-b border-slate-800/80">
          <SidebarLogo className="h-10" />
          <div>
            <p className="font-extrabold text-base tracking-tight text-white leading-tight">MerchandiseMS</p>
            <p className="text-[11px] text-slate-400 font-medium">SME Edition • v2.1</p>
          </div>
        </div>

        {/* Navigation Categories */}
        <nav className="flex-1 overflow-y-auto px-3.5 py-4 space-y-5 custom-scrollbar">
          {NAV_CATEGORIES.map((cat) => {
            const filteredLinks = cat.links.filter((l) => l.roles.includes(user?.role));
            if (!filteredLinks.length) return null;
            return (
              <div key={cat.category} className="space-y-1">
                <p className="text-[10px] font-extrabold tracking-wider text-slate-500 uppercase px-3 pb-1">
                  {cat.category}
                </p>
                {filteredLinks.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    end={l.to === '/'}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}
                  >
                    <span className="text-base">{l.icon}</span>
                    <span className="truncate">{l.label}</span>
                    {l.to === '/notifications' && unread > 0 && (
                      <span className="ml-auto bg-[#6023d5] text-white text-[11px] font-bold rounded-full px-2 py-0.5 shadow-sm">
                        {unread}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-800/80 text-xs text-slate-400 space-y-3">
          <div className="flex items-center justify-between px-2 py-1.5 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-medium text-slate-300">Cloud Sync</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Active</span>
          </div>

          <button 
            onClick={() => setOpen(false)} 
            className="w-full flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-white py-1 transition-colors"
          >
            <span>‹</span> Collapse
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navbar */}
        <header className="bg-white border-b border-slate-200/80 px-4 md:px-6 py-3 flex items-center justify-between gap-4 sticky top-0 z-30 shadow-sm">
          {/* Left Header Info & Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <button 
              className="md:hidden p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition" 
              onClick={() => setOpen(!open)}
            >
              ☰
            </button>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500 truncate">
              <span className="text-slate-400 hover:text-slate-600 transition cursor-pointer">MerchandiseMS</span>
              <span className="text-slate-300">›</span>
              <span className="font-bold text-slate-900 truncate">{getActiveTitle()}</span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Real-time Local Clock */}
            <LiveClock />

            {/* Notification Bell Button */}
            <button 
              onClick={() => nav('/notifications')} 
              className="relative p-2 rounded-full bg-slate-100/80 hover:bg-slate-200/80 text-slate-600 border border-slate-200/60 transition"
              title="Notifications"
            >
              🔔
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {unread}
                </span>
              )}
            </button>

            {/* User Profile Pill */}
            <div className="relative">
              <button 
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2.5 p-1.5 rounded-full hover:bg-slate-100 border border-transparent hover:border-slate-200 transition"
              >
                <div className="w-8 h-8 rounded-full bg-[#6023d5] text-white flex items-center justify-center font-bold text-xs shadow-sm">
                  {initials}
                </div>
                <div className="hidden md:block text-left pr-1">
                  <p className="text-xs font-bold text-slate-800 leading-tight">{user?.name || 'Sophie Laurent'}</p>
                  <p className="text-[10px] text-slate-500 capitalize">{user?.role?.replace('_', ' ') || 'Administrator'}</p>
                </div>
                <span className="text-xs text-slate-400 hidden sm:inline">▾</span>
              </button>

              {/* User Dropdown Menu */}
              {userMenuOpen && (
                <div 
                  className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-50 animate-in fade-in slide-in-from-top-2"
                  onClick={() => setUserMenuOpen(false)}
                >
                  <div className="px-4 py-2 border-b border-slate-100">
                    <p className="text-xs font-bold text-slate-800">{user?.name}</p>
                    <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
                  </div>
                  <button 
                    onClick={() => nav('/settings')} 
                    className="w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
                  >
                    ⚙️ Settings
                  </button>
                  <button 
                    onClick={() => { logout(); nav('/login'); }} 
                    className="w-full text-left px-4 py-2 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-semibold border-t border-slate-100 mt-1"
                  >
                    🚪 Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Page Body */}
        <main className="p-4 md:p-8 max-w-7xl w-full mx-auto flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

