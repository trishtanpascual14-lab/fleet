import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './layouts/MainLayout';
import Login from './pages/Login';
// OTP temporarily disabled
// import VerifyOtp from './pages/VerifyOtp';
import Dashboard from './pages/Dashboard';
import Vehicles from './pages/Vehicles';
import Reservations from './pages/Reservations';
import Dispatch from './pages/Dispatch';
import Drivers from './pages/Drivers';
import Trips from './pages/Trips';
import MyTrips from './pages/MyTrips';
import RoutesPage from './pages/Routes';
import Tracking from './pages/Tracking';
import Fuel from './pages/Fuel';
import Costs from './pages/Costs';
import Reports from './pages/Reports';
import Notifications from './pages/Notifications';
import Users from './pages/Users';
import Settings from './pages/Settings';
import Archive from './pages/Archive';
import AuditLogs from './pages/AuditLogs';

import useIsMobile from './hooks/useIsMobile';
import MobileLayout from './mobile/MobileLayout';
import MobileDashboard from './mobile/screens/MobileDashboard';
import MobileTrips from './mobile/screens/MobileTrips';
import MobileVehicles from './mobile/screens/MobileVehicles';
import MobileTracking from './mobile/screens/MobileTracking';
import MobileFuel from './mobile/screens/MobileFuel';
import MobileProfile from './mobile/screens/MobileProfile';

// Minimal standalone Leaflet proof (no GPS/API/DB/auth).
import TestMap from './maptest/TestMap';

// Driver-only mobile system (smartphone interface, same backend/database).
import DriverLayout from './driver/DriverLayout';
import DriverLogin from './driver/DriverLogin';
import DriverHome from './driver/screens/DriverHome';
import DriverTrips from './driver/screens/DriverTrips';
import DriverTripDetail from './driver/screens/DriverTripDetail';
import DriverNavigate from './driver/navigation/DriverNavigate';
import DriverMap from './driver/screens/DriverMap';
import DriverFuel from './driver/screens/DriverFuel';
import DriverVehicle from './driver/screens/DriverVehicle';
import DriverProfile from './driver/screens/DriverProfile';
import DriverNotifications from './driver/screens/DriverNotifications';

const M = ['admin', 'fleet_manager'];
const MD = ['admin', 'fleet_manager', 'dispatcher'];
const DRIVER = ['driver'];

// Renders the mobile screen below 768px, desktop page otherwise.
// Same route — no duplicate routes or pages.
function Adaptive({ desktop, mobile }) {
  const isMobile = useIsMobile();
  return isMobile ? mobile : desktop;
}

// App shell switches by viewport; both shells render the same <Outlet/> routes.
function Shell() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileLayout /> : <MainLayout />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* OTP temporarily disabled <Route path="/verify-otp" element={<VerifyOtp />} /> */}
          <Route path="/map-test" element={<TestMap />} />
          <Route path="/driver/login" element={<DriverLogin />} />
          <Route path="/driver" element={<ProtectedRoute roles={DRIVER}><DriverLayout /></ProtectedRoute>}>
            <Route path="home" element={<DriverHome />} />
            <Route path="trips" element={<DriverTrips />} />
            <Route path="trips/:id" element={<DriverTripDetail />} />
            <Route path="navigate/:id" element={<DriverNavigate />} />
            <Route path="map" element={<DriverMap />} />
            <Route path="fuel" element={<DriverFuel />} />
            <Route path="vehicle" element={<DriverVehicle />} />
            <Route path="profile" element={<DriverProfile />} />
            <Route path="notifications" element={<DriverNotifications />} />
            <Route index element={<Navigate to="home" replace />} />
          </Route>
          <Route element={<ProtectedRoute><Shell /></ProtectedRoute>}>
            <Route index element={<Adaptive desktop={<Dashboard />} mobile={<MobileDashboard />} />} />
            <Route path="vehicles" element={<ProtectedRoute roles={MD}><Adaptive desktop={<Vehicles />} mobile={<MobileVehicles />} /></ProtectedRoute>} />
            <Route path="reservations" element={<ProtectedRoute roles={[...MD, 'driver']}><Reservations /></ProtectedRoute>} />
            <Route path="dispatch" element={<ProtectedRoute roles={MD}><Dispatch /></ProtectedRoute>} />
            <Route path="drivers" element={<ProtectedRoute roles={MD}><Drivers /></ProtectedRoute>} />
            <Route path="trips" element={<ProtectedRoute roles={MD}><Adaptive desktop={<Trips />} mobile={<MobileTrips />} /></ProtectedRoute>} />
            <Route path="my-trips" element={<ProtectedRoute roles={['driver', 'admin', 'fleet_manager']}><MyTrips /></ProtectedRoute>} />
            <Route path="routes" element={<ProtectedRoute roles={MD}><RoutesPage /></ProtectedRoute>} />
            <Route path="tracking" element={<ProtectedRoute roles={MD}><Adaptive desktop={<Tracking />} mobile={<MobileTracking />} /></ProtectedRoute>} />
            <Route path="fuel" element={<Adaptive desktop={<Fuel />} mobile={<MobileFuel />} />} />
            <Route path="costs" element={<ProtectedRoute roles={M}><Costs /></ProtectedRoute>} />
            <Route path="reports" element={<ProtectedRoute roles={M}><Reports /></ProtectedRoute>} />
            <Route path="profile" element={<MobileProfile />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="users" element={<ProtectedRoute roles={['admin']}><Users /></ProtectedRoute>} />
            <Route path="settings" element={<ProtectedRoute roles={M}><Settings /></ProtectedRoute>} />
            <Route path="archive" element={<ProtectedRoute roles={['admin']}><Archive /></ProtectedRoute>} />
            <Route path="audit-logs" element={<ProtectedRoute roles={['admin']}><AuditLogs /></ProtectedRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
