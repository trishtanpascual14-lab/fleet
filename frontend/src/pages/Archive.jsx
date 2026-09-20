import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const TABS = [
  { key: 'vehicles', label: 'Vehicles', endpoint: '/vehicles', archivedParam: '1' },
  { key: 'drivers', label: 'Drivers', endpoint: '/drivers', archivedParam: '1' },
  { key: 'users', label: 'Users', endpoint: '/users', archivedParam: '1' },
  { key: 'reservations', label: 'Reservations', endpoint: '/reservations', archivedParam: '1' },
  { key: 'trips', label: 'Trips', endpoint: '/trips', archivedParam: '1' },
  { key: 'routes', label: 'Routes', endpoint: '/routes', archivedParam: '1' },
  { key: 'fuel', label: 'Fuel', endpoint: '/fuel', archivedParam: '1' },
  { key: 'costs', label: 'Costs', endpoint: '/costs', archivedParam: '1' },
];

export default function Archive() {
  const { can } = useAuth();
  const [activeTab, setActiveTab] = useState('vehicles');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };

  const tab = TABS.find((t) => t.key === activeTab);
  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(tab.endpoint, { params: { archived: '1', limit: 50 } });
      setRows(data.data || []);
    } catch { setRows([]); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [activeTab]);

  const restore = async (item) => {
    const label = item.vehicle_code || item.plate_number || item.driver_code || item.full_name || item.name || item.email || item.reservation_code || item.trip_code || item.route_code || item.fuel_code || item.cost_code || `#${item.id}`;
    if (!confirm(`Restore ${tab.label.slice(0,-1)} ${label}?`)) return;
    try {
      await api.patch(`${tab.endpoint}/${item.id}/restore`);
      show(`${tab.label.slice(0,-1)} restored`);
      load();
    } catch (err) { show(err.response?.data?.message || 'Restore failed', 'error'); }
  };

  const renderRow = (item) => {
    if (tab.key === 'vehicles') return `${item.vehicle_code} | ${item.plate_number} | ${item.vehicle_type} | ${item.status}`;
    if (tab.key === 'drivers') return `${item.driver_code} | ${item.full_name} | ${item.license_number} | ${item.status}`;
    if (tab.key === 'users') return `${item.name} | ${item.email} | ${item.role}`;
    if (tab.key === 'reservations') return `${item.reservation_code} | ${item.pickup_location} → ${item.destination} | ${item.status}`;
    if (tab.key === 'trips') return `${item.trip_code} | ${item.pickup_location} → ${item.destination} | ${item.trip_status}`;
    if (tab.key === 'routes') return `${item.route_code} | ${item.origin} → ${item.destination}`;
    if (tab.key === 'fuel') return `${item.fuel_code} | ${item.plate_number || ''} | ${item.liters}L | ₱${item.total_cost}`;
    if (tab.key === 'costs') return `${item.cost_code} | ${item.cost_date} | ₱${item.total_cost}`;
    return JSON.stringify(item).slice(0,80);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Archive</h2>
      <p className="text-sm text-slate-500">Archived records are hidden from active lists but remain in the database. You can restore them here.</p>
      <div className="flex gap-2 flex-wrap border-b">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-3 py-1.5 text-sm font-bold border-b-2 ${activeTab === t.key ? 'border-[#6023d5] text-[#6023d5]' : 'border-transparent text-slate-400'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="card">
        {loading ? <p className="text-sm text-slate-400">Loading...</p> : rows.length === 0 ? <p className="text-sm text-slate-400">No archived {tab.label.toLowerCase()}.</p> : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border rounded-lg p-3 bg-amber-50/50 border-amber-200">
                <div className="flex-1 text-sm">
                  <span className="font-semibold">{renderRow(r)}</span>
                  <span className="ml-2 text-xs text-slate-400">archived at {r.archived_at || '—'}</span>
                </div>
                <button className="btn-emerald btn !px-3 bg-emerald-100 text-emerald-800 border border-emerald-200" onClick={() => restore(r)}>Restore</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {toast && <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg text-sm font-semibold ${toast.type === 'error' ? 'bg-rose-100 text-rose-700 border border-rose-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>{toast.msg}</div>}
    </div>
  );
}
