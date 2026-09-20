import { useEffect, useState } from 'react';
import api from '../services/api';
import { Modal, Toast } from './ui';
import { getCurrentPosition } from '../driver/useGpsTracking';

/**
 * Driver-only SOS trigger. Auto-captures GPS + driver/vehicle/trip server-side.
 * Reuses existing /sos API, GPS hook and Modal/Toast — no redesign.
 */
export default function SosButton({ tripId = null, className = '' }) {
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [active, setActive] = useState(null);
  const [toast, setToast] = useState(null);
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const loadActive = async () => {
    try {
      const { data } = await api.get('/sos?status=ACTIVE');
      const mine = (data.data || [])[0] || null;
      setActive(mine);
    } catch { /* drivers without SOS just see the button */ }
  };
  useEffect(() => { loadActive(); }, []);

  const send = async () => {
    setSending(true);
    try {
      let lat = null; let lng = null;
      try {
        const p = await getCurrentPosition();
        lat = p.coords.latitude; lng = p.coords.longitude;
      } catch { /* backend falls back to latest GPS */ }
      const payload = { trip_id: tripId || undefined };
      if (lat != null && lng != null) { payload.latitude = lat; payload.longitude = lng; }
      const { data } = await api.post('/sos', payload);
      setActive(data.data);
      setConfirm(false);
      show(data.duplicate ? 'SOS already active' : '🚨 SOS sent — help is notified');
    } catch (err) {
      show(err.response?.data?.message || 'Failed to send SOS', 'error');
    } finally { setSending(false); }
  };

  const cancel = async () => {
    if (!active) return;
    if (!confirm('Cancel this SOS alert?')) return;
    try {
      await api.patch(`/sos/${active.id}/cancel`);
      setActive(null);
      show('SOS cancelled');
    } catch (err) { show(err.response?.data?.message || 'Cancel failed', 'error'); }
  };

  if (active) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={cancel}
          className="w-full min-h-[52px] rounded-2xl bg-rose-700 text-white text-base font-extrabold tracking-wide animate-pulse active:scale-[0.99] transition shadow-lg shadow-rose-200"
        >
          🚨 SOS ACTIVE — TAP TO CANCEL
        </button>
        <p className="text-xs text-rose-600 font-semibold mt-1 text-center">Alert sent {active.triggered_at || ''} • Admin is tracking you</p>
        <Toast toast={toast} />
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="w-full min-h-[52px] rounded-2xl bg-rose-600 text-white text-base font-extrabold tracking-wide active:bg-rose-700 active:scale-[0.99] transition shadow-lg shadow-rose-200"
      >
        🚨 SOS
      </button>
      <Modal open={confirm} onClose={() => !sending && setConfirm(false)} title="Emergency Alert">
        <p className="text-sm text-slate-700 font-semibold">Are you sure you want to send an SOS?</p>
        <p className="text-xs text-slate-500 mt-1">Your name, vehicle, trip, live location and time are sent automatically. You do not need to type anything.</p>
        <div className="flex gap-2 mt-5">
          <button type="button" disabled={sending} onClick={() => setConfirm(false)} className="flex-1 min-h-[48px] rounded-xl bg-slate-100 text-slate-700 font-bold active:scale-[0.99] transition disabled:opacity-50">CANCEL</button>
          <button type="button" disabled={sending} onClick={send} className="flex-1 min-h-[48px] rounded-xl bg-rose-600 text-white font-extrabold active:bg-rose-700 active:scale-[0.99] transition disabled:opacity-50">{sending ? 'Sending…' : 'SEND SOS'}</button>
        </div>
      </Modal>
      <Toast toast={toast} />
    </div>
  );
}
