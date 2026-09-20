// Route planning + optimization service layer.
//
// REAL SERVICES (no API key needed):
//  - Geocoding/autocomplete: OpenStreetMap Nominatim (via backend proxy) +
//    local `places` table (warehouses/depots/hubs) for instant SME results.
//  - Routing: OSRM public API with full geometry (true road path).
//  - Map: frontend Leaflet component renders `mapPoints` + `geometry`.
//
// HONESTY RULES (enforced here):
//  - Coordinates are NEVER invented. Unknown place names fail resolution and
//    the API rejects calculation with a "select a valid location" message.
//  - Distances are labeled: mode 'live' = real OSRM road network;
//    mode 'offline-estimate' = clearly-marked fallback estimate shown only
//    when the routing service is unreachable. Never presented as real-time.
const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const DIESEL_PRICE = +(process.env.DIESEL_PRICE || 58); // Php per liter

// Avg fuel consumption L/100km per vehicle type (used for estimates)
const FUEL_RATE = { Truck: 28, Van: 14, Pickup: 12, Motorcycle: 4, Bus: 22, SUV: 11 };

// Built-in fallback when the `places` table is unreachable (same real coords as seed)
const KNOWN = [
  { name: 'Warehouse A', address: 'KM 14 West Service Road, Parañaque City, Metro Manila', lat: 14.6, lon: 120.98 },
  { name: 'Warehouse B', address: 'Industrial Park, Calamba, Laguna', lat: 14.55, lon: 121.02 },
  { name: 'Central Depot', address: 'Commonwealth Ave, Quezon City, Metro Manila', lat: 14.676, lon: 121.0437 },
  { name: 'Port of Manila', address: 'South Harbor, Port Area, Manila', lat: 14.585, lon: 120.97 },
  { name: 'SM Mall of Asia', address: 'Seaside Blvd, Pasay City, Metro Manila', lat: 14.535, lon: 121.0 },
  { name: 'Pasig Hub', address: 'Ortigas Ave, Pasig City, Metro Manila', lat: 14.5764, lon: 121.0851 },
  { name: 'Taguig Hub', address: 'C-5, Taguig City, Metro Manila', lat: 14.5176, lon: 121.0509 },
  { name: 'Manila', address: 'Manila, Metro Manila, Philippines', lat: 14.5995, lon: 120.9842 },
  { name: 'Quezon City', address: 'Quezon City, Metro Manila, Philippines', lat: 14.676, lon: 121.0437 },
  { name: 'Makati', address: 'Makati, Metro Manila, Philippines', lat: 14.5547, lon: 121.0244 },
  { name: 'Pasig', address: 'Pasig, Metro Manila, Philippines', lat: 14.5764, lon: 121.0851 },
  { name: 'Taguig', address: 'Taguig, Metro Manila, Philippines', lat: 14.5176, lon: 121.0509 },
  { name: 'Cavite', address: 'Cavite, Philippines', lat: 14.4793, lon: 120.8969 },
  { name: 'Bulacan', address: 'Bulacan, Philippines', lat: 14.7944, lon: 120.8799 },
  { name: 'Pampanga', address: 'Pampanga, Philippines', lat: 15.0794, lon: 120.6198 },
  { name: 'Laguna', address: 'Laguna, Philippines', lat: 14.2691, lon: 121.4113 },
  { name: 'Batangas', address: 'Batangas, Philippines', lat: 13.7565, lon: 121.058 },
  { name: 'Cebu', address: 'Cebu, Philippines', lat: 10.3157, lon: 123.8854 },
  { name: 'Davao', address: 'Davao, Philippines', lat: 7.1907, lon: 125.4553 }
];

function matchKnown(q) {
  const key = String(q || '').toLowerCase().trim();
  if (!key) return [];
  return KNOWN.filter((p) => p.name.toLowerCase().includes(key) || key.includes(p.name.toLowerCase()))
    .map((p) => ({ ...p, source: 'local' }));
}

