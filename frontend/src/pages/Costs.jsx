import { useEffect, useState } from 'react';
import api from '../services/api';
import { Empty, Modal, Toast, Pager } from '../components/ui';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#f97316', '#8b5cf6'];

export default function Costs() {
  const [rows, setRows] = useState([]);
  const [pg, setPg] = useState(null);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState(null);
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState({ cost_date: new Date().toISOString().slice(0, 10) });
  const [showArchived, setShowArchived] = useState(false);
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };

  const load = async () => {
    const { data } = await api.get('/costs', { params: { page, archived: showArchived ? '1' : '' } });
    setRows(data.data); setPg(data.pagination);
    const s = await api.get('/costs/summary'); setSummary(s.data.data);
  };
  useEffect(() => { load(); }, [page, showArchived]);

  const openAdd = async () => {
    const v = await api.get('/vehicles?limit=100'); setVehicles(v.data.data);
    setForm({ cost_date: new Date().toISOString().slice(0, 10), fuel_cost: 0, driver_cost: 0, toll_cost: 0, maintenance_cost: 0, other_costs: 0 });
    setModal(true);
  };
  const save = async (e) => {
    e.preventDefault();
    try { await api.post('/costs', form); show('Cost record created'); setModal(false); load(); }
    catch (err) { show(err.response?.data?.message || 'Create failed', 'error'); }
  };
  const total = ['fuel_cost', 'driver_cost', 'toll_cost', 'maintenance_cost', 'other_costs'].reduce((s, k) => s + (+form[k] || 0), 0).toFixed(2);
  const pie = summary ? [
    { name: 'Fuel', value: +summary.totals.fuel }, { name: 'Driver', value: +summary.totals.driver },
    { name: 'Toll', value: +summary.totals.toll }, { name: 'Maintenance', value: +summary.totals.maint },
    { name: 'Other', value: +summary.totals.other }
  ] : [];

  const archive = async (id) => {
    if (!confirm('Archive this cost record?\nArchived records will be hidden.')) return;
    try { await api.patch(`/costs/${id}/archive`); show('Cost record archived'); load(); }
    catch (err) { show(err.response?.data?.message || 'Archive failed', 'error'); }
  };
  const restore = async (id) => {
    if (!confirm('Restore this cost record?')) return;
    try { await api.patch(`/costs/${id}/restore`); show('Cost record restored'); load(); }
    catch (err) { show(err.response?.data?.message || 'Restore failed', 'error'); }
  };

return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold">Transportation Cost Analysis</h2>
        <button className={`btn ml-auto ${showArchived ? 'btn-gray' : 'btn-amber bg-amber-50 text-amber-800 border'}`} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Show Active' : 'Show Archive'}</button>
        <button className="btn-primary btn" onClick={openAdd}>+ Add Cost Record</button>
      </div>
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="card"><p className="text-xs uppercase text-slate-500 font-semibold">Total Cost</p><p className="text-xl font-bold">₱{(+summary.totals.total).toLocaleString()}</p></div>
          <div className="card"><p className="text-xs uppercase text-slate-500 font-semibold">Fuel</p><p className="text-xl font-bold">₱{(+summary.totals.fuel).toLocaleString()}</p></div>
          <div className="card"><p className="text-xs uppercase text-slate-500 font-semibold">Driver + Toll + Maint</p><p className="text-xl font-bold">₱{(+summary.totals.driver + +summary.totals.toll + +summary.totals.maint).toLocaleString()}</p></div>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card"><h3 className="font-bold mb-2">Expense Breakdown</h3>
          <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={pie} dataKey="value" nameKey="name" outerRadius={75} label>{pie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
        <div className="card"><h3 className="font-bold mb-2">Monthly Cost Trend</h3>
          <ResponsiveContainer width="100%" height={200}><LineChart data={summary?.trend || []}><XAxis dataKey="m" /><YAxis /><Tooltip /><Line dataKey="total" stroke="#8b5cf6" strokeWidth={2} /></LineChart></ResponsiveContainer></div>
      </div>
      <div className="card overflow-auto">
        <table className="table min-w-[900px]">
          <thead><tr><th>Code</th><th>Date</th><th>Trip</th><th>Vehicle</th><th>Fuel</th><th>Driver</th><th>Toll</th><th>Maint.</th><th>Other</th><th>Total</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}><td className="font-semibold">{c.cost_code}</td><td>{c.cost_date}</td><td>{c.trip_code || '—'}</td>
                <td>{c.plate_number || '—'}</td><td>₱{c.fuel_cost}</td><td>₱{c.driver_cost}</td><td>₱{c.toll_cost}</td>
                <td>₱{c.maintenance_cost}</td><td>₱{c.other_costs}</td><td className="font-bold">₱{c.total_cost}</td>
                <td className="flex gap-1">
                  {!showArchived ? <button className="btn-amber btn !px-2 bg-amber-100 text-amber-800 border" onClick={() => archive(c.id)}>Archive</button> : <button className="btn-emerald btn !px-2 bg-emerald-100 text-emerald-800 border" onClick={() => restore(c.id)}>Restore</button>}
                </td></tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
        <Pager pagination={pg} onPage={setPage} />
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Add Transportation Cost">
        <form onSubmit={save} className="grid grid-cols-2 gap-3">
          <div><label className="label">Vehicle</label><select className="input" value={form.vehicle_id || ''} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}</select></div>
          <div><label className="label">Date *</label><input type="date" className="input" value={form.cost_date} onChange={(e) => setForm({ ...form, cost_date: e.target.value })} required /></div>
          {[['fuel_cost', 'Fuel Cost'], ['driver_cost', 'Driver Cost'], ['toll_cost', 'Toll Cost'], ['maintenance_cost', 'Maintenance Cost'], ['other_costs', 'Other Costs']].map(([k, l]) => (
            <div key={k}><label className="label">{l}</label><input type="number" step="0.01" className="input" value={form[k] || 0} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
          ))}
          <div className="col-span-2 bg-purple-50 rounded-lg p-2 text-sm font-semibold">Total = Fuel + Driver + Toll + Maint + Other = ₱{total}</div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn-gray btn" onClick={() => setModal(false)}>Cancel</button><button className="btn-primary btn">Save</button></div>
        </form>
      </Modal>
      <Toast toast={toast} />
    </div>
  );
}
