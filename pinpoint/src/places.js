/**
 * Location pins + same-place chat for Pinpoint.
 * Coordinates are integer microdegrees. Matching uses a 100m radius.
 * Exact coordinates are never returned for other users and never written to audit logs.
 */
const { audit } = require('./db');

const MICRO_PER_DEGREE = 1_000_000;
const MATCH_RADIUS_M = 100;
const METERS_PER_LAT_MICRO = 0.111132;
const PUBLIC_QUANTUM_MICRO = 1_000;
const MAX_LABEL = 80;
const MAX_NOTE = 280;
const MAX_MESSAGE = 2000;
const PIN_WINDOW_MS = 10 * 60 * 1000;
const PIN_MAX = 20;
const MSG_WINDOW_MS = 10 * 60 * 1000;
const MSG_MAX = 40;

const pinAttempts = new Map();
const msgAttempts = new Map();

const LANDMARKS = [
  { key: 'ferry-building', label: 'Ferry Building', lat: 37.7955, lng: -122.3937 },
  { key: 'civic-center', label: 'Civic Center Plaza', lat: 37.7793, lng: -122.4193 },
  { key: 'golden-gate-park', label: 'Golden Gate Park', lat: 37.7694, lng: -122.4862 },
  { key: 'embarcadero', label: 'The Embarcadero', lat: 37.7993, lng: -122.3977 },
  { key: 'union-square', label: 'Union Square', lat: 37.7879, lng: -122.4074 },
];

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

function distanceMeters(lat1, lng1, lat2, lng2) {
  const meanLatRad = ((lat1 + lat2) / 2) / MICRO_PER_DEGREE * Math.PI / 180;
  const dLatM = (lat1 - lat2) * METERS_PER_LAT_MICRO;
  const dLngM = (lng1 - lng2) * METERS_PER_LAT_MICRO * Math.cos(meanLatRad);
  return Math.sqrt(dLatM * dLatM + dLngM * dLngM);
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
  return `Pin ${publicDegrees(latMicro).toFixed(3)}, ${publicDegrees(lngMicro).toFixed(3)}`;
}

function findNearbyPlace(db, latMicro, lngMicro) {
  const pad = Math.ceil(MATCH_RADIUS_M / METERS_PER_LAT_MICRO) + 200;
  const rows = db.prepare(`
    SELECT id, label, lat_micro, lng_micro
    FROM places
    WHERE lat_micro BETWEEN ? AND ? AND lng_micro BETWEEN ? AND ?
  `).all(latMicro - pad, latMicro + pad, lngMicro - pad, lngMicro + pad);
  let best = null;
  let bestD = Infinity;
  for (const row of rows) {
    const d = distanceMeters(latMicro, lngMicro, row.lat_micro, row.lng_micro);
    if (d <= MATCH_RADIUS_M && d < bestD) {
      best = row;
      bestD = d;
    }
  }
  return best;
}

function hasVisited(db, userId, placeId) {
  return Boolean(db.prepare(
    'SELECT 1 AS ok FROM place_visits WHERE user_id = ? AND place_id = ? LIMIT 1'
  ).get(userId, placeId));
}

function serializePlace(db, userId, place) {
  const visitors = db.prepare(`
    SELECT u.id, u.name, COUNT(v.id) AS visit_count, MAX(v.created_at) AS last_visited_at
    FROM place_visits v
    JOIN users u ON u.id = v.user_id
    WHERE v.place_id = ?
    GROUP BY u.id, u.name
    ORDER BY last_visited_at DESC, u.name COLLATE NOCASE
  `).all(place.id);
  const myVisits = db.prepare(`
    SELECT id, note, created_at, lat_micro, lng_micro
    FROM place_visits WHERE place_id = ? AND user_id = ? ORDER BY id DESC
  `).all(place.id, userId);
  const lastMsg = db.prepare(
    'SELECT MAX(created_at) AS last_message_at FROM place_messages WHERE place_id = ?'
  ).get(place.id);
  return {
    id: place.id,
    label: place.label,
    approxLat: publicDegrees(place.lat_micro),
    approxLng: publicDegrees(place.lng_micro),
    visitorCount: visitors.length,
    lastMessageAt: lastMsg?.last_message_at || null,
    visitors: visitors.map((v) => ({
      id: v.id,
      name: v.name,
      visitCount: v.visit_count,
      lastVisitedAt: v.last_visited_at,
    })),
    myVisits: myVisits.map((v) => ({
      id: v.id,
      note: v.note || '',
      createdAt: v.created_at,
      lat: fromMicro(v.lat_micro),
      lng: fromMicro(v.lng_micro),
    })),
  };
}

