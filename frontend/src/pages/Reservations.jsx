import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, Empty, Modal, Toast, Pager } from '../components/ui';
import RouteMap from '../components/RouteMap';
import { 
  getCurrentDatePh, 
  getMinPickupTimeForDate,
  validatePickupDatetime,
  validateDropoffDate
} from '../utils/dateTime';

const fmtTime = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} hr ${min % 60} min`);

const STATUSES = ['Pending', 'Approved', 'Rejected', 'Reserved', 'Dispatched', 'Completed', 'Cancelled'];

/**
 * Format datetime for display in table
 */
const formatDateTimeForDisplay = (datetimeStr) => {
  if (!datetimeStr) return '—';
  const date = new Date(datetimeStr.replace(' ', 'T'));
  if (isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
};

/**
 * Format date for display
 */
const formatDateForDisplay = (dateStr) => {
  if (!dateStr) return '—';
  // Accept "YYYY-MM-DD", "YYYY-MM-DD HH:mm:ss" (legacy DB), or "YYYY-MM-DDTHH:mm"
  const ymd = String(dateStr).trim().slice(0, 10);
  const date = new Date(`${ymd}T00:00:00`);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function Reservations() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [pg, setPg] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [availV, setAvailV] = useState([]);
  const [availD, setAvailD] = useState([]);
  const [form, setForm] = useState(() => {
    const today = getCurrentDatePh();
    return { 
      reservation_date: today,
      pickup_datetime: `${today}T${getMinPickupTimeForDate(today)}`,
      dropoff_date: today
    };
  });
  const [routeView, setRouteView] = useState(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [availRoutes, setAvailRoutes] = useState([]);
  const [pickedRoute, setPickedRoute] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectForm, setRejectForm] = useState({ rejection_notes: '' });
  const [rejectId, setRejectId] = useState(null);
  const [rejectError, setRejectError] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  const [acceptModal, setAcceptModal] = useState(false);
  const [acceptRow, setAcceptRow] = useState(null);
  const [acceptBusy, setAcceptBusy] = useState(false);

  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };
  const load = async () => {
    const { data } = await api.get('/reservations', { params: { search, status, page, archived: showArchived ? '1' : '' } });
    setRows(data.data); setPg(data.pagination);
  };
  useEffect(() => { load(); }, [page, showArchived]);

  const openAdd = async () => {
    const today = getCurrentDatePh();
    setForm({ 
      reservation_date: today,
      pickup_datetime: `${today}T${getMinPickupTimeForDate(today)}`,
      dropoff_date: today
    });
    setPickedRoute(null);
    const [v, d, rt] = await Promise.all([api.get('/vehicles/available'), api.get('/drivers/available'), api.get('/routes?limit=100')]);
    setAvailV(v.data.data); setAvailD(d.data.data);
    setAvailRoutes(rt.data.data.filter((x) => x.status !== 'Cancelled'));
    setModal(true);
  };

  const pickRoute = async (id) => {
    setForm({ ...form, route_id: id || null });
    if (!id) { setPickedRoute(null); return; }
    try {
      const { data } = await api.get(`/routes/${id}`);
      setPickedRoute(data.data);
    } catch { setPickedRoute(null); }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.route_id) { show('Please select a Route from Route Planning', 'error'); return; }
    if (!form.pickup_datetime) { show('Pickup date and time is required', 'error'); return; }
    if (!form.dropoff_date) { show('Drop-off date is required', 'error'); return; }
    
    // Validate date/time logic using utility functions
    const pickupValidation = validatePickupDatetime(form.pickup_datetime);
    if (!pickupValidation.valid) {
      show(pickupValidation.message, 'error');
      return;
    }
    
    const dropoffValidation = validateDropoffDate(form.pickup_datetime, form.dropoff_date);
    if (!dropoffValidation.valid) {
      show(dropoffValidation.message, 'error');
      return;
    }
    
    try {
      const dropDate = form.dropoff_date;
      await api.post('/reservations', {
        route_id: form.route_id, 
        vehicle_id: form.vehicle_id || null, 
        driver_id: form.driver_id || null,
        reservation_date: form.reservation_date || form.pickup_datetime.slice(0, 10),
        pickup_datetime: form.pickup_datetime,
        dropoff_date: dropDate,
        drop_off_date: dropDate
      });
      show('Reservation created with selected route'); setModal(false); load();
    }
    catch (err) {
      const errObj = err.response?.data;
      const msg = errObj?.errors ? Object.values(errObj.errors).join(', ') : (errObj?.message || 'Create failed');
      show(msg, 'error');
    }
  };

  const updateStatus = async (id, st) => {
    if (!confirm(`Set reservation to ${st}?`)) return;
    try { await api.patch(`/reservations/${id}/status`, { status: st }); show(`Reservation ${st.toLowerCase()}`); load(); }
    catch (err) { show(err.response?.data?.message || 'Update failed', 'error'); }
  };

  const openAcceptModal = (row) => {
    setAcceptRow(row);
    setAcceptModal(true);
  };

  const closeAcceptModal = () => {
    if (acceptBusy) return;
    setAcceptModal(false);
    setAcceptRow(null);
  };

  const handleAccept = async () => {
    if (acceptBusy || !acceptRow) return;
    setAcceptBusy(true);
    try {
      const { data } = await api.patch(`/reservations/${acceptRow.id}/status`, { status: 'Approved' });
      show(data?.message || `Reservation ${acceptRow.reservation_code} has been accepted.`);
      setAcceptModal(false);
      setAcceptRow(null);
      load();
    } catch (err) {
      const errObj = err.response?.data;
      const msg = errObj?.errors ? Object.values(errObj.errors).join(', ') : (errObj?.message || 'Accept failed');
      show(msg, 'error');
    } finally {
      setAcceptBusy(false);
    }
  };

  const openRejectModal = (row) => {
    setRejectId(typeof row === 'object' ? row.id : row);
    setRejectForm({ rejection_notes: '' });
    setRejectError('');
    setRejectModal(true);
  };

  const closeRejectModal = () => {
    if (rejectBusy) return;
    setRejectModal(false);
    setRejectId(null);
    setRejectForm({ rejection_notes: '' });
    setRejectError('');
  };

  const handleReject = async (e) => {
    e.preventDefault();
    if (rejectBusy) return;
    const notes = rejectForm.rejection_notes.trim();
    if (!notes || notes.length < 5) {
      setRejectError('Please provide a valid reason for rejecting this reservation (minimum 5 characters).');
      return;
    }
    setRejectBusy(true);
    try {
      const { data } = await api.patch(`/reservations/${rejectId}/reject`, {
        rejection_notes: notes,
        rejection_note: notes,
        reason: notes
      });
      show(data?.message || 'Reservation has been rejected.');
      closeRejectModal();
      load();
    } catch (err) {
      const errObj = err.response?.data;
      const msg = errObj?.errors ? Object.values(errObj.errors).join(', ') : (errObj?.message || 'Reject failed');
      setRejectError(msg);
    } finally {
      setRejectBusy(false);
    }
  };

  const archive = async (id) => {
    if (!confirm('Archive this reservation?\nArchived records will be hidden from active list.')) return;
    try { await api.patch(`/reservations/${id}/archive`); show('Reservation archived'); load(); }
    catch (err) { show(err.response?.data?.message || 'Archive failed', 'error'); }
  };
  const restore = async (id) => {
    if (!confirm('Restore this reservation?')) return;
    try { await api.patch(`/reservations/${id}/restore`); show('Reservation restored'); load(); }
    catch (err) { show(err.response?.data?.message || 'Restore failed', 'error'); }
  };

  // The attached route (selected from Route Planning) with map + details.
  const openRoute = async (r) => {
    setRouteBusy(true); setRouteView({ loading: true, reservation: r });
    try {
      const { data } = await api.get(`/reservations/${r.id}`);
      if (data.data.route) {
        setRouteView({ ...data.data.route, reservation: data.data });
      } else {
        // legacy reservation without a linked route — generate from its locations
        const g = await api.get(`/routes/by-reservation/${r.id}`);
        setRouteView({ ...g.data.data, reservation: data.data });
      }
    } catch (err) {
      setRouteView(null);
      show(err.response?.data?.message || 'Could not load route for this reservation', 'error');
    } finally { setRouteBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold">Reservations</h2>
        <button className={`btn ml-auto ${showArchived ? 'btn-gray' : 'btn-amber bg-amber-50 text-amber-800 border'}`} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Show Active' : 'Show Archive'}</button>
        <button className="btn-primary btn ml-auto" onClick={openAdd}>+ New Reservation</button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }} className="card flex gap-2 flex-wrap">
        <input className="input max-w-xs" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-primary btn">Search</button>
      </form>
      <div className="card overflow-auto">
        <table className="table min-w-[1000px]">
          <thead><tr><th>Code</th><th>Pickup</th><th>Drop-off Date</th><th>Route (from Route Planning)</th><th>Pickup → Destination</th><th>Vehicle</th><th>Driver</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold">{r.reservation_code}</td>
                <td>{formatDateTimeForDisplay(r.pickup_datetime)}</td>
                <td>{formatDateForDisplay(r.dropoff_date || r.dropoff_datetime)}</td>
                <td>{r.route_name ? <><b>{r.route_name}</b><br /><span className="text-xs text-slate-400">{r.route_code} ({r.route_distance_km} km)</span></> : <span className="text-slate-400">— legacy —</span>}</td>
                <td>{r.pickup_location} → {r.destination}</td>
                <td>{r.plate_number || '—'}</td><td>{r.driver_name || '—'}</td>
                <td><StatusBadge value={r.status} /></td>
                <td className="flex gap-1 flex-wrap">
                  <button className="btn-gray btn !px-2" onClick={() => openRoute(r)} title="View route: Pickup Location to Destination">Route</button>
                  {r.status === 'Pending' && can('admin', 'fleet_manager') && (<>
                    <button className="btn-green btn !px-2" onClick={() => openAcceptModal(r)}>Accept</button>
                    <button className="btn-red btn !px-2" onClick={() => openRejectModal(r)}>Reject</button>
                  </>)}
                  {['Approved', 'Reserved'].includes(r.status) && <button className="btn-green btn !px-2" onClick={() => updateStatus(r.id, 'Dispatched')}>Dispatch</button>}
                  {can('admin', 'fleet_manager') && (!showArchived ? <button className="btn-amber btn !px-2 bg-amber-100 text-amber-800 border" onClick={() => archive(r.id)}>Archive</button> : <button className="btn-emerald btn !px-2 bg-emerald-100 text-emerald-800 border" onClick={() => restore(r.id)}>Restore</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
        <Pager pagination={pg} onPage={setPage} />
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="New Reservation" wide>
        <form onSubmit={save} className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="label">Route * (from Route Planning)</label>
            <select className="input" value={form.route_id || ''} onChange={(e) => pickRoute(e.target.value)} required>
              <option value="">— Select a saved route —</option>
              {availRoutes.map((x) => <option key={x.id} value={x.id}>{x.route_name || x.route_code}: {x.origin} → {x.destination} ({x.total_distance_km} km)</option>)}
            </select>
            {!availRoutes.length && <p className="text-xs text-amber-700 mt-1">No routes available yet — create one in Route Planning first.</p>}</div>
          {pickedRoute && (
            <div className="col-span-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm space-y-1">
              <p><b>{pickedRoute.route_name}</b> <span className="text-slate-500">({pickedRoute.route_code})</span></p>
              <p><b>Pickup Location:</b> {pickedRoute.origin} → <b>Destination:</b> {pickedRoute.destination}</p>
              <p><b>Distance:</b> {pickedRoute.total_distance_km} km | <b>Est. Time:</b> {pickedRoute.estimated_time_min} min | <b>Est. Cost:</b> ₱{(+pickedRoute.estimated_cost).toLocaleString()}</p>
            </div>
          )}
          <div><label className="label">Vehicle (available only)</label>
            <select className="input" value={form.vehicle_id || ''} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}>
              <option value="">— Select —</option>{availV.map((v) => <option key={v.id} value={v.id}>{v.plate_number} ({v.vehicle_type}, {v.capacity}kg)</option>)}
            </select></div>
          <div><label className="label">Driver (available only)</label>
            <select className="input" value={form.driver_id || ''} onChange={(e) => setForm({ ...form, driver_id: e.target.value })}>
              <option value="">— Select —</option>{availD.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select></div>
          
          <div className="col-span-2">
            <h3 className="font-semibold text-slate-700 mb-2">Pickup Schedule</h3>
            <div><label className="label">Pickup Date & Time *</label><input type="datetime-local" className="input" value={form.pickup_datetime} onChange={(e) => setForm({ ...form, pickup_datetime: e.target.value, reservation_date: e.target.value ? e.target.value.slice(0,10) : form.reservation_date })} required /></div>
          </div>
          
          <div className="col-span-2">
            <h3 className="font-semibold text-slate-700 mb-2">Drop-off Schedule</h3>
            <div><label className="label">Drop-off Date *</label><input type="date" className="input" value={form.dropoff_date || ''} onChange={(e) => setForm({ ...form, dropoff_date: e.target.value })} required /></div>
          </div>
          
          <div><label className="label">Pickup Location (from route)</label><input className="input bg-slate-50" value={pickedRoute ? pickedRoute.origin : ''} readOnly placeholder="Auto-filled from selected route" /></div>
          <div><label className="label">Destination (from route)</label><input className="input bg-slate-50" value={pickedRoute ? pickedRoute.destination : ''} readOnly placeholder="Auto-filled from selected route" /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn-gray btn" onClick={() => setModal(false)}>Cancel</button><button className="btn-primary btn" disabled={!availRoutes.length}>Create</button></div>
        </form>
      </Modal>

      {/* Accept Reservation Modal */}
      <Modal open={acceptModal} onClose={closeAcceptModal} title="Accept Reservation">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Accept this reservation{acceptRow ? <b> ({acceptRow.reservation_code})</b> : ''}?
          </p>
          <p className="text-xs text-slate-500">No rejection notes are required. The reservation status will change to Approved.</p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-gray btn" onClick={closeAcceptModal} disabled={acceptBusy}>Cancel</button>
            <button type="button" className="btn-green btn" onClick={handleAccept} disabled={acceptBusy}>
              {acceptBusy ? 'Accepting...' : 'Confirm Accept'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Reject Reservation Modal */}
      <Modal open={rejectModal} onClose={closeRejectModal} title="Reject Reservation">
        <form onSubmit={handleReject} className="space-y-4">
          <p className="text-sm text-slate-600">Please provide a reason for rejecting this reservation.</p>
          <div>
            <label className="label">Rejection Reason / Notes *</label>
            <textarea
              className="input min-h-[100px]"
              value={rejectForm.rejection_notes}
              onChange={(e) => setRejectForm({ ...rejectForm, rejection_notes: e.target.value })}
              placeholder="Enter the reason for rejecting this reservation..."
              required
              rows={4}
            />
            {rejectError && <p className="text-xs text-red-600 mt-1">{rejectError}</p>}
            <p className="text-xs text-slate-500 mt-1">Minimum 5 characters required.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-gray btn" onClick={closeRejectModal} disabled={rejectBusy}>Cancel</button>
            <button type="submit" className="btn-red btn" disabled={rejectBusy}>
              {rejectBusy ? 'Rejecting...' : 'Confirm Reject'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!routeView} onClose={() => setRouteView(null)} title={routeView ? `Route — ${routeView.reservation.reservation_code}` : ''} wide>
        {routeView && (routeView.loading ? <p className="text-sm text-slate-500">Loading attached route...</p> : (
          <div className="space-y-3 text-sm">
            <p><b>Route:</b> {routeView.route_name || '—'} <span className="text-slate-500">({routeView.route_code})</span></p>
            <p><b>Pickup Location:</b> {routeView.origin} → <b>Destination:</b> {routeView.destination}</p>
            {routeView.reservation && routeView.reservation.pickup_datetime && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-2">
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-500">Pickup Date & Time</p><p className="font-bold">{formatDateTimeForDisplay(routeView.reservation.pickup_datetime)}</p></div>
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-500">Drop-off Date</p><p className="font-bold">{formatDateForDisplay(routeView.reservation.dropoff_date || routeView.reservation.dropoff_datetime)}</p></div>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-500">Distance</p><p className="font-bold">{routeView.total_distance_km} km</p></div>
              <div className="bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-500">Est. Travel Time</p><p className="font-bold">{fmtTime(routeView.estimated_time_min)}</p></div>
              <div className="bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-500">Est. Fuel</p><p className="font-bold">{routeView.estimated_fuel_liters} L</p></div>
              <div className="bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-500">Est. Cost</p><p className="font-bold">₱{(+routeView.estimated_cost).toLocaleString()}</p></div>
            </div>
            <p><b>Status:</b> <StatusBadge value={routeView.status} /></p>
            {routeView.reservation && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
                <p className="font-semibold text-slate-700 text-xs uppercase tracking-wide">Reservation Details / History</p>
                <p><b>Status:</b> <StatusBadge value={routeView.reservation.status} /></p>
                {routeView.reservation.status === 'Approved' && (
                  <>
                    {routeView.reservation.approved_by_name && <p><b>Accepted by:</b> {routeView.reservation.approved_by_name}</p>}
                    {routeView.reservation.approved_at && <p><b>Accepted at:</b> {formatDateTimeForDisplay(routeView.reservation.approved_at)}</p>}
                  </>
                )}
                {routeView.reservation.status === 'Rejected' && (
                  <>
                    {routeView.reservation.rejection_notes && (
                      <p className="bg-white border border-rose-100 rounded-lg p-2"><b>Rejection Reason:</b> {routeView.reservation.rejection_notes}</p>
                    )}
                    {routeView.reservation.rejected_by_name && <p><b>Rejected by:</b> {routeView.reservation.rejected_by_name}</p>}
                    {routeView.reservation.rejected_at && <p><b>Rejected at:</b> {formatDateTimeForDisplay(routeView.reservation.rejected_at)}</p>}
                  </>
                )}
              </div>
            )}
            {routeView.route_info && <p className="text-slate-500">{routeView.route_info}</p>}
            <RouteMap points={routeView.mapPoints} geometry={routeView.geometry} height={300} />
          </div>
        ))}
      </Modal>
      <Toast toast={toast} />
    </div>
  );
}