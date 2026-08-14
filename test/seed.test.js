const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const { verifyPassword } = require('../src/security');
const { createServer } = require('../src/web/server');
const { applyDemoSeed, DEMO_USERS } = require('../seed/seed');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(port);
    });
  });
}

function request(port, method, urlPath, { body, headers = {} } = {}) {
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
        Origin: `http://127.0.0.1:${port}`,
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end' , () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('demo seed for empty databases', () => {
  let db;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-seed-${process.pid}-${Date.now()}.db`));
  });

  it('inserts demo users into an empty database', () => {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    const result = applyDemoSeed(db);
    assert.equal(result.seeded, true);
    assert.equal(result.userCount, DEMO_USERS.length);
    const avery = db.prepare("SELECT * FROM users WHERE email='avery@firm.example'").get();
    assert.ok(avery);
    assert.equal(avery.role, 'admin');
    assert.ok(verifyPassword('demo-change-me', avery.password_hash));
  });

  it('does not duplicate users when called again', () => {
    applyDemoSeed(db);
    const second = applyDemoSeed(db);
    assert.equal(second.seeded, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, DEMO_USERS.length);
  });

  it('lets avery@firm.example sign in after seeding an empty DB', async () => {
    applyDemoSeed(db);
    const server = createServer(db);
    const port = await listen(server);
    try {
      const denied = await request(port, 'POST', '/api/login', {
        body: { email: 'nobody@firm.example', password: 'demo-change-me' },
      });
      assert.equal(denied.status, 401);
      assert.equal(denied.json.error, 'invalid_credentials');

      const ok = await request(port, 'POST', '/api/login', {
        body: { email: 'avery@firm.example', password: 'demo-change-me' },
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.user.email, 'avery@firm.example');
      assert.equal(ok.json.user.role, 'admin');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
