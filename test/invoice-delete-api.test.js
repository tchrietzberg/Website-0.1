const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/web/server');
const timeSvc = require('../src/services/time');
const invoiceSvc = require('../src/services/invoices');

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
        } : {
          'Content-Type': 'application/json',
        }),
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
        resolve({ status: res.statusCode, setCookie: res.headers['set-cookie'] || [], json, raw });
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

describe('invoice delete API', () => {
  let db;
  let server;
  let port;

  beforeEach(async () => {
    db = resetDb(path.join(os.tmpdir(), `inv-del-${process.pid}-${Date.now()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('avery@firm.example','Avery','admin',?)"
    ).run(hashPassword('demo-change-me'));
    db.prepare("INSERT INTO users(email,name,role) VALUES ('para@x.com','Para','paralegal')").run();
    db.prepare("INSERT INTO clients(name) VALUES ('Acme')").run();
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, opened_on, responsible_attorney_id)
      VALUES (1, '2026-1', 'Case', 'billable', '2026-01-01', 1)
    `).run();
    db.prepare(`
      INSERT INTO rates(scope, scope_id, amount_cents, effective_date)
      VALUES ('timekeeper', 2, 45000, '2026-01-01')
    `).run();
    server = createServer(db);
    port = await listen(server);
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(() => resolve()));
  });

  it('deletes a bill via HTTP DELETE', async () => {
    const para = db.prepare('SELECT * FROM users WHERE id=2').get();
    const admin = db.prepare('SELECT * FROM users WHERE id=1').get();
    timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-01',
      hours: 1,
      description: 'work',
    });
    const inv = invoiceSvc.createBill(db, admin, 1);
    assert.ok(inv.id);

    const login = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login.setCookie);

    const del = await request(port, 'DELETE', `/api/invoices/${inv.id}`, {
      cookies: cookie,
      headers: {
        'X-CSRF-Token': login.json.csrf,
        Authorization: `Bearer ${login.json.token}`,
      },
    });
    assert.equal(del.status, 200, JSON.stringify(del.json));
    assert.equal(del.json.ok, true);
    assert.equal(invoiceSvc.getInvoice(db, inv.id), null);
  });

  it('accepts trailing slash on DELETE', async () => {
    const para = db.prepare('SELECT * FROM users WHERE id=2').get();
    const admin = db.prepare('SELECT * FROM users WHERE id=1').get();
    timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-01',
      hours: 1,
      description: 'work',
    });
    const inv = invoiceSvc.createBill(db, admin, 1);

    const login = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    const del = await request(port, 'DELETE', `/api/invoices/${inv.id}/`, {
      cookies: sessionCookie(login.setCookie),
      headers: {
        'X-CSRF-Token': login.json.csrf,
        Authorization: `Bearer ${login.json.token}`,
      },
    });
    assert.equal(del.status, 200, JSON.stringify(del.json));
  });

  it('deletes via POST /api/invoices/:id/delete', async () => {
    const para = db.prepare('SELECT * FROM users WHERE id=2').get();
    const admin = db.prepare('SELECT * FROM users WHERE id=1').get();
    timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-01',
      hours: 1,
      description: 'work',
    });
    const inv = invoiceSvc.createBill(db, admin, 1);

    const login = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    const del = await request(port, 'POST', `/api/invoices/${inv.id}/delete`, {
      body: {},
      cookies: sessionCookie(login.setCookie),
      headers: {
        'X-CSRF-Token': login.json.csrf,
        Authorization: `Bearer ${login.json.token}`,
      },
    });
    assert.equal(del.status, 200, JSON.stringify(del.json));
    assert.equal(del.json.ok, true);
    assert.equal(invoiceSvc.getInvoice(db, inv.id), null);
  });
});
