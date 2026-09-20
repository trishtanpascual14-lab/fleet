import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '../components/ui';

/**
 * Reusable mobile cards — white, rounded, soft shadow, purple accents,
 * 44px+ touch targets, no horizontal overflow (truncate + wrap).
 */

export function MobileCard({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 w-full max-w-full overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

export function MobileStatusCard({ icon, label, value, sub, to }) {
  const nav = useNavigate();
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span className="w-10 h-10 rounded-2xl bg-purple-100/80 text-[#6023d5] flex items-center justify-center text-lg shrink-0" aria-hidden="true">
          {icon}
        </span>
        <p className="text-xs font-semibold text-slate-500 truncate">{label}</p>
        {to && (
          <span className="ml-auto text-lg font-bold text-slate-300 shrink-0" aria-hidden="true">›</span>
        )}
      </div>
      <p className="text-2xl font-extrabold text-slate-900 tracking-tight mt-2 break-words">{value}</p>
      {sub && <p className="text-xs text-slate-400 font-medium mt-0.5 break-words">{sub}</p>}
    </>
  );

  if (!to) return <MobileCard>{body}</MobileCard>;
  return (
    <button
      type="button"
      onClick={() => nav(to)}
      aria-label={`${label}: ${value} — open ${label}`}
      className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 w-full max-w-full overflow-hidden text-left min-h-[44px] active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50"
    >
      {body}
    </button>
  );
}

export function MobileTripCard({ trip, onView }) {
  return (
    <MobileCard>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-extrabold text-slate-900 text-sm truncate">{trip.trip_code || `Trip #${trip.id}`}</p>
        <span className="ml-auto shrink-0"><StatusBadge value={trip.trip_status} /></span>
      </div>
      <p className="text-sm font-semibold text-slate-700 mt-1.5 break-words">
        {trip.pickup_location} → {trip.destination}
      </p>
      <p className="text-xs text-slate-500 mt-1 break-words">
        🚚 {trip.plate_number || trip.vehicle_code || `Vehicle #${trip.vehicle_id}`} • 🧑‍✈️ {trip.driver_name || trip.full_name || `Driver #${trip.driver_id}`}
      </p>
      <p className="text-xs text-slate-400 mt-0.5">
        🕒 {trip.departure_datetime || trip.schedule || trip.created_at || '—'}
      </p>
      <button
        type="button"
        onClick={() => onView?.(trip)}
        className="mt-3 w-full min-h-[44px] rounded-xl bg-[#6023d5] text-white text-sm font-bold active:bg-[#4f22c6] active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50"
      >
        VIEW DETAILS
      </button>
    </MobileCard>
  );
}

export function MobileVehicleCard({ vehicle, onView }) {
  return (
    <button
      type="button"
      onClick={() => onView?.(vehicle)}
      aria-label={`${vehicle.plate_number} — view details`}
      className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 w-full max-w-full overflow-hidden text-left min-h-[44px] active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50"
    >
      <div className="flex items-center gap-2.5">
        <span className="w-11 h-11 rounded-2xl bg-purple-100/80 text-[#6023d5] flex items-center justify-center text-xl shrink-0" aria-hidden="true">🚚</span>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-slate-900 text-sm truncate">{vehicle.vehicle_code || vehicle.plate_number}</p>
          <p className="text-xs text-slate-500 font-semibold truncate">{vehicle.plate_number}</p>
        </div>
        <span className="shrink-0"><StatusBadge value={vehicle.status} /></span>
      </div>
      <p className="text-xs text-slate-500 mt-2 break-words">
        {vehicle.vehicle_type || '—'} • ⛽ {vehicle.fuel_type || '—'}
        {vehicle.driver_name ? ` • 🧑‍✈️ ${vehicle.driver_name}` : ''}
      </p>
    </button>
  );
}
