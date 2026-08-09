const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/web/server');
const timeSvc = require('../src/services/time');

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

describe('public security controls', () => {
  let db;
  let server;
  let port;

  beforeEach(async () => {
    db = resetDb(path.join(os.tmpdir(), `billing-sec-${process.pid}-${Date.now()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('avery@firm.example','Avery','admin',?)"
    ).run(hashPassword('demo-change-me'));
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('sam@firm.example','Sam','paralegal',?)"
    ).run(hashPassword('demo-change-me'));
    db.prepare("INSERT INTO clients(name) VALUES ('Acme')").run();
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, responsible_attorney_id, opened_on)
      VALUES (1, '2026-0099', 'Case', 'default', 1, '2026-01-01')
    `).run();
    server = createServer(db);
    port = await listen(server);
  });

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
      server = null;
    }
  });

  it('rejects email-only login and accepts password login with HttpOnly session + CSRF', async () => {
    const bad = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example' },
    });
    assert.equal(bad.status, 401);

    const ok = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.csrf);
    assert.ok(ok.json.token);
    assert.equal(ok.json.user.email, 'avery@firm.example');
    const cookie = sessionCookie(ok.setCookie);
    assert.match(cookie, /^session=/);
    assert.match(ok.setCookie.join(';'), /HttpOnly/i);

    const blocked = await request(port, 'POST', '/api/matters', {
      body: { name: 'No CSRF', clientId: 1 },
      cookies: cookie,
    });
    assert.equal(blocked.status, 403);

    const me = await request(port, 'GET', '/api/me', { cookies: cookie });
    assert.equal(me.status, 200);
    assert.ok(me.json.csrf);

    const created = await request(port, 'POST', '/api/matters', {
      body: { name: 'Secured Matter', clientId: 1 },
      cookies: cookie,
      headers: { 'X-CSRF-Token': me.json.csrf },
    });
    assert.equal(created.status, 201, created.raw);

    // Bearer token works even without cookies (preview/proxy fallback)
    const viaBearer = await request(port, 'GET', '/api/me', {
      headers: { Authorization: `Bearer ${ok.json.token}` },
    });
    assert.equal(viaBearer.status, 200);
    assert.equal(viaBearer.json.user.email, 'avery@firm.example');
  });

  it('sets security headers on HTML and JSON', async () => {
    const html = await request(port, 'GET', '/');
    assert.equal(html.status, 200);
    assert.equal(html.headers['x-content-type-options'], 'nosniff');
    assert.equal(html.headers['x-frame-options'], 'DENY');
    assert.match(html.headers['content-security-policy'] || '', /default-src 'self'/);

    const me = await request(port, 'GET', '/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.headers['x-content-type-options'], 'nosniff');
  });

  it('blocks paralegals from creating time for another timekeeper', () => {
    const sam = db.prepare("SELECT * FROM users WHERE email='sam@firm.example'").get();
    const avery = db.prepare("SELECT * FROM users WHERE email='avery@firm.example'").get();
    assert.throws(
      () => timeSvc.createEntry(db, sam, {
        matterId: 1,
        timekeeperId: avery.id,
        serviceDate: '2026-03-01',
        rawMinutes: 15,
        description: 'nope',
      }),
      /yourself/
    );
  });

});
