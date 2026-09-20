// RouteMap — REAL interactive map (Leaflet + OpenStreetMap, no API key).
//
// CONTRACT: renders `points` = [{ name, lat, lon, kind, order }] as numbered
// markers plus `geometry` = [[lat, lon], ...] as the route line. It only
// visualizes PLANNED route locations from the backend — never fake GPS.
//
// PROVIDER SWAP: to use Google Maps/Mapbox later, replace the Leaflet block
// in the effect below with the provider component; keep the same props.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function icon(kind, tag) {
  const color = kind === 'origin' ? '#059669' : kind === 'destination' ? '#dc2626' : '#2563eb';
  return L.divIcon({
    className: 'rm-marker',
    html: `<div style="background:${color};color:#fff;border:3px solid #fff;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.4)">${tag}</div>`,
    iconSize: [30, 30], iconAnchor: [15, 15]
  });
}

export default function RouteMap({ points = [], geometry = [], height = 380 }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    mapRef.current = L.map(divRef.current, { zoomControl: true, scrollWheelZoom: true }).setView([14.6, 121.0], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(mapRef.current);
    layerRef.current = L.layerGroup().addTo(mapRef.current);
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!points.length) return;
    const latlngs = [];
    points.forEach((p) => {
      const tag = p.kind === 'stop' ? String(p.order) : p.kind === 'origin' ? 'A' : 'B';
      L.marker([+p.lat, +p.lon], { icon: icon(p.kind, tag) })
        .bindPopup(`<b>${p.kind === 'stop' ? `Stop ${p.order}: ` : ''}${p.name}</b>`)
        .bindTooltip(`${p.order > 0 ? `${p.order}. ` : ''}${p.name}`, { direction: 'top', offset: [0, -16] })
        .addTo(layer);
      latlngs.push([+p.lat, +p.lon]);
    });
    const line = geometry && geometry.length > 1 ? geometry.map(([la, lo]) => [+la, +lo]) : latlngs;
    L.polyline(line, { color: '#2563eb', weight: 5, opacity: 0.85 }).addTo(layer);
    if (geometry && geometry.length <= 1) {
      L.polyline(latlngs, { color: '#1e40af', weight: 2, dashArray: '8 6', opacity: 0.7 }).addTo(layer);
    }
    map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
  }, [points, geometry]);

  return (
    <div>
      <div ref={divRef} className="w-full rounded-lg border border-slate-200 z-0" style={{ height }} />
      <div className="flex gap-4 mt-2 text-xs text-slate-600 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-600 inline-block" /> Start (A)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-600 inline-block" /> Stops (numbered in visit order)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-600 inline-block" /> Destination (B)</span>
      </div>
    </div>
  );
}
