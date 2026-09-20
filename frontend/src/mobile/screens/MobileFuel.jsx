import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import MobileFuelForm from '../MobileFuelForm';
import ReceiptAttachment from '../ReceiptAttachment';
import { MobileCard } from '../cards';
import { Toast } from '../../components/ui';

/**
 * Mobile fuel screen — entry form (existing `/fuel` API) + recent records.
 */
export default function MobileFuel() {
  const [vehicles, setVehicles] = useState([]);
  const [recent, setRecent] = useState([]);
  const [toast, setToast] = useState(null);

  const loadRecent = useCallback(async () => {
    try {
      const { data } = await api.get('/fuel', { params: { limit: 10 } });
      setRecent(data.data || []);
    } catch (err) {
      setToast({ msg: err.response?.data?.message || 'Failed to load fuel records', type: 'error' });
      setTimeout(() => setToast(null), 2500);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/vehicles', { params: { limit: 100 } });
        setVehicles(data.data || []);
      } catch { /* form still renders; vehicle list may be empty */ }
      loadRecent();
    })();
  }, [loadRecent]);

  return (
    <div className="space-y-4 w-full max-w-full overflow-hidden">
      <MobileFuelForm vehicles={vehicles} onSaved={loadRecent} />

      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">Recent Transactions</p>
        <div className="space-y-2">
          {recent.map((f) => (
            <MobileCard key={f.id}>
              <div className="flex items-center gap-2 flex-wrap">
                <b className="text-sm truncate">{f.fuel_code}</b>
                <span className="ml-auto text-sm font-extrabold text-slate-900 shrink-0">₱{f.total_cost}</span>
              </div>
              <p className="text-xs text-slate-500 mt-1 break-words">
                {f.plate_number || '—'} • {f.liters} L • ₱{f.price_per_liter}/L • {f.record_date}
              </p>
              {f.receipt_path && (
                <div className="mt-2"><ReceiptAttachment record={f} /></div>
              )}
            </MobileCard>
          ))}
          {!recent.length && (
            <MobileCard><p className="text-xs text-slate-400">No fuel transactions yet.</p></MobileCard>
          )}
        </div>
      </div>
      <Toast toast={toast} />
    </div>
  );
}
