import { createContext, useContext, useEffect, useState } from 'react';
import api from '../services/api';
import { resetSocket } from '../services/socket';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fleet_user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const t = localStorage.getItem('fleet_token');
      if (t && !user) {
        try { const { data } = await api.get('/auth/me'); setUser(data.data); localStorage.setItem('fleet_user', JSON.stringify(data.data)); }
        catch { localStorage.removeItem('fleet_token'); }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    // OTP temporarily disabled - direct login
    // if (data.data?.otpRequired) { ... OTP flow kept for future ... }
    resetSocket();
    localStorage.setItem('fleet_token', data.data.token);
    localStorage.setItem('fleet_user', JSON.stringify(data.data.user));
    // clear any stale OTP artifacts
    localStorage.removeItem('fleet_pre_token');
    localStorage.removeItem('fleet_otp_email');
    localStorage.removeItem('fleet_otp_masked');
    localStorage.removeItem('fleet_otp_expires');
    setUser(data.data.user);
    return data.data.user;
  };

  // OTP temporarily disabled - kept for future re-enable
  const verifyOtp = async (otp) => {
    throw new Error('OTP verification temporarily disabled');
  };

  const resendOtp = async () => {
    throw new Error('OTP resend temporarily disabled');
  };

  const logout = () => {
    resetSocket();
    localStorage.removeItem('fleet_token'); localStorage.removeItem('fleet_user');
    localStorage.removeItem('fleet_pre_token'); localStorage.removeItem('fleet_otp_email');
    localStorage.removeItem('fleet_otp_masked'); localStorage.removeItem('fleet_otp_expires');
    setUser(null);
  };
  const normalizeRole = (r) => {
    if (!r) return '';
    const v = String(r).trim().toLowerCase();
    if (['super_admin','superadmin','system_admin','system administrator','administrator','admin'].includes(v)) return 'admin';
    if (['fleet_manager','fleet manager','fleet-manager','fleetmanager'].includes(v)) return 'fleet_manager';
    return v;
  };
  const can = (...roles) => {
    if (!user) return false;
    const userRole = normalizeRole(user.role);
    return roles.map(normalizeRole).includes(userRole);
  };
  return <AuthCtx.Provider value={{ user, login, logout, verifyOtp, resendOtp, can, loading }}>{children}</AuthCtx.Provider>;
}