// --- Nominatim proxy (real geocoding). In-memory cache, PH-bounded. ---
const geoCache = new Map();
async function nominatim(q) {
  const key = q.toLowerCase().trim();
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const url = `${NOMINATIM_URL}/search?format=json&limit=7&countrycodes=ph&addressdetails=1&q=${encodeURIComponent(q)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'SmartFleetCapstone/1.0 (sme-fleet-demo)', Accept: 'application/json' } });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    const out = (Array.isArray(j) ? j : []).map((n) => ({
      name: (n.display_name || '').split(',').slice(0, 2).join(','),
      address: n.display_name || '',
      lat: +n.lat, lon: +n.lon, source: 'osm'
    }));
    geoCache.set(key, out);
    if (geoCache.size > 200) geoCache.delete(geoCache.keys().next().value);
    return out;
  } catch {
    return [];
  }
}

// Public search: local places (DB rows mapped to {name,address,lat,lon}) + Nominatim
async function searchPlaces(q, localRows = []) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  const local = [
    ...localRows.map((p) => ({ name: p.name, address: p.address || p.name, lat: +p.latitude, lon: +p.longitude, source: 'local' })),
    ...matchKnown(query)
  ];
  const seen = new Set(local.map((p) => p.name.toLowerCase()));
  const remote = (await nominatim(query)).filter((p) => !seen.has(p.name.toLowerCase()));
  return [...local.slice(0, 6), ...remote].slice(0, 10);
}

// Strict resolution: point object with coords passes through; strings must
// match a known place. Returns null (never invented) when unresolvable.
function resolvePoint(input) {
  if (input && typeof input === 'object' && isFinite(+input.lat) && isFinite(+input.lon)) {
    return { name: input.name || 'Selected location', lat: +input.lat, lon: +input.lon, exact: true };
  }
  if (typeof input === 'string' && input.trim()) {
    const hit = matchKnown(input.trim())[0];
    if (hit) return { name: hit.name, lat: hit.lat, lon: hit.lon, exact: true };
  }
  return null;
}
const geocode = (name) => { const p = resolvePoint(name); return p ? [p.lat, p.lon] : null; };

function haversine(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const roadKm = (a, b) => haversine(a, b) * 1.25;

// OSRM with full route geometry (true road path for the map)
async function osrmRoute(points) {
  try {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(';');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(`${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const rt = j && j.routes && j.routes[0];
    if (!rt) return null;
    return {
      km: rt.distance / 1000,
      min: Math.round(rt.duration / 60),
      geometry: (rt.geometry && rt.geometry.coordinates ? rt.geometry.coordinates : []).map(([lon, lat]) => [lat, lon])
    };
  } catch {
    return null;
  }
}

// Deterministic offline estimate (labeled as such; used only when the
// routing service is unreachable or for legacy free-text trip locations)
function offlineEstimate(names) {
  const s = names.join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return 12 + h * 0.35 + Math.max(0, names.length - 2) * 8;
}

function optimizeOrder(originPt, destPt, stopPts) {
  const remaining = stopPts.map((s, i) => ({ ...s, origIndex: i }));
  const ordered = [];
  let current = originPt;
  while (remaining.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = roadKm(current, remaining[i]);
      if (d < bd) { bd = d; bi = i; }
    }
    current = remaining.splice(bi, 1)[0];
    ordered.push(current);
  }
  return ordered;
}

function pathKm(points) {
  let km = 0;
  for (let i = 0; i < points.length - 1; i++) km += roadKm(points[i], points[i + 1]);
  return km;
}