function listLandmarks() {
  return LANDMARKS.map((s) => ({
    key: s.key,
    label: s.label,
    approxLat: publicDegrees(toMicro(s.lat)),
    approxLng: publicDegrees(toMicro(s.lng)),
  }));
}

function listMyPlaces(db, userId) {
  const places = db.prepare(`
    SELECT p.id, p.label, p.lat_micro, p.lng_micro,
           COUNT(DISTINCT v2.user_id) AS visitor_count,
           MAX(v.created_at) AS last_visited_at,
           (SELECT MAX(m.created_at) FROM place_messages m WHERE m.place_id = p.id) AS last_message_at
    FROM place_visits v
    JOIN places p ON p.id = v.place_id
    JOIN place_visits v2 ON v2.place_id = p.id
    WHERE v.user_id = ?
    GROUP BY p.id
    ORDER BY last_visited_at DESC, p.id DESC
  `).all(userId);
  const pins = db.prepare(`
    SELECT v.id, v.place_id, v.note, v.created_at, v.lat_micro, v.lng_micro,
           p.label AS place_label,
           (SELECT COUNT(DISTINCT user_id) FROM place_visits WHERE place_id = v.place_id) AS visitor_count
    FROM place_visits v
    JOIN places p ON p.id = v.place_id
    WHERE v.user_id = ?
    ORDER BY v.id DESC
  `).all(userId);
  return {
    places: places.map((p) => ({
      id: p.id,
      label: p.label,
      approxLat: publicDegrees(p.lat_micro),
      approxLng: publicDegrees(p.lng_micro),
      visitorCount: p.visitor_count,
      lastVisitedAt: p.last_visited_at,
      lastMessageAt: p.last_message_at,
    })),
    myPins: pins.map((row) => ({
      id: row.id,
      placeId: row.place_id,
      placeLabel: row.place_label,
      note: row.note || '',
      createdAt: row.created_at,
      lat: fromMicro(row.lat_micro),
      lng: fromMicro(row.lng_micro),
      visitorCount: row.visitor_count,
    })),
  };
}

function getPlace(db, userId, placeId) {
  const place = db.prepare('SELECT id, label, lat_micro, lng_micro FROM places WHERE id = ?')
    .get(placeId);
  if (!place || !hasVisited(db, userId, placeId)) {
    throw fail('Place not found', 404, 'not_found');
  }
  return serializePlace(db, userId, place);
}

function dropPin(db, user, body, req = null) {
  const limit = rateOk(pinAttempts, user.id, PIN_WINDOW_MS, PIN_MAX);
  if (!limit.ok) throw fail('Too many pins. Try again later.', 429, 'rate_limited');
  const { latMicro, lngMicro } = parseLatLng(body);
  const label = cleanText(body.label, MAX_LABEL);
  const note = cleanText(body.note, MAX_NOTE);
  let placeId;
  db.exec('BEGIN');
  try {
    const nearby = findNearbyPlace(db, latMicro, lngMicro);
    if (nearby) {
      placeId = nearby.id;
      if (label && nearby.label.startsWith('Pin ')) {
        db.prepare('UPDATE places SET label = ? WHERE id = ?').run(label, nearby.id);
      }
    } else {
      const ins = db.prepare(
        'INSERT INTO places(label, lat_micro, lng_micro, created_by) VALUES (?, ?, ?, ?)'
      ).run(label || defaultLabel(latMicro, lngMicro), latMicro, lngMicro, user.id);
      placeId = Number(ins.lastInsertRowid);
    }
    db.prepare(
      'INSERT INTO place_visits(place_id, user_id, lat_micro, lng_micro, note) VALUES (?, ?, ?, ?, ?)'
    ).run(placeId, user.id, latMicro, lngMicro, note || null);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
  audit(db, {
    actorId: user.id,
    action: 'place.pin',
    entityType: 'place',
    entityId: placeId,
    detail: { note: Boolean(note), labeled: Boolean(label) },
    req,
  });
  return getPlace(db, user.id, placeId);
}

function checkInLandmark(db, user, key, req = null) {
  const spot = LANDMARKS.find((s) => s.key === String(key || '').trim());
  if (!spot) throw fail('Unknown landmark');
  return dropPin(db, user, { lat: spot.lat, lng: spot.lng, label: spot.label }, req);
}

function listMessages(db, userId, placeId, afterId = 0) {
  const place = db.prepare('SELECT id FROM places WHERE id = ?').get(placeId);
  if (!place || !hasVisited(db, userId, placeId)) {
    throw fail('Place not found', 404, 'not_found');
  }
  const after = Math.max(0, Number(afterId) || 0);
  const rows = db.prepare(`
    SELECT m.id, m.body, m.created_at, m.user_id, u.name AS author_name
    FROM place_messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.place_id = ? AND m.id > ?
    ORDER BY m.id ASC
    LIMIT 200
  `).all(placeId, after);
  return {
    messages: rows.map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      authorId: m.user_id,
      authorName: m.author_name,
      mine: m.user_id === userId,
    })),
  };
}

