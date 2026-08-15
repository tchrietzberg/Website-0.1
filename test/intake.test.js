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
const phoneDial = require('../src/services/phoneDial');

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
    assert.match(String(started.json.session.nextQuestion), /name/i);
    assert.equal(started.json.session.nextKey, 'contactName');
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
    assert.ok(['completed', 'filed'].includes(done.json.session.status), JSON.stringify(done.json));

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

  it('reuses the website button link and records a test call without auto-file', async () => {
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
    await request(port, 'PATCH', `/api/intake/forms/${formId}`, {
      ...auth,
      body: { autoFile: true, fieldIds: forms.json.forms[0].fieldIds, name: forms.json.forms[0].name },
    });
    const first = await request(port, 'POST', `/api/intake/forms/${formId}/portal-link`, {
      ...auth,
      body: { days: 365, reuse: true },
    });
    const again = await request(port, 'POST', `/api/intake/forms/${formId}/portal-link`, {
      ...auth,
      body: { days: 365, reuse: true },
    });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.token, first.json.token);
    assert.equal(again.json.reused, true);
    assert.match(again.json.testCallUrl, /\?test=1$/);

    const token = first.json.token;
    const started = await request(port, 'POST', `/api/portal/intake/${token}/call`, {
      body: { test: true },
    });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    assert.equal(started.json.session.test, true);
    const sessionId = started.json.session.id;
    await request(port, 'POST', `/api/portal/intake/${token}/call/${sessionId}/message`, {
      headers: { 'X-Intake-Guest': started.json.guestToken },
      body: { text: 'My name is Test Caller. Email is test.caller@example.com. Phone is 617-555-0101. Matter is Test website call.' },
    });
    const done = await request(port, 'POST', `/api/portal/intake/${token}/call/${sessionId}/complete`, {
      headers: { 'X-Intake-Guest': started.json.guestToken },
      body: {},
    });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.session.status, 'completed');
    assert.equal(done.json.session.test, true);

    const listed = await request(port, 'GET', '/api/intake/sessions', auth);
    const row = (listed.json.sessions || []).find((s) => s.id === sessionId);
    assert.ok(row);
    assert.equal(row.test, true);
    assert.equal(row.status, 'completed');
    assert.equal(row.clientId, null);
    assert.equal(row.matterId, null);
  });

  it('dials a test phone number and runs the intake agent on the live call', async () => {
    process.env.TWILIO_STUB = '1';
    process.env.INTAKE_PHONE_WEBHOOK_SECRET = 'intake-voice-test-secret-32chars';
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
    assert.equal(forms.json.dial.configured, true);

    const bad = await request(port, 'POST', `/api/intake/forms/${formId}/dial`, {
      ...auth,
      body: { phone: '123', test: true },
    });
    assert.equal(bad.status, 400);

    const dialed = await request(port, 'POST', `/api/intake/forms/${formId}/dial`, {
      ...auth,
      body: { phone: '415-555-0199', test: true },
    });
    assert.equal(dialed.status, 200, JSON.stringify(dialed.json));
    assert.equal(dialed.json.session.channel, 'phone');
    assert.equal(dialed.json.session.test, true);
    assert.match(String(dialed.json.callSid), /^CA_TEST_/);
    assert.match(dialed.json.toMasked, /0199|199/);
    const sessionId = dialed.json.session.id;
    const sig = phoneDial.voiceSig(sessionId);

    const pickup = await request(port, 'POST', `/api/intake/phone/voice?sid=${sessionId}&sig=${sig}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(pickup.status, 200);
    assert.match(pickup.raw, /<Gather/);
    assert.match(pickup.raw, /<Say voice="alice"/);
    assert.match(pickup.raw, /Chrono calling about a new matter/);
    assert.match(pickup.raw, /May I have your full name/);
    assert.match(pickup.raw, /I am listening/);
    assert.ok(pickup.raw.indexOf('<Say') < pickup.raw.indexOf('<Gather'));
    assert.doesNotMatch(pickup.raw, /Polly/);

    const opening = await request(port, 'GET', '/audio/intake-opening.wav');
    assert.equal(opening.status, 200);
    assert.match(opening.raw, /^RIFF/);

    const payload = new URLSearchParams({ SpeechResult: 'My name is Riley Dial. Email is riley.dial@example.com. Matter is Dial v. Acme. Case stage is Trial.' }).toString();
    const turn = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: `/api/intake/phone/voice?sid=${sessionId}&sig=${sig}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
          Origin: `http://127.0.0.1:${port}`,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    assert.equal(turn.status, 200);
    assert.match(turn.raw, /<Say|<Hangup/);

    const link = await request(port, 'POST', `/api/intake/forms/${formId}/portal-link`, {
      ...auth,
      body: { days: 365, reuse: true },
    });
    const siteDial = await request(port, 'POST', `/api/portal/intake/${link.json.token}/call/dial`, {
      body: { phone: '212-555-0188', test: true },
    });
    assert.equal(siteDial.status, 200, JSON.stringify(siteDial.json));
    assert.equal(siteDial.json.session.test, true);
    assert.ok(siteDial.json.guestToken);

    const liveDial = await request(port, 'POST', `/api/intake/forms/${formId}/dial`, {
      ...auth,
      body: { phone: '617-555-0133' },
    });
    assert.equal(liveDial.status, 200, JSON.stringify(liveDial.json));
    assert.equal(liveDial.json.session.test, false);
    const liveId = liveDial.json.session.id;
    const liveSig = phoneDial.voiceSig(liveId);
    const livePayload = new URLSearchParams({
      SpeechResult: 'My name is Casey Filed. Email is casey.filed@example.com. Matter is Filed v. Acme. Case stage is Trial.',
    }).toString();
    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: `/api/intake/phone/voice?sid=${liveId}&sig=${liveSig}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(livePayload),
          Origin: `http://127.0.0.1:${port}`,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.write(livePayload);
      req.end();
    });
    const filed = await request(port, 'GET', `/api/intake/sessions/${liveId}`, auth);
    assert.equal(filed.status, 200, JSON.stringify(filed.json));
    assert.equal(filed.json.session.status, 'filed');
    assert.equal(filed.json.session.extracted.contactName, 'Casey Filed');
    assert.ok(filed.json.session.clientId);
    assert.ok(filed.json.session.matterId);

    delete process.env.TWILIO_STUB;
    delete process.env.INTAKE_PHONE_WEBHOOK_SECRET;
  });

  it('lets any signed-in firm user list intake forms and dial', async () => {
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('pat@firm.example','Pat','paralegal',?)"
    ).run(hashPassword('demo-change-me'));
    const login = await request(port, 'POST', '/api/login', {
      body: { email: 'pat@firm.example', password: 'demo-change-me' },
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
    const dialed = await request(port, 'POST', `/api/intake/forms/${formId}/dial`, {
      ...auth,
      body: { phone: '202-555-0147', test: true },
    });
    assert.equal(dialed.status, 200, JSON.stringify(dialed.json));
    assert.equal(dialed.json.session.channel, 'phone');
    assert.equal(dialed.json.stub, true);
  });

  it('saves Twilio in Settings so dialing works without env vars', async () => {
    delete process.env.TWILIO_STUB;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
    delete process.env.TWILIO_PHONE_NUMBER;

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

    const before = await request(port, 'GET', '/api/settings', auth);
    assert.equal(before.status, 200);
    assert.equal(before.json.dial.configured, true);
    assert.equal(before.json.dial.canDial, true);
    assert.equal(before.json.dial.carrier, false);
    assert.equal(before.json.dial.fromEnv, false);

    const forms = await request(port, 'GET', '/api/intake/forms', auth);
    const formId = forms.json.forms[0].id;
    const localDial = await request(port, 'POST', `/api/intake/forms/${formId}/dial`, {
      ...auth,
      body: { phone: '415-555-0199' },
    });
    assert.equal(localDial.status, 200, JSON.stringify(localDial.json));
    assert.equal(localDial.json.stub, true);
    assert.match(String(localDial.json.callSid), /^CA_LOCAL_/);
    assert.equal(localDial.json.session.nextKey, 'contactName');
    const localId = localDial.json.session.id;
    const collected = await request(port, 'POST', `/api/intake/sessions/${localId}/message`, {
      ...auth,
      body: { text: 'My name is Casey Filed. Email is casey.filed@example.com. Matter is Filed v. Acme. Case stage is Trial.', source: 'speech' },
    });
    assert.equal(collected.status, 200, JSON.stringify(collected.json));
    assert.equal(collected.json.session.status, 'filed');
    assert.equal(collected.json.session.extracted.contactName, 'Casey Filed');
    assert.ok(collected.json.session.clientId);
    assert.ok(collected.json.session.matterId);
    const stageVal = db.prepare(
      'SELECT value_text FROM custom_field_values WHERE matter_id = ? AND field_id = ?'
    ).get(collected.json.session.matterId, stageField.id);
    assert.equal(stageVal?.value_text, 'Trial');

    const badSid = await request(port, 'PATCH', '/api/settings', {
      ...auth,
      body: { twilioConfig: { accountSid: 'not-a-sid', fromNumber: '415-555-0100' } },
    });
    assert.equal(badSid.status, 400);

    const sid = `AC${'ab'.repeat(16)}`;
    const saved = await request(port, 'PATCH', '/api/settings', {
      ...auth,
      body: {
        twilioConfig: {
          accountSid: sid,
          authToken: 'twilio-test-auth-token-value',
          fromNumber: '415-555-0100',
        },
      },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.dial.configured, true);
    assert.equal(saved.json.dial.carrier, true);
    assert.equal(saved.json.dial.hasAuthToken, true);
    assert.equal(saved.json.dial.fromNumber, '+14155550100');
    assert.match(String(saved.json.dial.accountSidMasked), /ACab/);
    assert.equal(saved.json.dial.fromEnv, false);
    assert.ok(!JSON.stringify(saved.json).includes('twilio-test-auth-token-value'));

    const updateFrom = await request(port, 'PATCH', '/api/settings', {
      ...auth,
      body: { twilioConfig: { fromNumber: '212-555-0188' } },
    });
    assert.equal(updateFrom.status, 200);
    assert.equal(updateFrom.json.dial.configured, true);
    assert.equal(updateFrom.json.dial.fromNumber, '+12125550188');
    assert.equal(phoneDial.configured(db), true);

    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('billie@firm.example','Billie','billing_clerk',?)"
    ).run(hashPassword('demo-change-me'));
    const clerkLogin = await request(port, 'POST', '/api/login', {
      body: { email: 'billie@firm.example', password: 'demo-change-me' },
    });
    const clerkAuth = {
      cookies: sessionCookie(clerkLogin.setCookie),
      headers: {
        'X-CSRF-Token': clerkLogin.json.csrf,
        Authorization: `Bearer ${clerkLogin.json.token}`,
      },
    };
    const clerkDenied = await request(port, 'PATCH', '/api/settings', {
      ...clerkAuth,
      body: { twilioConfig: { fromNumber: '202-555-0147' } },
    });
    assert.equal(clerkDenied.status, 403);

    process.env.TWILIO_STUB = '1';
    const dialed = await request(port, 'POST', `/api/intake/forms/${formId}/dial`, {
      ...auth,
      body: { phone: '617-555-0133', test: true },
    });
    assert.equal(dialed.status, 200, JSON.stringify(dialed.json));
    assert.match(String(dialed.json.callSid), /^CA_TEST_/);
    delete process.env.TWILIO_STUB;
  });

  it('places a call with a phone greeting instead of a collect-info script', async () => {
    intakeSvc.ensureDefaultForm(db, admin);
    db.prepare(`
      UPDATE intake_forms
      SET greeting = 'Hello, this is the Chrono intake agent. I will collect the information we need for a new matter. You can speak or type.'
    `).run();
    const forms = intakeSvc.listForms(db, admin);
    assert.equal(forms[0].greeting, 'This is Chrono calling about a new matter.');
    assert.doesNotMatch(forms[0].greeting, /collect/i);
    assert.doesNotMatch(forms[0].greeting, /speak or type/i);

    const stored = db.prepare('SELECT greeting FROM intake_forms WHERE id = ?').get(forms[0].id);
    assert.equal(stored.greeting, 'This is Chrono calling about a new matter.');

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
    const dialed = await request(port, 'POST', `/api/intake/forms/${forms[0].id}/dial`, {
      ...auth,
      body: { phone: '312-555-0144' },
    });
    assert.equal(dialed.status, 200, JSON.stringify(dialed.json));
    assert.equal(dialed.json.telUrl, 'tel:+13125550144');
    assert.match(String(dialed.json.speakText), /Chrono calling about a new matter/);
    assert.match(String(dialed.json.speakText), /May I have your full name/);
    const spoken = (dialed.json.session.messages || []).map((m) => m.content).join('\n');
    assert.match(spoken, /Chrono calling about a new matter/);
    assert.match(spoken, /May I have your full name/);
    assert.doesNotMatch(spoken, /I will collect/i);
    assert.doesNotMatch(spoken, /speak or type/i);
    assert.doesNotMatch(spoken, /share the information we need/i);
  });
});
