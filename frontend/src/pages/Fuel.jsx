import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Empty, Modal, Toast, Pager } from '../components/ui';
import ReceiptAttachment from '../mobile/ReceiptAttachment';
import ReceiptScanner from '../mobile/ReceiptScanner';
import { dateWarning, validateCorrectedValues } from '../mobile/receiptOcr';
import { formatCurrencyPHP } from '../utils/currency';
import { FUEL_TYPES, isFuelType } from '../constants/fuelTypes';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

export default function Fuel() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [pg, setPg] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [fVehicle, setFVehicle] = useState('');
  const [fDriver, setFDriver] = useState('');
  const [fFuelType, setFFuelType] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [summary, setSummary] = useState(null);
  const [modal, setModal] = useState(null);
  const [view, setView] = useState(null);
  const [toast, setToast] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [form, setForm] = useState({ record_date: new Date().toISOString().slice(0, 10), fuel_type: 'Diesel' });
  const [showArchived, setShowArchived] = useState(false);
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptTotal, setReceiptTotal] = useState(null);
  const [ocrDate, setOcrDate] = useState(null); // record_date as delivered by OCR (for the age warning)
  const [ocrSnapshot, setOcrSnapshot] = useState(null); // structured receipt+validation stored with the transaction
  const [ocrStates, setOcrStates] = useState(null); // per-field OCR verification states (save gate)
  const [fuelProduct, setFuelProduct] = useState(null); // raw product description from the receipt
  const [corrected, setCorrected] = useState({}); // fields the user manually touched after a scan
  const [totalConfirmed, setTotalConfirmed] = useState(false); // user confirmed the OCR total
  const [scannerKey, setScannerKey] = useState(0);
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };
  // Every manual edit marks the field corrected so the save gate revalidates it.
  const editForm = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    const keys = Object.keys(patch);
    setCorrected((c) => {
      let changed = false;
      const next = { ...c };
      for (const k of keys) if (!next[k]) { next[k] = true; changed = true; }
      return changed ? next : c;
    });
  };

  // OCR handler: OCR response -> parseReceiptData() (inside ReceiptScanner) ->
  // validate extracted fields -> setForm() on the EXISTING modal inputs.
  // Only HIGH/MEDIUM-tier values fill the form; NEEDS-VERIFICATION and
  // missing fields keep existing values and stay manually editable.
  const normalizeStation = (s) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 150);
    if (!t) return t;
    if (t === t.toUpperCase() || t === t.toLowerCase()) {
      return t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
    }
    return t;
  };
  const applyOcr = (ocr) => {
    if (!ocr) {
      setReceiptTotal(null); setOcrDate(null); setOcrSnapshot(null);
      setOcrStates(null); setFuelProduct(null); setCorrected({}); setTotalConfirmed(false);
      return;
    }
    console.log('Parsed receipt data:', ocr);
    const tiers = ocr.tiers || {};
    const conf = ocr.confidence || {};
    // Tier gate (new payloads) with numeric-confidence fallback (legacy).
    const fillable = (k) => {
      const t = tiers[k];
      if (t) return t === 'high' || t === 'medium';
      const c = conf[k];
      return c === undefined || c === null ? true : +c >= 60;
    };
    const ocrIso = ocr.record_date && /^\d{4}-\d{2}-\d{2}$/.test(ocr.record_date) && fillable('record_date') ? ocr.record_date : null;
    setOcrDate(ocrIso);
    setForm((f) => {
      const next = { ...f };
      if (ocr.fuel_type && FUEL_TYPES.includes(ocr.fuel_type) && fillable('fuel_type')) next.fuel_type = ocr.fuel_type;
      if (ocrIso) next.record_date = ocrIso;
      if (ocr.odometer_reading !== null && ocr.odometer_reading !== undefined && Number.isInteger(+ocr.odometer_reading) && +ocr.odometer_reading >= 0 && fillable('odometer_reading')) next.odometer_reading = ocr.odometer_reading;
      if (ocr.liters !== null && ocr.liters !== undefined && +ocr.liters > 0 && fillable('liters')) next.liters = ocr.liters;
      if (ocr.price_per_liter !== null && ocr.price_per_liter !== undefined && +ocr.price_per_liter > 0 && fillable('price_per_liter')) next.price_per_liter = ocr.price_per_liter;
      if (ocr.fuel_station && fillable('fuel_station')) next.fuel_station = normalizeStation(ocr.fuel_station);
      if (ocr.receipt_reference && fillable('receipt_reference')) next.receipt_reference = String(ocr.receipt_reference).trim().slice(0, 100);
      console.log('Final form data:', next);
      return next;
    });
    setReceiptTotal(ocr.receipt_total !== null && ocr.receipt_total !== undefined ? +ocr.receipt_total : null);
    setOcrStates(ocr.fieldStates || null);
    setFuelProduct(ocr.fuel_product || null);
    setCorrected({});
    setTotalConfirmed(false);
    // Snapshot of what OCR extracted (kept even if the user edits fields).
    try {
      setOcrSnapshot(JSON.stringify({
        receipt: {
          fuelStation: ocr.fuel_station ?? null,
          fuelProduct: ocr.fuel_product ?? null,
          fuelType: ocr.fuel_type ?? null,
          date: ocr.record_date ?? null,
          time: ocr.record_time ?? null,
          odometer: ocr.odometer_reading ?? null,
          liters: ocr.liters ?? null,
          pricePerLiter: ocr.price_per_liter ?? null,
          totalAmount: ocr.receipt_total ?? null,
          referenceNumber: ocr.receipt_reference ?? null,
        },
        tiers: ocr.tiers || null,
        fieldStates: ocr.fieldStates || null,
        receiptStatus: ocr.receiptStatus || null,
        validation: ocr.validation || null,
        scanned_at: new Date().toISOString(),
      }).slice(0, 8000));
    } catch { setOcrSnapshot(null); }
  };

  const load = async () => {
    const { data } = await api.get('/fuel', { params: { page, search, vehicle_id: fVehicle || undefined, driver_id: fDriver || undefined, fuel_type: fFuelType || undefined, from: fFrom || undefined, to: fTo || undefined, archived: showArchived ? '1' : '' } });
    setRows(data.data); setPg(data.pagination);
    const s = await api.get('/fuel/summary'); setSummary(s.data.data);
  };
  useEffect(() => { load(); }, [page, showArchived]);

  const loadRefs = async () => {
    const [v, d] = await Promise.all([api.get('/vehicles?limit=100'), api.get('/drivers?limit=100')]);
    setVehicles(v.data.data); setDrivers(d.data.data);
    return { v: v.data.data, d: d.data.data };
  };

  const openAdd = async () => {
    await loadRefs();
    setForm({ record_date: new Date().toISOString().slice(0, 10), fuel_type: 'Diesel' });
    setReceiptFile(null);
    setReceiptTotal(null);
    setOcrDate(null);
    setOcrSnapshot(null);
    setOcrStates(null);
    setFuelProduct(null);
    setCorrected({});
    setTotalConfirmed(false);
    setScannerKey((k) => k + 1);
    setModal('add');
  };
  const openEdit = async (f) => {
    await loadRefs();
    const { data } = await api.get(`/fuel/${f.id}`);
    setForm({ ...data.data });
    setReceiptFile(null);
    setReceiptTotal(null);
    setOcrDate(null);
    setOcrSnapshot(null);
    setOcrStates(null);
    setFuelProduct(null);
    setCorrected({});
    setTotalConfirmed(false);
    setScannerKey((k) => k + 1);
    setModal('edit');
  };
  const openView = async (f) => {
    const { data } = await api.get(`/fuel/${f.id}`);
    setView(data.data);
  };

  const onVehicleChange = (id) => {
    const v = vehicles.find((x) => String(x.id) === String(id));
    // The selected vehicle automatically sets the transaction's fuel type
    // from the SAME shared fuel type source — no mismatch possible.
    const fuel = v?.fuel_type && isFuelType(v.fuel_type) ? v.fuel_type : form.fuel_type;
    editForm({ vehicle_id: id, fuel_type: fuel });
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (modal === 'add') {
        if (receiptFile) {
          const fd = new FormData();
          for (const [k, v] of Object.entries(form)) {
            if (v !== null && v !== undefined && v !== '') fd.append(k, v);
          }
          fd.append('receipt', receiptFile);
          if (ocrSnapshot) fd.append('ocr_snapshot', ocrSnapshot);
          await api.post('/fuel', fd);
        } else {
          await api.post('/fuel', ocrSnapshot ? { ...form, ocr_snapshot: ocrSnapshot } : form);
        }
        show('Fuel transaction created');
      }
      else { await api.put(`/fuel/${form.id}`, form); show('Fuel transaction updated'); }
      setModal(null); setReceiptFile(null); setReceiptTotal(null); setOcrDate(null); setOcrSnapshot(null);
      setOcrStates(null); setFuelProduct(null); setCorrected({}); setTotalConfirmed(false); load();
    }
    catch (err) {
      const errObj = err.response?.data;
      const msg = errObj?.errors ? Object.values(errObj.errors).join(', ') : (errObj?.message || 'Save failed');
      show(msg, 'error');
    }
  };
  const archive = async (id) => {
    try { await api.patch(`/fuel/${id}/archive`); show('Fuel record archived'); load(); }
    catch (err) { show(err.response?.data?.message || 'Archive failed', 'error'); }
  };
  const restore = async (id) => {
    try { await api.patch(`/fuel/${id}/restore`); show('Fuel record restored'); load(); }
    catch (err) { show(err.response?.data?.message || 'Restore failed', 'error'); }
  };
  const applyFilters = (e) => { e.preventDefault(); setPage(1); load(); };
  const clearFilters = () => { setSearch(''); setFVehicle(''); setFDriver(''); setFFuelType(''); setFFrom(''); setFTo(''); setPage(1); };

  const total = form.liters && form.price_per_liter ? (+form.liters * +form.price_per_liter).toFixed(2) : '0.00';
  // Significant disagreement: receipt total vs Liters x Price/L beyond
  // max(₱1.00, 2% of receipt total) requires verification.
  const receiptMismatch = (() => {
    if (receiptTotal === null || receiptTotal === undefined || !(+total > 0)) return null;
    const diff = Math.abs(+total - +receiptTotal);
    const tolerance = Math.max(1, Math.abs(+receiptTotal) * 0.02);
    return diff > tolerance ? { diff: diff.toFixed(2) } : null;
  })();
  const verified = receiptTotal !== null && receiptTotal !== undefined && +total > 0
    ? receiptMismatch === null
    : null;

  // Save gate: while a receipt scan is attached, every required field must be
  // VERIFIED — by OCR or by manual correction + revalidation. Without a scan
  // (pure manual entry) the gate stays open and backend validation applies.
  const BLOCKER_LABELS = {
    fuel_type: 'Fuel Type', liters: 'Liters', price_per_liter: 'Price/Liter',
    total_amount: 'Total Amount', record_date: 'Date', receipt_reference: 'OR/Reference No.',
  };
  const gate = (() => {
    if (!ocrStates) return { canSave: true, blockers: [] };
    const prev = { ...ocrStates };
    for (const k of Object.keys(corrected)) {
      if (prev[k]) prev[k] = { ...prev[k], manuallyCorrected: true };
    }
    if (totalConfirmed && prev.total_amount) prev.total_amount = { ...prev.total_amount, manuallyCorrected: true };
    if (verified === true && prev.total_amount) {
      prev.total_amount = { ...prev.total_amount, status: 'VERIFIED', manuallyCorrected: true };
    }
    const r = validateCorrectedValues({
      fuel_type: form.fuel_type, liters: form.liters, price_per_liter: form.price_per_liter,
      total_amount: receiptTotal, record_date: form.record_date, receipt_reference: form.receipt_reference,
    }, prev);
    const issues = r.issues.filter((k) => {
      if (k === 'receipt_reference' && !ocrStates.receipt_reference) return false;
      if (k === 'total_amount' && (receiptTotal === null || receiptTotal === undefined)) return false;
      return true;
    });
    return { canSave: issues.length === 0, blockers: issues.map((k) => BLOCKER_LABELS[k] || k) };
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold">Fuel Management</h2>
        <button className={`btn ml-auto ${showArchived ? 'btn-gray' : 'btn-amber bg-amber-50 text-amber-800 border'}`} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Show Active' : 'Show Archive'}</button>
        <button className="btn-primary btn" onClick={openAdd}>+ Add Fuel Transaction</button>
      </div>
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card"><p className="text-xs uppercase text-slate-500 font-semibold">Total Fuel Cost</p><p className="text-xl font-bold">₱{(+summary.totals.cost).toLocaleString()}</p></div>
          <div className="card"><p className="text-xs uppercase text-slate-500 font-semibold">Total Liters Consumed</p><p className="text-xl font-bold">{(+summary.totals.liters).toFixed(1)} L</p></div>
          <div className="card"><p className="text-xs uppercase text-slate-500 font-semibold">Average Fuel Cost</p><p className="text-xl font-bold">₱{(+summary.totals.avg_cost || 0).toFixed(2)}</p></div>
          <div className="card"><p className="text-xs uppercase text-slate-500 font-semibold">Number of Fuel Transactions</p><p className="text-xl font-bold">{summary.totals.n}</p></div>
        </div>
      )}
      {summary && summary.wastage.length > 0 && (
        <div className="card border-l-4 border-l-red-500">
          <h3 className="font-bold text-red-700 mb-1">⚠️ High Fuel Consumption (over ₱{summary.threshold})</h3>
          {summary.wastage.map((w) => <p key={w.id} className="text-sm">{w.fuel_code} — {w.plate_number} — ₱{w.total_cost} ({w.liters}L)</p>)}
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card"><h3 className="font-bold mb-2">Consumption Trend</h3>
          <ResponsiveContainer width="100%" height={200}><LineChart data={summary?.trend || []}><XAxis dataKey="m" /><YAxis /><Tooltip /><Line dataKey="liters" stroke="#ef4444" strokeWidth={2} /></LineChart></ResponsiveContainer></div>
        <div className="card"><h3 className="font-bold mb-2">Cost per Vehicle</h3>
          <ResponsiveContainer width="100%" height={200}><BarChart data={summary?.perVehicle || []}><XAxis dataKey="plate_number" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Bar dataKey="cost" fill="#f59e0b" /></BarChart></ResponsiveContainer></div>
      </div>
      <form onSubmit={applyFilters} className="card flex gap-2 flex-wrap items-end">
        <div><label className="label">Search</label><input className="input max-w-xs" placeholder="Search code / plate / station / receipt..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div><label className="label">Vehicle</label><select className="input max-w-[180px]" value={fVehicle} onChange={(e) => setFVehicle(e.target.value)}><option value="">All vehicles</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}</select></div>
        <div><label className="label">Driver</label><select className="input max-w-[180px]" value={fDriver} onChange={(e) => setFDriver(e.target.value)}><option value="">All drivers</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></div>
        <div><label className="label">Fuel Type</label><select className="input max-w-[150px]" value={fFuelType} onChange={(e) => setFFuelType(e.target.value)}><option value="">All types</option>{FUEL_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label className="label">From</label><input type="date" className="input" value={fFrom} onChange={(e) => setFFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={fTo} onChange={(e) => setFTo(e.target.value)} /></div>
        <button className="btn-primary btn">Search</button>
        <button type="button" className="btn-gray btn" onClick={clearFilters}>Clear</button>
      </form>
      <div className="card overflow-auto">
        <table className="table min-w-[1100px]">
          <thead><tr><th>Fuel Transaction ID</th><th>Date</th><th>Vehicle</th><th>Driver</th><th>Type of Gas/Fuel</th><th>Liters</th><th>Price/L</th><th>Total Fuel Cost</th><th>Station</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}><td className="font-semibold">{f.fuel_code}</td><td>{f.record_date}</td><td>{f.plate_number}</td>
                <td>{f.driver_name || '—'}</td><td>{f.fuel_type}</td><td>{f.liters}</td><td>₱{f.price_per_liter}</td><td className="font-semibold">₱{f.total_cost}</td>
                <td>{f.fuel_station || '—'}</td>
                <td className="flex gap-1">
                  <button className="btn-gray btn !px-2" onClick={() => openView(f)}>View</button>
                  {can('admin', 'fleet_manager', 'dispatcher') && <button className="btn-gray btn !px-2" onClick={() => openEdit(f)}>Edit</button>}
                  {can('admin', 'fleet_manager') && (!showArchived ? <button className="btn-amber btn !px-2 bg-amber-100 text-amber-800 border" onClick={() => archive(f.id)}>Archive</button> : <button className="btn-emerald btn !px-2 bg-emerald-100 text-emerald-800 border" onClick={() => restore(f.id)}>Restore</button>)}
                </td></tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
        <Pager pagination={pg} onPage={setPage} />
      </div>

      <Modal open={!!modal} onClose={() => { setModal(null); setReceiptFile(null); setReceiptTotal(null); setOcrDate(null); setOcrSnapshot(null); setOcrStates(null); setFuelProduct(null); setCorrected({}); setTotalConfirmed(false); }} title={modal === 'add' ? 'Add Fuel Transaction' : 'Edit Fuel Transaction'}>
        <form onSubmit={save} className="grid grid-cols-2 gap-3">
          <div><label className="label">Vehicle *</label><select className="input" value={form.vehicle_id || ''} onChange={(e) => onVehicleChange(e.target.value)} required><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}{v.fuel_type ? ` (${v.fuel_type})` : ''}</option>)}</select></div>
          <div><label className="label">Driver</label><select className="input" value={form.driver_id || ''} onChange={(e) => editForm({ driver_id: e.target.value })}><option value="">—</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></div>
          <div><label className="label">Date *</label><input type="date" className="input" value={form.record_date} onChange={(e) => editForm({ record_date: e.target.value })} required /></div>
          <div><label className="label">Type of Gas/Fuel</label><select className="input" value={form.fuel_type} onChange={(e) => editForm({ fuel_type: e.target.value })}>{FUEL_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          {fuelProduct && modal === 'add' && (
            <p className="col-span-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2"><b>Fuel Product on receipt:</b> {fuelProduct}</p>
          )}
          <div><label className="label">Liters/Quantity *</label><input type="number" step="0.01" className="input" value={form.liters || ''} onChange={(e) => editForm({ liters: e.target.value })} required /></div>
          <div><label className="label">Price per Liter *</label><input type="number" step="0.01" className="input" value={form.price_per_liter || ''} onChange={(e) => editForm({ price_per_liter: e.target.value })} required /></div>
          <div><label className="label">Odometer Reading</label><input type="number" className="input" value={form.odometer_reading || ''} onChange={(e) => editForm({ odometer_reading: e.target.value })} /></div>
          <div><label className="label">Fuel Station</label><input className="input" value={form.fuel_station || ''} onChange={(e) => editForm({ fuel_station: e.target.value })} /></div>
          <div><label className="label">Receipt/Reference Number</label><input className="input" value={form.receipt_reference || ''} onChange={(e) => editForm({ receipt_reference: e.target.value })} /></div>
          <div><label className="label">Remarks</label><input className="input" value={form.notes || ''} onChange={(e) => editForm({ notes: e.target.value })} /></div>
          {modal === 'add' && (
            <div className="col-span-2">
              <ReceiptScanner key={scannerKey} onExtract={applyOcr} onFileChange={setReceiptFile} />
            </div>
          )}
          <div className="col-span-2 bg-emerald-50 rounded-lg p-2 text-sm font-semibold">Total Fuel Cost = Liters × Price per Liter = {formatCurrencyPHP(total)}</div>
          {verified === true && (
            <p className="col-span-2 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2">✅ Receipt total verified.</p>
          )}
          {verified === false && (
            <p className="col-span-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">⚠️ Receipt values need verification. Detected total ({formatCurrencyPHP(receiptTotal)}) does not match the calculated amount ({formatCurrencyPHP(total)}, diff {formatCurrencyPHP(receiptMismatch?.diff)}). Please verify the extracted values.</p>
          )}
          {ocrStates && gate.blockers.length > 0 && (
            <div className="col-span-2 space-y-2">
              <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">⚠️ Please verify before saving: {gate.blockers.join(', ')}. Correct the highlighted fields above — revalidation is automatic.</p>
              {gate.blockers.includes('Total Amount') && receiptTotal !== null && receiptTotal !== undefined && !totalConfirmed && (
                <button
                  type="button"
                  onClick={() => setTotalConfirmed(true)}
                  className="w-full min-h-[44px] rounded-xl bg-white text-amber-800 text-xs font-bold border border-amber-300"
                >
                  ✓ Confirm {formatCurrencyPHP(receiptTotal)} as the receipt total
                </button>
              )}
            </div>
          )}
          {ocrDate && form.record_date === ocrDate && dateWarning(form.record_date) && (
            <p className="col-span-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">{dateWarning(form.record_date)}</p>
          )}
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn-gray btn" onClick={() => { setModal(null); setReceiptFile(null); setReceiptTotal(null); setOcrDate(null); setOcrSnapshot(null); setOcrStates(null); setFuelProduct(null); setCorrected({}); setTotalConfirmed(false); }}>Cancel</button><button className="btn-primary btn disabled:opacity-50" disabled={!gate.canSave} title={!gate.canSave ? `Verify before saving: ${gate.blockers.join(', ')}` : undefined}>Save</button></div>
        </form>
      </Modal>

      <Modal open={!!view} onClose={() => setView(null)} title={`Fuel ${view?.fuel_code || ''}`}>
        {view && (
          <div className="text-sm space-y-2">
            <p><b>Fuel Transaction ID:</b> {view.fuel_code} | <b>Date:</b> {view.record_date}</p>
            <p><b>Vehicle:</b> {view.plate_number} ({view.vehicle_fuel_type || '—'}) | <b>Driver:</b> {view.driver_name || '—'}</p>
            <p><b>Type of Gas/Fuel:</b> {view.fuel_type} | <b>Odometer:</b> {view.odometer_reading || '—'}</p>
            <p><b>Liters:</b> {view.liters} | <b>Price/L:</b> ₱{view.price_per_liter} | <b>Total:</b> <span className="font-bold">₱{view.total_cost}</span></p>
            <p><b>Station:</b> {view.fuel_station || '—'} | <b>Receipt/Ref:</b> {view.receipt_reference || '—'}</p>
            <p><b>Remarks:</b> {view.notes || '—'}</p>
            {(() => {
              try {
                const o = typeof view.ocr_snapshot === 'string' ? JSON.parse(view.ocr_snapshot) : view.ocr_snapshot;
                if (!o || !o.receipt) return null;
                const r = o.receipt;
                const bits = [
                  r.fuelStation ? `Station ${r.fuelStation}` : null,
                  r.fuelType ? `Type ${r.fuelType}` : null,
                  r.date ? `Date ${r.date}` : null,
                  r.liters ? `${r.liters} L` : null,
                  r.pricePerLiter ? `₱${r.pricePerLiter}/L` : null,
                  r.totalAmount ? `Total ₱${r.totalAmount}` : null,
                  r.referenceNumber ? `Ref ${r.referenceNumber}` : null,
                ].filter(Boolean);
                if (!bits.length) return null;
                return <p><b>OCR extracted:</b> {bits.join(' • ')}{o.scanned_at ? ` (scanned ${String(o.scanned_at).slice(0, 16).replace('T', ' ')})` : ''}</p>;
              } catch { return null; }
            })()}
            <p><b>Created By:</b> {view.created_by_name || `#${view.created_by || '—'}`} | <b>Created Date:</b> {view.created_at || '—'}</p>
            {view.trip_code && <p><b>Trip:</b> {view.trip_code}</p>}
            <ReceiptAttachment record={view} />
          </div>
        )}
      </Modal>
      <Toast toast={toast} />
    </div>
  );
}
