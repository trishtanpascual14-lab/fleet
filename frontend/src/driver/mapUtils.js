/** Shared map helpers (no components — Fast Refresh safe). */

export const MANILA_CENTER = [14.5995, 120.9842];

/** Strict coordinate check — never pass undefined/null/''/NaN/out-of-range into Leaflet. */
export function isValidLatLng(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
  if (lat === '' || lng === '') return false;
  const la = +lat, ln = +lng;
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  return la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
}
