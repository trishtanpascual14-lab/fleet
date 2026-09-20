import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { Empty, Modal, Toast } from '../components/ui';

export default function Users() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [form, setForm] = useState({ role: 'dispatcher' });
  const highlight = params.get('highlight');
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };
  const load = async () => { const { data } = await api.get('/users?limit=100'); setRows(data.data); };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (highlight) {
      const t = setTimeout(() => setParams({}, { replace: true }), 4000);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight]);

  const openAdd = async () => {
    const d = await api.get('/drivers?limit=100'); setDrivers(d.data.data);
    setForm({ role: 'dispatcher' }); setModal(true);
  };
  const save = async (e) => {
    e.preventDefault();
    try { await api.post('/users', { ...form, driver_id: form.driver_id || null }); show('User created'); setModal(false); load(); }
    catch (err) { show(err.response?.data?.message || 'Create failed', 'error'); }
  };
  const toggle = async (u) => {
    await api.put(`/users/${u.id}`, { is_active: u.is_active ? 0 : 1 }); show('User updated'); load();
  };
  const [showArchived, setShowArchived] = useState(false);
  const archive = async (u) => {
    if (!confirm(`Archive user ${u.email}?\nArchived users will be hidden but remain in database.`)) return;
    try { await api.patch(`/users/${u.id}/archive`); show('User archived'); load(); }
    catch (err) { show(err.response?.data?.message || 'Archive failed', 'error'); }
  };
  const restore = async (u) => {
    if (!confirm(`Restore user ${u.email}?`)) return;
    try { await api.patch(`/users/${u.id}/restore`); show('User restored'); load(); }
    catch (err) { show(err.response?.data?.message || 'Restore failed', 'error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold">User Management</h2>
        <button className="btn-primary btn ml-auto" onClick={openAdd}>+ Add User</button>
      </div>
      {highlight && <p className="card text-sm">🔍 Showing linked account <button className="underline text-[#6023d5]" onClick={() => setParams({}, { replace: true })}>clear</button></p>}
      <div className="card overflow-auto">
        <table className="table min-w-[860px]">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Driver Profile</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className={String(u.id) === String(highlight) ? 'bg-purple-50' : ''}>
                <td>{u.name}</td><td>{u.email}</td><td className="capitalize">{u.role.replace('_', ' ')}</td>
                <td>{u.is_active ? '✅' : '❌'}</td>
                <td>
                  {u.role !== 'driver' ? <span className="text-slate-300">—</span>
                    : u.driver_profile_id ? (
                      <span className="flex items-center gap-1">
                        <span className="text-xs font-semibold">{u.driver_profile_code} · {u.driver_profile_status}</span>
                        <button className="btn-gray btn !px-2 !py-0.5 text-xs" onClick={() => navigate(`/drivers?view=${u.driver_profile_id}`)}>View Driver Profile</button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <span className="text-xs text-slate-400">Not Created</span>
                        <button className="btn-primary btn !px-2 !py-0.5 text-xs" disabled={!u.is_active} title={u.is_active ? 'Create the driver profile for this account' : 'Activate the user first'} onClick={() => navigate(`/drivers?preselect=${u.id}`)}>Create Driver Profile</button>
                      </span>
                    )}
                </td>
                <td className="flex gap-1">
                  <button className="btn-gray btn !px-2" onClick={() => toggle(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</button>
                  !showArchived ? <button className="btn-amber btn !px-2 bg-amber-100 text-amber-800 border border-amber-200" onClick={() => archive(u)}>Archive</button> : <button className="btn-emerald btn !px-2 bg-emerald-100 text-emerald-800 border border-emerald-200" onClick={() => restore(u)}>Restore</button>
                </td></tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Add User">
        <form onSubmit={save} className="space-y-3">
          <div><label className="label">Name *</label><input className="input" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label className="label">Email *</label><input className="input" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
          <div><label className="label">Password *</label><input type="password" className="input" value={form.password || ''} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
          <div><label className="label">Role</label><select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="admin">Admin</option><option value="fleet_manager">Fleet Manager</option><option value="dispatcher">Dispatcher</option><option value="driver">Driver</option></select></div>
          {form.role === 'driver' && (
            <p className="text-xs text-slate-500 rounded-lg bg-purple-50 border border-purple-200/60 p-2">After creating this user, open <b>Drivers → Add Driver</b> and pick the account under <b>Recommended Driver Accounts</b> — no need to re-type the name or email.</p>
          )}
          {form.role === 'driver' && (
            <div><label className="label">Link Driver Profile (optional, legacy)</label><select className="input" value={form.driver_id || ''} onChange={(e) => setForm({ ...form, driver_id: e.target.value })}><option value="">— create link later from Drivers</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></div>
          )}
          <div className="flex justify-end gap-2"><button type="button" className="btn-gray btn" onClick={() => setModal(false)}>Cancel</button><button className="btn-primary btn">Create</button></div>
        </form>
      </Modal>
      <Toast toast={toast} />
    </div>
  );
}
