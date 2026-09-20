import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { StatusBadge, Empty, Toast } from '../components/ui';

// Dispatch = approved/reserved reservations + quick trip creation
export default function Dispatch() {
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useState(null);
  const [availV, setAvailV] = useState([]);
  const [availD, setAvailD] = useState([]);
  const nav = useNavigate();
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };

  const load = async () => {
    const { data } = await api.get('/reservations', { params: { limit: 50 } });
    setRows(data.data.filter((r) => ['Approved', 'Reserved', 'Pending'].includes(r.status)));
    const [v, d] = await Promise.all([api.get('/vehicles/available'), api.get('/drivers/available')]);
    setAvailV(v.data.data); setAvailD(d.data.data);
  };
  useEffect(() => { load(); }, []);

  // Dispatch uses ONLY the route attached to the reservation (from Route Planning).
  const dispatch = async (r) => {
    if (!r.vehicle_id || !r.driver_id) { show('Reservation needs vehicle + driver before dispatch', 'error'); return; }
    if (!r.route_id) { show('No Route Assigned — attach a route to this reservation first', 'error'); return; }
    let route;
    try {
      const { data } = await api.get(`/routes/${r.route_id}`);
      route = data.data;
    } catch { show('Attached route could not be loaded', 'error'); return; }
    if (!confirm(`Dispatch ${r.reservation_code} using attached route ${route.route_name || route.route_code} (${route.origin} → ${route.destination})?`)) return;
    try {
      await api.post('/trips', {
        reservation_id: r.id,
        route_id: route.id,
        vehicle_id: r.vehicle_id, driver_id: r.driver_id,
        pickup_location: route.origin,
        destination: route.destination,
        stops: route.stops ? route.stops.map((s) => s.location).join(', ') : '',
        distance_km: route.total_distance_km,
        estimated_time_min: route.estimated_time_min,
        departure_datetime: new Date().toISOString().slice(0, 19).replace('T', ' ')
      });
      show(`Dispatched with attached route ${route.route_code} — trip created`); load();
    } catch (err) { show(err.response?.data?.message || 'Dispatch failed', 'error'); }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Dispatch Board</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-bold mb-2">Available Vehicles ({availV.length})</h3>
          {availV.slice(0, 8).map((v) => <p key={v.id} className="text-sm py-1 border-b">🚚 {v.plate_number} — {v.vehicle_type} ({v.capacity}kg)</p>)}
          {!availV.length && <p className="text-sm text-red-500">No vehicles available!</p>}
        </div>
        <div className="card">
          <h3 className="font-bold mb-2">Available Drivers ({availD.length})</h3>
          {availD.slice(0, 8).map((d) => <p key={d.id} className="text-sm py-1 border-b">🧑‍✈️ {d.full_name} — {d.license_number}</p>)}
          {!availD.length && <p className="text-sm text-red-500">No drivers available!</p>}
        </div>
      </div>
      <div className="card overflow-auto">
        <h3 className="font-bold mb-2">Ready for Dispatch</h3>
        <table className="table min-w-[900px]">
          <thead><tr><th>Reservation</th><th>Attached Route</th><th>Vehicle</th><th>Driver</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold">{r.reservation_code}</td>
                <td>{r.route_id ? <><b>{r.route_name || r.route_code}</b><br /><span className="text-xs text-slate-400">{r.pickup_location} → {r.destination} ({r.route_distance_km} km)</span></> : <span className="badge bg-red-100 text-red-700">No Route Assigned</span>}</td>
                <td>{r.plate_number || '—'}</td><td>{r.driver_name || '—'}</td>
                <td><StatusBadge value={r.status} /></td>
                <td className="flex gap-1">
                  <button className="btn-green btn !px-2" onClick={() => dispatch(r)} disabled={!r.route_id} title={r.route_id ? 'Dispatch using attached route' : 'No Route Assigned'}>Dispatch → Trip</button>
                  <button className="btn-gray btn !px-2" onClick={() => nav('/trips')}>Trips</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty msg="Nothing waiting for dispatch" />}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
