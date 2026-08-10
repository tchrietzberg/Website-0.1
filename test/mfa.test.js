const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting, audit } = require('../src/db');
const { hashPassword, sessionSecret } = require('../src/security');
const mfa = require('../src/mfa');
const { createServer } = require('../src/web/server');

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
        resolve({
          status: res.statusCode,
          headers: res.headers,
          setCookie: res.headers['set-cookie'] || [],
          json,
          raw,
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

function currentTotp(secretBase32) {
  const crypto = require('node:crypto');
  const secretBuf = mfa.base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  return String((
    ((hmac[offset] & 0x7f) << 24)
    | (hmac[offset + 1] << 16)
    | (hmac[offset + 2] << 8)
    | hmac[offset + 3]
  ) % 1_000_000).padStart(6, '0');
}

describe('MFA TOTP', () => {
  it('generates and verifies TOTP codes', () => {
    const secret = mfa.generateSecret(20);
    assert.equal(mfa.verifyTotp(secret, currentTotp(secret)), true);
    assert.equal(mfa.verifyTotp(secret, '000000'), false);
  });

  it('seals and opens MFA secrets', () => {
    const sealed = mfa.sealSecret('ABC123SECRET', 'test-key-material');
    assert.match(sealed, /^v1\./);
    assert.equal(mfa.openSecret(sealed, 'test-key-material'), 'ABC123SECRET');
  });
});

describe('MFA login + audit hardening', () => {
  let db;
  let server;
  let port;
  let prevCookieOnly;

  beforeEach(async () => {
    prevCookieOnly = process.env.COOKIE_ONLY_AUTH;
    delete process.env.COOKIE_ONLY_AUTH;
    db = resetDb(path.join(os.tmpdir(), `billing-mfa-${process.pid}-${Date.now()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('avery@firm.example','Avery','admin',?)"
    ).run(hashPassword('demo-change-me'));
    server = createServer(db);
    port = await listen(server);
  });

  afterEach(async () => {
    if (prevCookieOnly === undefined) delete process.env.COOKIE_ONLY_AUTH;
    else process.env.COOKIE_ONLY_AUTH = prevCookieOnly;
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
      server = null;
    }
  });

  it('requires TOTP after password when MFA is enabled', async () => {
    const login = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login.setCookie);
    const csrf = login.json.csrf;

    const setup = await request(port, 'POST', '/api/mfa/setup', {
      cookies: cookie,
      headers: { 'X-CSRF-Token': csrf },
      body: {},
    });
    assert.equal(setup.status, 200, setup.raw);
    assert.ok(setup.json.secret);
    assert.ok(Array.isArray(setup.json.backupCodes));

    const enabled = await request(port, 'POST', '/api/mfa/enable', {
      cookies: cookie,
      headers: { 'X-CSRF-Token': csrf },
      body: { code: currentTotp(setup.json.secret) },
    });
    assert.equal(enabled.status, 200, enabled.raw);
    assert.equal(enabled.json.enabled, true);

    await request(port, 'POST', '/api/logout', {
      cookies: cookie,
      headers: { 'X-CSRF-Token': csrf },
      body: {},
    });

    const step1 = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    assert.equal(step1.status, 200);
    assert.equal(step1.json.mfaRequired, true);
    assert.ok(step1.json.mfaToken);
    assert.equal(step1.json.token, undefined);

    const bad = await request(port, 'POST', '/api/login/mfa', {
      body: { mfaToken: step1.json.mfaToken, code: '000000' },
    });
    assert.equal(bad.status, 401);

    const step1b = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    const step2 = await request(port, 'POST', '/api/login/mfa', {
      body: { mfaToken: step1b.json.mfaToken, code: currentTotp(setup.json.secret) },
    });
    assert.equal(step2.status, 200, step2.raw);
    assert.ok(step2.json.csrf);
    assert.equal(step2.json.user.email, 'avery@firm.example');
    assert.match(sessionCookie(step2.setCookie), /^session=/);
  });

  it('omits session token JSON when COOKIE_ONLY_AUTH=1', async () => {
    process.env.COOKIE_ONLY_AUTH = '1';
    const ok = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.token, undefined);
    assert.ok(ok.json.csrf);
    assert.match(sessionCookie(ok.setCookie), /^session=/);

    const cfg = await request(port, 'GET', '/api/security-config');
    assert.equal(cfg.status, 200);
    assert.equal(cfg.json.cookieOnlyAuth, true);

    const tokenRow = db.prepare('SELECT token FROM sessions LIMIT 1').get();
    assert.ok(tokenRow?.token);
    const viaBearer = await request(port, 'GET', '/api/me', {
      headers: { Authorization: `Bearer ${tokenRow.token}` },
    });
    assert.equal(viaBearer.status, 200);
    assert.equal(viaBearer.json.user, null);

    const me = await request(port, 'GET', '/api/me', {
      cookies: sessionCookie(ok.setCookie),
    });
    assert.equal(me.json.user.email, 'avery@firm.example');
  });

  it('writes audit ip and state_hash', () => {
    const secret = sessionSecret(db);
    assert.ok(secret);
    audit(db, {
      actorId: 1,
      action: 'test.action',
      entityType: 'matter',
      entityId: 9,
      detail: { x: 1 },
      ip: '203.0.113.10',
      userAgent: 'test-agent',
    });
    const row = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get();
    assert.equal(row.ip, '203.0.113.10');
    assert.equal(row.user_agent, 'test-agent');
    assert.match(String(row.state_hash || ''), /^[a-f0-9]{64}$/);
  });
});
