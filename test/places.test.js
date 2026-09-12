const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/web/server');
const placesSvc = require('../src/services/places');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(port);
    });
  });
}

function request(port, method, urlPath, { body, headers = {}, cookies = '' } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        } : {}),
        ...(cookies ? { Cookie: cookies } : {}),
        Origin: `http://127.0.0.1:${port}`,
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
        const setCookie = res.headers['set-cookie'] || [];
        resolve({ status: res.statusCode, headers: res.headers, setCookie, json, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sessionCookie(setCookie) {
  const line = setCookie.find((c) => c.startsWith('session='));
  if (!line) return '';
  return line.split(';')[0];
}

async function login(port, email = 'avery@firm.example') {
  const res = await request(port, 'POST', '/api/login', {
    body: { email, password: 'demo-change-me' },
  });
  assert.equal(res.status, 200, res.raw);
  return {
    cookie: sessionCookie(res.setCookie),
    csrf: res.json.csrf,
    user: res.json.user,
  };
}

function authHeaders(session) {
  return { 'X-CSRF-Token': session.csrf };
}

describe('places pins and same-location chat', () => {
  let db;
  let server;
  let port;

  beforeEach(async () => {
    db = resetDb(path.join(os.tmpdir(), `places-${process.pid}-${Date.now()}.db`));
    const hash = hashPassword('demo-change-me');
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('avery@firm.example','Avery','admin',?)"
    ).run(hash);
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('jordan@firm.example','Jordan','attorney',?)"
    ).run(hash);
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('riley@firm.example','Riley','attorney',?)"
    ).run(hash);
    placesSvc.resetRateLimits();
    server = createServer(db);
    port = await listen(server);
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('matches nearby pins into one place and keeps distant pins separate', () => {
    const avery = db.prepare("SELECT * FROM users WHERE email='avery@firm.example'").get();
    const jordan = db.prepare("SELECT * FROM users WHERE email='jordan@firm.example'").get();
    const riley = db.prepare("SELECT * FROM users WHERE email='riley@firm.example'").get();

    const ferry = placesSvc.dropPin(db, avery, {
      lat: 37.7955, lng: -122.3937, label: 'Ferry Building',
    });
    const nearby = placesSvc.dropPin(db, jordan, {
      lat: 37.79555, lng: -122.39375, label: 'Arcade',
    });
    const civic = placesSvc.dropPin(db, riley, {
      lat: 37.7793, lng: -122.4193, label: 'Civic Center Plaza',
    });

    assert.equal(nearby.id, ferry.id);
    assert.notEqual(civic.id, ferry.id);
    assert.equal(nearby.visitorCount, 2);
    assert.equal(civic.visitorCount, 1);
    assert.ok(nearby.visitors.some((v) => v.name === 'Avery'));
    assert.ok(nearby.visitors.some((v) => v.name === 'Jordan'));
  });

  it('lets visitors chat and hides rooms from people who were never there', async () => {
    const avery = await login(port);
    const jordan = await login(port, 'jordan@firm.example');
    const riley = await login(port, 'riley@firm.example');

    const pin = await request(port, 'POST', '/api/places/pins', {
      cookies: avery.cookie,
      headers: authHeaders(avery),
      body: { lat: 37.7955, lng: -122.3937, label: 'Ferry Building' },
    });
    assert.equal(pin.status, 201, pin.raw);
    const placeId = pin.json.id;

    const join = await request(port, 'POST', '/api/places/pins', {
      cookies: jordan.cookie,
      headers: authHeaders(jordan),
      body: { lat: 37.79552, lng: -122.39372, label: 'Ferry Building' },
    });
    assert.equal(join.status, 201, join.raw);
    assert.equal(join.json.id, placeId);

    const msg = await request(port, 'POST', `/api/places/${placeId}/messages`, {
      cookies: avery.cookie,
      headers: authHeaders(avery),
      body: { body: 'Anyone still here?' },
    });
    assert.equal(msg.status, 201, msg.raw);
    assert.equal(msg.json.messages[0].body, 'Anyone still here?');
    assert.equal(msg.json.messages[0].mine, true);

    const inbox = await request(port, 'GET', `/api/places/${placeId}/messages`, {
      cookies: jordan.cookie,
      headers: authHeaders(jordan),
    });
    assert.equal(inbox.status, 200, inbox.raw);
    assert.equal(inbox.json.messages.length, 1);
    assert.equal(inbox.json.messages[0].mine, false);
    assert.equal(inbox.json.messages[0].authorName, 'Avery');

    const blocked = await request(port, 'GET', `/api/places/${placeId}/messages`, {
      cookies: riley.cookie,
      headers: authHeaders(riley),
    });
    assert.equal(blocked.status, 404);

    const blockedPost = await request(port, 'POST', `/api/places/${placeId}/messages`, {
      cookies: riley.cookie,
      headers: authHeaders(riley),
      body: { body: 'should not post' },
    });
    assert.equal(blockedPost.status, 404);
  });

  it('never returns other users exact coordinates or logs them', async () => {
    const avery = await login(port);
    const jordan = await login(port, 'jordan@firm.example');

    await request(port, 'POST', '/api/places/pins', {
      cookies: avery.cookie,
      headers: authHeaders(avery),
      body: { lat: 37.7955123, lng: -122.3937456, label: 'Ferry Building' },
    });
    const join = await request(port, 'POST', '/api/places/pins', {
      cookies: jordan.cookie,
      headers: authHeaders(jordan),
      body: { lat: 37.7955999, lng: -122.3937111, label: 'Ferry Building' },
    });
    assert.equal(join.status, 201, join.raw);

    const listed = JSON.stringify(join.json);
    assert.equal(listed.includes('37.7955123'), false);
    assert.equal(listed.includes('-122.3937456'), false);
    assert.ok(join.json.visitors.some((v) => v.name === 'Avery'));
    for (const visitor of join.json.visitors) {
      assert.equal(visitor.lat, undefined);
      assert.equal(visitor.lng, undefined);
    }
    assert.ok(join.json.myVisits[0].lat);
    assert.ok(join.json.approxLat);
    // Public centroid is quantized, not the raw GPS reading.
    assert.notEqual(join.json.approxLat, 37.7955999);

    const audits = db.prepare('SELECT action, detail_json FROM audit_log WHERE action LIKE ?')
      .all('place.%');
    assert.ok(audits.length >= 2);
    for (const row of audits) {
      assert.equal(String(row.detail_json || '').includes('37.795'), false);
      assert.equal(String(row.detail_json || '').includes('-122.39'), false);
    }
  });

  it('requires CSRF on pin drops and rejects out-of-range coordinates', async () => {
    const avery = await login(port);
    const noCsrf = await request(port, 'POST', '/api/places/pins', {
      cookies: avery.cookie,
      body: { lat: 37.7, lng: -122.4, label: 'Nope' },
    });
    assert.equal(noCsrf.status, 403);

    const bad = await request(port, 'POST', '/api/places/pins', {
      cookies: avery.cookie,
      headers: authHeaders(avery),
      body: { lat: 200, lng: 0, label: 'Nope' },
    });
    assert.equal(bad.status, 400);

    const landmarks = await request(port, 'GET', '/api/places/landmarks', {
      cookies: avery.cookie,
    });
    assert.equal(landmarks.status, 200);
    assert.ok(landmarks.json.landmarks.length >= 3);

    const checkin = await request(port, 'POST', '/api/places/pins', {
      cookies: avery.cookie,
      headers: authHeaders(avery),
      body: { landmarkKey: 'ferry-building' },
    });
    assert.equal(checkin.status, 201, checkin.raw);
    assert.equal(checkin.json.label, 'Ferry Building');
  });

  it('lists only rooms the signed-in user has visited', async () => {
    const avery = await login(port);
    const riley = await login(port, 'riley@firm.example');
    await request(port, 'POST', '/api/places/pins', {
      cookies: avery.cookie,
      headers: authHeaders(avery),
      body: { landmarkKey: 'ferry-building' },
    });
    await request(port, 'POST', '/api/places/pins', {
      cookies: riley.cookie,
      headers: authHeaders(riley),
      body: { landmarkKey: 'civic-center' },
    });

    const mine = await request(port, 'GET', '/api/places', {
      cookies: avery.cookie,
    });
    assert.equal(mine.status, 200, mine.raw);
    assert.equal(mine.json.places.length, 1);
    assert.equal(mine.json.places[0].label, 'Ferry Building');
    assert.equal(mine.json.myPins.length, 1);
    assert.ok(mine.json.myPins[0].lat);
  });
});
