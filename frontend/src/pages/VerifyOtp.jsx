import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { OfficialLogoCard } from '../components/Logo';

function maskFallback(email) {
  if (!email || !email.includes('@')) return email || 'your email';
  const [l, d] = email.split('@');
  return `${l[0]}${'*'.repeat(Math.min(6, Math.max(3, l.length - 1)))}@${d}`;
}

export default function VerifyOtp() {
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(300);
  const inputsRef = useRef([]);
  const nav = useNavigate();
  const { verifyOtp, resendOtp } = useAuth();

  const preToken = localStorage.getItem('fleet_pre_token');
  const storedEmail = localStorage.getItem('fleet_otp_email') || '';
  const storedMasked = localStorage.getItem('fleet_otp_masked') || maskFallback(storedEmail);
  const storedExpires = localStorage.getItem('fleet_otp_expires');

  useEffect(() => {
    if (!preToken) nav('/login', { replace: true });
  }, [preToken, nav]);

  // init expires countdown from storedExpires
  useEffect(() => {
    if (storedExpires) {
      const diff = Math.floor((new Date(storedExpires).getTime() - Date.now()) / 1000);
      if (diff > 0) setExpiresIn(diff);
      else setExpiresIn(0);
    }
  }, [storedExpires]);

  useEffect(() => {
    const t = setInterval(() => {
      setExpiresIn((s) => (s > 0 ? s - 1 : 0));
      setCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const focusInput = (idx) => inputsRef.current[idx]?.focus();

  const handleChange = (idx, val) => {
    const v = val.replace(/\D/g, '').slice(0, 1);
    const next = [...otp];
    next[idx] = v;
    setOtp(next);
    if (v && idx < 5) focusInput(idx + 1);
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) focusInput(idx - 1);
    if (e.key === 'ArrowLeft' && idx > 0) focusInput(idx - 1);
    if (e.key === 'ArrowRight' && idx < 5) focusInput(idx + 1);
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    const next = Array(6).fill('');
    for (let i = 0; i < text.length; i++) next[i] = text[i];
    setOtp(next);
    focusInput(Math.min(text.length, 5));
  };

  const code = otp.join('');

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    if (!/^\d{6}$/.test(code)) { setErr('Please enter a 6-digit code.'); return; }
    setBusy(true);
    try {
      const user = await verifyOtp(code);
      setMsg('Verified! Redirecting...');
      // role-based redirect
      setTimeout(() => {
        if (user?.role === 'driver') nav('/driver/home', { replace: true });
        else nav('/', { replace: true });
      }, 400);
    } catch (e2) {
      const m = e2.response?.data?.message || 'Verification failed';
      const rem = e2.response?.data?.attemptsRemaining;
      setErr(rem !== undefined ? `${m} (${rem} attempts left)` : m);
      if (e2.response?.status === 429) {
        // too many attempts
      }
    } finally { setBusy(false); }
  };

  const doResend = async () => {
    if (cooldown > 0) return;
    setErr(''); setMsg('');
    setResendBusy(true);
    try {
      const data = await resendOtp();
      // update stored expiry if returned
      if (data?.expiresAt) localStorage.setItem('fleet_otp_expires', data.expiresAt);
      if (data?.maskedEmail) localStorage.setItem('fleet_otp_masked', data.maskedEmail);
      if (data?.preAuthToken) localStorage.setItem('fleet_pre_token', data.preAuthToken);
      setExpiresIn(data?.expiresIn || 300);
      setCooldown(60);
      setMsg('A new code has been sent to your email.');
      setOtp(['', '', '', '', '', '']);
      focusInput(0);
    } catch (e2) {
      const m = e2.response?.data?.message || 'Failed to resend OTP';
      if (e2.response?.data?.retryAfter) setCooldown(e2.response.data.retryAfter);
      setErr(m);
    } finally { setResendBusy(false); }
  };

  const fmt = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const isExpired = expiresIn <= 0;

  return (
    <div className="min-h-screen flex w-full bg-white font-sans antialiased text-slate-800">
      {/* Left */}
      <div className="w-full lg:w-1/2 flex flex-col justify-between p-6 sm:p-10 md:p-14 lg:p-16 xl:p-20 bg-white z-10">
        <div className="mb-8">
          <OfficialLogoCard className="h-16 sm:h-20" />
        </div>

        <div className="max-w-md w-full mx-auto my-auto space-y-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">Verify Your Account</h1>
            <p className="text-sm text-slate-500 leading-relaxed">
              We sent a 6-digit verification code to<br />
              <span className="font-bold text-slate-800">{storedMasked}</span>
            </p>
          </div>

          {err && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-2xl px-4 py-3 flex items-center gap-2">
              <span>⚠️</span><span>{err}</span>
            </div>
          )}
          {msg && !err && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold rounded-2xl px-4 py-3 flex items-center gap-2">
              <span>✅</span><span>{msg}</span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-5 pt-2" onPaste={handlePaste}>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">Enter 6-digit code</label>
              <div className="flex gap-2 justify-between">
                {otp.map((v, i) => (
                  <input
                    key={i}
                    ref={(el) => (inputsRef.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={v}
                    onChange={(e) => handleChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    className="w-11 h-12 sm:w-12 sm:h-14 text-center text-lg font-extrabold rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-[#6023d5] transition-all"
                  />
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={busy || isExpired}
              className="w-full rounded-full bg-[#6023d5] hover:bg-[#4f22c6] active:scale-[0.99] text-white py-3.5 px-6 font-bold text-sm shadow-lg shadow-purple-200/80 transition-all disabled:opacity-50"
            >
              {busy ? 'Verifying...' : isExpired ? 'Code Expired' : 'Verify OTP'}
            </button>

            <div className="text-center space-y-3">
              <div className={`text-xs font-semibold ${isExpired ? 'text-rose-600' : 'text-slate-500'}`}>
                OTP expires in: <span className="font-mono text-sm">{fmt(expiresIn)}</span>
                {isExpired && <span className="ml-2">(expired)</span>}
              </div>

              <div className="text-xs text-slate-500">
                Didn&apos;t receive the code?{' '}
                <button
                  type="button"
                  onClick={doResend}
                  disabled={resendBusy || cooldown > 0}
                  className="font-bold text-[#6023d5] hover:text-[#4f22c6] disabled:text-slate-400 disabled:cursor-not-allowed underline underline-offset-2"
                >
                  {resendBusy ? 'Sending...' : cooldown > 0 ? `Resend OTP (${cooldown}s)` : 'Resend OTP'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => { localStorage.removeItem('fleet_pre_token'); localStorage.removeItem('fleet_otp_email'); localStorage.removeItem('fleet_otp_masked'); localStorage.removeItem('fleet_otp_expires'); nav('/login'); }}
                className="text-xs font-medium text-slate-400 hover:text-slate-600 underline"
              >
                Back to Sign In
              </button>
            </div>
          </form>
        </div>

        <div className="text-xs text-slate-400 text-center lg:text-left mt-8">
          © {new Date().getFullYear()} Tri-M Global Trading Inc. All rights reserved.
        </div>
      </div>

      {/* Right purple banner - same as Login */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#6023d5] relative overflow-hidden flex-col justify-center px-12 lg:px-20 text-white shadow-2xl">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/10 blur-xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="relative z-10 max-w-lg space-y-5">
          <div className="mb-2">
            <OfficialLogoCard className="h-20 sm:h-24" />
          </div>
          <h2 className="text-4xl lg:text-5xl font-extrabold leading-[1.15] tracking-tight text-white">
            Secure<br />Verification
          </h2>
          <p className="text-purple-100/90 text-sm lg:text-base leading-relaxed">
            Your security is our priority. Enter the verification code sent to your email to continue to your dashboard.
          </p>
          <div className="pt-4 flex items-center gap-3 text-xs font-semibold text-purple-200">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Protected by Email OTP
          </div>
        </div>
      </div>
    </div>
  );
}
