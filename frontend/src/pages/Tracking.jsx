import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { StatusBadge, Toast } from '../components/ui';
import SosPanel from '../components/SosPanel';
import { useAuth } from '../context/AuthContext';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function markerIcon(status, active) {
  const color = !active ? '#94a3b8' : status === 'In Transit' ? '#4f46e5' : status === 'Dispatched' ? '#2563eb' : status === 'Available' ? '#059669' : status === 'Maintenance' ? '#ea580c' : '#0284c7';
  return L.divIcon({
    className: 'trk-marker',
    html: `<div style="background:${color};color:#fff;border:3px solid #fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 5px rgba(0,0,0,.45)">🚚</div>`,
    iconSize: [32, 32], iconAnchor: [16, 16]
  });
}

function sosIcon() {
  return L.divIcon({
    className: 'sos-marker',
    html: `<div style="background:#e11d48;color:#fff;border:3px solid #fff;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 0 0 4px rgba(225,29,72,.35),0 1px 5px rgba(0,0,0,.5);animation:sos-pulse 1.2s infinite">🚨</div><style>@keyframes sos-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}</style>`,
    iconSize: [40, 40], iconAnchor: [20, 20]
  });
}

function sosPopup(s) {
  return `<b>🚨 SOS ALERT</b><br/>Driver: ${s.driver_name || '—'}<br/>Vehicle: ${s.plate_number || s.vehicle_code || ''}<br/>` +
    `Trip: ${s.trip_code || (s.trip_id ? `#${s.trip_id}` : '—')}<br/>Current Location:<br/>Latitude: ${s.latitude}<br/>Longitude: ${s.longitude}<br/>` +
    `Status: SOS ACTIVE<br/>Last Updated:<br/>${s.updated_at || s.triggered_at || '—'}`;
}

