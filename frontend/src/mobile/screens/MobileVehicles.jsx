import { useEffect, useState } from 'react';
import api from '../../services/api';
import { MobileVehicleCard } from '../cards';
import { Empty, Modal, Toast } from '../../components/ui';

/**
 * Mobile vehicle list — real `/vehicles` records, tap for detail.
 */
export default function MobileVehicles() {
  const [rows, setRows] = useState([]);
  const [view, setView] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/vehicles', { params: { limit: 50 } });
        setRows(data.data || []);
      } catch (err) {
        setToast({ msg: err.response?.data?.message || 'Failed to load vehicles', type: 'error' });
        setTimeout(() => setToast(null), 2500);
      }
    })();
  }, []);

  const openView = async (v) => {
    try {
      const { data } = await api.get(`/vehicles/${v.id}`);
      setView(data.data);
    } catch { setView(v); }
  };

  return (
    <div className="space-y-3 w-full max-w-full overflow-hidden">
      {rows.map((v) => (
        <MobileVehicleCard key={v.id} vehicle={v} onView={openView} />
      ))}
      {!rows.length && <Empty msg="No vehicles found" />}

      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${view.vehicle_code || ''} ${view.plate_number || ''}` : ''}>
        {view && (
          <div className="text-sm space-y-2 break-words">
            <p><b>Vehicle name:</b> {view.vehicle_code || '—'}</p>
            <p><b>Plate number:</b> {view.plate_number || '—'}</p>
            <p><b>Vehicle type:</b> {view.vehicle_type || '—'}</p>
            <p><b>Fuel type:</b> {view.fuel_type || '—'}</p>
            <p><b>Status:</b> {view.status || '—'}</p>
            <p><b>Capacity:</b> {view.capacity != null ? `${view.capacity} kg` : '—'}</p>
            <p><b>Registration:</b> {view.registration_number || '—'}{view.registration_expiry ? ` (expires ${view.registration_expiry})` : ''}</p>
            {view.notes && <p><b>Notes:</b> {view.notes}</p>}
          </div>
        )}
      </Modal>
      <Toast toast={toast} />
    </div>
  );
}
