import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

/**
 * Phone GPS tracking — active ONLY while the driver has an authorized
 * active trip. Posts fixes to the existing `/tracking/location` API
 * (same table the desktop dispatcher map reads). No GPS before start,
 * no GPS after completion.
 */
export function useGpsTracking(activeTrip) {
  const [pos, setPos] = useState(null);
  const [gpsOn, setGpsOn] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const latest = useRef(null);
  const tripRef = useRef(null);

  useEffect(() => {
    tripRef.current = activeTrip;
    if (!activeTrip) { setGpsOn(false); return; }
    if (!('geolocation' in navigator)) { setGpsError('GPS not supported on this device'); return; }
    let cancelled = false;

    const post = async (latitude, longitude, speedMps, headingDeg, status) => {
      const t = tripRef.current;
      if (!t || cancelled) return;
      try {
        await api.post('/tracking/location', {
          vehicle_id: t.vehicle_id,
          driver_id: t.driver_id,
          trip_id: t.id,
          latitude,
          longitude,
          speed_kmh: speedMps != null ? +((speedMps * 3.6).toFixed(1)) : 0,
          heading: headingDeg == null || Number.isNaN(+headingDeg) ? null : +(+headingDeg).toFixed(1),
          status: status || 'moving',
        });
        if (!cancelled) { setLastUpdate(new Date()); setGpsOn(true); setGpsError(''); }
      } catch {
        if (!cancelled) setGpsOn(false);
      }
    };

    const id = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude, longitude, speed, heading } = p.coords;
        latest.current = { latitude, longitude, speed, heading };
        setPos({ latitude, longitude, speed, heading, accuracy: p.coords.accuracy });
        post(latitude, longitude, speed, heading);
      },
      (err) => { if (!cancelled) { setGpsError(err.message || 'Location unavailable'); setGpsOn(false); } },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    // heartbeat every 30s with the latest fix so tracking stays live
    const beat = setInterval(() => {
      const l = latest.current;
      if (l) post(l.latitude, l.longitude, l.speed, l.heading);
    }, 30000);

    return () => { cancelled = true; navigator.geolocation.clearWatch(id); clearInterval(beat); };
  }, [activeTrip ? activeTrip.id : null]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pos, gpsOn, gpsError, lastUpdate };
}

/** One-shot position for start/complete confirmations (permission prompt). */
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('GPS not supported on this device'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 });
  });
}
