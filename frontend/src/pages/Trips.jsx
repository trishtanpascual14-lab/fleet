import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, Empty, Modal, Toast, Pager } from '../components/ui';

const TSTAT = ['Scheduled', 'Dispatched', 'In Transit', 'Arrived', 'Completed', 'Cancelled'];
const DSTAT = ['Pending', 'Out for Delivery', 'Delivered', 'Failed'];

export default function Trips() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [pg, setPg] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState(null);
  const [toast, setToast] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };
  const load = async () => {
    const { data } = await api.get('/trips', { params: { search, status, page, archived: showArchived ? '1' : '' } });
    setRows(data.data); setPg(data.pagination);
  };
  useEffect(() => { load(); }, [page, showArchived]);

  const setTripStatus = async (id, trip_status) => {
    if (!confirm(`Set trip to ${trip_status}?`)) return;
    try { await api.patch(`/trips/${id}/status`, { trip_status }); show('Trip updated'); openView({ id }); load(); }
    catch (err) { show(err.response?.data?.message || 'Update failed', 'error'); }
  };
  const setDelivery = async (id, delivery_status) => {
    try { await api.patch(`/trips/${id}/status`, { delivery_status }); show('Delivery status updated'); openView({ id }); load(); }
    catch (err) { show(err.response?.data?.message || 'Update failed', 'error'); }
  };

  const openView = async (t) => { const { data } = await api.get(`/trips/${t.id}`); setView(data.data); };
  const archive = async (t) => {
    if (!confirm(`Archive trip ${t.trip_code}?\nArchived trips will be hidden.`)) return;
    try { await api.patch(`/trips/${t.id}/archive`); show('Trip archived'); load(); }
    catch (err) { show(err.response?.data?.message || 'Archive failed', 'error'); }
  };
  const restore = async (t) => {
    if (!confirm(`Restore trip ${t.trip_code}?`)) return;
    try { await api.patch(`/trips/${t.id}/restore`); show('Trip restored'); load(); }
    catch (err) { show(err.response?.data?.message || 'Restore failed', 'error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold">Trip Management</h2>
        <span className="ml-auto text-xs text-slate-500">Trips are created via Dispatch from approved reservations</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }} className="card flex gap-2 flex-wrap">
        <input className="input max-w-xs" placeholder="Search code / location..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{TSTAT.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-primary btn">Search</button>
      </form>
      <div className="card overflow-auto">
        <table className="table min-w-[1000px]">
          <thead><tr><th>Trip ID</th><th>Route</th><th>Vehicle</th><th>Driver</th><th>Dist.</th><th>ETA</th><th>Trip Status</th><th>Delivery</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="font-semibold">{t.trip_code}</td>
                <td>{t.pickup_location} → {t.destination}</td>
                <td>{t.plate_number}</td><td>{t.driver_name}</td>
                <td>{t.distance_km} km</td><td>{t.estimated_time_min} min</td>
                <td><StatusBadge value={t.trip_status} /></td><td><StatusBadge value={t.delivery_status} /></td>
                <td className="flex gap-1">
                  <button className="btn-gray btn !px-2" onClick={() => openView(t)}>View</button>
                  {can('admin', 'fleet_manager') && (!showArchived ? <button className="btn-amber btn !px-2 bg-amber-100 text-amber-800 border" onClick={() => archive(t)}>Archive</button> : <button className="btn-emerald btn !px-2 bg-emerald-100 text-emerald-800 border" onClick={() => restore(t)}>Restore</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
        <Pager pagination={pg} onPage={setPage} />
      </div>

      <Modal open={!!view} onClose={() => setView(null)} title={view ? `Trip ${view.trip_code}` : ''} wide>
        {view && (
          <div className="text-sm space-y-2">
            <p><b>Pickup:</b> {view.pickup_location} → <b>Destination:</b> {view.destination}</p>
            <p><b>Stops:</b> {view.stops || '—'} | <b>Distance:</b> {view.distance_km} km | <b>ETA:</b> {view.estimated_time_min} min</p>
            <p><b>Vehicle:</b> {view.plate_number} ({view.vehicle_type}) | <b>Driver:</b> {view.driver_name}</p>
            <p><b>Departure:</b> {view.departure_datetime || '—'} | <b>Arrival:</b> {view.arrival_datetime || '—'}</p>
            <p><b>Trip:</b> <StatusBadge value={view.trip_status} /> <b>Delivery:</b> <StatusBadge value={view.delivery_status} /></p>
            {view.notes && <p><b>Notes:</b> {view.notes}</p>}
            <div className="flex gap-2 flex-wrap pt-2">
              {['In Transit', 'Arrived', 'Completed'].map((s) => <button key={s} className="btn-green btn !px-2" onClick={() => setTripStatus(view.id, s)}>{s}</button>)}
              {['Out for Delivery', 'Delivered', 'Failed'].map((s) => <button key={s} className="btn-gray btn !px-2" onClick={() => setDelivery(view.id, s)}>{s}</button>)}
            </div>
          </div>
        )}
      </Modal>
      <Toast toast={toast} />
    </div>
  );
}
