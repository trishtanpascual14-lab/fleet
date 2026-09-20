import { useEffect, useState } from 'react';
import api from '../services/api';

const fmtSize = (b) => {
  if (b === null || b === undefined) return '';
  if (+b < 1024) return `${b} B`;
  if (+b < 1024 * 1024) return `${(+b / 1024).toFixed(1)} KB`;
  return `${(+b / 1024 / 1024).toFixed(2)} MB`;
};

/**
 * "Receipt Attachment" block for a saved fuel transaction: thumbnail,
 * metadata, View Receipt and Download Receipt (all via authenticated API).
 */
export default function ReceiptAttachment({ record }) {
  const [thumb, setThumb] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!record?.receipt_path) return;
    let url = null;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get(`/fuel/${record.id}/receipt`, { responseType: 'blob' });
        url = URL.createObjectURL(r.data);
        if (!cancelled) setThumb(url);
        else URL.revokeObjectURL(url);
      } catch {
        if (!cancelled) setError('Could not load receipt preview.');
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [record?.id, record?.receipt_path]);

  if (!record?.receipt_path) return null;

  const fetchBlob = async (download) => {
    setError('');
    try {
      const r = await api.get(`/fuel/${record.id}/receipt${download ? '?download=1' : ''}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      if (download) {
        const a = document.createElement('a');
        a.href = url;
        a.download = record.receipt_original_name || `receipt-${record.id}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch {
      setError('Could not load the receipt. Please try again.');
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
      <p className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">🧾 Receipt Attachment</p>
      {thumb && (
        <img src={thumb} alt="Receipt attachment" className="w-full max-h-48 object-contain rounded-lg border border-slate-200 bg-white" />
      )}
      <p className="text-[11px] text-slate-500 break-words">
        {record.receipt_original_name || 'Receipt image'}
        {record.receipt_size ? ` • ${fmtSize(record.receipt_size)}` : ''}
        {record.receipt_uploaded_at ? ` • ${String(record.receipt_uploaded_at).slice(0, 16).replace('T', ' ')}` : ''}
      </p>
      {error && <p className="text-[11px] font-semibold text-rose-600">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => fetchBlob(false)}
          className="min-h-[44px] rounded-xl bg-white text-purple-800 text-xs font-bold border border-purple-300">
          👁 View Receipt
        </button>
        <button type="button" onClick={() => fetchBlob(true)}
          className="min-h-[44px] rounded-xl bg-purple-700 text-white text-xs font-bold">
          ⬇ Download Receipt
        </button>
      </div>
    </div>
  );
}
