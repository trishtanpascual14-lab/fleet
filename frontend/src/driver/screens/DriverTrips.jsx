import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { StatusBadge, Empty, Toast } from '../../components/ui';

/**
 * Driver trips — ONLY the logged-in driver's trips (`/trips/mine`,
 * backend-scoped by JWT driver_id). Start/complete from the detail screen.
 */
export default function DriverTrips() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/trips/mine');
        setRows(data.data || []);
      } catch (err) {
        setToast({ msg: err.response?.data?.message || 'Failed to load trips', type: 'error' });
        setTimeout(() => setToast(null), 2500);
      }
    })();
  }, []);

  return (
    <div className="space-y-3 w-full max-w-full overflow-hidden">
      {rows.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => nav(`/driver/trips/${t.id}`)}
          aria-label={`Trip ${t.trip_code} — view details`}
          className="w-full text-left bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 min-h-[44px] active:scale-[0.99] transition"
        >
          <span className="flex items-center gap-2 flex-wrap">
            <b className="text-sm truncate">TRIP-{t.trip_code || t.id}</b>
            <span className="ml-auto shrink-0"><StatusBadge value={t.trip_status} /></span>
          </span>
          <span className="block text-sm font-semibold text-slate-700 mt-1.5 break-words">{t.pickup_location} → {t.destination}</span>
          <span className="block text-xs text-slate-500 mt-1 break-words">
            🚚 {t.plate_number || `#${t.vehicle_id}`} • 🕒 {t.departure_datetime || '—'}
          </span>
          <span className="mt-3 block w-full min-h-[44px] rounded-xl bg-[#6023d5] text-white text-sm font-bold text-center leading-[44px]">
            {['In Transit', 'Arrived'].includes(t.trip_status) ? 'TRIP IN PROGRESS' : ['Scheduled', 'Dispatched'].includes(t.trip_status) ? 'START TRIP' : 'VIEW DETAILS'}
          </span>
        </button>
      ))}
      {!rows.length && <Empty msg="No trips assigned to you" />}
      <Toast toast={toast} />
    </div>
  );
}
