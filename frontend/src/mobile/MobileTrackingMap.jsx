import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function isValidLatLng(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
  if (lat === '' || lng === '') return false;
  const la = +lat, ln = +lng;
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  return la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
}

/**
 * Compact mobile map container (Leaflet/OpenStreetMap, same stack as desktop).
 * Base map always renders; vehicle markers come from real
 * `/tracking/vehicles` rows. Invalid coordinates are skipped.
 */
export default function MobileTrackingMap({ vehicles = [], onSelect, height = 280, onTileError }) {
  const mapDiv = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const tileErrRef = useRef(null);
  useEffect(() => { tileErrRef.current = onTileError; });

  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;
    const map = L.map(mapDiv.current, { zoomControl: false, scrollWheelZoom: false }).setView([14.5995, 120.9842], 11);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap',
    })
      .on('tileerror', () => tileErrRef.current?.())
      .addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // recalc after tab navigation in case the container was hidden at init
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts = [];
    for (const v of vehicles) {
      if (!isValidLatLng(v.latitude, v.longitude)) continue;
      const color = v.status === 'In Transit' ? '#4f46e5' : v.status === 'Dispatched' ? '#2563eb' : v.status === 'Available' ? '#059669' : '#0284c7';
      const m = L.marker([+v.latitude, +v.longitude], {
        icon: L.divIcon({
          className: 'm-trk-marker',
          html: `<div style="background:${color};color:#fff;border:3px solid #fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 5px rgba(0,0,0,.45)">🚚</div>`,
          iconSize: [34, 34], iconAnchor: [17, 17],
        }),
        title: v.plate_number,
      });
      m.on('click', () => onSelect?.(v));
      m.addTo(layer);
      pts.push([+v.latitude, +v.longitude]);
    }
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 16 });
  }, [vehicles, onSelect]);

  return (
    <div className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200/80">
      <div ref={mapDiv} className="w-full z-0" style={{ height, touchAction: 'pan-x pan-y' }} />
    </div>
  );
}
