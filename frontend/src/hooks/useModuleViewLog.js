import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../services/api';

// Exact module roots only — detail routes (e.g. /driver/trips/5) are NOT
// logged here; their single-record API GETs log RECORD_VIEW server-side.
// Sidebar/dropdown/modal interactions are never logged.
const ROUTE_MODULES = {
  '/': 'dashboard',
  '/vehicles': 'vehicles',
  '/reservations': 'reservations',
  '/dispatch': 'dispatch',
  '/drivers': 'drivers',
  '/trips': 'trips',
  '/my-trips': 'trips',
  '/routes': 'routes',
  '/tracking': 'tracking',
  '/fuel': 'fuel',
  '/costs': 'costs',
  '/reports': 'reports',
  '/notifications': 'notifications',
  '/users': 'users',
  '/settings': 'settings',
  '/archive': 'archive',
  '/audit-logs': 'audit',
  '/driver/home': 'dashboard',
  '/driver/trips': 'trips',
  '/driver/map': 'tracking',
  '/driver/fuel': 'fuel',
  '/driver/vehicle': 'vehicles',
  '/driver/notifications': 'notifications',
};

/**
 * Reports each meaningful module open once. The request only names the
 * module — user, role, IP, route, method and timestamp are all derived
 * server-side from the authenticated session (see moduleView controller).
 */
export default function useModuleViewLog() {
  const { pathname } = useLocation();
  const last = useRef(null);
  useEffect(() => {
    const mod = ROUTE_MODULES[pathname];
    if (!mod || last.current === pathname) return;
    last.current = pathname;
    api.post('/audit-logs/module-view', { module: mod, route: pathname }).catch(() => {
      // Auditing must never break navigation (e.g. driver role hitting
      // admin-only modules is blocked client-side anyway).
      last.current = null;
    });
  }, [pathname]);
}
