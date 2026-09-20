import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import MobileTrackingMap from '../MobileTrackingMap';
import { MobileCard } from '../cards';
import { StatusBadge, Toast } from '../../components/ui';

/**
 * Mobile tracking screen — map container + selected vehicle info.
 * Uses real `/tracking/vehicles` data; polling hook point is ready
 * for live GPS to be connected later (no push/GPS APIs in this phase).
 */
export default function MobileTracking() {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async (silent) => {
    try {
      const { data } = await api.get('/tracking/vehicles');
      setRows(data.data || []);
    } catch (err) {
      if (!silent) {
        setToast({ msg: err.response?.data?.message || 'Failed to load tracking', type: 'error' });
        setTimeout(() => setToast(null), 2500);
      }
    }
  }, []);

  // Base polling every 30s — live-GPS ready; increase frequency later if needed.
  useEffect(() => {
    load(false);
    const t = setInterval(() => load(true), 30000);
    return () => clearInterval(t);
  }, [load]);

  const onSelect = useCallback((v) => setSelected(v), []);
  const online = rows.filter((r) => r.latitude).length;

  return (
    <div className="space-y-3 w-full max-w-full overflow-hidden">
      <MobileCard>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
          <span>{online} online • {rows.length - online} offline • {rows.length} vehicles</span>
        </div>
        <div className="mt-2">
          <MobileTrackingMap vehicles={rows} onSelect={onSelect} />
        </div>
      </MobileCard>

      {selected ? (
        <MobileCard>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-extrabold text-slate-900 text-sm truncate">{selected.plate_number}</p>
            <span className="ml-auto shrink-0"><StatusBadge value={selected.status} /></span>
          </div>
          <div className="text-xs text-slate-600 mt-2 space-y-1 break-words">
            <p>🚚 {selected.vehicle_type || '—'} • ⛽ {selected.fuel_type || '—'}</p>
            <p>🧑‍✈️ Driver: {selected.driver_name || 'Unassigned'}{selected.driver_contact ? ` (${selected.driver_contact})` : ''}</p>
            <p>🛣️ Trip status: {selected.current_trip ? `${selected.current_trip}` : 'No active trip'}</p>
            <p>📍 Current location: {selected.latitude ? `${selected.latitude}, ${selected.longitude}` : 'No GPS data yet'}</p>
            <p>🚗 Speed: {selected.speed_kmh != null ? `${selected.speed_kmh} km/h` : '—'}</p>
            <p>🕒 Last updated: {selected.recorded_at || '—'}</p>
          </div>
        </MobileCard>
      ) : (
        <MobileCard>
          <p className="text-xs text-slate-400">Tap a vehicle marker on the map to see vehicle, driver, trip and location details.</p>
        </MobileCard>
      )}

      <div className="space-y-2">
        {rows.slice(0, 10).map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setSelected(v)}
            className={`w-full text-left bg-white rounded-2xl border shadow-sm p-3 min-h-[44px] active:scale-[0.99] transition ${selected?.id === v.id ? 'border-[#6023d5] ring-1 ring-purple-300' : 'border-slate-200/80'}`}
          >
            <span className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${v.latitude ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden="true" />
              <b className="text-sm truncate">{v.plate_number}</b>
              <span className="ml-auto text-xs text-slate-400 shrink-0">{v.latitude ? 'Active' : 'Offline'}</span>
            </span>
          </button>
        ))}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
