import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Static debug coordinates ONLY — never used as driver/GPS data.
const TEST_LAT = 14.6760;
const TEST_LNG = 121.0437;
const TEST_ZOOM = 13;

/**
 * MINIMAL standalone Leaflet test. No GPS, no API, no database, no auth.
 * Proves: container size, Leaflet init, OSM tiles, marker, popup, zoom/pan.
 */
export default function TestMap() {
  const mapDiv = useRef(null);
  const mapRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tilesOk, setTilesOk] = useState(0);
  const [tilesErr, setTilesErr] = useState(0);
  const [mapError, setMapError] = useState('');

  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;
    try {
      const map = L.map(mapDiv.current).setView([TEST_LAT, TEST_LNG], TEST_ZOOM);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      })
        .on('tileload', () => setTilesOk((n) => n + 1))
        .on('tileerror', () => setTilesErr((n) => n + 1))
        .addTo(map);
      L.marker([TEST_LAT, TEST_LNG], {
        title: 'Test Location',
        icon: L.divIcon({
          className: 'test-map-pin',
          html: '<div style="background:#dc2626;color:#fff;border:3px solid #fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 1px 5px rgba(0,0,0,.45)">📍</div>',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
      })
        .bindPopup('<b>Test Location</b><br/>14.6760, 121.0437')
        .addTo(map);
      mapRef.current = map;
      const measure = () => {
        if (mapDiv.current) setSize({ w: mapDiv.current.clientWidth, h: mapDiv.current.clientHeight });
      };
      measure();
      const t = setTimeout(() => { map.invalidateSize(); measure(); }, 300);
      return () => { clearTimeout(t); map.remove(); mapRef.current = null; };
    } catch (e) {
      setMapError(e.message || 'Map init failed');
    }
  }, []);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontWeight: 800, fontSize: 20 }}>REAL MAP TEST</h1>
      <div
        data-testid="map-debug"
        data-w={size.w}
        data-h={size.h}
        data-tiles-ok={tilesOk}
        data-tiles-err={tilesErr}
        style={{ fontSize: 12, margin: '8px 0', fontFamily: 'monospace' }}
      >
        container: {size.w}x{size.h} | tiles ok: {tilesOk} | tiles err: {tilesErr}
        {mapError ? ` | ERROR: ${mapError}` : ''}
      </div>
      <div
        ref={mapDiv}
        data-testid="map-container"
        style={{
          width: '100%',
          height: 450,
          minHeight: 400,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 16,
          border: '1px solid #cbd5e1',
          background: '#e2e8f0',
          zIndex: 0,
        }}
      />
    </div>
  );
}
