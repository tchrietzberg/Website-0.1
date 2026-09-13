/**
 * Private place stamps for Waymark.
 * Coordinates are integer microdegrees. Exact GPS is returned only to the owner.
 * Shared books use ~100 m quantized coordinates. Audit logs never store lat/lng.
 */
const crypto = require('node:crypto');
const { audit } = require('./db');

const MICRO_PER_DEGREE = 1_000_000;
const PUBLIC_QUANTUM_MICRO = 1_000;
const MAX_LABEL = 80;
const MAX_LOCALITY = 80;
const MAX_NOTE = 280;
const STAMP_WINDOW_MS = 10 * 60 * 1000;
const STAMP_MAX = 30;
const GEOCODE_WINDOW_MS = 60 * 1000;
const GEOCODE_MAX = 8;

const stampAttempts = new Map();
const geocodeCache = new Map();

function fail(message, status = 400, code = 'error') {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function toMicro(deg) {
  return Math.round(Number(deg) * MICRO_PER_DEGREE);
}

function fromMicro(micro) {
  return Number(micro) / MICRO_PER_DEGREE;
}

function publicMicro(micro) {
  return Math.round(Number(micro) / PUBLIC_QUANTUM_MICRO) * PUBLIC_QUANTUM_MICRO;
}

function publicDegrees(micro) {
  return fromMicro(publicMicro(micro));
}

function cleanText(value, max) {
  const text = String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
  return text.length > max ? text.slice(0, max) : text;
}

function parseLatLng({ lat, lng }) {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
    throw fail('Latitude and longitude are required');
  }
  if (latN < -90 || latN > 90 || lngN < -180 || lngN > 180) {
    throw fail('Latitude must be between -90 and 90, longitude between -180 and 180');
  }
  return { latMicro: toMicro(latN), lngMicro: toMicro(lngN) };
}

function rateOk(map, key, windowMs, max) {
  const now = Date.now();
  let row = map.get(key);
  if (!row || now >= row.resetAt) {
    row = { count: 0, resetAt: now + windowMs };
    map.set(key, row);
  }
  if (row.count >= max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((row.resetAt - now) / 1000)) };
  }
  row.count += 1;
  return { ok: true };
}

function defaultLabel(latMicro, lngMicro) {
  return `Waymark ${publicDegrees(latMicro).toFixed(3)}, ${publicDegrees(lngMicro).toFixed(3)}`;
}

function ownerStampJson(row) {
  return {
    id: row.id,
    label: row.label,
    locality: row.locality || '',
    note: row.note || '',
    lat: fromMicro(row.lat_micro),
    lng: fromMicro(row.lng_micro),
    createdAt: row.created_at,
  };
}

function sharedStampJson(row) {
  return {
    id: row.id,
    label: row.label,
    locality: row.locality || '',
    note: row.note || '',
    lat: publicDegrees(row.lat_micro),
    lng: publicDegrees(row.lng_micro),
    createdAt: row.created_at,
  };
}

