import { useEffect, useRef, useState } from 'react';
import { validateReceiptFile, dateWarning, FIELD_STATUS } from './receiptOcr';
import { runReceiptOcr } from './receiptService';
import { formatCurrencyPHP } from '../utils/currency';

const DEV = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV;
const OCR_EMPTY = 'Unable to read the receipt clearly. Please retake the photo or enter the information manually.';

const CAM_DENIED = 'Camera permission was denied. You can use Choose File instead.';
const CAM_MISSING = 'No camera detected. Please use Choose File instead.';
const CAM_FAILED = 'Unable to access camera. Please use Choose File instead.';

// One extracted row with its verification state. Status comes from the
// parser's fieldStates (VERIFIED / NEEDS_VERIFICATION / NOT_DETECTED) —
// values are only ever read from the receipt, never invented. Numeric fields
// carry the TRUE multi-pass agreement confidence (st.confidence), not the
// page-level engine score. Uncertain or missing values are flagged, never
// silently auto-filled.
function statusBadge(status, conf) {
  const suffix = Number.isFinite(+conf) && +conf > 0 ? ` (${Math.round(conf)}%)` : '';
  if (status === FIELD_STATUS?.VERIFIED || status === 'high') {
    return <span className="text-[10px] font-extrabold text-emerald-600 uppercase shrink-0" title={`OCR confidence ${Math.round(conf || 0)}%`}>✓ High confidence{suffix}</span>;
  }
  if (status === FIELD_STATUS?.NEEDS_VERIFICATION || status === 'medium' || status === 'verify') {
    return <span className="text-[10px] font-extrabold text-amber-700 uppercase shrink-0" title={`OCR confidence ${Math.round(conf || 0)}%`}>⚠ Needs verification{suffix}</span>;
  }
  return <span className="text-[10px] font-extrabold text-slate-400 uppercase shrink-0">— Not detected</span>;
}