export default function Tracking() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [fDriver, setFDriver] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fSignal, setFSignal] = useState('');
  const mapDiv = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [params, setParams] = useSearchParams();
  const [sosList, setSosList] = useState([]);
  const sosRef = useRef([]);
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };

  const load = async () => { const { data } = await api.get('/tracking/vehicles'); setRows(data.data); };
  const loadSos = async () => {
    try { const { data } = await api.get('/sos?status=ACTIVE'); setSosList(data.data || []); sosRef.current = data.data || []; }
    catch { /* ignore */ }
  };
  useEffect(() => {
    load(); loadSos();
    const s = getSocket();
    const onSosCreated = (sos) => {
      setSosList((prev) => [sos, ...prev.filter((x) => x.id !== sos.id)]);
      show(`🚨 SOS from ${sos.driver_name || 'driver'}`);
      load();
    };
    const onSosMoved = (sos) => {
      setSosList((prev) => {
        const i = prev.findIndex((x) => x.id === sos.id);
        if (i >= 0) { const n = [...prev]; n[i] = { ...n[i], ...sos }; return n; }
        return [sos, ...prev];
      });
      // move the vehicle marker live without refresh
      setRows((prev) => prev.map((r) => (r.id === sos.vehicle_id ? { ...r, latitude: sos.latitude, longitude: sos.longitude, recorded_at: sos.updated_at || r.recorded_at } : r)));
    };
    const onSosGone = (p) => {
      const id = p?.id ?? p;
      setSosList((prev) => prev.filter((x) => x.id !== id));
      loadSos();
    };
    const onTrack = (p) => {
      setRows((prev) => prev.map((r) => (r.id === p.vehicle_id ? { ...r, latitude: p.latitude, longitude: p.longitude, speed_kmh: p.speed_kmh ?? r.speed_kmh, recorded_at: new Date().toISOString().slice(0, 19).replace('T', ' ') } : r)));
    };
    s.on('sos:created', onSosCreated);
    s.on('sos:location-updated', onSosMoved);
    s.on('sos:resolved', onSosGone);
    s.on('sos:cancelled', onSosGone);
    s.on('tracking:location', onTrack);
    const t = setInterval(() => { load(); loadSos(); }, 15000);
    return () => {
      s.off('sos:created', onSosCreated); s.off('sos:location-updated', onSosMoved);
      s.off('sos:resolved', onSosGone); s.off('sos:cancelled', onSosGone); s.off('tracking:location', onTrack);
      clearInterval(t);
    };
  }, []);

  const drivers = useMemo(() => {
    const m = new Map();
    for (const r of rows) if (r.driver_id) m.set(r.driver_id, r.driver_name);
    return [...m.entries()];
  }, [rows]);
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))], [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (search && !`${r.plate_number} ${r.vehicle_code} ${r.driver_name || ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (fDriver && String(r.driver_id) !== String(fDriver)) return false;
    if (fStatus && r.status !== fStatus) return false;
    if (fSignal === 'active' && !r.latitude) return false;
    if (fSignal === 'inactive' && r.latitude) return false;
    return true;
  }), [rows, search, fDriver, fStatus, fSignal]);

  // init map once
  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;
    mapRef.current = L.map(mapDiv.current, { zoomControl: true, scrollWheelZoom: true }).setView([14.5995, 120.9842], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(mapRef.current);
    layerRef.current = L.layerGroup().addTo(mapRef.current);
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  const sosByVehicle = useMemo(() => {
    const m = new Map();
    for (const s of sosList) m.set(s.vehicle_id, s);
    return m;
  }, [sosList]);

  const locateSos = (s) => {
    const map = mapRef.current;
    const v = rows.find((r) => r.id === s.vehicle_id);
    if (v) { setSelected(v); open(v); }
    if (map && s.latitude && s.longitude) {
      map.setView([+s.latitude, +s.longitude], 16, { animate: true });
      L.popup().setLatLng([+s.latitude, +s.longitude]).setContent(sosPopup(s)).openOn(map);
    }
    setParams((p) => { p.set('focusSos', s.id); return p; }, { replace: true });
  };

  // render markers (SOS marker visually distinct)
  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts = [];
    const focusId = params.get('focusSos');
    for (const v of filtered) {
      const sos = sosByVehicle.get(v.id);
      const lat = sos ? sos.latitude : v.latitude;
      const lng = sos ? sos.longitude : v.longitude;
      if (!lat || !lng) continue;
      const active = !!lat;
      const m = L.marker([+lat, +lng], { icon: sos ? sosIcon() : markerIcon(v.status, active), title: sos ? `🚨 SOS ${v.plate_number}` : v.plate_number });
      if (sos) {
        m.bindPopup(sosPopup(sos));
        m.on('click', () => { setSelected(v); open(v); });
      } else {
        m.bindPopup(
          `<b>${v.plate_number}</b> (${v.vehicle_code || ''})<br/>` +
          `Type: ${v.vehicle_type || '—'} | Fuel: ${v.fuel_type || '—'}<br/>` +
          `Driver: ${v.driver_name || 'Unassigned'}${v.driver_contact ? ` (${v.driver_contact})` : ''}<br/>` +
          `Status: ${v.status || '—'}${v.gps_status ? ` / ${v.gps_status}` : ''}<br/>` +
          `Location: ${v.latitude}, ${v.longitude}<br/>` +
          `Speed: ${v.speed_kmh ?? '—'} km/h<br/>` +
          `Updated: ${v.recorded_at || '—'}`
        );
        m.on('click', () => { setSelected(v); open(v); });
      }
      m.addTo(layer);
      pts.push([+lat, +lng]);
    }
    // SOS live points without stored vehicle GPS (e.g. direct SOS coords)
    for (const s of sosList) {
      if (sosByVehicle.has(s.vehicle_id)) continue;
      if (!s.latitude || !s.longitude) continue;
      const m = L.marker([+s.latitude, +s.longitude], { icon: sosIcon(), title: `🚨 SOS ${s.plate_number || ''}` });
      m.bindPopup(sosPopup(s));
      m.addTo(layer);
      pts.push([+s.latitude, +s.longitude]);
    }
    if (focusId) {
      const f = sosRef.current.find((x) => String(x.id) === String(focusId)) || sosList.find((x) => String(x.id) === String(focusId));
      if (f && f.latitude && f.longitude) {
        map.setView([+f.latitude, +f.longitude], 16, { animate: true });
        L.popup().setLatLng([+f.latitude, +f.longitude]).setContent(sosPopup(f)).openOn(map);
        const v = rows.find((r) => r.id === f.vehicle_id);
        if (v && !selected) { setSelected(v); open(v); }
        return;
      }
    }
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2));
  }, [filtered, sosList]);

  const simulate = async () => {
    try { const { data } = await api.post('/tracking/simulate'); show(data.message); load(); }
    catch (err) { show(err.response?.data?.message || 'Simulation failed', 'error'); }
  };
  const open = async (v) => {
    const { data } = await api.get(`/tracking/vehicle/${v.id}`);
    setDetail(data.data);
    setSelected(v);
  };

  useEffect(() => { sosRef.current = sosList; }, [sosList]);

  const focusId = params.get('focusSos');
  const focusSos = focusId ? sosList.find((x) => String(x.id) === String(focusId)) : null;

  const selDetail = detail;
  const panelVehicle = selDetail?.vehicle || selected;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xl font-bold">Vehicle Tracking</h2>
        {sosList.length > 0 && <span className="badge bg-rose-600 text-white animate-pulse">🚨 {sosList.length} ACTIVE SOS</span>}
        {can('admin', 'fleet_manager') && <button className="btn-primary btn ml-auto" onClick={simulate}>Simulate GPS Update</button>}
      </div>
      {focusSos && (
        <div className="card border-2 border-rose-400 bg-rose-50 flex items-center gap-2 flex-wrap">
          <span className="font-extrabold text-rose-700 text-sm">🚨 SOS FOCUS: {focusSos.driver_name} • {focusSos.plate_number || focusSos.vehicle_code} • Trip {focusSos.trip_code || `#${focusSos.trip_id || '—'}`}</span>
          <button className="btn-gray btn !px-2 ml-auto" onClick={() => setParams({}, { replace: true })}>Clear focus</button>
        </div>
      )}

      <div className="card flex gap-2 flex-wrap items-end">
        <div><label className="label">Search vehicle</label><input className="input max-w-xs" placeholder="Plate / code / driver..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div><label className="label">Filter by driver</label><select className="input max-w-[200px]" value={fDriver} onChange={(e) => setFDriver(e.target.value)}><option value="">All drivers</option>{drivers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
        <div><label className="label">Filter by status</label><select className="input max-w-[180px]" value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">All statuses</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><label className="label">Tracking signal</label><select className="input max-w-[160px]" value={fSignal} onChange={(e) => setFSignal(e.target.value)}><option value="">Active + Inactive</option><option value="active">Active only</option><option value="inactive">Inactive only</option></select></div>
        <span className="text-xs text-slate-500 ml-auto">{filtered.length} / {rows.length} vehicles</span>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div ref={mapDiv} className="w-full rounded-lg border border-slate-200 z-0" style={{ height: 480 }} />
          <div className="flex gap-4 mt-2 text-xs text-slate-600 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-600 inline-block" /> Available</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-600 inline-block" /> Dispatched</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-indigo-600 inline-block" /> In Transit</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-slate-400 inline-block" /> No signal (inactive)</span>
            <span className="flex items-center gap-1 font-bold text-rose-700"><span className="w-3 h-3 rounded-full bg-rose-600 inline-block animate-pulse" /> 🚨 SOS ACTIVE</span>
          </div>
        </div>

        <div className="space-y-4 max-h-[560px] overflow-auto">
          <SosPanel onLocate={locateSos} />
          <div className="card">
          <h3 className="font-bold mb-2">Vehicles & Drivers</h3>
          <div className="space-y-2">
            {filtered.map((v) => (
              <button key={v.id} onClick={() => open(v)} className={`w-full text-left border rounded-lg p-2 hover:shadow-sm ${selected?.id === v.id ? 'border-blue-500 ring-1 ring-blue-300' : 'border-slate-200'}`}>
                <div className="flex items-center gap-2">
                  <span className="font-bold">{v.plate_number}</span><StatusBadge value={v.status} />
                  <span className={`ml-auto w-2.5 h-2.5 rounded-full ${v.latitude ? 'bg-emerald-500' : 'bg-slate-300'}`} title={v.latitude ? 'GPS active' : 'Inactive — no signal'} />
                </div>
                <div className="text-xs mt-1 space-y-0.5 text-slate-600">
                  <p>{v.vehicle_type || '—'} | ⛽ {v.fuel_type || '—'} | 🧑‍✈️ {v.driver_name || 'Unassigned'}</p>
                  <p>📍 {v.latitude ? `${v.latitude}, ${v.longitude}` : 'No GPS data yet'} | 🚗 {v.speed_kmh ?? '—'} km/h</p>
                  <p>🕒 {v.recorded_at || '—'}</p>
                </div>
              </button>
            ))}
            {!filtered.length && <p className="text-sm text-slate-400">No vehicles match the filters.</p>}
          </div>
          </div>
        </div>
      </div>

      {panelVehicle && (
        <div className="card">
          <div className="flex items-center gap-2"><h3 className="font-bold">Details — {panelVehicle.plate_number} ({panelVehicle.vehicle_code})</h3>
            <button className="btn-gray btn !px-2 ml-auto" onClick={() => { setDetail(null); setSelected(null); }}>Close</button></div>
          <div className="text-sm mt-2 grid md:grid-cols-2 gap-2">
            <p><b>Vehicle Name/Plate:</b> {panelVehicle.plate_number}</p>
            <p><b>Vehicle Type:</b> {panelVehicle.vehicle_type || '—'}</p>
            <p><b>Type of Gas/Fuel:</b> {panelVehicle.fuel_type || selDetail?.vehicle?.fuel_type || '—'}</p>
            <p><b>Assigned Driver:</b> {selDetail?.driver?.full_name || selected?.driver_name || selDetail?.vehicle && '' || '—'}</p>
            <p><b>Driver Contact/ID:</b> {selDetail?.driver ? `${selDetail.driver.contact_number || '—'} (ID ${selDetail.driver.id})` : selected?.driver_contact ? `${selected.driver_contact} (ID ${selected.driver_id})` : '—'}</p>
            <p><b>Current Status:</b> {panelVehicle.status || selected?.status || '—'}</p>
            <p><b>Current Location:</b> {selected?.latitude ? `${selected.latitude}, ${selected.longitude}` : '—'}</p>
            <p><b>Last Updated:</b> {selected?.recorded_at || '—'}</p>
            <p><b>Current Speed:</b> {selected?.speed_kmh != null ? `${selected.speed_kmh} km/h` : '—'}</p>
            <p><b>Tracking:</b> {selected?.latitude ? 'Active' : 'Inactive'}</p>
          </div>
          <div className="text-sm mt-3 max-h-64 overflow-auto border-t pt-2">
            <h4 className="font-bold mb-1">Location history</h4>
            {(selDetail?.history || []).map((h) => (
              <p key={h.id} className="py-1 border-b">📍 {h.latitude}, {h.longitude} — {h.speed_kmh} km/h — {h.recorded_at} {h.trip_id ? `(trip #${h.trip_id})` : ''}</p>
            ))}
            {selDetail && !selDetail.history.length && <p className="text-slate-400">No location history.</p>}
          </div>
        </div>
      )}
      <Toast toast={toast} />
    </div>
  );
}
