const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const mail = require('../src/mail');

describe('mail configuration', () => {
  let db;

  let prevOutbound;

  beforeEach(() => {
    mail.clearOutbox();
    prevOutbound = process.env.OUTBOUND_EMAIL;
    delete process.env.OUTBOUND_EMAIL;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    delete process.env.RESEND_API_KEY;
    db = resetDb(path.join(os.tmpdir(), `billing-mail-${process.pid}-${Date.now()}.db`));
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
  });

  afterEach(() => {
    if (prevOutbound === undefined) delete process.env.OUTBOUND_EMAIL;
    else process.env.OUTBOUND_EMAIL = prevOutbound;
  });

  it('defers outbound email until OUTBOUND_EMAIL is enabled', async () => {
    const status = mail.mailStatus(db);
    assert.equal(status.outboundEnabled, false);
    assert.equal(status.provider, 'deferred');
    const result = await mail.sendMail({
      db,
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Body',
    });
    assert.equal(result.ok, false);
    assert.equal(result.mode, 'deferred');
    assert.equal(mail.getOutbox().length, 1);
  });

  it('logs locally when outbound is enabled but email is not configured', async () => {
    process.env.OUTBOUND_EMAIL = '1';
    const status = mail.mailStatus(db);
    assert.equal(status.configured, false);
    const result = await mail.sendMail({
      db,
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Body',
    });
    assert.equal(result.ok, false);
    assert.equal(result.mode, 'log');
    assert.equal(mail.getOutbox().length, 1);
  });

  it('saves SMTP settings and reports configured when outbound is enabled', () => {
    process.env.OUTBOUND_EMAIL = '1';
    const admin = db.prepare('SELECT * FROM users WHERE id=1').get();
    const status = mail.saveMailConfig(db, admin, {
      provider: 'smtp',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'mailer',
      smtpPass: 'secret-pass',
      smtpFrom: 'billing@example.com',
      clearResend: true,
    });
    assert.equal(status.configured, true);
    assert.equal(status.provider, 'smtp');
    assert.equal(status.host, 'smtp.example.com');
    assert.match(status.from, /billing@example\.com/);
    assert.equal(status.passConfigured, true);
  });

  it('test send fails clearly when deferred with allowLog false', async () => {
    await assert.rejects(
      () => mail.sendMail({
        db,
        to: 'admin@x.com',
        subject: 'Test',
        text: 'x',
        allowLog: false,
      }),
      /deferred|live domain/i
    );
  });

  it('test send fails clearly when not configured with allowLog false', async () => {
    process.env.OUTBOUND_EMAIL = '1';
    await assert.rejects(
      () => mail.sendMail({
        db,
        to: 'admin@x.com',
        subject: 'Test',
        text: 'x',
        allowLog: false,
      }),
      /Resend API key|not configured|Connect Microsoft/i
    );
  });

  it('saves Resend settings for inbox delivery when outbound is enabled', () => {
    process.env.OUTBOUND_EMAIL = '1';
    const admin = db.prepare('SELECT * FROM users WHERE id=1').get();
    const status = mail.saveMailConfig(db, admin, {
      provider: 'resend',
      apiKey: 're_test_key_12345',
      from: 'onboarding@resend.dev',
      fromName: 'Firm Billing',
    });
    assert.equal(status.configured, true);
    assert.equal(status.provider, 'resend');
    assert.equal(status.hasApiKey, true);
    assert.match(status.from, /onboarding@resend\.dev/);
  });
});
