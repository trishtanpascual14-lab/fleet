import { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { MobileTripCard } from '../cards';
import { Empty, Modal, Toast } from '../../components/ui';

/**
 * Mobile trips list — real trip records, card UI with view-details modal.
 * Drivers read their own trips via `/trips/mine`; other roles use `/trips`.
 */
export default function MobileTrips() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [view, setView] = useState(null);
  const [toast, setToast] = useState(null);

  const load = async () => {
    try {
      const endpoint = user?.role === 'driver' ? '/trips/mine' : '/trips';
      const { data } = await api.get(endpoint, { params: { limit: 20 } });
      setRows(data.data || []);
    } catch (err) {
      setToast({ msg: err.response?.data?.message || 'Failed to load trips', type: 'error' });
      setTimeout(() => setToast(null), 2500);
    }
  };
  useEffect(() => { load(); }, []);

  const openView = async (t) => {
    try {
      const { data } = await api.get(`/trips/${t.id}`);
      setView(data.data);
    } catch { setView(t); }
  };

  return (
    <div className="space-y-3 w-full max-w-full overflow-hidden">
      {rows.map((t) => (
        <MobileTripCard key={t.id} trip={t} onView={openView} />
      ))}
      {!rows.length && <Empty msg="No trips found" />}

      <Modal open={!!view} onClose={() => setView(null)} title={view ? `Trip ${view.trip_code || `#${view.id}`}` : ''}>
        {view && (
          <div className="text-sm space-y-2 break-words">
            <p><b>Origin:</b> {view.pickup_location}</p>
            <p><b>Destination:</b> {view.destination}</p>
            <p><b>Vehicle:</b> {view.plate_number || view.vehicle_code || `#${view.vehicle_id}`}</p>
            <p><b>Driver:</b> {view.driver_name || `#${view.driver_id}`}</p>
            <p><b>Schedule:</b> {view.departure_datetime || '—'}</p>
            <p><b>Status:</b> {view.trip_status} • <b>Delivery:</b> {view.delivery_status}</p>
          </div>
        )}
      </Modal>
      <Toast toast={toast} />
    </div>
  );
}
