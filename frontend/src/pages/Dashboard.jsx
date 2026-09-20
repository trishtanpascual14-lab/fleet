import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { StatCard } from '../components/ui';
import { useGreeting } from '../utils/greeting';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';

const PIE_COLORS = ['#6023d5', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const num = (x) => Number(x || 0);
const peso = (x) => `₱${num(x).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FuelTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload || {};
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-lg px-3 py-2 text-xs space-y-0.5">
      <p className="font-bold text-slate-800">{label || p.m}</p>
      <p className="text-slate-600">{num(p.liters).toLocaleString('en-PH', { maximumFractionDigits: 2 })} L consumed</p>
      <p className="text-slate-400">{num(p.txns).toLocaleString()} fuel transactions</p>
    </div>
  );
};

const CostTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload || {};
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-lg px-3 py-2 text-xs space-y-0.5">
      <p className="font-bold text-slate-800">{label || p.m}</p>
      <p className="text-slate-600">{peso(p.total)} transport cost</p>
      <p className="text-slate-400">{num(p.txns).toLocaleString()} transactions</p>
    </div>
  );
};

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { user } = useAuth();
  const nav = useNavigate();
  const greeting = useGreeting();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/dashboard');
      const payload = r?.data?.data;
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid dashboard response format');
      }
      setD(payload);
    } catch (e) {
      console.error('Dashboard load failed:', e);
      let msg = 'Unable to load dashboard data. Please check the backend connection.';
      const status = e?.response?.status;
      const code = e?.code;
      if (code === 'ECONNABORTED' || /timeout/i.test(e?.message || '')) {
        msg = 'Dashboard request timed out. The backend may be down or slow. Please try again.';
      } else if (!e?.response) {
        msg = 'Unable to load dashboard data. Please check the backend connection. (Backend unreachable at /api/dashboard)';
      } else if (status === 401 || status === 403) {
        msg = 'Session expired or unauthorized. Please log in again.';
      } else if (status === 404) {
        msg = 'Dashboard endpoint not found (GET /api/dashboard). Please check the backend routes.';
      } else if (status >= 500) {
        msg = `Dashboard service failed (${status}). ${e?.response?.data?.message || e?.response?.data?.error || 'Please check the backend logs.'}`;
      } else if (e?.response?.data?.message) {
        msg = e.response.data.message;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-purple-200 border-t-[#6023d5] rounded-full animate-spin" />
        <p className="text-sm font-semibold text-slate-500">Loading Fleet Management System...</p>
      </div>
    </div>
  );

  if (error && !d) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3 max-w-md text-center">
        <p className="text-2xl">⚠️</p>
        <p className="text-sm font-bold text-slate-800">Unable to load dashboard data. Please check the backend connection.</p>
        <p className="text-xs text-slate-500">{error}</p>
        <button className="btn-primary btn" onClick={load}>Retry</button>
      </div>
    </div>
  );

  const v = d.vehicles || {};
  const drv = d.driversDetail || { total: d.drivers || 0, available: 0 };
  const res = d.reservations || { total: 0, pending: d.pendingReservations || 0, ready: 0, done: 0 };
  const disp = d.dispatch || { ready: 0, active: 0 };
  const t = d.trips || {};
  const rt = d.routes || {};
  const trk = d.tracking || {};
  const fuel = d.fuel || {};
  const costs = d.costs || { total: d.transportCost || 0 };
  const reps = d.reports || {};
  const charts = d.charts || {};
  const utilization = Array.isArray(charts.utilization) ? charts.utilization : [];
  const tripPerf = Array.isArray(charts.tripPerf) ? charts.tripPerf : [];
  const fuelTrend = Array.isArray(charts.fuelTrend) ? charts.fuelTrend : [];
  const costTrend = Array.isArray(charts.costTrend) ? charts.costTrend : [];

  const chartWrapClass = 'cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/40';
  const openOnEnter = (to) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav(to); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Hero Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#4f22c6] via-[#6023d5] to-[#7424e6] p-6 md:p-8 text-white shadow-xl shadow-purple-950/10">
        <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-2xl">
            <p className="text-purple-200 font-medium text-xs md:text-sm mb-1 flex items-center gap-1.5">
              <span>{greeting}, {user?.name || 'Sophie'}</span> ✨
            </p>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-2 text-white">
              Merchandising Management System
            </h1>
            <p className="text-purple-100/90 text-xs md:text-sm leading-relaxed font-normal">
              Automated Report Generation • Real-Time KPI Monitoring • Supplier Evaluation • Cloud-Based Business Intelligence
            </p>
          </div>

          {/* Banner Status Pill Badges */}
          <div className="flex flex-wrap md:flex-col gap-2 shrink-0 text-xs">
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-purple-200">Cloud Status</span>
              <span className="font-bold text-white ml-auto">Synced</span>
            </div>
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15">
              <span className="text-purple-200">🕒 Last Backup</span>
              <span className="font-bold text-white ml-auto">07:00 UTC</span>
            </div>
          </div>
        </div>
      </div>

      {/* Fleet KPI Cards — one per sidebar module, values from real API/DB counts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        <StatCard
          title="Fleet & Vehicles"
          value={num(v.total).toLocaleString()}
          sub={`${num(v.available).toLocaleString()} available`}
          color="purple"
          to="/vehicles"
          icon="🚚"
        />
        <StatCard
          title="Drivers"
          value={num(drv.total).toLocaleString()}
          sub={`${num(drv.available).toLocaleString()} available`}
          color="blue"
          to="/drivers"
          icon="🧑‍✈️"
        />
        <StatCard
          title="Reservations"
          value={num(res.total).toLocaleString()}
          sub={`${num(res.pending).toLocaleString()} pending`}
          color="amber"
          to="/reservations"
          icon="📝"
        />
        <StatCard
          title="Dispatch Queue"
          value={num(disp.ready).toLocaleString()}
          sub={`${num(disp.active).toLocaleString()} dispatched trips active`}
          color="indigo"
          to="/dispatch"
          icon="🛰️"
        />
        <StatCard
          title="Trips"
          value={num(t.total).toLocaleString()}
          sub={`${num(t.active).toLocaleString()} active • ${num(t.done).toLocaleString()} completed`}
          color="emerald"
          to="/trips"
          icon="🛣️"
        />
        <StatCard
          title="Route Planning"
          value={num(rt.total).toLocaleString()}
          sub={`${num(rt.planned).toLocaleString()} planned • ${num(rt.active).toLocaleString()} active`}
          color="cyan"
          to="/routes"
          icon="🗺️"
        />
        <StatCard
          title="Vehicle Tracking"
          value={num(trk.tracked).toLocaleString()}
          sub={`${num(trk.online).toLocaleString()} online • ${num(trk.offline).toLocaleString()} offline`}
          color="yellow"
          to="/tracking"
          icon="📍"
        />
        <StatCard
          title="Fuel Management"
          value={num(fuel.total).toLocaleString()}
          sub={`${num(fuel.liters).toLocaleString('en-PH', { maximumFractionDigits: 2 })} L • ${peso(fuel.cost)}`}
          color="red"
          to="/fuel"
          icon="⛽"
        />
        <StatCard
          title="Transport Costs"
          value={peso(costs.total)}
          sub={`${num(costs.count).toLocaleString()} records • ${peso(costs.monthTotal)} this month`}
          color="blue"
          to="/costs"
          icon="💰"
        />
        <StatCard
          title="Reports"
          value={num(reps.available).toLocaleString()}
          sub={(reps.types || []).join(' • ')}
          color="purple"
          to="/reports"
          icon="📑"
        />
      </div>

      {/* Analytics & Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Vehicle Utilization Card (real vehicle statuses) */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Vehicle Utilization</h3>
              <p className="text-xs text-slate-400">Fleet status distribution</p>
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-1 text-xs font-semibold rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 transition">Filter</button>
              <button className="px-3 py-1 text-xs font-semibold rounded-full border border-purple-200 text-[#6023d5] hover:bg-purple-50 transition">Export</button>
            </div>
          </div>
          <div
            role="button"
            tabIndex={0}
            title="Click to open Fleet & Vehicles"
            aria-label={`Vehicle utilization chart — open Fleet & Vehicles`}
            className={chartWrapClass}
            onClick={() => nav('/vehicles')}
            onKeyDown={openOnEnter('/vehicles')}
          >
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={utilization} dataKey="n" nameKey="status" outerRadius={85} innerRadius={45} label style={{ cursor: 'pointer' }}>
                {utilization.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }} />
            </PieChart>
          </ResponsiveContainer>
          </div>
        </div>

        {/* Trip Performance Card */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Trip Performance</h3>
              <p className="text-xs text-slate-400">Actual trip statuses (Scheduled • In Transit • Arrived • Completed • Cancelled)</p>
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-1 text-xs font-semibold rounded-full border border-purple-200 text-[#6023d5] hover:bg-purple-50 transition">Export</button>
            </div>
          </div>
          <div
            role="button"
            tabIndex={0}
            title="Click to open Trips"
            aria-label="Trip performance chart — open Trips"
            className={chartWrapClass}
            onClick={() => nav('/trips')}
            onKeyDown={openOnEnter('/trips')}
          >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={tripPerf}>
              <XAxis dataKey="trip_status" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }} />
              <Bar dataKey="n" fill="#6023d5" radius={[8, 8, 0, 0]} style={{ cursor: 'pointer' }} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>

        {/* Fuel Consumption Trend */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Fuel Consumption Trend</h3>
              <p className="text-xs text-slate-400">Total liters recorded per month</p>
            </div>
          </div>
          <div
            role="button"
            tabIndex={0}
            title="Click to open Fuel Management"
            aria-label="Fuel consumption trend chart — open Fuel Management"
            className={chartWrapClass}
            onClick={() => nav('/fuel')}
            onKeyDown={openOnEnter('/fuel')}
          >
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={fuelTrend}>
              <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip content={<FuelTip />} />
              <Line type="monotone" dataKey="liters" stroke="#ef4444" strokeWidth={3} dot={{ r: 4, fill: '#ef4444' }} style={{ cursor: 'pointer' }} />
            </LineChart>
          </ResponsiveContainer>
          </div>
        </div>

        {/* Transport Cost Trend */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Transport Cost Trend</h3>
              <p className="text-xs text-slate-400">Cost in ₱ per month</p>
            </div>
          </div>
          <div
            role="button"
            tabIndex={0}
            title="Click to open Transport Costs"
            aria-label="Transport cost trend chart — open Transport Costs"
            className={chartWrapClass}
            onClick={() => nav('/costs')}
            onKeyDown={openOnEnter('/costs')}
          >
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={costTrend}>
              <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip content={<CostTip />} />
              <Line type="monotone" dataKey="total" stroke="#6023d5" strokeWidth={3} dot={{ r: 4, fill: '#6023d5' }} style={{ cursor: 'pointer' }} />
            </LineChart>
          </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Expiry Alerts Warning Card */}
      {d.expiries?.length > 0 && (
        <div className="card border-l-4 border-l-rose-500 bg-rose-50/40 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <h3 className="font-bold text-rose-800 text-sm">Registration & License Expiry Alerts (30 Days)</h3>
          </div>
          <ul className="text-xs font-medium space-y-2 text-slate-700">
            {d.expiries.map((e, i) => (
              <li key={i} className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-rose-100 shadow-sm">
                <span>{e.kind === 'vehicle' ? '🚚' : '🪪'} <strong>{e.label}</strong></span>
                <span className="text-rose-600 font-bold">Expires {e.expiry}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Footer */}
      <div className="card flex items-center justify-between">
        <div>
          <p className="font-bold text-slate-900 text-sm">Need deep analytical reports?</p>
          <p className="text-xs text-slate-500">Generate PDF / CSV reports for fleet operations.</p>
        </div>
        <button className="btn-primary btn" onClick={() => nav('/reports')}>View Full Reports</button>
      </div>
    </div>
  );
}

