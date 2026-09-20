import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { OfficialLogoCard } from '../components/Logo';

export default function Login() {
  const [email, setEmail] = useState('manager@fleet.com');
  const [password, setPassword] = useState('password123');
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
      // OTP temporarily disabled - direct navigation
      nav(u?.role === 'driver' ? '/driver/home' : '/'); 
    }
    catch (e2) { 
      setErr(e2.response?.data?.message || 'Login failed'); 
    }
    finally { 
      setBusy(false); 
    }
  };

  return (
    <div className="min-h-screen flex w-full bg-white font-sans antialiased text-slate-800">
      {/* Left Column: Login Form (50% Width on Desktop) */}
      <div className="w-full lg:w-1/2 flex flex-col justify-between p-6 sm:p-10 md:p-14 lg:p-16 xl:p-20 bg-white z-10">
        {/* Top Brand Header */}
        <div className="mb-8">
          <OfficialLogoCard className="h-16 sm:h-20" />
        </div>

        {/* Main Form Body */}
        <div className="max-w-md w-full mx-auto my-auto space-y-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">
              Sign In
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 font-medium">
              Performance & Development Management System
            </p>
          </div>

          {err && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-2xl px-4 py-3 flex items-center gap-2 animate-in fade-in">
              <span>⚠️</span>
              <span>{err}</span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Email
              </label>
              <input 
                type="email"
                className="w-full rounded-full border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-[#6023d5] focus:bg-white transition-all"
                placeholder="you@tmglt.com"
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                required 
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Password
              </label>
              <input 
                type="password" 
                className="w-full rounded-full border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-[#6023d5] focus:bg-white transition-all"
                placeholder="••••••••"
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                required 
              />
            </div>

            {/* Sign In Button */}
            <button 
              type="submit" 
              className="w-full rounded-full bg-[#6023d5] hover:bg-[#4f22c6] active:scale-[0.99] text-white py-3.5 px-6 font-bold text-sm shadow-lg shadow-purple-200/80 transition-all duration-150 cursor-pointer disabled:opacity-50 mt-2" 
              disabled={busy}
            >
              {busy ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Footer Credit */}
        <div className="text-xs text-slate-400 text-center lg:text-left mt-8">
          © {new Date().getFullYear()} Tri-M Global Trading Inc. All rights reserved.
        </div>
      </div>

      {/* Right Column: Purple Decorative Banner (50% Width on Desktop) */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#6023d5] relative overflow-hidden flex-col justify-center px-12 lg:px-20 text-white shadow-2xl">
        {/* Soft Ambient Translucent Circles */}
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/10 blur-xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full bg-white/10 blur-2xl pointer-events-none" />

        <div className="relative z-10 max-w-lg space-y-5">
          <div className="mb-2">
            <OfficialLogoCard className="h-20 sm:h-24" />
          </div>
          <h2 className="text-4xl lg:text-5xl font-extrabold leading-[1.15] tracking-tight text-white">
            Welcome to <br />
            Tri-M Global <br />
            Logistics & Trading Inc.
          </h2>
          <p className="text-purple-100/90 text-sm lg:text-base leading-relaxed font-normal">
            Satisfying Filipino cravings around the globe. Manage your team's performance, goals, training, and growth, all in one system built for TMGLT.
          </p>
        </div>
      </div>
    </div>
  );
}


