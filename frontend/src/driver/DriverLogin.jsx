import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { OfficialLogoCard } from '../components/Logo';

/**
 * Driver-only mobile login. Same auth API; verifies role === 'driver'
 * before entering the driver interface. Staff keep using desktop login.
 */
export default function DriverLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const u = await login(email, password);
      // OTP temporarily disabled - direct check
      if (u?.role !== 'driver') {
        setErr('This app is for drivers only. Please use the staff login.');
        return;
      }
      nav('/driver/home');
    } catch (e2) {
      setErr(e2.response?.data?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mobile-safe min-h-screen bg-[#f4f6fa] flex flex-col max-w-full overflow-x-hidden">
      <div className="bg-[#6023d5] px-6 pt-12 pb-10 text-white">
        <div className="max-w-sm mx-auto w-full">
          <OfficialLogoCard className="h-14" />
          <h1 className="text-2xl font-extrabold tracking-tight mt-4">Driver Sign In</h1>
          <p className="text-purple-200 text-sm font-medium">Fleet Driver Mobile System</p>
        </div>
      </div>

      <div className="max-w-sm mx-auto w-full px-6 -mt-6 flex-1">
        <form onSubmit={submit} className="bg-white rounded-3xl border border-slate-200/80 shadow-lg p-5 space-y-4">
          {err && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-2xl px-4 py-3 flex items-center gap-2">
              <span aria-hidden="true">⚠️</span><span>{err}</span>
            </div>
          )}
          <div>
            <label className="label" htmlFor="d-email">Driver ID / Email</label>
            <input
              id="d-email" type="email" className="input min-h-[48px]" placeholder="you@fleet.com"
              value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username"
            />
          </div>
          <div>
            <label className="label" htmlFor="d-pass">Password</label>
            <input
              id="d-pass" type="password" className="input min-h-[48px]" placeholder="••••••••"
              value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
            />
          </div>
          <button type="submit" disabled={busy} className="btn-primary btn w-full min-h-[52px] !text-base">
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <p className="text-center text-xs text-slate-400 mt-6">© {new Date().getFullYear()} Tri-M Global Trading Inc.</p>
      </div>
    </div>
  );
}
