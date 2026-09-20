import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MANILA_CENTER, isValidLatLng } from './mapUtils';

function dot(color, emoji) {
  return L.divIcon({
    className: 'trip-route-marker',
    html: `<div style="background:${color};color:#fff;border:3px solid #fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 5px rgba(0,0,0,.45)">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

/**
 * Trip route preview: 🟢 pickup, 🔴 drop-off, optional 🔵 live position,
 * straight-line route segment when both endpoint coordinates exist.
 * The base OpenStreetMap map ALWAYS renders (default Manila center) —
 * even with no pins and no GPS — so the container is never blank.
 * Invalid coordinates are skipped, never passed to Leaflet.
 */
export default function TripRouteMap({ pickup, dropoff, current, onTileError }) {
  const mapDiv = useRef(null);
  const mapRef = useRef(null);
  const tileErrRef = useRef(null);
  useEffect(() => { tileErrRef.current = onTileError; });

  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;
    const map = L.map(mapDiv.current, { zoomControl: false, scrollWheelZoom: false }).setView(MANILA_CENTER, 11);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap',
    })
      .on('tileerror', () => tileErrRef.current?.())
      .addTo(map);
    mapRef.current = map;
    // container may have been hidden (tab switch) during init — recalc size
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.eachLayer((l) => { if (l instanceof L.Marker || l instanceof L.Polyline) map.removeLayer(l); });
    const pts = [];
    const put = (pin, color, emoji, title) => {
      if (!pin || !isValidLatLng(pin.lat, pin.lng)) return;
      const lat = +pin.lat, lng = +pin.lng;
      L.marker([lat, lng], { icon: dot(color, emoji), title })
        .bindPopup(`<b>${title}</b>${pin.label ? `<br/>${pin.label}` : ''}`).addTo(map);
      pts.push([lat, lng]);
    };
    put(pickup, '#16a34a', '🟢', 'Pickup');
    put(dropoff, '#dc2626', '🔴', 'Drop-off');
    if (pickup && dropoff && isValidLatLng(pickup.lat, pickup.lng) && isValidLatLng(dropoff.lat, dropoff.lng)) {
      L.polyline([[+pickup.lat, +pickup.lng], [+dropoff.lat, +dropoff.lng]], { color: '#6023d5', weight: 4, opacity: 0.8, dashArray: '8 6' }).addTo(map);
    }
    put(current, '#2563eb', '🔵', 'Current vehicle location');
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 16 });
    else map.setView(MANILA_CENTER, 11);
  }, [pickup, dropoff, current]);

  return (
    <div className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200/80">
      <div ref={mapDiv} className="w-full z-0" style={{ height: 260, touchAction: 'pan-x pan-y' }} />
    </div>
  );
}
