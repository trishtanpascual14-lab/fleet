import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

// Location autocomplete: type a place/warehouse/street/city → pick a
// suggestion. The selected value carries { name, address, lat, lon } so the
// dispatcher never types coordinates. Parent must require a non-null value
// before calculating ("Please select a valid location from the search suggestions").
export default function LocationSearch({ value, onSelect, placeholder = '🔍 Search location...', error }) {
  const [text, setText] = useState(value?.name || '');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const box = useRef(null);

  useEffect(() => { setText(value?.name || ''); }, [value?.name]);
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const search = (q) => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setItems([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const { data } = await api.get('/routes/places', { params: { q } });
        setItems(data.data || []); setOpen(true);
      } catch { setItems([]); }
      finally { setBusy(false); }
    }, 400);
  };

  const pick = (p) => {
    onSelect({ name: p.name, address: p.address, lat: p.lat, lon: p.lon });
    setText(p.name); setOpen(false);
  };

  return (
    <div className="relative" ref={box}>
      <input
        className={`input pr-8 ${error ? 'border-red-500' : ''} ${value ? 'border-emerald-400' : ''}`}
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { setText(e.target.value); onSelect(null); search(e.target.value); }}
        onFocus={() => { if (items.length) setOpen(true); }}
      />
      <span className="absolute right-2.5 top-2 text-slate-400 text-sm">{busy ? '…' : value ? '✅' : '🔍'}</span>
      {open && items.length > 0 && (
        <ul className="absolute z-30 w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-56 overflow-auto">
          {items.map((p, i) => (
            <li key={i}>
              <button type="button" className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100" onClick={() => pick(p)}>
                <span className="text-sm font-semibold">📍 {p.name}</span>
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{p.source === 'local' ? 'Fleet place' : 'Map search'}</span>
                <span className="block text-xs text-slate-500 truncate">{p.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && text.trim().length >= 2 && !busy && !items.length && (
        <div className="absolute z-30 w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-1 px-3 py-2 text-xs text-slate-500">
          No matching location. Try another name or spelling.
        </div>
      )}
      {value?.address && <p className="text-[11px] text-slate-500 mt-1 truncate" title={value.address}>{value.address}</p>}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
