import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, Empty, Modal, Toast, Pager } from '../components/ui';

const STATUSES = ['Available', 'Assigned', 'On Trip', 'Off Duty', 'Inactive'];

export default function Drivers() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [pg, setPg] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [view, setView] = useState(null);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({});
  // Recommended user accounts (Users with role=Driver, active, unlinked)
  const [eligible, setEligible] = useState([]);
  const [eligSearch, setEligSearch] = useState('');
  const [eligLoading, setEligLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const [showArchived, setShowArchived] = useState(false);
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };
  const load = async () => {
    const { data } = await api.get('/drivers', { params: { search, status, page, archived: showArchived ? '1' : '' } });
    setRows(data.data); setPg(data.pagination);
  };
  useEffect(() => { load(); }, [page, showArchived]);

  const loadEligible = async (q = '') => {
    setEligLoading(true);
    try {
      const { data } = await api.get('/drivers/eligible-users', { params: { search: q, limit: 50 } });
      setEligible(data.data);
    } catch { setEligible([]); }
    setEligLoading(false);
  };

  const openAdd = async (preselectId = null) => {
    setForm({ status: 'Available' });
    setSelectedUser(null);
    setEligSearch('');
    setModal('add');
    await loadEligible('');
    if (preselectId) {
      try {
        const { data } = await api.get(`/users/${preselectId}`);
        const u = data.data;
        if (u.role !== 'driver') show('That user is not a Driver account', 'error');
        else if (!u.is_active) show('That user account is deactivated', 'error');
        else if (u.driver_profile_id) show('That user is already linked to a driver profile', 'error');
        else {
          const sel = { id: u.id, name: u.name, email: u.email };
          setSelectedUser(sel);
          setForm({ status: 'Available', user_id: u.id, full_name: u.name, email: u.email });
        }
      } catch { show('Could not load that user account', 'error'); }
    }
  };

  // Deep links from Users page: /drivers?preselect=<userId> or /drivers?view=<driverId>
  useEffect(() => {
    const pre = params.get('preselect');
    const v = params.get('view');
    if (pre && can('admin', 'fleet_manager')) {
      setParams({}, { replace: true });
      openAdd(pre);
    } else if (v) {
      setParams({}, { replace: true });
      (async () => {
        try { const { data } = await api.get(`/drivers/${v}`); setView(data.data); }
        catch { show('Driver not found', 'error'); }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live search of eligible accounts (debounced)
  useEffect(() => {
    if (modal !== 'add') return;
    const t = setTimeout(() => loadEligible(eligSearch), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligSearch]);

  const useAccount = (u) => {
    setSelectedUser(u);
    setForm({ ...form, user_id: u.id, full_name: u.name, email: u.email });
  };
  const clearAccount = () => {
    setSelectedUser(null);
    setForm((f) => { const { user_id, email, ...rest } = f; return { ...rest, full_name: '' }; });
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (modal === 'add') {
        const { email, ...payload } = form; // email is display-only: identity lives in users table
        await api.post('/drivers', payload);
        show('Driver created and linked to user account');
      }
      else { await api.put(`/drivers/${form.id}`, form); show('Driver updated'); }
      setModal(null); setSelectedUser(null); load();
    } catch (err) { show(err.response?.data?.message || 'Save failed', 'error'); }
  };
  const archive = async (d) => {
    if (!confirm(`Archive driver ${d.full_name}?\nArchived records will be hidden from the active list but remain in Archive.`)) return;
    try { await api.patch(`/drivers/${d.id}/archive`); show('Driver archived'); load(); }
    catch (err) { show(err.response?.data?.message || 'Archive failed', 'error'); }
  };
  const restore = async (d) => {
    if (!confirm(`Restore driver ${d.full_name}?`)) return;
    try { await api.patch(`/drivers/${d.id}/restore`); show('Driver restored'); load(); }
    catch (err) { show(err.response?.data?.message || 'Restore failed', 'error'); }
  };
  const openView = async (d) => { const { data } = await api.get(`/drivers/${d.id}`); setView(data.data); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold">Drivers</h2>
        <button className={`btn ml-auto ${showArchived ? 'btn-gray' : 'btn-amber bg-amber-50 text-amber-800 border border-amber-200'}`} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Show Active' : 'Show Archive'}</button>
        {can('admin', 'fleet_manager') && <button className="btn-primary btn" onClick={() => openAdd()}>+ Add Driver</button>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }} className="card flex gap-2 flex-wrap">
        <input className="input max-w-xs" placeholder="Search name / license / email..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-primary btn">Search</button>
      </form>
      <div className="card overflow-auto">
        <table className="table min-w-[980px]">
          <thead><tr><th>Driver ID</th><th>Full Name</th><th>Email</th><th>Contact</th><th>License</th><th>Expiry</th><th>Status</th><th>Trips</th><th>Rating</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="font-semibold">{d.driver_code}</td><td>{d.full_name}</td>
                <td className="text-slate-500">{d.user_email || '—'}</td>
                <td>{d.contact_number || '—'}</td>
                <td>{d.license_number}</td><td>{d.license_expiry || '—'}</td>
                <td><StatusBadge value={d.status} /></td>
                <td>{d.completed_trips}/{d.total_trips}</td><td>⭐ {d.performance_rating}</td>
                <td className="flex gap-1">
                  <button className="btn-gray btn !px-2" onClick={() => openView(d)}>View</button>
                  {can('admin', 'fleet_manager') && (<>
                    {!showArchived ? (<>
                      <button className="btn-gray btn !px-2" onClick={() => { setForm({ ...d }); setSelectedUser(null); setModal('edit'); }}>Edit</button>
                      <button className="btn-amber btn !px-2 bg-amber-100 text-amber-800 border border-amber-200" onClick={() => archive(d)}>Archive</button>
                    </>) : (
                      <button className="btn-emerald btn !px-2 bg-emerald-100 text-emerald-800 border border-emerald-200" onClick={() => restore(d)}>Restore</button>
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

      <Modal open={!!modal} onClose={() => { setModal(null); setSelectedUser(null); }} title={modal === 'add' ? 'Add Driver' : 'Edit Driver'} wide={modal === 'add'}>
        {modal === 'add' && (
          <div className="mb-4 rounded-xl border border-purple-200/70 bg-purple-50/60 p-4">
            <h4 className="font-bold text-[#6023d5] text-sm">Recommended Driver Accounts</h4>
            <p className="text-xs text-slate-500 mb-2">Active Users with role Driver that are not yet linked to a driver profile.</p>
            <input className="input mb-2" placeholder="Search by name or email..." value={eligSearch} onChange={(e) => setEligSearch(e.target.value)} />
            <div className="max-h-56 overflow-auto space-y-2">
              {eligLoading && <p className="text-xs text-slate-400">Loading accounts...</p>}
              {!eligLoading && !eligible.length && <p className="text-xs text-slate-400">No eligible driver accounts. Create a User with role Driver first.</p>}
              {eligible.map((u) => (
                <div key={u.id} className={`flex items-center gap-3 rounded-lg border p-2.5 bg-white ${selectedUser?.id === u.id ? 'border-[#6023d5] ring-1 ring-purple-300' : 'border-slate-200'}`}>
                  <span className="text-xl">👤</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate">{u.name}</p>
                    <p className="text-xs text-slate-500 truncate">{u.email}</p>
                    <p className="text-[11px] text-slate-400">Driver Account</p>
                  </div>
                  {selectedUser?.id === u.id
                    ? <span className="text-xs font-bold text-[#6023d5]">✓ Selected</span>
                    : <button type="button" className="btn-primary btn !px-3 !py-1.5 text-xs" onClick={() => useAccount(u)}>Use This Account</button>}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 my-3">
              <div className="h-px bg-purple-200 flex-1" /><span className="text-xs font-bold text-slate-400">OR</span><div className="h-px bg-purple-200 flex-1" />
            </div>
            <p className="text-xs font-semibold text-slate-600">Create driver profile {selectedUser ? 'for the selected account' : 'manually (no user link)'}</p>
          </div>
        )}

        {modal === 'edit' && form.user_account_id && (
          <div className="mb-4 rounded-xl border border-purple-200/70 bg-purple-50/60 p-3 text-xs">
            <p className="font-bold text-[#6023d5] text-sm">Linked User Account</p>
            <p><b>{form.user_account_name}</b> · {form.user_email}</p>
            <p>Role: <span className="capitalize">{(form.user_role || '').replace('_', ' ')}</span> · Account: {form.user_is_active ? 'Active ✅' : 'Inactive ❌'}</p>
            <button type="button" className="btn-gray btn !px-2 !py-1 mt-1 text-xs" onClick={() => navigate(`/users?highlight=${form.user_account_id}`)}>View User Account</button>
          </div>
        )}

        <form onSubmit={save} className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="label">Full Name *</label>
            <input className="input" value={form.full_name || ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required readOnly={!!selectedUser} title={selectedUser ? 'Comes from the linked user account' : ''} />
            {selectedUser && <p className="text-[11px] text-slate-400 mt-0.5">From user account — read-only. <button type="button" className="underline" onClick={clearAccount}>Use a different account</button></p>}
          </div>
          <div className="col-span-2"><label className="label">Email</label>
            <input className="input" value={selectedUser?.email || form.user_email || form.email || ''} readOnly placeholder={selectedUser ? '' : 'No linked account'} />
            {selectedUser && <p className="text-[11px] text-slate-400 mt-0.5">From user account — read-only. No duplicate account is created.</p>}
          </div>
          <div><label className="label">Contact Number</label><input className="input" value={form.contact_number || ''} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} /></div>
          <div><label className="label">License Number *</label><input className="input" value={form.license_number || ''} onChange={(e) => setForm({ ...form, license_number: e.target.value })} required /></div>
          <div><label className="label">License Expiry</label><input type="date" className="input" value={form.license_expiry || ''} onChange={(e) => setForm({ ...form, license_expiry: e.target.value })} /></div>
          <div><label className="label">Status</label><select className="input" value={form.status || 'Available'} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn-gray btn" onClick={() => { setModal(null); setSelectedUser(null); }}>Cancel</button><button className="btn-primary btn">Save Driver</button></div>
        </form>
      </Modal>

      <Modal open={!!view} onClose={() => setView(null)} title={view?.full_name || ''} wide>
        {view && (
          <div className="text-sm space-y-2">
            <p><b>License:</b> {view.license_number} (exp {view.license_expiry || '—'}) | <b>Status:</b> <StatusBadge value={view.status} /> | <b>Vehicle:</b> {view.assigned_vehicle_plate || '—'}</p>
            <p><b>Trips:</b> {view.completed_trips}/{view.total_trips} | <b>Rating:</b> ⭐ {view.performance_rating}/5</p>
            <div className="rounded-xl border border-purple-200/70 bg-purple-50/60 p-3">
              <p className="font-bold text-[#6023d5]">Linked Account</p>
              {view.user_account_id ? (
                <>
                  <p><b>{view.user_account_name}</b> · {view.user_email}</p>
                  <p>Role: <span className="capitalize">{(view.user_role || '').replace('_', ' ')}</span> · Account: {view.user_is_active ? 'Active ✅' : 'Inactive ❌'} · Profile: {view.status}</p>
                  <button className="btn-gray btn !px-2 !py-1 mt-1 text-xs" onClick={() => navigate(`/users?highlight=${view.user_account_id}`)}>View User Account</button>
                </>
              ) : <p className="text-slate-500">No user account linked to this driver profile.</p>}
            </div>
            <h4 className="font-bold mt-3">Trip History</h4>
            {view.tripHistory?.length ? view.tripHistory.map((t, i) => <p key={i}>{t.trip_code}: {t.pickup_location} → {t.destination} (<StatusBadge value={t.trip_status} />)</p>) : <p className="text-slate-400">No trips yet.</p>}
          </div>
        )}
      </Modal>
      <Toast toast={toast} />
    </div>
  );
}
