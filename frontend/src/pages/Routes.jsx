import { useEffect, useState } from 'react';
import api from '../services/api';
import { StatusBadge, Empty, Modal, Toast, Pager } from '../components/ui';
import RouteMap from '../components/RouteMap';
import LocationSearch from '../components/LocationSearch';

// Route Planning = CREATE AND MANAGE REUSABLE ROUTES ONLY.
// Vehicle / Driver / Cargo / Departure / Stops assignment lives in the
// Reservation System and Dispatch — never duplicated here.
const STATUSES = ['Planned', 'Optimized', 'Assigned', 'In Transit', 'Completed', 'Cancelled'];
const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
const blankForm = () => ({ route_name: '', origin: null, destination: null, priority: 'Normal' });
const fmtTime = (min) => {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} hr ${min % 60} min`;
};

export default function Routes() {
  const [rows, setRows] = useState([]);
  const [pg, setPg] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState('');
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [errors, setErrors] = useState({});
  const [calc, setCalc] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const [edit, setEdit] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const load = async () => {
    const { data } = await api.get('/routes', { params: { page, search, status: statusF, archived: showArchived ? '1' : '' } });
    setRows(data.data); setPg(data.pagination);
  };
  useEffect(() => { load(); }, [page, showArchived]);

  const validateCalc = () => {
    const e = {};
    if (!form.route_name.trim()) e.route_name = 'Route Name is required';
    if (!form.origin) e.origin = 'Starting Location is required — please select a valid location from the search suggestions.';
    if (!form.destination) e.destination = 'Destination is required — please select a valid location from the search suggestions.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const calculate = async () => {
    if (!validateCalc()) { show('Please complete the route details', 'error'); return; }
    setBusy(true); setSavedId(null);
    try {
      const { data } = await api.post('/routes/calculate', {
        origin: form.origin, destination: form.destination, stops: []
      });
      setCalc(data.data);
    } catch (err) { show(err.response?.data?.message || 'Route calculation failed', 'error'); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!calc) return;
    try {
      const { data } = await api.post('/routes', {
        route_name: form.route_name.trim(),
        origin: form.origin, destination: form.destination, stops: [],
        priority: form.priority, total_distance_km: calc.distanceKm, estimated_time_min: calc.estimatedMin,
        estimated_fuel_liters: calc.fuel.liters, estimated_cost: calc.cost.total,
        route_info: calc.info, status: 'Planned'
      });
      show('Route saved — now available in the Reservation System');
      setSavedId(data.data.id);
      load();
    } catch (err) {
      const r = err.response?.data;
      show(r?.errors ? Object.values(r.errors).join(' ') : r?.message || 'Save failed', 'error');
    }
  };

  const openView = async (r) => { const { data } = await api.get(`/routes/${r.id}`); setView(data.data); };
  const openEdit = async (r) => {
    const { data } = await api.get(`/routes/${r.id}`);
    const v = data.data;
    setEdit({
      ...v,
      origin: v.origin_lat ? { name: v.origin, lat: +v.origin_lat, lon: +v.origin_lng } : null,
      destination: v.destination_lat ? { name: v.destination, lat: +v.destination_lat, lon: +v.destination_lng } : null
    });
  };
  const saveEdit = async (e) => {
    e.preventDefault();
    if (!edit.route_name?.trim() || !edit.origin || !edit.destination) { show('Route Name, Starting Location and Destination are required', 'error'); return; }
    try {
      await api.put(`/routes/${edit.id}`, {
        route_name: edit.route_name.trim(), origin: edit.origin, destination: edit.destination,
        priority: edit.priority, status: edit.status
      });
      show('Route updated'); setEdit(null); load();
      if (view?.id === edit.id) openView({ id: edit.id });
    } catch (err) { show(err.response?.data?.message || 'Update failed', 'error'); }
  };
  const recalc = async (r) => {
    if (!confirm(`Recalculate ${r.route_code}?`)) return;
    try { const { data } = await api.post(`/routes/${r.id}/recalculate`); show(`Recalculated: ${data.data.distanceKm} km, ${fmtTime(data.data.estimatedMin)}`); load(); }
    catch (err) { show(err.response?.data?.message || 'Recalculation failed', 'error'); }
  };

  const archive = async (r) => {
    if (!confirm(`Archive route ${r.route_code}?\nArchived routes will be hidden.`)) return;
    try { await api.patch(`/routes/${r.id}/archive`); show('Route archived'); load(); }
    catch (err) { show(err.response?.data?.message || 'Archive failed', 'error'); }
  };
  const restore = async (r) => {
    if (!confirm(`Restore route ${r.route_code}?`)) return;
    try { await api.patch(`/routes/${r.id}/restore`); show('Route restored'); load(); }
    catch (err) { show(err.response?.data?.message || 'Restore failed', 'error'); }
  };

  const seqLine = (c) => [c.origin.name, ...c.orderedStops.map((s) => s.name), c.destination.name].join(' → ');

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Route Planning</h2>
      <p className="text-sm text-slate-500 -mt-2">Create and manage reusable routes. Reservations select these routes and assign Vehicle + Driver.</p>

      {/* ROUTE INPUT — route data only */}
      <div className="card">
        <h3 className="font-bold mb-3">Route Input</h3>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><label className="label">Route Name *</label>
            <input className="input" value={form.route_name} onChange={(e) => setForm({ ...form, route_name: e.target.value })} placeholder="e.g. Warehouse A – SM Mall Morning Run" />
            {errors.route_name && <p className="text-xs text-red-600 mt-1">{errors.route_name}</p>}</div>
          <div><label className="label">Starting Location *</label>
            <LocationSearch value={form.origin} onSelect={(p) => setForm({ ...form, origin: p })} placeholder="🔍 Search starting location..." error={errors.origin} /></div>
          <div><label className="label">Destination *</label>
            <LocationSearch value={form.destination} onSelect={(p) => setForm({ ...form, destination: p })} placeholder="🔍 Search destination..." error={errors.destination} /></div>
          <div><label className="label">Priority Level</label>
            <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></div>
          <div className="flex items-end gap-2">
            <button className="btn-primary btn" onClick={calculate} disabled={busy}>{busy ? 'Calculating...' : 'Calculate Route'}</button>
            <button className="btn-gray btn" onClick={() => { setForm(blankForm()); setCalc(null); setErrors({}); setSavedId(null); }}>Reset</button>
          </div>
        </div>
      </div>

      {/* RESULT + MAP */}
      {calc && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card">
            <h3 className="font-bold mb-2">Route Result</h3>
            <span className={`badge ${calc.mode === 'live' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
              {calc.mode === 'live' ? '🛣️ Live road-network route' : '⚠️ Offline estimate — connect for live routing'}
            </span>
            <div className="text-sm space-y-1.5 mt-2">
              <p className="font-semibold text-blue-700">{seqLine(calc)}</p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-500">Total Distance</p><p className="font-bold">{calc.distanceKm} km</p></div>
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-500">Est. Travel Time</p><p className="font-bold">{fmtTime(calc.estimatedMin)}</p></div>
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-500">Est. Fuel</p><p className="font-bold">{calc.fuel.liters} L ({calc.fuel.ratePer100km} L/100km)</p></div>
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-500">Est. Transport Cost</p><p className="font-bold">₱{calc.cost.total.toLocaleString()}</p></div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2">
                <p className="text-xs text-slate-600">Fuel ₱{calc.cost.fuelCost} + Toll ₱{calc.cost.tollEst} + Driver ₱{calc.cost.driverAllowance}</p>
              </div>
            </div>
          </div>
          <div className="card">
            <h3 className="font-bold mb-2">Interactive Map</h3>
            <RouteMap points={calc.mapPoints} geometry={calc.geometry} />
          </div>
        </div>
      )}

      {/* ROUTE SUMMARY + SAVE */}
      {calc && (
        <div className="card border-l-4 border-l-blue-600">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold">Route Summary</h3>
            {savedId && <span className="badge bg-emerald-100 text-emerald-700">Saved — DB ID {savedId}</span>}
            <button className="btn-green btn ml-auto" onClick={save}>💾 Save Route</button>
          </div>
          <div className="grid md:grid-cols-3 gap-x-6 gap-y-1.5 mt-2 text-sm">
            <p><b>Route Name:</b> {form.route_name}</p>
            <p><b>Starting Location:</b> {calc.origin.name}</p>
            <p><b>Destination:</b> {calc.destination.name}</p>
            <p><b>Total Distance:</b> {calc.distanceKm} km</p>
            <p><b>Est. Travel Time:</b> {fmtTime(calc.estimatedMin)}</p>
            <p><b>Priority:</b> <StatusBadge value={form.priority} /></p>
            <p><b>Est. Fuel:</b> {calc.fuel.liters} L</p>
            <p><b>Est. Cost:</b> ₱{calc.cost.total.toLocaleString()}</p>
            <p><b>Status:</b> <StatusBadge value="Planned" /></p>
          </div>
        </div>
      )}

      {/* SAVED ROUTES — route information only */}
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-bold">Saved Routes</h3>
          <button className={`btn ml-auto ${showArchived ? 'btn-gray' : 'btn-amber bg-amber-50 text-amber-800 border'}`} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Show Active' : 'Show Archive'}</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }} className="flex gap-2 flex-wrap mb-3">
          <input className="input max-w-xs" placeholder="Search name / code / origin / destination..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input max-w-[180px]" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button className="btn-primary btn">Search</button>
        </form>
        <div className="overflow-auto">
          <table className="table min-w-[1000px]">
            <thead><tr><th>Route ID</th><th>Route</th><th>Stops</th><th>Distance</th><th>Est. Time</th><th>Priority</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><span className="font-semibold">{r.route_name || '—'}</span><br /><span className="text-xs text-slate-400">{r.route_code}</span></td>
                  <td>{r.origin} → {r.destination}</td>
                  <td className="max-w-[200px] truncate" title={r.stops.map((s) => s.location).join(', ')}>{r.stops.map((s) => s.location).join(', ') || 'Direct'}</td>
                  <td>{r.total_distance_km} km</td><td>{fmtTime(r.estimated_time_min)}</td>
                  <td><StatusBadge value={r.priority} /></td>
                  <td><StatusBadge value={r.status} /></td>
                  <td>{String(r.created_at).slice(0, 10)}</td>
                  <td className="flex gap-1 flex-wrap">
                    <button className="btn-gray btn !px-2" onClick={() => openView(r)}>View</button>
                    <button className="btn-gray btn !px-2" onClick={() => openEdit(r)}>Edit</button>
                    <button className="btn-gray btn !px-2" onClick={() => recalc(r)}>Recalculate</button>
                    !showArchived ? <button className="btn-amber btn !px-2 bg-amber-100 text-amber-800 border" onClick={() => archive(r)}>Archive</button> : <button className="btn-emerald btn !px-2 bg-emerald-100 text-emerald-800 border" onClick={() => restore(r)}>Restore</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty />}
          <Pager pagination={pg} onPage={setPage} />
        </div>
      </div>

      {/* VIEW MODAL */}
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${view.route_name || 'Route'} (${view.route_code})` : ''} wide>
        {view && (
          <div className="space-y-3 text-sm">
            <div className="grid md:grid-cols-3 gap-x-6 gap-y-1.5">
              <p><b>Route Name:</b> {view.route_name || '—'}</p>
              <p><b>Origin:</b> {view.origin}</p><p><b>Destination:</b> {view.destination}</p>
              <p><b>Status:</b> <StatusBadge value={view.status} /> <StatusBadge value={view.priority} /></p>
              <p><b>Distance:</b> {view.total_distance_km} km</p><p><b>Est. Time:</b> {fmtTime(view.estimated_time_min)}</p>
              <p><b>Est. Fuel:</b> {view.estimated_fuel_liters} L</p><p><b>Est. Cost:</b> ₱{(+view.estimated_cost).toLocaleString()}</p>
            </div>
            <p><b>Ordered stops:</b> {view.stops.map((s) => s.location).join(' → ') || 'Direct route'}</p>
            {view.route_info && <p className="text-slate-500">{view.route_info}</p>}
            <RouteMap points={view.mapPoints} geometry={view.geometry} height={280} />
            {view.linkedTrips?.length > 0 && <p><b>Linked trips:</b> {view.linkedTrips.map((t) => `${t.trip_code} (${t.trip_status})`).join(', ')}</p>}
            <div className="flex gap-2 flex-wrap">
              <button className="btn-gray btn" onClick={() => { setView(null); openEdit(view); }}>Edit</button>
            </div>
          </div>
        )}
      </Modal>

      {/* EDIT MODAL — route data only */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Edit ${edit.route_code}` : ''} wide>
        {edit && (
          <form onSubmit={saveEdit} className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2"><label className="label">Route Name *</label>
              <input className="input" value={edit.route_name || ''} onChange={(e) => setEdit({ ...edit, route_name: e.target.value })} required /></div>
            <div><label className="label">Starting Location *</label>
              <LocationSearch value={edit.origin} onSelect={(p) => setEdit({ ...edit, origin: p })} /></div>
            <div><label className="label">Destination *</label>
              <LocationSearch value={edit.destination} onSelect={(p) => setEdit({ ...edit, destination: p })} /></div>
            <div><label className="label">Priority</label><select className="input" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></div>
            <div><label className="label">Status</label><select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <button type="button" className="btn-gray btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn-primary btn">Save Changes</button>
            </div>
          </form>
        )}
      </Modal>
      <Toast toast={toast} />
    </div>
  );
}
