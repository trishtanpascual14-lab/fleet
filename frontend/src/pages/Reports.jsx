import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { StatusBadge, Empty, Toast } from '../components/ui';

const TABS = [
  ['fleet', 'Fleet'], ['drivers', 'Drivers'], ['trips', 'Trips'],
  ['fuel', 'Fuel'], ['costs', 'Costs'], ['delivery', 'Customer Service']
];

export default function Reports() {
  const [tab, setTab] = useState('fleet');
  const [data, setData] = useState(null);
  const [from, setFrom] = useState('2020-01-01');
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [toast, setToast] = useState(null);
  const nav = useNavigate();
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };

  const gen = async () => {
    try { const { data } = await api.get(`/reports/${tab}`, { params: { from, to } }); setData(data.data); }
    catch { show('Report failed', 'error'); }
  };

  const go = (type, id) => {
    if (type === 'trip') nav(`/trips`);
    else if (type === 'reservation') nav('/reservations');
    else if (type === 'vehicle') nav('/vehicles');
    else if (type === 'driver') nav('/drivers');
    else if (type === 'fuel') nav('/fuel');
  };

  const print = () => window.print();
  const csv = () => {
    const arr = Array.isArray(data) ? data : data?.rows;
    if (!arr?.length) { show('Nothing to export', 'error'); return; }
    const keys = Object.keys(arr[0]);
    const text = [keys.join(','), ...arr.map((r) => keys.map((k) => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = `${tab}-report.csv`; a.click();
  };

  const render = () => {
    if (!data) return <Empty msg="Click Generate to run the report" />;
    if (tab === 'delivery') {
      return (<div className="text-sm space-y-1">
        <p><b>Total:</b> {data.total} | <b>Delivered:</b> {data.delivered} | <b>Failed:</b> {data.failed} | <b>On-time rate:</b> {data.onTimeRate}%</p>
        {data.rows.map((r, i) => <p key={i} className="border-b py-1">{r.trip_code}: {r.pickup_location} → {r.destination} — <StatusBadge value={r.trip_status} /> <StatusBadge value={r.delivery_status} /></p>)}
      </div>);
    }
    if (!data.length) return <Empty />;
    if (tab === 'fleet') return data.map((v, i) => <p key={i} className="text-sm border-b py-1">{v.vehicle_code} {v.plate_number} ({v.vehicle_type}) — <StatusBadge value={v.status} /> — {v.completed}/{v.trips} trips</p>);
    if (tab === 'drivers') return data.map((d, i) => <p key={i} className="text-sm border-b py-1">{d.full_name} — ⭐{d.performance_rating} — {d.completed}/{d.trips} completed, {d.cancelled} cancelled</p>);
    if (tab === 'trips') return data.map((t, i) => <p key={i} className="text-sm border-b py-1">{t.trip_code}: {t.pickup_location} → {t.destination} — <StatusBadge value={t.trip_status} /> <StatusBadge value={t.delivery_status} /></p>);
    if (tab === 'fuel') return data.map((f, i) => <p key={i} className="text-sm border-b py-1">{f.fuel_code} — {f.plate_number} — {f.liters}L = ₱{f.total_cost} ({f.record_date})</p>);
    if (tab === 'costs') return data.map((c, i) => <p key={i} className="text-sm border-b py-1">{c.cost_code} — {c.trip_code || '—'} — ₱{c.total_cost} ({c.cost_date})</p>);
    return null;
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Reports</h2>
      <div className="card flex gap-2 flex-wrap">
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'btn-primary btn' : 'btn-gray btn'} onClick={() => { setTab(k); setData(null); }}>{l}</button>)}
      </div>
      <div className="card flex gap-2 flex-wrap items-end">
        <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button className="btn-primary btn" onClick={gen}>Generate</button>
        <button className="btn-gray btn" onClick={csv}>Export CSV</button>
        <button className="btn-gray btn" onClick={print}>Print</button>
      </div>
      <div className="card max-h-[500px] overflow-auto">{render()}</div>
      <Toast toast={toast} />
    </div>
  );
}
