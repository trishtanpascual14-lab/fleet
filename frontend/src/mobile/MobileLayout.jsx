import { Outlet, useLocation } from 'react-router-dom';
import useModuleViewLog from '../hooks/useModuleViewLog';
import MobileHeader from './MobileHeader';
import MobileBottomNav from './MobileBottomNav';

const TITLES = {
  '/': 'Dashboard',
  '/vehicles': 'Vehicles',
  '/trips': 'Trips',
  '/tracking': 'Vehicle Tracking',
  '/fuel': 'Fuel Management',
  '/profile': 'Profile',
  '/notifications': 'Notifications',
  '/reservations': 'Reservations',
  '/dispatch': 'Dispatch',
  '/drivers': 'Drivers',
  '/routes': 'Route Planning',
  '/costs': 'Transport Costs',
  '/reports': 'Reports',
};

/**
 * Mobile app shell: compact header + page content + bottom tab bar.
 * Used only below the 768px breakpoint; desktop keeps MainLayout.
 */
export default function MobileLayout() {
  const { pathname } = useLocation();
  useModuleViewLog();
  const title = TITLES[pathname] || 'Fleet Management';

  return (
    <div className="mobile-safe min-h-screen bg-[#f4f6fa] max-w-full overflow-x-hidden">
      <MobileHeader title={title} />
      <main className="max-w-lg mx-auto w-full px-4 pt-4 pb-28">
        <Outlet />
      </main>
      <MobileBottomNav />
    </div>
  );
}
