import api from '../../services/api';

const OSRM_DIRECT = 'https://router.project-osrm.org';

/** Parse an OSRM route response into { distanceM, durationS, geometry [[lat,lng]], steps[] }. */
export function parseOsrm(json) {
  const rt = json && json.routes && json.routes[0];
  if (!rt || !rt.geometry || !Array.isArray(rt.geometry.coordinates)) return null;
  const steps = [];
  for (const leg of rt.legs || []) {
    for (const s of leg.steps || []) {
      steps.push({
        maneuver: {
          type: (s.maneuver && s.maneuver.type) || '',
          modifier: (s.maneuver && s.maneuver.modifier) || '',
        },
        name: s.name || '',
        distanceM: Math.round(s.distance || 0),
        durationS: Math.round(s.duration || 0),
        geometry: ((s.geometry && s.geometry.coordinates) || []).map(([lon, lat]) => [lat, lon]),
      });
    }
  }
  if (!steps.length) return null;
  return {
    distanceM: Math.round(rt.distance || 0),
    durationS: Math.round(rt.duration || 0),
    geometry: rt.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    steps,
  };
}

/**
 * Road-route leg via the backend `/routes/navigate` proxy (respects the
 * server OSRM_URL config). Falls back to a direct OSRM call from the
 * browser when the proxy is unreachable. Throws 'Unable to calculate
 * route.' when neither works — never a fake/straight-line route.
 */
export async function fetchLeg(from, to) {
  try {
    const { data } = await api.post('/routes/navigate', { from, to });
    if (data && data.success && data.data && data.data.geometry) {
      const g = data.data.geometry;
      return {
        distanceM: Math.round(data.data.distanceM || 0),
        durationS: Math.round(data.data.durationS || 0),
        geometry: g,
        steps: data.data.steps || [],
      };
    }
  } catch { /* fall through to direct OSRM */ }
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${OSRM_DIRECT}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`, { signal: ctrl.signal });
    if (!r.ok) throw new Error('osrm ' + r.status);
    const leg = parseOsrm(await r.json());
    if (!leg) throw new Error('empty route');
    return leg;
  } catch {
    throw new Error('Unable to calculate route.');
  } finally {
    clearTimeout(t);
  }
}

// ---------- pure geo helpers (no I/O — unit tested) ----------

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function haversineM(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function segDistM(p, a, b) {
  const px = p.lng, py = p.lat, ax = a[1], ay = a[0], bx = b[1], by = b[0];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return haversineM(p, { lat: cy, lng: cx });
}

/** Nearest route vertex index + lateral distance to the polyline. */
export function nearestOnRoute(pos, geometry) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < geometry.length; i++) {
    const d = haversineM(pos, { lat: geometry[i][0], lng: geometry[i][1] });
    if (d < bestD) { bestD = d; best = i; }
  }
  let edge = bestD;
  for (let i = 0; i < geometry.length - 1; i++) {
    edge = Math.min(edge, segDistM(pos, geometry[i], geometry[i + 1]));
  }
  return { index: best, lateralM: edge };
}

export function cumulativeM(geometry) {
  const cum = [0];
  for (let i = 1; i < geometry.length; i++) {
    cum.push(cum[i - 1] + haversineM({ lat: geometry[i - 1][0], lng: geometry[i - 1][1] }, { lat: geometry[i][0], lng: geometry[i][1] }));
  }
  return cum;
}

/**
 * Map a route vertex index to its OSRM step by walking step geometries.
 * Falls back to proportional mapping when step geometries are absent.
 */
export function stepIndexForRouteIndex(routeIdx, steps, geometryLen) {
  let acc = 0;
  for (let s = 0; s < steps.length; s++) {
    const len = (steps[s].geometry && steps[s].geometry.length) || 0;
    if (routeIdx < acc + Math.max(len - 1, 1)) return s;
    acc += Math.max(len - 1, 1);
  }
  if (!geometryLen) return 0;
  return Math.min(steps.length - 1, Math.floor((routeIdx / Math.max(geometryLen - 1, 1)) * steps.length));
}

export function formatDist(m) {
  const v = Math.max(0, Math.round(m));
  if (v < 1000) return `${v} m`;
  return `${(v / 1000).toFixed(1)} km`;
}

export function formatRemain(m) {
  const v = Math.max(0, Math.round(m));
  if (v < 1000) return `${v} m remaining`;
  return `${(v / 1000).toFixed(1)} km remaining`;
}

export function formatETA(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  return `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')} min`;
}

const MANEUVER_ICON = {
  'turn:left': '↰', 'turn:right': '↱', 'turn:slight left': '↲', 'turn:slight right': '↳',
  'turn:sharp left': '↰', 'turn:sharp right': '↱', 'new name:straight': '↑',
  continue: '↑', 'depart:': '🚏', 'arrive:': '🏁', 'roundabout:': '◉', 'rotary:': '◉',
  'roundabout:left': '◉', 'roundabout:right': '◉', 'exit roundabout:': '◉', 'exit rotary:': '◉',
  'merge:slight left': '↲', 'merge:slight right': '↳', 'merge:straight': '↑',
  'on ramp:left': '↰', 'on ramp:right': '↱', 'on ramp:straight': '↑', 'on ramp:slight left': '↲', 'on ramp:slight right': '↳',
  'off ramp:left': '↰', 'off ramp:right': '↱', 'off ramp:slight left': '↲', 'off ramp:slight right': '↳',
  'end of road:left': '↰', 'end of road:right': '↱', 'fork:slight left': '↲', 'fork:slight right': '↳',
  'turn:uturn': '↩', 'continue:uturn': '↩',
};

/** Human instruction from one OSRM step (data-driven, never invented roads). */
export function maneuverInfo(step, distToManeuverM) {
  const type = step?.maneuver?.type || '';
  const mod = step?.maneuver?.modifier || '';
  const name = step?.name || '';
  const key = `${type}:${mod}`;
  const icon = MANEUVER_ICON[key] || MANEUVER_ICON[type] || '↑';
  const when = distToManeuverM == null ? '' : (distToManeuverM < 1000 ? ` IN ${Math.round(distToManeuverM)} m` : ` IN ${(distToManeuverM / 1000).toFixed(1)} km`);
  let title = 'CONTINUE STRAIGHT';
  if (type === 'arrive') title = 'DESTINATION REACHED';
  else if (type === 'depart') title = 'START — HEAD OUT';
  else if (type === 'turn' || type === 'end of road') title = `TURN ${String(mod || '').toUpperCase()}`;
  else if (type === 'new name') title = `CONTINUE ONTO ${name.toUpperCase() || 'ROAD'}`;
  else if (type === 'continue' || type === 'merge') title = mod ? `CONTINUE ${String(mod).toUpperCase()}` : 'CONTINUE STRAIGHT';
  else if (type === 'roundabout' || type === 'rotary' || type === 'exit roundabout' || type === 'exit rotary') title = 'AT THE ROUNDABOUT';
  else if (type === 'on ramp' || type === 'off ramp') title = `${String(type).toUpperCase()} ${String(mod || '').toUpperCase()}`.trim();
  else if (type === 'fork') title = `KEEP ${String(mod || '').toUpperCase()}`;
  else if (mod === 'uturn' || type.includes('uturn')) title = 'MAKE A U-TURN';
  return { icon, title: title + when, road: name ? `onto ${name}` : '' };
}