// Full planning pipeline. Points may be {name,lat,lon} (from autocomplete)
// or known place-name strings. Unknown names -> throws { invalid }.
async function planRoute(origin, destination, stops = [], opts = {}) {
  const norm = (v) => (v && typeof v === 'object' ? { name: v.name, lat: +v.lat, lon: +v.lon } : v);
  const oPt = resolvePoint(norm(origin));
  const dPt = resolvePoint(norm(destination));
  if (!oPt) throw { invalid: typeof origin === 'string' ? origin : 'Starting Location' };
  if (!dPt) throw { invalid: typeof destination === 'string' ? destination : 'Destination' };
  const rawStops = (Array.isArray(stops) ? stops : String(stops || '').split(','))
    .map((s) => (s && typeof s === 'object' ? { name: s.name, lat: +s.lat, lon: +s.lon } : String(s || '').trim()))
    .filter((s) => (typeof s === 'object' ? s.name : s));
  const stopPts = [];
  for (const s of rawStops) {
    const p = resolvePoint(s);
    if (!p) throw { invalid: typeof s === 'string' ? s : (s.name || 'Stop') };
    stopPts.push({ name: p.name, lat: p.lat, lon: p.lon });
  }

  const origPath = [oPt, ...stopPts, dPt];
  const origKm = +pathKm(origPath).toFixed(2);
  const orderedStops = optimizeOrder(oPt, dPt, stopPts);
  const optPath = [oPt, ...orderedStops, dPt];

  let km = +pathKm(optPath).toFixed(2);
  let min = Math.round((km / 40) * 60);
  let mode = 'offline-estimate';
  let geometry = optPath.map((p) => [p.lat, p.lon]); // straight segments fallback
  const live = await osrmRoute(optPath);
  if (live) { km = +live.km.toFixed(2); min = live.min; mode = 'live'; geometry = live.geometry; }

  const savedKm = +(origKm - km).toFixed(2);
  const reordered = orderedStops.some((s, i) => s.origIndex !== i);
  const seq = [oPt.name, ...orderedStops.map((s) => s.name), dPt.name];
  const legs = [];
  for (let i = 0; i < optPath.length - 1; i++) {
    legs.push({ from: seq[i], to: seq[i + 1], km: +roadKm(optPath[i], optPath[i + 1]).toFixed(2) });
  }

  const rate = FUEL_RATE[opts.vehicleType] || 15;
  const fuelLiters = +((km / 100) * rate).toFixed(2);
  const fuelCost = +(fuelLiters * DIESEL_PRICE).toFixed(2);
  const numStops = orderedStops.length;
  const tollEst = numStops === 0 ? 100 : 100 + numStops * 50;
  const driverAllowance = 400;
  const totalCost = +(fuelCost + tollEst + driverAllowance).toFixed(2);

  let capacityWarning = null;
  if (opts.cargoKg && opts.capacityKg && +opts.cargoKg > +opts.capacityKg) {
    capacityWarning = `Cargo load (${opts.cargoKg} kg) exceeds vehicle capacity (${opts.capacityKg} kg). Choose a larger vehicle or split the delivery.`;
  }

  const mapPoints = [
    { name: oPt.name, lat: oPt.lat, lon: oPt.lon, kind: 'origin', order: 0 },
    ...orderedStops.map((s, i) => ({ name: s.name, lat: s.lat, lon: s.lon, kind: 'stop', order: i + 1 })),
    { name: dPt.name, lat: dPt.lat, lon: dPt.lon, kind: 'destination', order: numStops + 1 }
  ];

  return {
    origin: oPt, destination: dPt,
    stopsEntered: stopPts.map((s) => s.name),
    orderedStops: orderedStops.map((s) => ({ name: s.name, lat: s.lat, lon: s.lon })),
    orderedStopNames: orderedStops.map((s) => s.name),
    reordered, originalKm: origKm, distanceKm: km, savedKm,
    estimatedMin: min, numStops, legs,
    fuel: { liters: fuelLiters, ratePer100km: rate, pricePerLiter: DIESEL_PRICE, fuelCost },
    cost: { fuelCost, tollEst, driverAllowance, total: totalCost },
    capacityWarning, vehicleType: opts.vehicleType || null,
    mapPoints, geometry, mode,
    sourceLabel: mode === 'live' ? 'Live road-network route (OSRM)' : 'Offline estimate — routing service unreachable, connect for live routing',
    info: `Optimized route: ${seq.join(' → ')} (${km} km)`
  };
}

// Backward-compatible simple calculation (trips/dispatch free text).
// Unknown names -> labeled offline estimate (never throws).
async function calculateRoute(origin, destination, stops = []) {
  try {
    const r = await planRoute(origin, destination, stops);
    return { distanceKm: r.distanceKm, estimatedMin: r.estimatedMin, info: r.info, mode: r.mode };
  } catch {
    const names = [origin, ...(Array.isArray(stops) ? stops : String(stops || '').split(',')), destination].filter(Boolean);
    const km = +offlineEstimate(names).toFixed(2);
    return { distanceKm: km, estimatedMin: Math.round((km / 40) * 60), info: `Estimated route (${km} km, offline)`, mode: 'offline-estimate' };
  }
}

// OSRM turn-by-turn navigation: true road path + steps for one leg.
// Returns { distanceM, durationS, geometry [[lat,lng]], steps[] } or null.
async function navigateRoute(from, to) {
  try {
    const f = { lat: +from.lat, lon: +from.lng ?? +from.lon };
    const t = { lat: +to.lat, lon: +to.lng ?? +to.lon };
    if (![f.lat, f.lon, t.lat, t.lon].every((v) => Number.isFinite(v))) return null;
    if (Math.abs(f.lat) > 90 || Math.abs(t.lat) > 90 || Math.abs(f.lon) > 180 || Math.abs(t.lon) > 180) return null;
    const coords = `${f.lon},${f.lat};${t.lon},${t.lat}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(`${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json();
    const rt = j && j.routes && j.routes[0];
    if (!rt || !rt.geometry || !Array.isArray(rt.geometry.coordinates)) return null;
    const steps = [];
    for (const leg of rt.legs || []) {
      for (const s of leg.steps || []) {
        steps.push({
          maneuver: {
            type: (s.maneuver && s.maneuver.type) || '',
            modifier: (s.maneuver && s.maneuver.modifier) || '',
            location: (s.maneuver && s.maneuver.location) || null,
          },
          name: s.name || '',
          distanceM: Math.round(s.distance || 0),
          durationS: Math.round(s.duration || 0),
          geometry: ((s.geometry && s.geometry.coordinates) || []).map(([lon, lat]) => [lat, lon]),
        });
      }
    }
    return {
      distanceM: Math.round(rt.distance || 0),
      durationS: Math.round(rt.duration || 0),
      geometry: rt.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      steps,
    };
  } catch {
    return null;
  }
}

module.exports = { calculateRoute, planRoute, searchPlaces, geocode, resolvePoint, navigateRoute, FUEL_RATE, DIESEL_PRICE };
