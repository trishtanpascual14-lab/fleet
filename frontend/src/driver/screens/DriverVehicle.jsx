import { useEffect, useState } from 'react';
import api from '../../services/api';
import { StatusBadge, Toast } from '../../components/ui';
import { getCurrentPosition } from '../useGpsTracking';

const REPORT_STATUSES = ['Available', 'In Use', 'Maintenance', 'Problem Reported'];

/**
 * Driver vehicle screen — read-only assigned-vehicle info +
 * status/problem report to the fleet team (existing backend).
 */
export default function DriverVehicle() {
  const [vehicle, setVehicle] = useState(null);
  const [status, setStatus] = useState('In Use');
  const [description, setDescription] = useState('');
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/drivers/me');
        if (!data.data.assigned_vehicle_id) return;
        const v = await api.get(`/vehicles/${data.data.assigned_vehicle_id}`);
        setVehicle(v.data.data);
      } catch (err) {
        show(err.response?.data?.message || 'Failed to load vehicle', 'error');
      }
    })();
  }, []);

  const report = async (e) => {
    e.preventDefault();
    if (!vehicle) return;
    setBusy(true);
    try {
      let coords = {};
      try {
        const p = await getCurrentPosition();
        coords = { latitude: p.coords.latitude, longitude: p.coords.longitude };
      } catch { /* location optional for the report */ }
      await api.post(`/vehicles/${vehicle.id}/report`, { status, description, ...coords });
      show('Report sent to fleet team');
      setDescription('');
    } catch (err) {
      show(err.response?.data?.message || 'Report failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!vehicle) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 text-center">
        <p className="text-3xl" aria-hidden="true">🚚</p>
        <p className="font-bold text-slate-700 mt-2">No vehicle assigned</p>
        <p className="text-xs text-slate-400 mt-1">Your assigned vehicle will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full max-w-full overflow-hidden">
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-extrabold text-slate-900 text-lg truncate">{vehicle.plate_number}</p>
          <span className="ml-auto shrink-0"><StatusBadge value={vehicle.status} /></span>
        </div>
        <div className="text-sm text-slate-600 mt-2 space-y-1.5 break-words">
          <p>🚚 Vehicle type: <b className="text-slate-800">{vehicle.vehicle_type || '—'}</b></p>
          <p>⛽ Fuel type: <b className="text-slate-800">{vehicle.fuel_type || '—'}</b></p>
          <p>📦 Capacity: <b className="text-slate-800">{vehicle.capacity != null ? `${vehicle.capacity} kg` : '—'}</b></p>
          <p>📋 Registration: <b className="text-slate-800">{vehicle.registration_number || '—'}{vehicle.registration_expiry ? ` (expires ${vehicle.registration_expiry})` : ''}</b></p>
        </div>
      </div>

      <form onSubmit={report} className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 space-y-3">
        <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">Report Vehicle Status</p>
        <div>
          <label className="label" htmlFor="dv-status">Status</label>
          <select id="dv-status" className="input min-h-[48px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            {REPORT_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="dv-desc">Problem description</label>
          <textarea id="dv-desc" rows={3} className="input min-h-[48px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the issue (optional)" />
        </div>
        <button type="submit" disabled={busy} className="btn-primary btn w-full min-h-[52px]">
          {busy ? 'Sending…' : 'Send Report'}
        </button>
      </form>
      <Toast toast={toast} />
    </div>
  );
}
