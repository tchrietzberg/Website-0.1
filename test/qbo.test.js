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
const qbo = require('../src/services/qbo');

function setup() {
  const db = resetDb(path.join(os.tmpdir(), `qbo-${process.pid}-${Date.now()}-${Math.random()}.db`));
  setSetting(db, 'round_increment_minutes', '15');
  setSetting(db, 'round_mode', 'up');
  db.prepare("INSERT INTO users(email,name,role,password_hash) VALUES ('avery@firm.example','Avery','admin',?)")
    .run(hashPassword('demo-change-me'));
  db.prepare("INSERT INTO users(email,name,role) VALUES ('para@x.com','Para','paralegal')").run();
  db.prepare("INSERT INTO clients(name, record_type) VALUES ('Helios Capital', 'company')").run();
  db.prepare("INSERT INTO clients(name, record_type) VALUES ('Northwind Holdings', 'company')").run();
  db.prepare(`
    INSERT INTO matters(client_id, number, name, matter_type, opened_on, responsible_attorney_id)
    VALUES (1, '2026-0001', 'HLIO Case', 'billable', '2026-01-01', 1)
  `).run();
  db.prepare(`
    INSERT INTO rates(scope, scope_id, amount_cents, effective_date)
    VALUES ('timekeeper', 2, 45000, '2026-01-01')
  `).run();
  const tickerField = db.prepare(`
    SELECT id FROM custom_fields
    WHERE api_name = 'ticker' AND IFNULL(applies_to, 'matter') = 'client'
    LIMIT 1
  `).get();
  db.prepare(`
    INSERT INTO client_custom_field_values(client_id, field_id, value_text)
    VALUES (1, ?, 'HLIO')
  `).run(Number(tickerField.id));
  return {
    db,
    admin: db.prepare('SELECT * FROM users WHERE id=1').get(),
    para: db.prepare('SELECT * FROM users WHERE id=2').get(),
  };
}

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

describe('QuickBooks sandbox', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it('is loadable without Intuit credentials', () => {
    const status = qbo.connectionStatus(ctx.db);
    assert.equal(status.loadable, true);
    assert.equal(status.connected, false);
    assert.equal(status.neverConnected, true);
    assert.equal(status.clientConfigured, false);

    const loaded = qbo.connectSandbox(ctx.db, ctx.admin);
    assert.equal(loaded.connected, true);
    assert.equal(loaded.mode, 'sandbox');
    assert.equal(loaded.companyName, 'Chrono Legal (QuickBooks sandbox)');
    assert.equal(loaded.realmId, 'sandbox-chrono');
    assert.ok(loaded.customers.length >= 2);
    const helios = loaded.customers.find((c) => c.display_name === 'Helios Capital');
    assert.ok(helios);
    assert.equal(helios.ticker, 'HLIO');
    assert.equal(helios.qbo_id, '1000');
  });

  it('sends a Chrono bill into the sandbox ledger once', () => {
    timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-01',
      hours: 1,
      description: 'review',
    });
    const inv = invoiceSvc.createBill(ctx.db, ctx.admin, 1);
    assert.throws(() => qbo.sendInvoice(ctx.db, ctx.admin, inv.id), /Connect QuickBooks first/);

    qbo.connectSandbox(ctx.db, ctx.admin);
    const sent = qbo.sendInvoice(ctx.db, ctx.admin, inv.id);
    assert.equal(sent.alreadySent, false);
    assert.equal(sent.invoice.qbo_doc_number, inv.number);
    assert.equal(sent.invoice.qbo_customer_name, 'Helios Capital');
    assert.equal(sent.invoice.total_cents, inv.total_cents);
    assert.equal(sent.invoice.payload.CustomerRef.name, 'Helios Capital');
    assert.equal(sent.invoice.payload.DocNumber, inv.number);
    assert.ok(Array.isArray(sent.invoice.payload.Line));
    assert.ok(sent.invoice.payload.Line.length >= 1);

    const again = qbo.sendInvoice(ctx.db, ctx.admin, inv.id);
    assert.equal(again.alreadySent, true);
    assert.equal(again.invoice.qbo_id, sent.invoice.qbo_id);
  });

  it('blocks voided bills and disconnects the company', () => {
    timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-02',
      hours: 1,
      description: 'call',
    });
    const inv = invoiceSvc.createBill(ctx.db, ctx.admin, 1);
    ctx.db.prepare("UPDATE invoices SET status = 'void' WHERE id = ?").run(inv.id);
    qbo.connectSandbox(ctx.db, ctx.admin);
    assert.throws(() => qbo.sendInvoice(ctx.db, ctx.admin, inv.id), /Voided/);

    const off = qbo.disconnect(ctx.db, ctx.admin);
    assert.equal(off.connected, false);
    assert.equal(off.neverConnected, false);
    assert.equal(off.companyName, null);
  });

  it('requires a Client ID before Intuit OAuth', () => {
    assert.throws(
      () => qbo.startOAuth(ctx.db, ctx.admin, { redirectUri: 'http://127.0.0.1/api/qbo/callback' }),
      /Client ID/
    );
    qbo.saveAppConfig(ctx.db, ctx.admin, {
      clientId: 'IntuitClientABC',
      clientSecret: 'secret',
      environment: 'sandbox',
    });
    const start = qbo.startOAuth(ctx.db, ctx.admin, { redirectUri: 'http://127.0.0.1/api/qbo/callback' });
    assert.match(start.authUrl, /appcenter\.intuit\.com/);
    assert.match(start.authUrl, /IntuitClientABC/);
    assert.ok(start.state);
  });
});

describe('QuickBooks HTTP', () => {
  let ctx;
  let server;
  let port;
  let cookie;
  let csrf;
  let token;

  beforeEach(async () => {
    ctx = setup();
    server = createServer(ctx.db);
    port = await listen(server);
    const login = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    assert.equal(login.status, 200);
    cookie = sessionCookie(login.setCookie);
    csrf = login.json.csrf;
    token = login.json.token;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(() => resolve()));
  });

  function auth(body) {
    return {
      body,
      cookies: cookie,
      headers: {
        'X-CSRF-Token': csrf,
        Authorization: `Bearer ${token}`,
      },
    };
  }

  it('loads the sandbox company and sends a bill', async () => {
    const before = await request(port, 'GET', '/api/qbo', auth());
    assert.equal(before.status, 200);
    assert.equal(before.json.loadable, true);
    assert.equal(before.json.connected, false);

    const loaded = await request(port, 'POST', '/api/qbo/sandbox', auth({}));
    assert.equal(loaded.status, 200, JSON.stringify(loaded.json));
    assert.equal(loaded.json.connected, true);
    assert.equal(loaded.json.companyName, 'Chrono Legal (QuickBooks sandbox)');
    assert.ok(loaded.json.customers.length >= 2);

    timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-01',
      hours: 2,
      description: 'draft complaint',
    });
    const inv = invoiceSvc.createBill(ctx.db, ctx.admin, 1);

    const sent = await request(port, 'POST', `/api/qbo/invoices/${inv.id}/send`, auth({}));
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.equal(sent.json.alreadySent, false);
    assert.equal(sent.json.invoice.qbo_doc_number, inv.number);

    const settings = await request(port, 'GET', '/api/settings', auth());
    assert.equal(settings.json.qbo.connected, true);
    assert.equal(settings.json.qbo.loadable, true);

    const listed = await request(port, 'GET', '/api/invoices', auth());
    const row = (listed.json || []).find((i) => i.id === inv.id);
    assert.ok(row?.qbo);
    assert.equal(row.qbo.qbo_doc_number, inv.number);
  });
});
