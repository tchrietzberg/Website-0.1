const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/server');
const stamps = require('../src/stamps');

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

async function login(port, email = 'maya@waymark.test') {
  const res = await request(port, 'POST', '/api/login', {
    body: { email, password: 'waymark-demo-1' },
  });
  assert.equal(res.status, 200, res.raw);
  return { cookie: sessionCookie(res.setCookie), csrf: res.json.csrf, user: res.json.user };
}

function authHeaders(session) {
  return { 'X-CSRF-Token': session.csrf };
}

describe('Waymark standalone app', () => {
  let db;
  let server;
  let port;

  beforeEach(async () => {
    db = resetDb(path.join(os.tmpdir(), `waymark-${process.pid}-${Date.now()}.db`));
    const hash = hashPassword('waymark-demo-1');
    db.prepare("INSERT INTO users(email,name,password_hash) VALUES ('maya@waymark.test','Maya',?)").run(hash);
    db.prepare("INSERT INTO users(email,name,password_hash) VALUES ('chris@waymark.test','Chris',?)").run(hash);
    stamps.resetRateLimits();
    server = createServer(db);
    port = await listen(server);
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('is a separate product: HTML title is Waymark, not Chrono', async () => {
    const html = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/' }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject);
    });
    assert.match(html, /<title>Waymark<\/title>/);
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
    assert.equal(manifest.name, 'Waymark');
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
    assert.match(sw.body, /waymark-phone-v1/);
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

    const cfg = await request(port, 'GET', '/api/security-config');
    assert.equal(cfg.status, 200);
    assert.equal(cfg.json.googleMapsApiKey, null);
  });

  it('lets a new person sign up and keeps Chrono logins out', async () => {
    const signup = await request(port, 'POST', '/api/signup', {
      body: { email: 'sam@example.com', name: 'Sam', password: 'waymark-demo-1' },
    });
    assert.equal(signup.status, 200, signup.raw);
    assert.equal(signup.json.user.name, 'Sam');
    assert.ok(signup.json.csrf);
    assert.match(signup.setCookie.join(';'), /HttpOnly/i);

    const chrono = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    assert.equal(chrono.status, 401);
  });

  it('saves a private stamp and hides it from other accounts', async () => {
    const maya = await login(port);
    const chris = await login(port, 'chris@waymark.test');
    const created = await request(port, 'POST', '/api/stamps', {
      cookies: maya.cookie,
      headers: authHeaders(maya),
      body: { lat: 37.7955, lng: -122.3937, label: 'Ferry Building', locality: 'San Francisco', note: 'Market day' },
    });
    assert.equal(created.status, 201, created.raw);
    assert.equal(created.json.label, 'Ferry Building');
    assert.equal(created.json.note, 'Market day');
    assert.ok(Number.isFinite(created.json.lat));

    const listed = await request(port, 'GET', '/api/stamps', {
      cookies: chris.cookie,
      headers: authHeaders(chris),
    });
    assert.equal(listed.status, 200);
    assert.equal(listed.json.stamps.length, 0);

    const blocked = await request(port, 'GET', `/api/stamps/${created.json.id}`, {
      cookies: chris.cookie,
      headers: authHeaders(chris),
    });
    assert.equal(blocked.status, 404);
  });

  it('quantizes coordinates on a shared book and never logs exact GPS', async () => {
    const maya = await login(port);
    const pin = await request(port, 'POST', '/api/stamps', {
      cookies: maya.cookie,
      headers: authHeaders(maya),
      body: { lat: 37.7955123, lng: -122.3937456, label: 'Ferry Building', locality: 'San Francisco' },
    });
    assert.equal(pin.status, 201, pin.raw);
    assert.ok(Math.abs(pin.json.lat - 37.7955123) < 0.000001);

    const share = await request(port, 'POST', '/api/share', {
      cookies: maya.cookie,
      headers: authHeaders(maya),
    });
    assert.equal(share.status, 201, share.raw);
    const book = await request(port, 'GET', `/api/books/${share.json.token}`);
    assert.equal(book.status, 200, book.raw);
    assert.equal(book.json.ownerName, 'Maya');
    assert.equal(book.json.stamps.length, 1);
    assert.equal(String(JSON.stringify(book.json)).includes('37.795512'), false);
    assert.equal(book.json.stamps[0].lat, 37.796);
    assert.ok(Math.abs(book.json.stamps[0].lat - pin.json.lat) > 0.0001);

    const chris = await login(port, 'chris@waymark.test');
    const stolen = await request(port, 'GET', `/api/stamps/${pin.json.id}`, {
      cookies: chris.cookie,
      headers: authHeaders(chris),
    });
    assert.equal(stolen.status, 404);

    const audits = db.prepare("SELECT detail_json FROM audit_log WHERE action LIKE 'stamp.%'").all();
    for (const row of audits) {
      assert.equal(String(row.detail_json || '').includes('37.795'), false);
    }
  });

  it('requires CSRF on stamp creates and reports stats', async () => {
    const maya = await login(port);
    const noCsrf = await request(port, 'POST', '/api/stamps', {
      cookies: maya.cookie,
      body: { lat: 40.758, lng: -73.9855, label: 'Times Square' },
    });
    assert.equal(noCsrf.status, 403);

    const ok = await request(port, 'POST', '/api/stamps', {
      cookies: maya.cookie,
      headers: authHeaders(maya),
      body: { lat: 40.758, lng: -73.9855, label: 'Times Square', locality: 'New York' },
    });
    assert.equal(ok.status, 201, ok.raw);

    const stats = await request(port, 'GET', '/api/stats', {
      cookies: maya.cookie,
      headers: authHeaders(maya),
    });
    assert.equal(stats.status, 200);
    assert.equal(stats.json.stampCount, 1);
    assert.equal(stats.json.localityCount, 1);

    const del = await request(port, 'DELETE', `/api/stamps/${ok.json.id}`, {
      cookies: maya.cookie,
      headers: authHeaders(maya),
    });
    assert.equal(del.status, 200);
    const empty = await request(port, 'GET', '/api/stamps', {
      cookies: maya.cookie,
      headers: authHeaders(maya),
    });
    assert.equal(empty.json.stamps.length, 0);
  });
});
