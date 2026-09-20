import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../../services/api';
import { Toast } from '../../components/ui';
import { useGpsTracking, getCurrentPosition } from '../useGpsTracking';
import { MANILA_CENTER, isValidLatLng } from '../mapUtils';
import {
  fetchLeg, nearestOnRoute, cumulativeM, stepIndexForRouteIndex,
  haversineM, formatDist, formatRemain, formatETA, maneuverInfo,
} from './navEngine';

const ARRIVE_M = 50;      // arrival radius (m)
const OFFROUTE_M = 80;    // lateral deviation triggering recalculation
const MAX_POOR_ACC_M = 150; // above this, skip arrival/off-route decisions
const RECALC_MIN_MS = 15000;

function dot(color, emoji, size = 34) {
  return L.divIcon({
    className: 'nav-marker',
    html: `<div style="background:${color};color:#fff;border:3px solid #fff;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 5px rgba(0,0,0,.45)">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Waze-like driver navigation for one assigned trip (backend ownership-enforced).
 * CURRENT → PICKUP → DROP-OFF over the real OSRM road network with
 * turn-by-turn steps, live distance/ETA, off-route recalculation and
 * 50 m arrival detection. No GPS → map + addresses still render.
 */
export default function DriverNavigate() {
  const { id } = useParams();
  const nav = useNavigate();
  const [trip, setTrip] = useState(null);
  const [leg, setLeg] = useState('preview'); // preview | pickup | dropoff
  const [route, setRoute] = useState(null);
  const [routeErr, setRouteErr] = useState('');
  const [routeLoading, setRouteLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [manualPos, setManualPos] = useState(null);
  const [follow, setFollow] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);
  const [offRoute, setOffRoute] = useState(false);
  const [arrivedPickup, setArrivedPickup] = useState(false);
  const [arrivedDest, setArrivedDest] = useState(false);
  const show = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const mapDiv = useRef(null);
  const mapRef = useRef(null);
  const roadRef = useRef(null);
  const pinsRef = useRef(null);
  const meRef = useRef(null);
  const accRef = useRef(null);
  const suppressMove = useRef(false);
  const offCount = useRef(0);
  const lastRecalc = useRef(0);
  const forceNonce = useRef(0);

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
  const { pos: gpsPos, gpsError } = useGpsTracking(isActive ? trip : null);
  const pos = gpsPos || manualPos;
  const noGps = !('geolocation' in navigator) || (!!gpsError && !pos);

  const pickup = useMemo(() => (trip && isValidLatLng(trip.origin_lat, trip.origin_lng)
    ? { lat: +trip.origin_lat, lng: +trip.origin_lng, label: trip.pickup_location || trip.route_origin } : null), [trip]);
  const dropoff = useMemo(() => (trip && isValidLatLng(trip.destination_lat, trip.destination_lng)
    ? { lat: +trip.destination_lat, lng: +trip.destination_lng, label: trip.destination || trip.route_destination } : null), [trip]);
  const pickupText = trip?.pickup_location || trip?.route_origin || '—';
  const dropoffText = trip?.destination || trip?.route_destination || '—';

  // switch preview -> active legs once the trip is moving
  useEffect(() => {
    if (isActive) setLeg((l) => (l === 'preview' ? 'pickup' : l));
    else setLeg('preview');
  }, [isActive, trip?.trip_status]);

  const dest = leg === 'dropoff' ? dropoff : leg === 'pickup' ? pickup : dropoff; // preview shows full pickup->dropoff below
  const destKey = dest ? `${leg}:${dest.lat},${dest.lng}` : null;

  const calcRoute = useCallback(async (from, to, nonce) => {
    setRouteLoading(true);
    setRouteErr('');
    try {
      const r = await fetchLeg(from, to);
      if (forceNonce.current !== nonce) return; // superseded
      setRoute({ ...r, destKey: `${to.lat},${to.lng}`, nonce });
      setOffRoute(false);
      offCount.current = 0;
    } catch (e) {
      if (forceNonce.current !== nonce) return;
      setRoute(null);
      setRouteErr(e.message || 'Unable to calculate route.');
    } finally {
      if (forceNonce.current === nonce) setRouteLoading(false);
    }
  }, []);

  // (re)calculate when leg/destination changes, or on forced recalc
  useEffect(() => {
    if (!trip) return;
    let from, to;
    if (leg === 'preview') {
      if (!pickup || !dropoff) return;
      from = pickup; to = dropoff;
    } else {
      if (!dest) return;
      from = pos ? { lat: +pos.latitude, lng: +pos.longitude } : (leg === 'pickup' ? pickup : pickup);
      if (!from) return;
      to = dest;
    }
    const nonce = ++forceNonce.current;
    calcRoute(from, to, nonce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, leg, destKey, retryNonce]);

  const recalcFromHere = useCallback(() => {
    if (!pos || !dest || Date.now() - lastRecalc.current < RECALC_MIN_MS) return false;
    lastRecalc.current = Date.now();
    const nonce = ++forceNonce.current;
    calcRoute({ lat: +pos.latitude, lng: +pos.longitude }, dest, nonce);
    return true;
  }, [pos, dest, calcRoute]);

  // ---- map lifecycle (init once the trip — and therefore the map div — exists) ----
  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;
    const map = L.map(mapDiv.current, { zoomControl: false, scrollWheelZoom: false }).setView(MANILA_CENTER, 11);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    pinsRef.current = L.layerGroup().addTo(map);
    roadRef.current = L.layerGroup().addTo(map);
    map.on('movestart', () => {
      if (suppressMove.current) { suppressMove.current = false; return; }
      setFollow(false); // user took over — stop auto-centering until RECENTER
    });
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; };
  }, [!!trip]);

  // pins + road geometry on trip/route change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pinsRef.current || !roadRef.current) return;
    pinsRef.current.clearLayers();
    roadRef.current.clearLayers();
    const pts = [];
    if (pickup) {
      L.marker([pickup.lat, pickup.lng], { icon: dot('#16a34a', '🟢'), title: `Pickup: ${pickup.label || ''}` })
        .bindPopup(`<b>🟢 Pickup</b><br/>${pickup.label || ''}`).addTo(pinsRef.current);
      pts.push([pickup.lat, pickup.lng]);
    }
    if (dropoff) {
      L.marker([dropoff.lat, dropoff.lng], { icon: dot('#dc2626', '🔴'), title: `Drop-off: ${dropoff.label || ''}` })
        .bindPopup(`<b>🔴 Drop-off</b><br/>${dropoff.label || ''}`).addTo(pinsRef.current);
      pts.push([dropoff.lat, dropoff.lng]);
    }
    if (route?.geometry?.length) {
      L.polyline(route.geometry, { color: '#6023d5', weight: 5, opacity: 0.9 }).addTo(roadRef.current);
      pts.push(...route.geometry.filter((_, i) => i % 10 === 0));
    }
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 16 });
  }, [pickup, dropoff, route]);

  // live driver marker (moved, never recreated) + follow
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pos) return;
    const lat = +pos.latitude, lng = +pos.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (!meRef.current) {
      meRef.current = L.marker([lat, lng], { icon: dot('#2563eb', '🔵', 38), title: 'Current location', zIndexOffset: 500 }).addTo(map);
      accRef.current = L.circle([lat, lng], { radius: pos.accuracy || 0, color: '#2563eb', weight: 1, opacity: 0.4, fillOpacity: 0.08 }).addTo(map);
    } else {
      meRef.current.setLatLng([lat, lng]);
      accRef.current.setLatLng([lat, lng]).setRadius(pos.accuracy || 0);
    }
    if (follow) {
      suppressMove.current = true;
      map.setView([lat, lng], Math.max(map.getZoom(), 16));
    }
  }, [pos, follow]);

  // ---- navigation math on every fix ----
  const navi = useMemo(() => {
    if (!route?.geometry?.length || !pos || leg === 'preview') return null;
    const p = { lat: +pos.latitude, lng: +pos.longitude };
    const { index, lateralM } = nearestOnRoute(p, route.geometry);
    const cum = cumulativeM(route.geometry);
    const total = route.distanceM || cum[cum.length - 1] || 0;
    const covered = Math.min(cum[index] || 0, total);
    const remaining = Math.max(0, total - covered) + lateralM;
    const stepIdx = stepIndexForRouteIndex(index, route.steps, route.geometry.length);
    const stepCum = [0];
    for (const s of route.steps) stepCum.push(stepCum[stepCum.length - 1] + (s.distanceM || 0));
    const frac = total ? covered / total : 0;
    const upcomingIdx = Math.min(stepIdx + 1, route.steps.length - 1);
    const distToStep = Math.max(0, (stepCum[upcomingIdx] ?? total) - covered);
    const gpsMs = pos.speed != null && pos.speed > 1 ? pos.speed : null;
    const avgMs = route.durationS ? total / route.durationS : 8;
    const etaS = remaining / (gpsMs || avgMs);
    const speedKmh = gpsMs != null ? gpsMs * 3.6 : avgMs * 3.6;
    return { stepIdx, upcomingIdx, distToStep, remaining, etaS, speedKmh, lateralM,
      info: maneuverInfo(route.steps[upcomingIdx], distToStep),
      next: route.steps[upcomingIdx + 1] ? maneuverInfo(route.steps[upcomingIdx + 1]) : null };
  }, [route, pos, leg]);

  // arrival + off-route decisions (skip on poor accuracy)
  useEffect(() => {
    if (!isActive || !pos || leg === 'preview' || !dest) return;
    const acc = pos.accuracy;
    const reliable = acc == null || acc <= MAX_POOR_ACC_M;
    const d = haversineM({ lat: +pos.latitude, lng: +pos.longitude }, dest);
    if (reliable && d <= ARRIVE_M) {
      if (leg === 'pickup' && !arrivedPickup) setArrivedPickup(true);
      if (leg === 'dropoff' && !arrivedDest) setArrivedDest(true);
    }
    if (!route?.geometry?.length || !navi) return;
    if (reliable && navi.lateralM > OFFROUTE_M) {
      offCount.current += 1;
      if (offCount.current >= 2) {
        setOffRoute(true);
        if (recalcFromHere()) show("You're off route — recalculating…");
      }
    } else {
      offCount.current = 0;
      setOffRoute(false);
    }
  }, [pos, navi, route, isActive, leg, dest, arrivedPickup, arrivedDest, recalcFromHere]);

  const ping = async (status) => {
    const p = await getCurrentPosition();
    await api.post('/tracking/location', {
      vehicle_id: trip.vehicle_id, driver_id: trip.driver_id, trip_id: trip.id,
      latitude: p.coords.latitude, longitude: p.coords.longitude,
      speed_kmh: p.coords.speed != null ? +((p.coords.speed * 3.6).toFixed(1)) : 0,
      heading: p.coords.heading == null ? null : +(+p.coords.heading).toFixed(1),
      status,
    });
  };

  const startTrip = async () => {
    if (!confirm('Start this trip and begin navigation?')) return;
    setBusy(true);
    try {
      await ping('trip_start');
      await api.patch(`/trips/${id}/status`, { trip_status: 'In Transit' });
      await load();
      show('Trip started — navigation active');
    } catch (err) {
      show(err.response?.data?.message || err.message || 'Start failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const completeTrip = async () => {
    if (!confirm('Are you sure you want to complete this trip?')) return;
    setBusy(true);
    try {
      await ping('trip_end');
      await api.patch(`/trips/${id}/status`, { trip_status: 'Completed' });
      nav('/driver/trips');
    } catch (err) {
      show(err.response?.data?.message || err.message || 'Complete failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const enableLocation = async () => {
    try {
      const p = await getCurrentPosition();
      setManualPos({ latitude: p.coords.latitude, longitude: p.coords.longitude, speed: p.coords.speed, accuracy: p.coords.accuracy });
    } catch (e) {
      show(e.message || 'Location unavailable', 'error');
    }
  };

  if (!trip) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-10 h-10 border-4 border-purple-200 border-t-[#6023d5] rounded-full animate-spin" aria-label="Loading" />
      </div>
    );
  }

  const acc = pos?.accuracy;
  const lowAcc = acc != null && acc > 100;

  return (
    <div className="space-y-3 w-full max-w-full overflow-hidden">
      {/* instruction header */}
      <div className="bg-[#6023d5] text-white rounded-2xl px-4 py-4 shadow-md">
        {navi ? (
          <div className="flex items-center gap-3">
            <span className="text-4xl leading-none shrink-0" aria-hidden="true">{navi.info.icon}</span>
            <div className="min-w-0">
              <p className="text-lg font-extrabold leading-tight break-words">{navi.info.title}</p>
              {navi.info.road && <p className="text-purple-200 text-sm font-semibold truncate">{navi.info.road}</p>}
            </div>
          </div>
        ) : (
          <p className="text-base font-extrabold">
            {leg === 'preview' ? 'ROUTE PREVIEW' : leg === 'pickup' ? 'GO TO PICKUP' : 'GO TO DROP-OFF'}
          </p>
        )}
        {arrivedPickup && leg === 'pickup' && <p className="mt-1 text-sm font-bold text-emerald-200">✓ Arrived at Pickup</p>}
        {arrivedDest && leg === 'dropoff' && <p className="mt-1 text-sm font-bold text-emerald-200">✓ Arrived at Destination</p>}
      </div>

      {/* map */}
      <div className="relative">
        <div className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200/80">
          <div ref={mapDiv} className="w-full z-0" style={{ height: '52vh', minHeight: 320, touchAction: 'pan-x pan-y' }} />
        </div>
        {!follow && (
          <button type="button" onClick={() => setFollow(true)} className="absolute bottom-3 right-3 min-h-[44px] px-4 rounded-full bg-white shadow-lg border border-slate-200 text-xs font-extrabold text-[#6023d5]">
            ◎ RECENTER
          </button>
        )}
      </div>

      {/* status panel */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 space-y-2">
        {offRoute && <p className="text-sm font-extrabold text-amber-600">⚠️ You're off route — recalculating…</p>}
        {routeLoading && <p className="text-sm text-slate-500 font-semibold">Calculating road route…</p>}
        {routeErr && (
          <div className="space-y-2">
            <p className="text-sm font-bold text-rose-600">{routeErr}</p>
            <button type="button" onClick={() => { setRetryNonce((n) => n + 1); setRouteErr(''); setRoute(null); }} className="w-full min-h-[44px] rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">
              RETRY
            </button>
          </div>
        )}
        {route && navi && (
          <>
            <div className="flex items-center gap-4">
              <p className="text-xl font-extrabold text-slate-900">{formatRemain(navi.remaining)}</p>
              <p className="text-xl font-extrabold text-[#6023d5]">ETA {formatETA(navi.etaS)}</p>
              <p className="ml-auto text-xs font-bold text-slate-500">{Math.round(navi.speedKmh)} km/h</p>
            </div>
            {navi.next && (
              <p className="text-xs text-slate-500 font-semibold border-t border-slate-100 pt-2">
                NEXT: {navi.next.icon} {navi.next.title}{navi.next.road ? ` ${navi.next.road}` : ''}
              </p>
            )}
          </>
        )}
        {route && !navi && (
          <p className="text-sm text-slate-600 font-semibold">
            {formatDist(route.distanceM)} • ETA {formatETA(route.durationS)} (live road route)
          </p>
        )}
        <p className="text-xs text-slate-500 font-semibold border-t border-slate-100 pt-2">
          🛰️ GPS: {pos ? (lowAcc ? 'accuracy is low' : 'active') : 'unavailable'}
          {pos?.accuracy != null ? ` (±${Math.round(pos.accuracy)} m)` : ''}
          {pos ? ` • ${(+pos.latitude).toFixed(5)}, ${(+pos.longitude).toFixed(5)}` : ''}
        </p>
      </div>

      {/* addresses */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 space-y-2">
        <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">Pickup</p>
        <p className="text-sm font-bold text-slate-800 break-words">📍 {pickupText}</p>
        <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wider pt-1">Drop-off</p>
        <p className="text-sm font-bold text-slate-800 break-words">📍 {dropoffText}</p>
      </div>

      {/* actions */}
      <div className="space-y-2.5">
        {!pos && (
          <button type="button" onClick={enableLocation} className="w-full min-h-[52px] rounded-2xl bg-slate-900 text-white text-sm font-extrabold active:scale-[0.99] transition">
            📍 ENABLE LOCATION
          </button>
        )}
        {leg === 'preview' && canStart && (
          <button type="button" onClick={startTrip} disabled={busy} className="w-full min-h-[52px] rounded-2xl bg-[#6023d5] text-white text-base font-extrabold tracking-wide shadow-lg shadow-purple-200 disabled:opacity-50">
            {busy ? 'Starting…' : 'START TRIP'}
          </button>
        )}
        {arrivedPickup && leg === 'pickup' && (
          <button type="button" onClick={() => { setArrivedPickup(false); setLeg('dropoff'); }} className="w-full min-h-[52px] rounded-2xl bg-[#6023d5] text-white text-base font-extrabold shadow-lg shadow-purple-200">
            START ROUTE TO DROP-OFF
          </button>
        )}
        {(arrivedDest || (isActive && leg === 'dropoff')) && (
          <button type="button" onClick={completeTrip} disabled={busy} className="w-full min-h-[52px] rounded-2xl bg-emerald-600 text-white text-base font-extrabold shadow-lg shadow-emerald-200 disabled:opacity-50">
            {busy ? 'Completing…' : 'COMPLETE TRIP'}
          </button>
        )}
      </div>
      {!pos && <p className="text-xs text-slate-500 text-center font-medium">Location permission is required for navigation. Map and addresses remain visible.</p>}
      <Toast toast={toast} />
    </div>
  );
}