function postMessage(db, user, placeId, body, req = null) {
  const place = db.prepare('SELECT id FROM places WHERE id = ?').get(placeId);
  if (!place || !hasVisited(db, user.id, placeId)) {
    throw fail('Place not found', 404, 'not_found');
  }
  const limit = rateOk(msgAttempts, user.id, MSG_WINDOW_MS, MSG_MAX);
  if (!limit.ok) throw fail('Too many messages. Try again later.', 429, 'rate_limited');
  const text = cleanText(body && body.body, MAX_MESSAGE);
  if (!text) throw fail('Message cannot be empty');
  const ins = db.prepare(
    'INSERT INTO place_messages(place_id, user_id, body) VALUES (?, ?, ?)'
  ).run(placeId, user.id, text);
  audit(db, {
    actorId: user.id,
    action: 'place.message',
    entityType: 'place',
    entityId: placeId,
    detail: { messageId: Number(ins.lastInsertRowid) },
    req,
  });
  return listMessages(db, user.id, placeId, 0);
}

function seedDemo(db) {
  pinAttempts.clear();
  msgAttempts.clear();
  const byEmail = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  const alex = byEmail('alex@pinpoint.test');
  const jordan = byEmail('jordan@pinpoint.test');
  const riley = byEmail('riley@pinpoint.test');
  if (!alex || !jordan) return { seeded: false };
  if (db.prepare('SELECT COUNT(*) AS n FROM places').get().n > 0) return { seeded: false };

  const actors = [
    { user: alex, landmark: 'ferry-building', note: 'Sunset walk' },
    { user: jordan, landmark: 'ferry-building', note: 'Coffee' },
    { user: riley, landmark: 'ferry-building', note: 'Waiting by the arcade' },
    { user: riley, landmark: 'civic-center', note: 'On the lawn' },
    { user: alex, landmark: 'civic-center', note: 'Passing through' },
    { user: jordan, landmark: 'golden-gate-park', note: 'Walking the loop' },
  ];
  for (const row of actors) {
    const spot = LANDMARKS.find((s) => s.key === row.landmark);
    dropPin(db, row.user, { lat: spot.lat, lng: spot.lng, label: spot.label, note: row.note });
  }
  const ferry = findNearbyPlace(db, toMicro(37.7955), toMicro(-122.3937));
  const civic = findNearbyPlace(db, toMicro(37.7793), toMicro(-122.4193));
  if (ferry) {
    db.prepare('INSERT INTO place_messages(place_id, user_id, body) VALUES (?, ?, ?)')
      .run(ferry.id, jordan.id, 'Anyone still at the Ferry Building? I am by the north arcade.');
    db.prepare('INSERT INTO place_messages(place_id, user_id, body) VALUES (?, ?, ?)')
      .run(ferry.id, alex.id, 'Just pinned — grabbing a table if you want to hang.');
    db.prepare('INSERT INTO place_messages(place_id, user_id, body) VALUES (?, ?, ?)')
      .run(ferry.id, riley.id, 'On my way. Two minutes.');
  }
  if (civic) {
    db.prepare('INSERT INTO place_messages(place_id, user_id, body) VALUES (?, ?, ?)')
      .run(civic.id, riley.id, 'It is quiet on the Civic Center lawn this morning.');
  }
  return { seeded: true };
}

function resetRateLimits() {
  pinAttempts.clear();
  msgAttempts.clear();
}

module.exports = {
  LANDMARKS,
  MATCH_RADIUS_M,
  toMicro,
  fromMicro,
  publicDegrees,
  distanceMeters,
  listLandmarks,
  listMyPlaces,
  getPlace,
  dropPin,
  checkInLandmark,
  listMessages,
  postMessage,
  seedDemo,
  findNearbyPlace,
  resetRateLimits,
};
