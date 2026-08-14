const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/web/server');
const customFields = require('../src/services/customFields');
const intakeSvc = require('../src/services/intake');

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
        } : { 'Content-Type': 'application/json' }),
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

describe('intake agent', () => {
  let db;
  let server;
  let port;
  let admin;
  let stageField;

  beforeEach(async () => {
    db = resetDb(path.join(os.tmpdir(), `intake-${process.pid}-${Date.now()}.db`));
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('avery@firm.example','Avery','admin',?)"
    ).run(hashPassword('demo-change-me'));
    admin = db.prepare('SELECT * FROM users WHERE id = 1').get();
    customFields.ensureRecordTypes(db);
    stageField = customFields.createCustomField(db, admin, {
      label: 'Case stage',
      fieldType: 'select',
      recordTypeKey: 'billable',
      options: ['Investigation', 'Discovery', 'Trial'],
    });
    server = createServer(db);
    port = await listen(server);
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(() => resolve()));
  });

  it('extracts contact details and custom fields from a call transcript', () => {
    const fields = [customFields.getCustomField(db, stageField.id)];
    const extracted = intakeSvc.extractFromTranscript(fields, [
      'Hi, my name is Jane Doe.',
      'Email is jane.doe@example.com and phone is 415-555-0100.',
      'The matter is Ford battery litigation.',
      'Case stage is Discovery.',
    ].join(' '));
    assert.equal(extracted.contactName, 'Jane Doe');
    assert.equal(extracted.contactEmail, 'jane.doe@example.com');
    assert.match(String(extracted.contactPhone), /415/);
    assert.match(String(extracted.matterName), /Ford/i);
    assert.equal(extracted[String(stageField.id)], 'Discovery');
  });

  it('files a staff call session into a contact and matter', () => {
    const session = intakeSvc.startSession(db, admin, { channel: 'agent' });
    intakeSvc.addTurn(db, admin, session.id, { text: 'My name is Pat Lee. Email is pat.lee@example.com.' });
    intakeSvc.addTurn(db, admin, session.id, { text: 'Phone is 212-555-0199. Matter is Lee v. Acme. Case stage is Trial.' });
    const filed = intakeSvc.fileSession(db, admin, session.id);
    assert.equal(filed.status, 'filed');
    assert.ok(filed.clientId);
    assert.ok(filed.matterId);
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(filed.clientId);
    const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(filed.matterId);
    assert.equal(client.name, 'Pat Lee');
    assert.equal(client.email, 'pat.lee@example.com');
    assert.match(matter.name, /Lee/);
    const value = db.prepare(
      'SELECT value_text FROM custom_field_values WHERE matter_id = ? AND field_id = ?'
    ).get(matter.id, stageField.id);
    assert.equal(value?.value_text, 'Trial');
  });

  it('accepts a client portal submission and a signed phone webhook', async () => {
    const login = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login.setCookie);
    const auth = {
      cookies: cookie,
      headers: {
        'X-CSRF-Token': login.json.csrf,
        Authorization: `Bearer ${login.json.token}`,
      },
    };

    const forms = await request(port, 'GET', '/api/intake/forms', auth);
    assert.equal(forms.status, 200, JSON.stringify(forms.json));
    const formId = forms.json.forms[0].id;

    const link = await request(port, 'POST', `/api/intake/forms/${formId}/portal-link`, {
      ...auth,
      body: {},
    });
    assert.equal(link.status, 200, JSON.stringify(link.json));
    const token = link.json.token;

    const portalGet = await request(port, 'GET', `/api/portal/intake/${token}`);
    assert.equal(portalGet.status, 200);
    assert.ok(portalGet.json.form);

    const portalPost = await request(port, 'POST', `/api/portal/intake/${token}`, {
      body: {
        contactName: 'River Client',
        contactEmail: 'river@example.com',
        contactPhone: '646-555-0144',
        matterName: 'River intake',
        values: { [stageField.id]: 'Investigation' },
      },
    });
    assert.equal(portalPost.status, 200, JSON.stringify(portalPost.json));
    assert.equal(portalPost.json.session.extracted.contactName, 'River Client');
    assert.equal(portalPost.json.session.status, 'completed');

    process.env.INTAKE_PHONE_WEBHOOK_SECRET = 'intake-test-secret-32chars-minimum';
    const denied = await request(port, 'POST', '/api/intake/phone/webhook', {
      body: { transcript: 'My name is Sam Caller.' },
    });
    assert.equal(denied.status, 401);

    const phone = await request(port, 'POST', '/api/intake/phone/webhook', {
      headers: { 'X-Intake-Secret': process.env.INTAKE_PHONE_WEBHOOK_SECRET },
      body: {
        transcript: 'My name is Sam Caller. Email is sam.caller@example.com. Case stage is Discovery.',
        from: '555-0102',
      },
    });
    assert.equal(phone.status, 200, JSON.stringify(phone.json));
    assert.equal(phone.json.session.extracted.contactName, 'Sam Caller');
    assert.equal(phone.json.session.channel, 'phone');
    delete process.env.INTAKE_PHONE_WEBHOOK_SECRET;
  });

  it('lets a client start a website intake call from a portal token', async () => {
    const login = await request(port, 'POST', '/api/login', {
      body: { email: 'avery@firm.example', password: 'demo-change-me' },
    });
    const cookie = sessionCookie(login.setCookie);
    const auth = {
      cookies: cookie,
      headers: {
        'X-CSRF-Token': login.json.csrf,
        Authorization: `Bearer ${login.json.token}`,
      },
    };
    const forms = await request(port, 'GET', '/api/intake/forms', auth);
    const formId = forms.json.forms[0].id;
    const link = await request(port, 'POST', `/api/intake/forms/${formId}/portal-link`, {
      ...auth,
      body: { days: 365 },
    });
    assert.equal(link.status, 200, JSON.stringify(link.json));
    assert.match(link.json.callPath, /\/portal\/intake\/call\//);
    assert.match(link.json.embedHtml, /Start an intake call/);
    const token = link.json.token;

    const page = await request(port, 'GET', `/portal/intake/call/${token}`);
    assert.equal(page.status, 200);
    assert.match(page.raw, /portal-call\.js/);

    const denied = await request(port, 'POST', `/api/portal/intake/${token}/call/1/message`, {
      body: { text: 'My name is Jordan Client.' },
    });
    assert.equal(denied.status, 401);

    const started = await request(port, 'POST', `/api/portal/intake/${token}/call`, { body: {} });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    assert.equal(started.json.session.channel, 'web_call');
    assert.ok(started.json.guestToken);
    const sessionId = started.json.session.id;

    const turn = await request(port, 'POST', `/api/portal/intake/${token}/call/${sessionId}/message`, {
      headers: { 'X-Intake-Guest': started.json.guestToken },
      body: { text: 'My name is Jordan Client. Email is jordan.client@example.com. Phone is 312-555-0148. Matter is Client v. Acme. Case stage is Discovery.' },
    });
    assert.equal(turn.status, 200, JSON.stringify(turn.json));
    assert.equal(turn.json.session.extracted.contactName, 'Jordan Client');

    const done = await request(port, 'POST', `/api/portal/intake/${token}/call/${sessionId}/complete`, {
      headers: { 'X-Intake-Guest': started.json.guestToken },
      body: {},
    });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.session.status, 'completed');

    const widget = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/intake-widget.js' }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          corp: res.headers['cross-origin-resource-policy'],
          raw: Buffer.concat(chunks).toString('utf8'),
        }));
      }).on('error', reject);
    });
    assert.equal(widget.status, 200);
    assert.equal(widget.corp, 'cross-origin');
    assert.match(widget.raw, /chronoIntakeCall/);
  });
});
