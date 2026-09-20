import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, Empty, Modal, Toast, Pager } from '../components/ui';
import { fuelTypeOptions } from '../constants/fuelTypes';

const STATUSES = ['Available', 'Reserved', 'Dispatched', 'In Transit', 'Maintenance', 'Inactive'];
// Motor / Bus / SUV retired from new entries — legacy records still display via LEGACY_TYPES fallback.
const TYPES = ['Truck', 'Van', 'Pickup', 'Motorcycle'];
const LEGACY_TYPES = ['Motor', 'Bus', 'SUV'];

export default function Vehicles() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [pg, setPg] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [view, setView] = useState(null);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({});
  const [showArchived, setShowArchived] = useState(false);

  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };
  const load = async () => {
    const { data } = await api.get('/vehicles', { params: { search, status, page, archived: showArchived ? '1' : '' } });
    setRows(data.data); setPg(data.pagination);
  };
  useEffect(() => { load(); }, [page, showArchived]);
  const doSearch = (e) => { e.preventDefault(); setPage(1); load(); };

  const typeOptions = (current) => {
    const opts = [...TYPES];
    if (current && !opts.includes(current)) opts.push(current);
    return opts;
  };
  const openAdd = () => { setForm({ vehicle_type: 'Truck', fuel_type: 'Diesel', status: 'Available', capacity: 1000 }); setModal('add'); };
  const openEdit = (v) => { setForm({ ...v }); setModal('edit'); };
  const openView = async (v) => { const { data } = await api.get(`/vehicles/${v.id}`); setView(data.data); };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (modal === 'add') { await api.post('/vehicles', form); show('Vehicle successfully created'); }
      else { await api.put(`/vehicles/${form.id}`, form); show('Vehicle updated'); }
      setModal(null); load();
    } catch (err) { show(err.response?.data?.message || 'Save failed', 'error'); }
  };

  const archive = async (v) => {
    if (!confirm(`Archive vehicle ${v.plate_number}?\nArchived records will no longer appear in the active list, but they will remain available in the Archive section.`)) return;
    try { await api.patch(`/vehicles/${v.id}/archive`); show('Vehicle archived'); load(); }
    catch (err) { show(err.response?.data?.message || 'Archive failed', 'error'); }
  };
  const restore = async (v) => {
    if (!confirm(`Restore vehicle ${v.plate_number}?`)) return;
    try { await api.patch(`/vehicles/${v.id}/restore`); show('Vehicle restored'); load(); }
    catch (err) { show(err.response?.data?.message || 'Restore failed', 'error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xl font-bold">Fleet & Vehicles</h2>
        <button className={`btn ml-auto ${showArchived ? 'btn-gray' : 'btn-amber bg-amber-50 text-amber-800 border border-amber-200'}`} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Show Active' : 'Show Archive'}</button>
        {can('admin', 'fleet_manager') && <button className="btn-primary btn" onClick={openAdd}>+ Add Vehicle</button>}
      </div>
      <form onSubmit={doSearch} className="card flex gap-2 flex-wrap">
        <input className="input max-w-xs" placeholder="Search plate / code / type..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-primary btn">Search</button>
      </form>
      <div className="card overflow-auto">
        <table className="table min-w-[800px]">
          <thead><tr><th>Vehicle ID</th><th>Plate</th><th>Type</th><th>Type of Fuel</th><th>Capacity (kg)</th><th>Status</th><th>Reg. Expiry</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td className="font-semibold">{v.vehicle_code}</td><td>{v.plate_number}</td><td>{v.vehicle_type}{LEGACY_TYPES.includes(v.vehicle_type) ? ' (legacy)' : ''}</td>
                <td><span className="badge bg-amber-100 text-amber-800">{v.fuel_type || '—'}</span></td>
                <td>{v.capacity}</td><td><StatusBadge value={v.status} /></td><td>{v.registration_expiry || '—'}</td>
                <td className="flex gap-1">
                  <button className="btn-gray btn !px-2" onClick={() => openView(v)}>View</button>
                  {can('admin', 'fleet_manager') && (<>
                    {!showArchived ? (<>
                      <button className="btn-gray btn !px-2" onClick={() => openEdit(v)}>Edit</button>
                      <button className="btn-amber btn !px-2 bg-amber-100 text-amber-800 border border-amber-200" onClick={() => archive(v)}>Archive</button>
                    </>) : (
                      <button className="btn-emerald btn !px-2 bg-emerald-100 text-emerald-800 border border-emerald-200" onClick={() => restore(v)}>Restore</button>
                    )}
                  </>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
        <Pager pagination={pg} onPage={setPage} />
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'Add Vehicle' : 'Edit Vehicle'}>
        <form onSubmit={save} className="grid grid-cols-2 gap-3">
          <div><label className="label">Plate Number *</label><input className="input" value={form.plate_number || ''} onChange={(e) => setForm({ ...form, plate_number: e.target.value })} required /></div>
          <div><label className="label">Vehicle Type *</label><select className="input" value={form.vehicle_type || ''} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}>{typeOptions(form.vehicle_type).map((t) => <option key={t}>{t}</option>)}</select></div>
          <div><label className="label">Type of Fuel *</label><select className="input" value={form.fuel_type || 'Diesel'} onChange={(e) => setForm({ ...form, fuel_type: e.target.value })}>{fuelTypeOptions(form.fuel_type).map((t) => <option key={t}>{t}</option>)}</select></div>
          <div><label className="label">Capacity (kg)</label><input type="number" className="input" value={form.capacity || ''} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
          <div><label className="label">Registration No.</label><input className="input" value={form.registration_number || ''} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} /></div>
          <div><label className="label">Registration Expiry</label><input type="date" className="input" value={form.registration_expiry || ''} onChange={(e) => setForm({ ...form, registration_expiry: e.target.value })} /></div>
          <div><label className="label">Status</label><select className="input" value={form.status || 'Available'} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="col-span-2"><label className="label">Notes</label><textarea className="input" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn-gray btn" onClick={() => setModal(null)}>Cancel</button><button className="btn-primary btn">Save</button></div>
        </form>
      </Modal>

      <Modal open={!!view} onClose={() => setView(null)} title={`Vehicle ${view?.plate_number || ''}`}>
        {view && (
          <div className="text-sm space-y-2">
            <p><b>Code:</b> {view.vehicle_code} | <b>Type:</b> {view.vehicle_type} | <b>Type of Fuel:</b> {view.fuel_type || '—'} | <b>Capacity:</b> {view.capacity} kg</p>
            <p><b>Status:</b> <StatusBadge value={view.status} /> | <b>Reg:</b> {view.registration_number} (exp {view.registration_expiry})</p>
            <p><b>Notes:</b> {view.notes || '—'}</p>
            {view.lastLocation && <p><b>Last GPS:</b> {view.lastLocation.latitude}, {view.lastLocation.longitude} @ {view.lastLocation.speed_kmh} km/h ({view.lastLocation.recorded_at})</p>}
            <h4 className="font-bold mt-3">Recent Trips</h4>
            {view.recentTrips?.length ? view.recentTrips.map((t, i) => <p key={i}>{t.trip_code}: {t.pickup_location} → {t.destination} (<StatusBadge value={t.trip_status} />)</p>) : <p className="text-slate-400">No trips yet.</p>}
          </div>
        )}
      </Modal>
      <Toast toast={toast} />
    </div>
  );
}
