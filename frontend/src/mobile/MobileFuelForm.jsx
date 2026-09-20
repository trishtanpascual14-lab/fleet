import { useState } from 'react';
import api from '../services/api';
import { Toast } from '../components/ui';
import ReceiptScanner from './ReceiptScanner';
import { dateWarning, validateCorrectedValues } from './receiptOcr';
import { formatCurrencyPHP } from '../utils/currency';
import { FUEL_TYPES, isFuelType } from '../constants/fuelTypes';

/**
 * Mobile-friendly fuel form. Same fields + Total = Liters × Price/L as desktop.
 * Posts to the existing `/fuel` API — no new endpoints.
 */
export default function MobileFuelForm({ vehicles = [], onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ record_date: today, fuel_type: 'Diesel' });
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptTotal, setReceiptTotal] = useState(null);
  const [ocrDate, setOcrDate] = useState(null); // record_date as delivered by OCR (for the age warning)
  const [ocrSnapshot, setOcrSnapshot] = useState(null); // structured receipt+validation stored with the transaction
  const [ocrStates, setOcrStates] = useState(null); // per-field OCR verification states (save gate)
  const [fuelProduct, setFuelProduct] = useState(null); // raw product description from the receipt (e.g. D POWER)
  const [corrected, setCorrected] = useState({}); // fields the user manually touched after a scan
  const [totalConfirmed, setTotalConfirmed] = useState(false); // user confirmed the OCR total
  const [scannerKey, setScannerKey] = useState(0);
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setCorrected((c) => (c[k] ? c : { ...c, [k]: true }));
  };
  // Picking a vehicle auto-sets the transaction fuel type from the SAME
  // shared source (matches desktop Fuel Management behavior).
  const onVehicleChange = (id) => {
    const v = vehicles.find((x) => String(x.id) === String(id));
    const fuel = v?.fuel_type && isFuelType(v.fuel_type) ? v.fuel_type : form.fuel_type;
    setForm((f) => ({ ...f, vehicle_id: id, fuel_type: fuel }));
    setCorrected((c) => ({ ...c, fuel_type: true }));
  };

  // OCR handler: maps the structured receipt response into the SAME form
  // state bound to the inputs and used by Save Fuel Transaction.
  // Only HIGH/MEDIUM-tier values fill the form; NEEDS-VERIFICATION and
  // missing fields keep existing values and stay manually editable.
  // Garbage ("JpeTROY K", "1 L", "₱2") never arrives: the parser drops it.
  const normalizeStation = (s) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 150);
    if (!t) return t;
    // "PETRON" -> "Petron", "SHELL STATION" -> "Shell Station"; keep mixed-case as-is.
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
    // Verification gate state: every required field must be VERIFIED (by OCR
    // or by manual correction + revalidation) before Save is enabled.
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
    // Guide the user to the auto-filled fields.
    requestAnimationFrame(() => {
      document.getElementById('m-fuel-liters')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const total = form.liters && form.price_per_liter
    ? (+form.liters * +form.price_per_liter).toFixed(2)
    : '0.00';
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
  // VERIFIED — by OCR or by manual correction + revalidation. Manual edits
  // revalidate immediately; a matching liters×price total auto-verifies the
  // OCR total. Without a scan (pure manual entry) the gate stays open and
  // the backend validation applies.
  const BLOCKER_LABELS = {
    fuel_type: 'Fuel Type', liters: 'Liters', price_per_liter: 'Price/Liter',
    total_amount: 'Total Amount', record_date: 'Date', receipt_reference: 'OR/Reference No.',
  };
  const gate = (() => {
    if (!ocrStates) return { canSave: true, blockers: [], states: {} };
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
    // Reference is optional unless the scan actually produced one; the total
    // only gates when a receipt total was detected.
    const issues = r.issues.filter((k) => {
      if (k === 'receipt_reference' && !ocrStates.receipt_reference) return false;
      if (k === 'total_amount' && (receiptTotal === null || receiptTotal === undefined)) return false;
      return true;
    });
    return { canSave: issues.length === 0, blockers: issues.map((k) => BLOCKER_LABELS[k] || k), states: r.states };
  })();

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
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
      show('Fuel transaction saved successfully.');
      setForm({ record_date: today, fuel_type: 'Diesel' });
      setReceiptFile(null);
      setReceiptTotal(null);
      setOcrDate(null);
      setOcrSnapshot(null);
      setOcrStates(null);
      setFuelProduct(null);
      setCorrected({});
      setTotalConfirmed(false);
      setScannerKey((k) => k + 1);
      onSaved?.();
    } catch (err) {
      const errObj = err.response?.data;
      const msg = errObj?.errors ? Object.values(errObj.errors).join(', ') : (errObj?.message || 'Save failed');
      show(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 space-y-3 w-full max-w-full overflow-hidden">
      <div>
        <label className="label" htmlFor="m-fuel-vehicle">Vehicle *</label>
        <select id="m-fuel-vehicle" className="input min-h-[44px]" value={form.vehicle_id || ''} onChange={(e) => onVehicleChange(e.target.value)} required>
          <option value="">Select vehicle</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}{v.fuel_type ? ` (${v.fuel_type})` : ''}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="m-fuel-type">Fuel Type</label>
          <select id="m-fuel-type" className="input min-h-[44px]" value={form.fuel_type} onChange={set('fuel_type')}>
            {FUEL_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="m-fuel-date">Date *</label>
          <input id="m-fuel-date" type="date" className="input min-h-[44px]" value={form.record_date} onChange={set('record_date')} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="m-fuel-odo">Odometer</label>
          <input id="m-fuel-odo" type="number" inputMode="numeric" className="input min-h-[44px]" value={form.odometer_reading || ''} onChange={set('odometer_reading')} placeholder="km" />
        </div>
        <div>
          <label className="label" htmlFor="m-fuel-liters">Liters *</label>
          <input id="m-fuel-liters" type="number" inputMode="decimal" step="0.01" min="0" className="input min-h-[44px]" value={form.liters || ''} onChange={set('liters')} required />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="m-fuel-price">Price per Liter *</label>
        <input id="m-fuel-price" type="number" inputMode="decimal" step="0.01" min="0" className="input min-h-[44px]" value={form.price_per_liter || ''} onChange={set('price_per_liter')} required />
      </div>
      <div className="bg-emerald-50 rounded-xl p-3 text-sm font-bold text-emerald-800 break-words">
        Total Cost = Liters × Price/L = {formatCurrencyPHP(total)}
      </div>
      {verified === true && (
        <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">✅ Receipt total verified.</p>
      )}
      {verified === false && (
        <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5">⚠️ Receipt values need verification. Detected total ({formatCurrencyPHP(receiptTotal)}) does not match the calculated amount ({formatCurrencyPHP(total)}, diff {formatCurrencyPHP(receiptMismatch?.diff)}). Please verify the extracted values.</p>
      )}
      {dateWarning(form.record_date) && ocrDate && form.record_date === ocrDate && (
        <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5">{dateWarning(form.record_date)}</p>
      )}
      <div>
        <label className="label" htmlFor="m-fuel-station">Fuel Station</label>
        <input id="m-fuel-station" className="input min-h-[44px]" value={form.fuel_station || ''} onChange={set('fuel_station')} placeholder="Station name" />
      </div>
      <div>
        <label className="label" htmlFor="m-fuel-receipt">Receipt / Reference</label>
        <input id="m-fuel-receipt" className="input min-h-[44px]" value={form.receipt_reference || ''} onChange={set('receipt_reference')} placeholder="OR / reference no." />
      </div>
      <div>
        <label className="label" htmlFor="m-fuel-remarks">Remarks</label>
        <input id="m-fuel-remarks" className="input min-h-[44px]" value={form.notes || ''} onChange={set('notes')} placeholder="Optional notes" />
      </div>
      <ReceiptScanner key={scannerKey} onExtract={applyOcr} onFileChange={setReceiptFile} />
      {fuelProduct && (
        <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
          <b>Fuel Product on receipt:</b> {fuelProduct}
        </p>
      )}
      {ocrStates && gate.blockers.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
            ⚠️ Please verify before saving: {gate.blockers.join(', ')}. Correct the highlighted fields below — revalidation is automatic.
          </p>
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
      <button
        type="submit"
        disabled={busy || !gate.canSave}
        title={!gate.canSave ? `Verify before saving: ${gate.blockers.join(', ')}` : undefined}
        className="btn-primary btn w-full min-h-[48px] disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save Fuel Transaction'}
      </button>
      <Toast toast={toast} />
    </form>
  );
}