async function reverseGeocode(latMicro, lngMicro) {
  const cacheKey = `${publicMicro(latMicro)}:${publicMicro(lngMicro)}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);
  const lat = fromMicro(latMicro);
  const lng = fromMicro(lngMicro);
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&zoom=16`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'Waymark/0.1 (educational demo; https://github.com/tchrietzberg/Website-0.1)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data && data.address ? data.address : {};
    const label = cleanText(
      data.name
      || addr.tourism
      || addr.amenity
      || addr.building
      || addr.road
      || addr.neighbourhood
      || addr.suburb
      || '',
      MAX_LABEL
    );
    const locality = cleanText(
      [addr.city || addr.town || addr.village || addr.hamlet, addr.state, addr.country]
        .filter(Boolean)
        .join(', '),
      MAX_LOCALITY
    );
    const out = { label, locality };
    geocodeCache.set(cacheKey, out);
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function dropStamp(db, user, body, req) {
  const limit = rateOk(stampAttempts, String(user.id), STAMP_WINDOW_MS, STAMP_MAX);
  if (!limit.ok) {
    throw fail('Too many stamps. Try again in a few minutes.', 429, 'rate_limited');
  }
  const { latMicro, lngMicro } = parseLatLng(body);
  let label = cleanText(body.label, MAX_LABEL);
  let locality = cleanText(body.locality, MAX_LOCALITY);
  const note = cleanText(body.note, MAX_NOTE);
  if (!label || !locality) {
    const geoLimit = rateOk(stampAttempts, `geo:${user.id}`, GEOCODE_WINDOW_MS, GEOCODE_MAX);
    if (geoLimit.ok) {
      const geo = await reverseGeocode(latMicro, lngMicro);
      if (geo) {
        if (!label) label = geo.label;
        if (!locality) locality = geo.locality;
      }
    }
  }
  if (!label) label = defaultLabel(latMicro, lngMicro);
  const ins = db.prepare(`
    INSERT INTO stamps(user_id, lat_micro, lng_micro, label, locality, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user.id, latMicro, lngMicro, label, locality, note);
  const id = Number(ins.lastInsertRowid);
  audit(db, {
    actorId: user.id,
    action: 'stamp.create',
    entityType: 'stamp',
    entityId: id,
    detail: { hasNote: Boolean(note) },
    req,
  });
  return getStamp(db, user.id, id);
}

function listStamps(db, userId) {
  const rows = db.prepare(`
    SELECT id, label, locality, note, lat_micro, lng_micro, created_at
    FROM stamps
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(userId);
  return { stamps: rows.map(ownerStampJson) };
}

function getStamp(db, userId, stampId) {
  const row = db.prepare(`
    SELECT id, user_id, label, locality, note, lat_micro, lng_micro, created_at
    FROM stamps WHERE id = ?
  `).get(stampId);
  if (!row || row.user_id !== userId) throw fail('Stamp not found', 404, 'not_found');
  return ownerStampJson(row);
}

function deleteStamp(db, user, stampId, req) {
  const row = db.prepare('SELECT id, user_id FROM stamps WHERE id = ?').get(stampId);
  if (!row || row.user_id !== user.id) throw fail('Stamp not found', 404, 'not_found');
  db.prepare('DELETE FROM stamps WHERE id = ?').run(stampId);
  audit(db, {
    actorId: user.id,
    action: 'stamp.delete',
    entityType: 'stamp',
    entityId: stampId,
    req,
  });
  return { ok: true, id: stampId };
}

function stats(db, userId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS stamp_count,
      COUNT(DISTINCT CASE WHEN locality <> '' THEN locality END) AS locality_count,
      MIN(created_at) AS first_at,
      MAX(created_at) AS last_at
    FROM stamps
    WHERE user_id = ?
  `).get(userId);
  const recent = db.prepare(`
    SELECT locality, COUNT(*) AS n
    FROM stamps
    WHERE user_id = ? AND locality <> ''
    GROUP BY locality
    ORDER BY n DESC, locality ASC
    LIMIT 5
  `).all(userId);
  return {
    stampCount: Number(row.stamp_count) || 0,
    localityCount: Number(row.locality_count) || 0,
    firstAt: row.first_at || null,
    lastAt: row.last_at || null,
    topLocalities: recent.map((r) => ({ locality: r.locality, count: Number(r.n) })),
  };
}

function hashShareToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createShareLink(db, user, req) {
  db.prepare('UPDATE share_links SET revoked = 1 WHERE user_id = ? AND revoked = 0').run(user.id);
  const token = crypto.randomBytes(18).toString('base64url');
  const ins = db.prepare(
    'INSERT INTO share_links(user_id, token_hash) VALUES (?, ?)'
  ).run(user.id, hashShareToken(token));
  const id = Number(ins.lastInsertRowid);
  audit(db, {
    actorId: user.id,
    action: 'share.create',
    entityType: 'share_link',
    entityId: id,
    req,
  });
  return { token, id };
}

function revokeShareLinks(db, user, req) {
  db.prepare('UPDATE share_links SET revoked = 1 WHERE user_id = ? AND revoked = 0').run(user.id);
  audit(db, {
    actorId: user.id,
    action: 'share.revoke',
    entityType: 'share_link',
    req,
  });
  return { ok: true };
}

function getSharedBook(db, token) {
  const clean = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(clean)) {
    throw fail('Book not found', 404, 'not_found');
  }
  const link = db.prepare(`
    SELECT sl.id, sl.user_id, u.name
    FROM share_links sl
    JOIN users u ON u.id = sl.user_id
    WHERE sl.token_hash = ? AND sl.revoked = 0 AND u.active = 1
  `).get(hashShareToken(clean));
  if (!link) throw fail('Book not found', 404, 'not_found');
  const rows = db.prepare(`
    SELECT id, label, locality, note, lat_micro, lng_micro, created_at
    FROM stamps
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(link.user_id);
  return {
    ownerName: link.name,
    stampCount: rows.length,
    stamps: rows.map(sharedStampJson),
  };
}

function resetRateLimits() {
  stampAttempts.clear();
  geocodeCache.clear();
}

function seedDemo(db) {
  const maya = db.prepare('SELECT id FROM users WHERE email = ?').get('maya@waymark.test');
  if (!maya) return;
  const samples = [
    { lat: 37.7955, lng: -122.3937, label: 'Ferry Building', locality: 'San Francisco, California, United States', note: 'Saturday market. Got the almond croissant.' },
    { lat: 37.8199, lng: -122.4783, label: 'Golden Gate Bridge', locality: 'San Francisco, California, United States', note: 'Fog lifted for ten minutes.' },
    { lat: 40.7580, lng: -73.9855, label: 'Times Square', locality: 'New York, New York, United States', note: 'Too loud. Still glad I came.' },
    { lat: 40.6892, lng: -74.0445, label: 'Statue of Liberty', locality: 'New York, New York, United States', note: '' },
  ];
  const insert = db.prepare(`
    INSERT INTO stamps(user_id, lat_micro, lng_micro, label, locality, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const s of samples) {
    insert.run(maya.id, toMicro(s.lat), toMicro(s.lng), s.label, s.locality, s.note);
  }
}

module.exports = {
  dropStamp,
  listStamps,
  getStamp,
  deleteStamp,
  stats,
  createShareLink,
  revokeShareLinks,
  getSharedBook,
  resetRateLimits,
  seedDemo,
  toMicro,
  fromMicro,
  publicDegrees,
};