function ReviewRow({ label, display, fieldState }) {
  const status = fieldState?.status || FIELD_STATUS?.NOT_DETECTED || 'NOT_DETECTED';
  const missing = display === null || display === undefined || display === '';
  const highlight = missing || status === 'NEEDS_VERIFICATION' || status === 'verify' || status === 'medium';
  return (
    <p className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${highlight ? 'bg-amber-50 border border-amber-200' : ''}`}>
      <span><b>{label}:</b> {missing ? <span className="text-slate-400">—</span> : <span>{display}</span>}</span>
      {statusBadge(missing && status === 'VERIFIED' ? 'NOT_DETECTED' : status, fieldState?.confidence)}
    </p>
  );
}

function SectionTitle({ children }) {
  return <p className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider pt-1">{children}</p>;
}

// Hidden OCR debug panel (dev/test only): original, straightened, enhanced
// renders, receipt/table boundaries, per-region crops, word bounding boxes,
// per-pass text + confidence. Canvases are converted to data URLs locally —
// nothing leaves the device.
function OcrDebugPanel({ debug, previewUrl }) {
  const [urls, setUrls] = useState(null);
  const [showWords, setShowWords] = useState(true);
  const [showWordTable, setShowWordTable] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  useEffect(() => {
    if (!debug) return;
    const toUrl = (c) => {
      try { return c?.toDataURL?.('image/jpeg', 0.82) || null; } catch { return null; }
    };
    const crops = {};
    for (const [k, c] of Object.entries(debug.regionCrops || {})) crops[k] = toUrl(c);
    setUrls({
      corrected: toUrl(debug.corrected),
      variants: (debug.variants || []).map((v) => ({ name: v.name, url: toUrl(v.canvas) })),
      crops,
    });
  }, [debug]);
  if (!debug) return null;
  const words = (debug.stage1Words || []).slice(0, 250);
  const rectColors = { qty: '#2563eb', price: '#ea580c', amount: '#9333ea', total: '#dc2626', description: '#16a34a', date: '#0d9488', reference: '#a855f7' };
  const quadPts = debug.quad
    ? `${debug.quad.tl.x},${debug.quad.tl.y} ${debug.quad.tr.x},${debug.quad.tr.y} ${debug.quad.br.x},${debug.quad.br.y} ${debug.quad.bl.x},${debug.quad.bl.y}`
    : null;
  return (
    <div className="rounded-xl bg-slate-900 text-slate-100 p-3 text-[11px] space-y-3">
      <p className="font-extrabold uppercase tracking-wider text-amber-300">🔧 OCR debug (hidden mode)</p>
      {debug.coarse && <p className="text-slate-400">Coarse crop (orig px): x={Math.round(debug.coarse.x)} y={Math.round(debug.coarse.y)} w={Math.round(debug.coarse.w)} h={Math.round(debug.coarse.h)}</p>}
      {debug.skew && <p className="text-slate-400">Text skew: {Number(debug.skew.degrees || 0).toFixed(2)}° ({debug.skew.source})</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="font-bold text-slate-300 mb-1">Original image</p>
          {previewUrl && <img src={previewUrl} alt="Original" className="w-full rounded border border-slate-600" />}
        </div>
        <div>
          <p className="font-bold text-slate-300 mb-1">Straightened ({debug.usedWarp ? 'perspective warp' : 'box crop fallback'})</p>
          {urls?.corrected && (
            <div className="relative">
              <img src={urls.corrected} alt="Straightened" className="w-full rounded border border-slate-600" />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                {Object.entries(debug.rects || {}).map(([k, r]) => (
                  <rect key={k} x={r.x * 100} y={r.y * 100} width={r.w * 100} height={r.h * 100}
                    fill="none" stroke={rectColors[k] || '#fff'} strokeWidth={0.6} strokeDasharray="1.5 1"
                    vectorEffect="non-scaling-stroke" />
                ))}
                {showWords && words.map((w, i) => (
                  <rect key={i} x={w.x0 * 100} y={w.y0 * 100} width={(w.x1 - w.x0) * 100} height={(w.y1 - w.y0) * 100}
                    fill="none" stroke="#22c55e" strokeWidth={0.4} vectorEffect="non-scaling-stroke" opacity={0.7} />
                ))}
              </svg>
            </div>
          )}
          <button type="button" onClick={() => setShowWords((v) => !v)} className="mt-1 text-[10px] underline text-sky-300">
            {showWords ? 'Hide' : 'Show'} word boxes ({words.length})
          </button>
        </div>
      </div>
      {quadPts && <p className="text-slate-400">Quad (orig px): {quadPts}</p>}
      <p className="text-slate-400">Bands: {debug.bandsSource} {debug.bands ? JSON.stringify(debug.bands) : ''}</p>
      <div>
        <p className="font-bold text-slate-300 mb-1">Enhanced renders (V1–V5)</p>
        <div className="grid grid-cols-3 gap-1">
          {(urls?.variants || []).map((v) => (
            <div key={v.name}><p className="text-slate-400">{v.name}</p>{v.url && <img src={v.url} alt={v.name} className="w-full rounded border border-slate-700" />}</div>
          ))}
        </div>
      </div>
      <div>
        <p className="font-bold text-slate-300 mb-1">Region crops (product / qty / price / amount / total / date / reference)</p>
        <div className="grid grid-cols-2 gap-1">
          {Object.entries(urls?.crops || {}).map(([k, u]) => (
            <div key={k}><p style={{ color: rectColors[k] || '#fff' }}>{k}</p>{u && <img src={u} alt={`${k} crop`} className="w-full rounded border border-slate-700" />}</div>
          ))}
        </div>
      </div>
      <div>
        <button type="button" onClick={() => setShowRawText((v) => !v)} className="text-[10px] underline text-sky-300">
          {showRawText ? 'Hide' : 'Show'} complete raw OCR text (Stage 1 renders)
        </button>
        {showRawText && (
          <div className="mt-1 space-y-1 max-h-56 overflow-auto">
            {Object.entries(debug.stage1Texts || {}).map(([k, t]) => (
              <div key={k} className="rounded bg-slate-800 p-1.5">
                <p className="text-sky-300"><b>Stage 1 raw ({k})</b> — {(t || '').length} chars</p>
                <pre className="whitespace-pre-wrap text-slate-200">{t || '(empty)'}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <button type="button" onClick={() => setShowWordTable((v) => !v)} className="text-[10px] underline text-sky-300">
          {showWordTable ? 'Hide' : 'Show'} detected text boxes ({words.length})
        </button>
        {showWordTable && (
          <div className="mt-1 max-h-56 overflow-auto rounded bg-slate-800 p-1.5">
            <table className="w-full text-[10px]">
              <thead><tr className="text-slate-400 text-left"><th>text</th><th>conf</th><th>x,y (% norm)</th><th>w×h (% norm)</th></tr></thead>
              <tbody>
                {words.map((w, i) => (
                  <tr key={i} className="border-t border-slate-700 text-slate-200">
                    <td className="pr-1 break-all">{w.text}</td>
                    <td>{Math.round(w.conf || 0)}%</td>
                    <td>{(w.x0 * 100).toFixed(1)},{(w.y0 * 100).toFixed(1)}</td>
                    <td>{((w.x1 - w.x0) * 100).toFixed(1)}×{((w.y1 - w.y0) * 100).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div>
        <p className="font-bold text-slate-300 mb-1">Region votes</p>
        {Object.entries(debug.votes || {}).map(([k, v]) => (
          <p key={k} className="text-slate-300"><b>{k}:</b> {v.value ?? '—'} — {v.verdict} ({v.passes} passes, avg {v.avgConf}%)</p>
        ))}
      </div>
      <div>
        <p className="font-bold text-slate-300 mb-1">Per-pass OCR text + confidence</p>
        <div className="max-h-48 overflow-auto space-y-1">
          {(debug.regionPasses || []).map((p, i) => (
            <div key={i} className="rounded bg-slate-800 p-1.5">
              <p className="text-sky-300"><b>{p.pass}</b> — conf {p.conf}%{p.error ? ` — error: ${p.error}` : ''}</p>
              <pre className="whitespace-pre-wrap text-slate-200">{p.text || '(empty)'}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Receipt input with TWO options sharing ONE pipeline (receiptService):
 *   Take Picture (live camera modal) or Choose File (system picker)
 *     → Receipt Image → Preprocess → REAL OCR → Extract → Review → Attach → Save
 * Extracted values are mapped into the parent form state by onExtract;
 * the driver can correct everything before saving.
 */
export default function ReceiptScanner({ onExtract, onFileChange }) {
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState('');
  const [source, setSource] = useState(null); // 'camera' | 'file'
  const [status, setStatus] = useState(''); // '', 'scanning', 'error'
  const [scanStage, setScanStage] = useState('');
  const [detectState, setDetectState] = useState(''); // '', 'success', 'partial', 'unreadable'
  const [error, setError] = useState('');
  const [review, setReview] = useState(null);
  const [diag, setDiag] = useState(null); // dev diagnostics: per-pass chars/fields + raw error
  const [debugOn, setDebugOn] = useState(false); // hidden OCR debug mode
  const tapRef = useRef({ n: 0, t: 0 });
  const uploadRef = useRef(null);
  const objectUrl = useRef(null);

  // Hidden debug activation: ?ocrdebug=1, localStorage, or 5 taps on the header.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('ocrdebug');
      if (q === '1' || window.localStorage?.getItem('ocr_debug') === '1') setDebugOn(true);
    } catch { /* ignore */ }
  }, []);
  const tapDebug = () => {
    const now = Date.now();
    const s = tapRef.current;
    s.n = now - s.t < 3000 ? s.n + 1 : 1;
    s.t = now;
    if (s.n >= 5) {
      s.n = 0;
      setDebugOn((v) => {
        try { window.localStorage?.setItem('ocr_debug', v ? '0' : '1'); } catch { /* ignore */ }
        return !v;
      });
    }
  };

  // Camera modal state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const [camNonce, setCamNonce] = useState(0);
  const [captured, setCaptured] = useState(null); // object URL of the photo
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const capturedBlob = useRef(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  // Start/stop the live preview whenever the modal opens or camera switches.
  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    const start = async () => {
      setCameraError('');
      setCameraReady(false);
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(CAM_MISSING);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setCameraReady(true);
        }
      } catch (e) {
        if (cancelled) return;
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') setCameraError(CAM_DENIED);
        else if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError' || e?.name === 'DevicesNotFoundError') setCameraError(CAM_MISSING);
        else setCameraError(CAM_FAILED);
        stopCamera();
      }
    };
    start();
    return () => { cancelled = true; stopCamera(); };
  }, [cameraOpen, facingMode, camNonce]);

  // Safety: never leave the camera running after unmount.
  useEffect(() => () => stopCamera(), []);

  const openCamera = () => {
    setCaptured(null);
    capturedBlob.current = null;
    setCameraError('');
    setCameraOpen(true); // live preview starts via the effect above — no file picker
  };

  const closeCamera = () => {
    stopCamera();
    setCameraOpen(false);
    setCaptured(null);
    capturedBlob.current = null;
    setCameraError('');
    setCameraReady(false);
  };

  const switchCamera = () => {
    stopCamera();
    setCaptured(null);
    capturedBlob.current = null;
    setFacingMode((f) => (f === 'environment' ? 'user' : 'environment'));
  };

  const takePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) {
      setCameraError(CAM_FAILED);
      stopCamera();
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stopCamera(); // stop the stream immediately after capture
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraError(CAM_FAILED);
        return;
      }
      capturedBlob.current = blob;
      setCaptured(URL.createObjectURL(blob));
    }, 'image/jpeg', 0.92);
  };

  const retakePhoto = () => {
    if (captured) URL.revokeObjectURL(captured);
    setCaptured(null);
    capturedBlob.current = null;
    setCamNonce((n) => n + 1); // restart the live preview
  };

  const clearPreview = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setPreview(null);
    setFileName('');
    setSource(null);
  };

  const remove = () => {
    clearPreview();
    setReview(null);
    setError('');
    setStatus('');
    setScanStage('');
    setDetectState('');
    setDiag(null);
    if (uploadRef.current) uploadRef.current.value = '';
    onFileChange?.(null);
    onExtract?.(null);
  };

  const runOcr = async (file) => {
    setStatus('scanning');
    setScanStage('Preparing image...');
    setError('');
    setReview(null);
    setDetectState('');
    setDiag(null);
    try {
      const res = await runReceiptOcr(file, setScanStage);
      const r = res.receipt;
      const t = res.tiers || {};
      const fs = res.fieldStates || {};
      const stateOf = (snake) => fs[snake] || null;
      setReview({
        station: r.fuelStation, fuelProduct: r.fuelProduct, fuelType: r.fuelType, date: r.date,
        time: r.time, odometer: r.odometer, liters: r.liters, price: r.pricePerLiter,
        total: r.totalAmount, ref: r.referenceNumber,
        tiers: t, fieldStates: fs, receiptStatus: res.receiptStatus || null, validation: res.validation,
        debug: res.debug || null,
        stateOf,
      });
      // Map the structured receipt into the EXISTING form state (snake_case).
      // Garbage never arrives here: failed validation returns null fields.
      // fieldStates + receiptStatus travel along so the form can gate Save
      // until every required field is verified or manually corrected.
      onExtract?.({
        fuel_station: r.fuelStation ?? null,
        fuel_product: r.fuelProduct ?? null,
        fuel_type: r.fuelType ?? null,
        record_date: r.date ?? null,
        record_time: r.time ?? null,
        odometer_reading: r.odometer ?? null,
        liters: r.liters ?? null,
        price_per_liter: r.pricePerLiter ?? null,
        receipt_reference: r.referenceNumber ?? null,
        receipt_total: r.totalAmount ?? null,
        tiers: t,
        fieldStates: fs,
        receiptStatus: res.receiptStatus || null,
        validation: res.validation,
      });
      setStatus('');
      const present = ['fuelStation', 'fuelProduct', 'fuelType', 'date', 'liters', 'pricePerLiter', 'totalAmount', 'referenceNumber']
        .filter((k) => r[k] !== null && r[k] !== undefined).length;
      // Receipt-level status from the parser drives the banner; the legacy
      // detectState mirrors it for any external consumers.
      const rs = res.receiptStatus || (present >= 3 ? 'DETECTED' : present >= 1 ? 'PARTIAL' : 'NOT_DETECTED');
      setDetectState(rs === 'DETECTED' ? 'success' : rs === 'PARTIAL' ? 'partial' : 'unreadable');
      // "Detected" never means "all fields extracted": flag the review
      // banner when any required field still needs verification.
      const requiredKeys = ['fuel_type', 'liters', 'price_per_liter', 'total_amount', 'record_date', 'receipt_reference'];
      const needsReview = requiredKeys.some((k) => {
        const st = fs[k]?.status;
        return st !== 'VERIFIED';
      });
      setReview((prev) => (prev ? { ...prev, needsReview } : prev));
      if (present < 1) {
        setDiag({ attempts: res.raw?.passes || [], chars: res.raw?.chars || 0, error: null });
        setError(DEV
          ? `OCR Processing Failed\n\nNo receipt fields detected.\nOCR characters detected: ${res.raw?.chars || 0}\nPlease check the browser console and backend logs.`
          : `Receipt could not be read. ${OCR_EMPTY}`);
        onExtract?.(null);
      }
    } catch (e) {
      const reason = e?.message || String(e);
      console.error('OCR failed:', e);
      setStatus('');
      setDetectState('unreadable');
      setDiag({ attempts: [], chars: 0, error: reason });
      setError(DEV
        ? `OCR Processing Failed\n\nReason: ${reason}\nOCR characters detected: 0\nPlease check the browser console and backend logs.`
        : `Receipt could not be read. ${OCR_EMPTY}`);
      onExtract?.(null);
    }
  };

  // SINGLE shared pipeline: Receipt Image → OCR → Review/Edit → Attach.
  const ingestFile = (file, from) => {
    const problem = validateReceiptFile(file);
    if (problem) {
      setStatus('error');
      setError(problem);
      return;
    }
    clearPreview();
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    setPreview(url);
    setFileName(file.name);
    setSource(from);
    onFileChange?.(file);
    runOcr(file);
  };

  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    ingestFile(file, 'file');
  };

  const useThisReceipt = () => {
    if (!capturedBlob.current) return;
    const file = new File([capturedBlob.current], `receipt-photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
    if (captured) URL.revokeObjectURL(captured);
    setCaptured(null);
    capturedBlob.current = null;
    setCameraOpen(false);
    ingestFile(file, 'camera');
  };

  const retakeOrAnother = () => {
    if (source === 'camera') openCamera();
    else uploadRef.current?.click();
  };

  return (
    <div className="rounded-2xl border-2 border-dashed border-purple-200 bg-purple-50/60 p-3 space-y-3">
      <p onClick={tapDebug} title="Scan / Upload Receipt"
        className="text-xs font-extrabold text-purple-900 uppercase tracking-wider text-center select-none">Scan / Upload Receipt</p>

      {!preview && (
        <div className="rounded-xl bg-white border border-purple-100 p-3 space-y-2">
          <button type="button" onClick={openCamera}
            className="w-full min-h-[52px] rounded-xl bg-purple-700 text-white text-sm font-bold shadow hover:bg-purple-800 active:scale-[0.99] transition">
            📷 Take Picture
          </button>
          <button type="button" onClick={() => uploadRef.current?.click()}
            className="w-full min-h-[52px] rounded-xl bg-white text-purple-800 text-sm font-bold border-2 border-purple-300 shadow-sm hover:bg-purple-50 active:scale-[0.99] transition">
            📁 Choose File
          </button>
          <p className="text-[11px] text-slate-500 text-center">JPG, JPEG, PNG, WEBP • 10 MB</p>
        </div>
      )}
      <input ref={uploadRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="hidden" onChange={pick} />

      {preview && (
        <div className="space-y-2">
          <p className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">Receipt Preview</p>
          <img src={preview} alt="Receipt preview" className="w-full max-h-64 object-contain rounded-xl border border-slate-200 bg-white" />
          <p className="text-[11px] text-slate-500 truncate">{fileName}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={retakeOrAnother}
              className="min-h-[44px] rounded-xl bg-white text-purple-800 text-xs font-bold border border-purple-300">
              ↻ {source === 'camera' ? 'Retake' : 'Choose Another'}
            </button>
            <button type="button" onClick={remove}
              className="min-h-[44px] rounded-xl bg-white text-rose-700 text-xs font-bold border border-rose-200">
              ✕ Remove Receipt
            </button>
          </div>
        </div>
      )}

      {status === 'scanning' && (
        <div className="flex items-center gap-2 rounded-xl bg-white border border-purple-200 p-3">
          <div className="w-5 h-5 border-[3px] border-purple-200 border-t-purple-700 rounded-full animate-spin shrink-0" />
          <p className="text-xs font-bold text-purple-900">{scanStage || 'Scanning receipt...'}</p>
        </div>
      )}
      {detectState === 'success' && !review?.needsReview && (
        <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">Receipt detected. Please review the extracted information.</p>
      )}
      {(detectState === 'partial' || (detectState === 'success' && review?.needsReview)) && (
        <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
          {['liters', 'price_per_liter', 'total_amount'].some((k) => review?.fieldStates?.[k]?.status !== 'VERIFIED')
            ? 'Some handwritten values could not be reliably recognized. Please verify the highlighted fields.'
            : 'Some receipt values could not be reliably read. Please verify the highlighted fields.'}
        </p>
      )}
      {detectState === 'unreadable' && error && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3 whitespace-pre-line">{error}</p>
          {DEV && diag?.attempts?.length > 0 && (
            <div className="rounded-xl bg-white border border-slate-200 p-3 text-[11px] space-y-1">
              <p className="font-extrabold text-slate-700 uppercase tracking-wider">OCR diagnostics (dev)</p>
              {diag.attempts.map((a) => (
                <p key={a.name} className="text-slate-600">
                  <b>{a.name}:</b> {a.chars} chars, {a.fields} fields{a.engineConf !== null && a.engineConf !== undefined ? `, engine ${a.engineConf}%` : ''}{a.error ? ` — error: ${a.error}` : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {status === 'error' && error && detectState !== 'unreadable' && (
        <p className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">{error}</p>
      )}

      {review && (
        <div className="rounded-xl bg-white border border-purple-200 p-3 text-xs space-y-1">
          <p className="font-extrabold text-slate-800 text-sm">🧾 Extracted Receipt Information</p>
          <p className="text-slate-500">Review and correct any value before saving.</p>
          <SectionTitle>Receipt Detection</SectionTitle>
          <p className="flex items-center justify-between gap-2 rounded-lg px-2 py-1">
            <span><b>Receipt Status:</b> {review.receiptStatus === 'DETECTED' ? 'DETECTED' : review.receiptStatus === 'PARTIAL' ? 'PARTIAL' : 'DETECTED'}</span>
            <span className="text-[10px] font-extrabold text-emerald-600 uppercase">✓ Receipt found</span>
          </p>
          <SectionTitle>Fuel Information</SectionTitle>
          <ReviewRow label="Fuel Station" display={review.station} fieldState={review.stateOf?.('fuel_station')} />
          <ReviewRow label="Fuel Product" display={review.fuelProduct} fieldState={review.stateOf?.('fuel_product')} />
          <ReviewRow label="Fuel Type" display={review.fuelType} fieldState={review.stateOf?.('fuel_type')} />
          <ReviewRow label="Liters" display={review.liters !== null && review.liters !== undefined ? `${review.liters} L` : null} fieldState={review.stateOf?.('liters')} />
          <ReviewRow label="Price/Liter" display={review.price !== null && review.price !== undefined ? formatCurrencyPHP(review.price) : null} fieldState={review.stateOf?.('price_per_liter')} />
          <SectionTitle>Transaction Information</SectionTitle>
          <ReviewRow label="Total Amount" display={review.total !== null && review.total !== undefined ? formatCurrencyPHP(review.total) : null} fieldState={review.stateOf?.('total_amount')} />
          <ReviewRow
            label="Date"
            display={review.date ? `${review.date}${review.time ? ` ${review.time}` : ''}` : null}
            fieldState={review.stateOf?.('record_date')}
          />
          <ReviewRow label="OR/Reference No." display={review.ref} fieldState={review.stateOf?.('receipt_reference')} />
          {review.odometer !== null && review.odometer !== undefined && (
            <ReviewRow label="Odometer" display={`${review.odometer} km`} fieldState={review.stateOf?.('odometer_reading')} />
          )}
          {review.validation?.checked && !review.validation?.totalMatches && (
            <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 font-semibold">Receipt values need verification.</p>
          )}
          {review.date && dateWarning(review.date) && (
            <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 font-semibold">{dateWarning(review.date)}</p>
          )}
        </div>
      )}

      {debugOn && review?.debug && (
        <OcrDebugPanel debug={review.debug} previewUrl={preview} />
      )}

      {cameraOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/80 p-4" role="dialog" aria-label="Camera scanner">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-800">📷 Take Picture</h3>
              <button type="button" onClick={closeCamera} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 font-bold">✕</button>
            </div>
            <div className="p-4 space-y-3">
              {cameraError ? (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">{cameraError}</p>
                  <button type="button" onClick={closeCamera} className="btn-gray btn w-full min-h-[48px]">Use Choose File Instead</button>
                </div>
              ) : captured ? (
                <div className="space-y-3">
                  <img src={captured} alt="Captured receipt" className="w-full max-h-72 object-contain rounded-xl border border-slate-200 bg-slate-50" />
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={retakePhoto} className="min-h-[48px] rounded-xl bg-white text-purple-800 text-sm font-bold border border-purple-300">↻ Retake</button>
                    <button type="button" onClick={useThisReceipt} className="min-h-[48px] rounded-xl bg-purple-700 text-white text-sm font-bold">✓ Use This Receipt</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-[3/4] max-h-[60vh] w-full">
                    <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />
                    {!cameraReady && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-white text-xs font-bold">Starting camera...</p>
                      </div>
                    )}
                  </div>
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" onClick={switchCamera} className="min-h-[48px] rounded-xl bg-white text-purple-800 text-xs font-bold border border-purple-300">🔄 Switch Camera</button>
                    <button type="button" onClick={takePhoto} disabled={!cameraReady} className="min-h-[48px] rounded-xl bg-purple-700 text-white text-sm font-bold disabled:opacity-50">📸 Take Photo</button>
                    <button type="button" onClick={closeCamera} className="min-h-[48px] rounded-xl bg-white text-slate-700 text-xs font-bold border border-slate-300">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
