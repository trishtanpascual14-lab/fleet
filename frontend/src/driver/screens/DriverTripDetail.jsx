import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api';
import { StatusBadge, Toast } from '../../components/ui';
import { useGpsTracking, getCurrentPosition } from '../useGpsTracking';
import TripRouteMap from '../TripRouteMap';
import { isValidLatLng } from '../mapUtils';
import SosButton from '../../components/SosButton';

/**
 * Trip Details screen for `/driver/trips/:id` (backend ownership-enforced).
 * Shows the trip's own pickup/drop-off addresses, a route map built only
 * from stored coordinates (never invented), vehicle, driver, date/time,
 * and the START / IN PROGRESS / COMPLETED action states.
 */
export default function DriverTripDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [trip, setTrip] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tilesDown, setTilesDown] = useState(false);
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/trips/${id}`);
      setTrip(data.data);
    } catch (err) {
      show(err.response?.data?.message || 'Failed to load trip', 'error');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const isActive = trip && ['In Transit', 'Arrived'].includes(trip.trip_status);
  const canStart = trip && ['Scheduled', 'Dispatched'].includes(trip.trip_status);
  const isDone = trip && trip.trip_status === 'Completed';
  const { pos, gpsOn, gpsError, lastUpdate } = useGpsTracking(isActive ? trip : null);

  const ping = async (status) => {
    try {
      const p = await getCurrentPosition();
      await api.post('/tracking/location', {
        vehicle_id: trip.vehicle_id,
        driver_id: trip.driver_id,
        trip_id: trip.id,
        latitude: p.coords.latitude,
        longitude: p.coords.longitude,
        speed_kmh: p.coords.speed != null ? +((p.coords.speed * 3.6).toFixed(1)) : 0,
        status,
      });
    } catch (e) {
      show(e.message || 'Could not get GPS location', 'error');
      throw e;
    }
  };

  const startTrip = async () => {
    if (!confirm('Start this trip and begin navigation?')) return;
    setBusy(true);
    try {
      await ping('trip_start'); // location permission + start coordinates first
      await api.patch(`/trips/${id}/status`, { trip_status: 'In Transit' });
      show('Trip started — opening navigation');
      nav(`/driver/navigate/${id}`);
    } catch (err) {
      if (err.response) show(err.response?.data?.message || 'Start failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const completeTrip = async () => {
    if (!confirm('Are you sure you want to complete this trip?')) return;
    setBusy(true);
    try {
      await ping('trip_end'); // final location before closing
      await api.patch(`/trips/${id}/status`, { trip_status: 'Completed' });
      show('Trip completed');
      nav('/driver/trips');
    } catch (err) {
      if (err.response) show(err.response?.data?.message || 'Complete failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const pickupText = trip?.pickup_location || trip?.route_origin || '—';
  const dropoffText = trip?.destination || trip?.route_destination || '—';
  // memoized so marker layers aren't rebuilt on every parent re-render
  const pickupPin = useMemo(() => (
    trip && isValidLatLng(trip.origin_lat, trip.origin_lng)
      ? { lat: +trip.origin_lat, lng: +trip.origin_lng, label: pickupText } : null
  ), [trip, pickupText]);
  const dropoffPin = useMemo(() => (
    trip && isValidLatLng(trip.destination_lat, trip.destination_lng)
      ? { lat: +trip.destination_lat, lng: +trip.destination_lng, label: dropoffText } : null
  ), [trip, dropoffText]);
  const hasRouteMap = Boolean(pickupPin && dropoffPin);
  const livePin = isActive && pos ? { lat: +pos.latitude, lng: +pos.longitude } : null;

  if (!trip) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-10 h-10 border-4 border-purple-200 border-t-[#6023d5] rounded-full animate-spin" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full max-w-full overflow-hidden">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-extrabold text-slate-900 text-lg truncate">TRIP #{trip.trip_code || trip.id}</p>
        <span className="ml-auto shrink-0"><StatusBadge value={trip.trip_status} /></span>
      </div>
      {isActive && (
        <div className="bg-emerald-600 text-white rounded-2xl px-4 py-3 flex items-center gap-2 font-extrabold text-sm tracking-wide shadow-md">
          <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
          ● TRIP IN PROGRESS — GPS TRACKING ACTIVE
        </div>
      )}
      {isDone && (
        <div className="bg-slate-900 text-white rounded-2xl px-4 py-3 font-extrabold text-sm tracking-wide text-center">
          ✓ TRIP COMPLETED
        </div>
      )}

      {/* Pickup / drop-off addresses from this trip's own record */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 space-y-3">
        <div>
          <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">Pickup Location</p>
          <p className="text-sm font-bold text-slate-800 mt-1 break-words">📍 {pickupText}</p>
        </div>
        <div className="flex justify-center" aria-hidden="true">
          <span className="text-purple-400 text-xl font-bold">↓</span>
        </div>
        <div>
          <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">Drop-off Location</p>
          <p className="text-sm font-bold text-slate-800 mt-1 break-words">📍 {dropoffText}</p>
        </div>
      </div>

      {/* Route map — always renders the base map; pins only from stored coords */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3">
        <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider px-1 pb-2">Map</p>
        <TripRouteMap pickup={pickupPin} dropoff={dropoffPin} current={livePin} onTileError={() => setTilesDown(true)} />
        <div className="flex gap-4 px-1 pt-2 text-xs font-semibold text-slate-500 flex-wrap">
          {pickupPin && <span>🟢 Pickup</span>}
          {dropoffPin && <span>🔴 Drop-off</span>}
          {livePin && <span>🔵 Current location</span>}
          {!hasRouteMap && <span>Exact pins unavailable — addresses shown above.</span>}
        </div>
        {tilesDown && (
          <p className="text-[11px] text-amber-600 font-semibold px-1 pt-1">Map tiles unavailable (offline?) — trip data above is unaffected.</p>
        )}
      </div>

      {/* Vehicle / driver / date-time */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4">
        <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">Vehicle</p>
        <p className="text-sm font-bold text-slate-800 mt-1 break-words">
          {trip.plate_number || `#${trip.vehicle_id}`} • {trip.vehicle_type || '—'} • ⛽ {trip.vehicle_fuel_type || '—'}
        </p>
        <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mt-3">Driver</p>
        <p className="text-sm font-bold text-slate-800 mt-1 break-words">{trip.driver_name || '—'}</p>
        <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mt-3">Date &amp; Time</p>
        <div className="text-sm text-slate-600 mt-1 space-y-0.5 break-words">
          <p>🕒 Scheduled: {trip.departure_datetime || trip.created_at || '—'}</p>
          {(isActive || isDone) && <p>▶ Trip start: {trip.departure_datetime || '—'}</p>}
          {isDone && <p>⏹ Trip end: {trip.arrival_datetime || '—'}</p>}
        </div>
        {isActive && (
          <div className="text-sm text-slate-600 mt-2 space-y-0.5 break-words border-t border-slate-100 pt-2">
            <p>📡 Current location: {pos ? `${(+pos.latitude).toFixed(6)}, ${(+pos.longitude).toFixed(6)}` : 'Waiting for GPS…'}</p>
            <p>🛰️ GPS status: <b className={gpsOn ? 'text-emerald-600' : 'text-slate-500'}>{gpsOn ? 'Tracking' : gpsError || 'Acquiring…'}</b></p>
            <p>🔄 Last GPS update: {lastUpdate ? lastUpdate.toLocaleTimeString() : '—'}</p>
          </div>
        )}
      </div>

      <SosButton tripId={trip?.id || null} />

      <div className="space-y-2.5">
        <button type="button" onClick={() => nav(`/driver/navigate/${id}`)} className="w-full min-h-[52px] rounded-2xl bg-slate-900 text-white text-base font-extrabold tracking-wide active:scale-[0.99] transition">
          VIEW ROUTE
        </button>
        {canStart && (
          <button type="button" onClick={startTrip} disabled={busy} className="w-full min-h-[52px] rounded-2xl bg-[#6023d5] text-white text-base font-extrabold tracking-wide active:bg-[#4f22c6] active:scale-[0.99] transition shadow-lg shadow-purple-200 disabled:opacity-50">
            {busy ? 'Starting…' : 'START TRIP'}
          </button>
        )}
        {isActive && (
          <>
            <button type="button" onClick={() => nav('/driver/map')} className="w-full min-h-[52px] rounded-2xl bg-slate-900 text-white text-base font-extrabold tracking-wide active:scale-[0.99] transition">
              VIEW LIVE LOCATION
            </button>
            <button type="button" onClick={completeTrip} disabled={busy} className="w-full min-h-[52px] rounded-2xl bg-emerald-600 text-white text-base font-extrabold tracking-wide active:bg-emerald-700 active:scale-[0.99] transition shadow-lg shadow-emerald-200 disabled:opacity-50">
              {busy ? 'Completing…' : 'COMPLETE TRIP'}
            </button>
          </>
        )}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
