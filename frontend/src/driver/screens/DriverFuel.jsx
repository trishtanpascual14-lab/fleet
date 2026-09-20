import { useEffect, useState } from 'react';
import api from '../../services/api';
import MobileFuelForm from '../../mobile/MobileFuelForm';
import ReceiptAttachment from '../../mobile/ReceiptAttachment';
import { Toast } from '../../components/ui';

/**
 * Driver fuel screen — records fuel for the driver's own assigned
 * vehicle only (backend validates ownership). Same `/fuel` API/table.
 */
export default function DriverFuel() {
  const [vehicle, setVehicle] = useState(null);
  const [recent, setRecent] = useState([]);
  const [toast, setToast] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get('/drivers/me');
      const v = data.data.assigned_vehicle_id
        ? { id: data.data.assigned_vehicle_id, plate_number: data.data.assigned_vehicle_plate, fuel_type: data.data.assigned_vehicle_fuel }
        : null;
      setVehicle(v);
      const f = await api.get('/fuel', { params: { limit: 10 } });
      setRecent(f.data.data || []);
    } catch (err) {
      setToast({ msg: err.response?.data?.message || 'Failed to load fuel data', type: 'error' });
      setTimeout(() => setToast(null), 2500);
    }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4 w-full max-w-full overflow-hidden">
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Authorized Vehicle</p>
        <p className="font-extrabold text-slate-900 mt-1 break-words">
          {vehicle ? `${vehicle.plate_number}` : 'No vehicle assigned'}
        </p>
      </div>

      {vehicle
        ? <MobileFuelForm vehicles={[vehicle]} onSaved={load} />
        : (
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 text-center">
            <p className="text-sm text-slate-500">Fuel recording unlocks once a vehicle is assigned to you.</p>
          </div>
        )}

      {recent.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">My Recent Fuel Records</p>
          <div className="space-y-2">
            {recent.map((f) => (
              <div key={f.id} className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <b className="text-sm truncate">{f.fuel_code}</b>
                  <span className="ml-auto text-sm font-extrabold text-slate-900 shrink-0">₱{f.total_cost}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1 break-words">{f.liters} L • {f.record_date} • {f.fuel_station || '—'}</p>
                {f.receipt_path && (
                  <div className="mt-2"><ReceiptAttachment record={f} /></div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <Toast toast={toast} />
    </div>
  );
}
