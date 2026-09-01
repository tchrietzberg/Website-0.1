'use strict';

const MIN_LAT = -90;
const MAX_LAT = 90;
const MIN_LON = -180;
const MAX_LON = 180;
const MIN_RADIUS_M = 100;
const MAX_RADIUS_M = 5000;
const DEFAULT_RADIUS_M = 1200;

function asFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseLatitude(value) {
  const n = asFiniteNumber(value);
  if (n === null || n < MIN_LAT || n > MAX_LAT) return null;
  return n;
}

function parseLongitude(value) {
  const n = asFiniteNumber(value);
  if (n === null || n < MIN_LON || n > MAX_LON) return null;
  return n;
}

function parseRadiusMeters(value, fallback = DEFAULT_RADIUS_M) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = asFiniteNumber(value);
  if (n === null) return null;
  const rounded = Math.round(n);
  if (rounded < MIN_RADIUS_M || rounded > MAX_RADIUS_M) return null;
  return rounded;
}

function parseCoords(query) {
  const lat = parseLatitude(query && query.lat);
  const lon = parseLongitude(query && query.lon);
  const radiusMeters = parseRadiusMeters(query && query.radius);
  if (lat === null || lon === null || radiusMeters === null) {
    const err = new Error('Provide lat, lon, and an optional radius between 100 and 5000 meters.');
    err.status = 400;
    err.code = 'invalid_coords';
    throw err;
  }
  return { lat, lon, radiusMeters };
}

/** Integer meters. Earth radius is a constant; trig is only used for distance. */
function distanceMeters(aLat, aLon, bLat, bLon) {
  const R = 6_371_000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** ~1.1 km grid — safe for logs, never exact GPS. */
function coarseCoord(n) {
  return Math.round(Number(n) * 100) / 100;
}

function cacheKey(lat, lon, radiusMeters) {
  return `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)},${radiusMeters}`;
}

module.exports = {
  MIN_LAT,
  MAX_LAT,
  MIN_LON,
  MAX_LON,
  MIN_RADIUS_M,
  MAX_RADIUS_M,
  DEFAULT_RADIUS_M,
  parseLatitude,
  parseLongitude,
  parseRadiusMeters,
  parseCoords,
  distanceMeters,
  coarseCoord,
  cacheKey,
};
