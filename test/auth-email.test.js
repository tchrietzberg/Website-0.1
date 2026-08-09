const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/web/server');
const mail = require('../src/mail');

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

async function loginAdmin(port) {
  const ok = await request(port, 'POST', '/api/login', {
    body: { email: 'avery@firm.example', password: 'demo-change-me' },
  });
  assert.equal(ok.status, 200);
  return {
    cookie: sessionCookie(ok.setCookie),
    csrf: ok.json.csrf,
    token: ok.json.token,
  };
}

describe('secure email auth flows', () => {
  let db;
  let server;
  let port;
  let prevOutbound;

  beforeEach(async () => {
    mail.clearOutbox();
    prevOutbound = process.env.OUTBOUND_EMAIL;
    delete process.env.OUTBOUND_EMAIL;
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_FROM_NAME;
    delete process.env.MAIL_FROM;
    db = resetDb(path.join(os.tmpdir(), `billing-auth-email-${process.pid}-${Date.now()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('avery@firm.example','Avery','admin',?)"
    ).run(hashPassword('demo-change-me'));
    server = createServer(db);
    port = await listen(server);
  });

  afterEach(async () => {
    mail.clearOutbox();
    if (prevOutbound === undefined) delete process.env.OUTBOUND_EMAIL;
    else process.env.OUTBOUND_EMAIL = prevOutbound;
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
      server = null;
    }
  });

  it('invites a user with a shareable link (email deferred until go-live)', async () => {
    const admin = await loginAdmin(port);
    const invited = await request(port, 'POST', '/api/users', {
      body: {
        invite: true,
        email: 'newhire@firm.example',
        name: 'New Hire',
        role: 'attorney',
        defaultRateCents: 25000,
        rateEffectiveDate: '2026-01-01',
      },
      cookies: admin.cookie,
      headers: {
        'X-CSRF-Token': admin.csrf,
        Authorization: `Bearer ${admin.token}`,
      },
    });
    assert.equal(invited.status, 201);
    assert.equal(invited.json.user.email, 'newhire@firm.example');
    assert.ok(invited.json.devToken);
    assert.ok(invited.json.devLink);
    assert.equal(invited.json.delivery.mode, 'deferred');
    assert.equal(mail.getOutbox().length, 0);

    const info = await request(port, 'GET', `/api/auth/token-info?token=${encodeURIComponent(invited.json.devToken)}`);
    assert.equal(info.status, 200);
    assert.equal(info.json.valid, true);
    assert.equal(info.json.purpose, 'invite');

    const setPwd = await request(port, 'POST', '/api/auth/set-password', {
      body: { token: invited.json.devToken, password: 'secure-password-1' },
    });
    assert.equal(setPwd.status, 200);
    assert.equal(setPwd.json.user.email, 'newhire@firm.example');
    assert.ok(setPwd.json.token);
    assert.ok(sessionCookie(setPwd.setCookie).startsWith('session='));

    const login = await request(port, 'POST', '/api/login', {
      body: { email: 'newhire@firm.example', password: 'secure-password-1' },
    });
    assert.equal(login.status, 200);

    // Token is single-use
    const reuse = await request(port, 'POST', '/api/auth/set-password', {
      body: { token: invited.json.devToken, password: 'another-password-1' },
    });
    assert.equal(reuse.status, 400);
  });

  it('defers public password-reset and magic-link email until outbound is enabled', async () => {
    const reset = await request(port, 'POST', '/api/password-reset/request', {
      body: { email: 'avery@firm.example' },
    });
    assert.equal(reset.status, 503);
    assert.match(reset.json.message, /live domain|admin/i);

    const magic = await request(port, 'POST', '/api/login/magic/request', {
      body: { email: 'avery@firm.example' },
    });
    assert.equal(magic.status, 503);
    assert.match(magic.json.message, /password|live domain/i);
    assert.equal(mail.getOutbox().length, 0);
  });

  it('admin can create a password reset link without sending email', async () => {
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('riley@firm.example','Riley','attorney',?)"
    ).run(hashPassword('demo-change-me'));
    const riley = db.prepare("SELECT id FROM users WHERE email='riley@firm.example'").get();
    const admin = await loginAdmin(port);
    const sent = await request(port, 'POST', `/api/users/${riley.id}/send-reset`, {
      body: {},
      cookies: admin.cookie,
      headers: {
        'X-CSRF-Token': admin.csrf,
        Authorization: `Bearer ${admin.token}`,
      },
    });
    assert.equal(sent.status, 200);
    assert.ok(sent.json.devToken);
    assert.ok(sent.json.devLink);
    assert.equal(sent.json.delivery.mode, 'deferred');
    assert.equal(mail.getOutbox().length, 0);

    const done = await request(port, 'POST', '/api/auth/set-password', {
      body: { token: sent.json.devToken, password: 'reset-password-ok' },
    });
    assert.equal(done.status, 200);

    const newLogin = await request(port, 'POST', '/api/login', {
      body: { email: 'riley@firm.example', password: 'reset-password-ok' },
    });
    assert.equal(newLogin.status, 200);
  });

  it('when OUTBOUND_EMAIL=1, invite still logs when SMTP/Resend is unset', async () => {
    process.env.OUTBOUND_EMAIL = '1';
    const admin = await loginAdmin(port);
    const invited = await request(port, 'POST', '/api/users', {
      body: {
        invite: true,
        email: 'mailed@firm.example',
        name: 'Mailed Hire',
        role: 'paralegal',
      },
      cookies: admin.cookie,
      headers: {
        'X-CSRF-Token': admin.csrf,
        Authorization: `Bearer ${admin.token}`,
      },
    });
    assert.equal(invited.status, 201);
    assert.equal(mail.getOutbox().length, 1);
    assert.match(mail.getOutbox()[0].text, /\/auth\?token=/);
  });
});
