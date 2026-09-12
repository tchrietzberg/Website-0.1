const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/server');
const places = require('../src/places');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
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
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
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
        resolve({
          status: res.statusCode,
          json,
          raw,
          setCookie: res.headers['set-cookie'] || [],
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sessionCookie(setCookie) {
  const line = setCookie.find((c) => c.startsWith('session='));
  return line ? line.split(';')[0] : '';
}

async function login(port, email = 'alex@pinpoint.test') {
  const res = await request(port, 'POST', '/api/login', {
    body: { email, password: 'pinpoint-demo-1' },
  });
  assert.equal(res.status, 200, res.raw);
  return { cookie: sessionCookie(res.setCookie), csrf: res.json.csrf, user: res.json.user };
}

function authHeaders(session) {
  return { 'X-CSRF-Token': session.csrf };
}

describe('Pinpoint standalone app', () => {
  let db;
  let server;
  let port;

  beforeEach(async () => {
    db = resetDb(path.join(os.tmpdir(), `pinpoint-${process.pid}-${Date.now()}.db`));
    const hash = hashPassword('pinpoint-demo-1');
    db.prepare("INSERT INTO users(email,name,password_hash) VALUES ('alex@pinpoint.test','Alex',?)").run(hash);
    db.prepare("INSERT INTO users(email,name,password_hash) VALUES ('jordan@pinpoint.test','Jordan',?)").run(hash);
    db.prepare("INSERT INTO users(email,name,password_hash) VALUES ('riley@pinpoint.test','Riley',?)").run(hash);
    places.resetRateLimits();
    server = createServer(db);
    port = await listen(server);
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('is a separate product: HTML title is Pinpoint, not Chrono', async () => {
    const html = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/' }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject);
    });
    assert.match(html, /<title>Pinpoint<\/title>/);
    assert.equal(html.includes('Chrono'), false);
    assert.equal(html.includes('Create Matter'), false);
    assert.match(html, /apple-mobile-web-app-capable/);
    assert.match(html, /rel="manifest"/);
    assert.match(html, /class="phone"/);
  });

  it('serves an installable phone app manifest and service worker', async () => {
    const manifestRes = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/manifest.webmanifest' }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          type: res.headers['content-type'],
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      }).on('error', reject);
    });
    assert.equal(manifestRes.status, 200);
    assert.match(manifestRes.type, /manifest/);
    const manifest = JSON.parse(manifestRes.body);
    assert.equal(manifest.name, 'Pinpoint');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');

    const sw = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/sw.js' }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          type: res.headers['content-type'],
          allowed: res.headers['service-worker-allowed'],
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      }).on('error', reject);
    });
    assert.equal(sw.status, 200);
    assert.match(sw.type, /javascript/);
    assert.equal(sw.allowed, '/');
    assert.match(sw.body, /pinpoint-phone-v3/);
    assert.match(sw.body, /\/api\//);

    const icon = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/icons/icon-192.png' }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          type: res.headers['content-type'],
          bytes: Buffer.concat(chunks).length,
        }));
      }).on('error', reject);
    });
    assert.equal(icon.status, 200);
    assert.equal(icon.type, 'image/png');
    assert.ok(icon.bytes > 100);

    const leaflet = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/vendor/leaflet.js' }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          type: res.headers['content-type'],
          csp: res.headers['content-security-policy'] || '',
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      }).on('error', reject);
    });
    assert.equal(leaflet.status, 200);
    assert.match(leaflet.type, /javascript/);
    assert.match(leaflet.body, /Leaflet/);
    assert.match(leaflet.csp, /tile\.openstreetmap\.org/);

    const cfg = await request(port, 'GET', '/api/security-config');
    assert.equal(cfg.status, 200);
    assert.equal(cfg.json.googleMapsApiKey, null);
  });

  it('lets a new person sign up and keeps Chrono logins out', async () => {
    const signup = await request(port, 'POST', '/api/signup', {
      body: { email: 'sam@example.com', name: 'Sam', password: 'pinpoint-demo-1' },
    });
    assert.equal(signup.status, 200, signup.raw);
    assert.equal(signup.json.user.name, 'Sam');
    assert.ok(signup.json.csrf);

    const chrono = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    assert.equal(chrono.status, 401);
  });

  it('matches nearby pins into one chat room and hides rooms from non-visitors', async () => {
    const alex = await login(port);
    const jordan = await login(port, 'jordan@pinpoint.test');
    const riley = await login(port, 'riley@pinpoint.test');

    const pin = await request(port, 'POST', '/api/places/pins', {
      cookies: alex.cookie,
      headers: authHeaders(alex),
      body: { lat: 37.7955, lng: -122.3937, label: 'Ferry Building' },
    });
    assert.equal(pin.status, 201, pin.raw);
    const join = await request(port, 'POST', '/api/places/pins', {
      cookies: jordan.cookie,
      headers: authHeaders(jordan),
      body: { lat: 37.79552, lng: -122.39372, label: 'Ferry Building' },
    });
    assert.equal(join.status, 201, join.raw);
    assert.equal(join.json.id, pin.json.id);
    assert.equal(join.json.visitorCount, 2);

    const msg = await request(port, 'POST', `/api/places/${pin.json.id}/messages`, {
      cookies: alex.cookie,
      headers: authHeaders(alex),
      body: { body: 'Anyone still here?' },
    });
    assert.equal(msg.status, 201, msg.raw);
    assert.equal(msg.json.messages[0].body, 'Anyone still here?');

    const blocked = await request(port, 'GET', `/api/places/${pin.json.id}/messages`, {
      cookies: riley.cookie,
      headers: authHeaders(riley),
    });
    assert.equal(blocked.status, 404);
  });

  it('never returns another persons exact coordinates or logs them', async () => {
    const alex = await login(port);
    const jordan = await login(port, 'jordan@pinpoint.test');
    await request(port, 'POST', '/api/places/pins', {
      cookies: alex.cookie,
      headers: authHeaders(alex),
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
    for (const visitor of join.json.visitors) {
      assert.equal(visitor.lat, undefined);
    }
    const audits = db.prepare("SELECT detail_json FROM audit_log WHERE action LIKE 'place.%'").all();
    for (const row of audits) {
      assert.equal(String(row.detail_json || '').includes('37.795'), false);
    }
  });

  it('requires CSRF on pin drops', async () => {
    const alex = await login(port);
    const noCsrf = await request(port, 'POST', '/api/places/pins', {
      cookies: alex.cookie,
      body: { landmarkKey: 'ferry-building' },
    });
    assert.equal(noCsrf.status, 403);
    const ok = await request(port, 'POST', '/api/places/pins', {
      cookies: alex.cookie,
      headers: authHeaders(alex),
      body: { landmarkKey: 'ferry-building' },
    });
    assert.equal(ok.status, 201, ok.raw);
    assert.equal(ok.json.label, 'Ferry Building');
  });
});
