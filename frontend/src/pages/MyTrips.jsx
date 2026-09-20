import { useEffect, useState } from 'react';
import api from '../services/api';
import { StatusBadge, Empty, Toast } from '../components/ui';
import SosButton from '../components/SosButton';

// Driver dashboard: My Trips with FULL location info
export default function MyTrips() {
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useState(null);
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };
  const load = async () => { const { data } = await api.get('/trips/mine'); setRows(data.data); };
  useEffect(() => { load(); }, []);

  const update = async (id, payload) => {
    try { await api.patch(`/trips/${id}/status`, payload); show('Trip updated'); load(); }
    catch (err) { show(err.response?.data?.message || 'Update failed', 'error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-xl font-bold">🧭 My Trips</h2>
        <div className="ml-auto w-full sm:w-64"><SosButton /></div>
      </div>
      {!rows.length && <div className="card"><Empty msg="No trips assigned to you yet." /></div>}
      <div className="grid md:grid-cols-2 gap-4">
        {rows.map((t) => (
          <div key={t.id} className="card border-l-4 border-l-blue-600">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold">{t.trip_code}</span>
              <StatusBadge value={t.trip_status} /><StatusBadge value={t.delivery_status} />
            </div>
            <div className="mt-3 text-sm space-y-1.5">
              <p>📍 <b>Pickup:</b> {t.pickup_location}</p>
              <p>🏁 <b>Destination:</b> {t.destination}</p>
              <p>🛑 <b>Stops:</b> {t.stops || 'Direct route'}</p>
              <p>📏 <b>Distance:</b> {t.distance_km} km &nbsp; ⏱️ <b>ETA:</b> {t.estimated_time_min} min</p>
              <p>🚚 <b>Vehicle:</b> {t.plate_number} ({t.vehicle_type})</p>
              <p>📅 <b>Trip date:</b> {t.departure_datetime || t.created_at}</p>
              {t.notes && <p>📝 <b>Notes:</b> {t.notes}</p>}
            </div>
            <div className="flex gap-2 mt-3 flex-wrap">
              <button className="btn-green btn !px-2" onClick={() => update(t.id, { trip_status: 'In Transit' })}>Start (In Transit)</button>
              <button className="btn-green btn !px-2" onClick={() => update(t.id, { trip_status: 'Arrived' })}>Arrived</button>
              <button className="btn-green btn !px-2" onClick={() => update(t.id, { delivery_status: 'Delivered' })}>Delivered</button>
              <button className="btn-primary btn !px-2" onClick={() => update(t.id, { trip_status: 'Completed' })}>Complete Trip</button>
            </div>
          </div>
        ))}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
