import { useEffect, useState } from 'react';
import api from '../../services/api';
import MobileTrackingMap from '../../mobile/MobileTrackingMap';

/**
 * Driver map: own active trip — current position, destination,
 * trip status, last update. Data from the driver's own trip +
 * its GPS history (backend ownership-enforced).
 */
export default function DriverMap() {
  const [trip, setTrip] = useState(null);
  const [history, setHistory] = useState([]);
  const [updated, setUpdated] = useState(null);
  const [tilesDown, setTilesDown] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/trips/mine');
        const trips = data.data || [];
        const active = trips.find((t) => ['In Transit', 'Arrived', 'Dispatched'].includes(t.trip_status)) || trips[0] || null;
        setTrip(active);
        if (active) {
          try {
            const h = await api.get(`/tracking/vehicle/${active.vehicle_id}`);
            setHistory(h.data.data.history || []);
            const latest = (h.data.data.history || [])[0];
            if (latest) setUpdated(latest.recorded_at);
          } catch { /* no GPS yet */ }
        }
      } catch { /* empty state */ }
    })();
  }, []);

  const latest = history[0];
  const pin = trip && latest
    ? [{ id: trip.vehicle_id, plate_number: trip.plate_number, status: trip.trip_status, latitude: latest.latitude, longitude: latest.longitude }]
    : [];

  return (
    <div className="space-y-3 w-full max-w-full overflow-hidden">
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3">
        <MobileTrackingMap vehicles={pin} height={300} onTileError={() => setTilesDown(true)} />
        {tilesDown && (
          <p className="text-[11px] text-amber-600 font-semibold px-1 pt-2">Map tiles unavailable (offline?) — trip info below is unaffected.</p>
        )}
      </div>

      {trip ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4">
          <p className="font-extrabold text-slate-900 text-sm truncate">TRIP-{trip.trip_code || trip.id} • {trip.trip_status}</p>
          <div className="text-xs text-slate-600 mt-2 space-y-1 break-words">
            <p>🚚 Vehicle: <b className="text-slate-800">{trip.plate_number || `#${trip.vehicle_id}`}</b></p>
            <p>🏁 Destination: <b className="text-slate-800">{trip.destination}</b></p>
            <p>🛣️ Trip status: <b className="text-slate-800">{trip.trip_status}</b></p>
            <p>🕒 Last updated: {updated || 'No GPS fix yet'}</p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 text-center">
          <p className="text-3xl" aria-hidden="true">🗺️</p>
          <p className="font-bold text-slate-700 mt-2">No active trip</p>
          <p className="text-xs text-slate-400 mt-1">Start a trip to see live tracking here.</p>
        </div>
      )}
    </div>
  );
}
