const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const mail = require('../src/mail');

describe('mail configuration', () => {
  let db;

  beforeEach(() => {
    mail.clearOutbox();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    delete process.env.RESEND_API_KEY;
    db = resetDb(path.join(os.tmpdir(), `billing-mail-${process.pid}-${Date.now()}.db`));
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
  });

  it('logs locally when email is not configured and reports not delivered', async () => {
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

  it('saves SMTP settings and reports configured', () => {
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

  it('test send fails clearly when not configured with allowLog false', async () => {
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

  it('saves Resend settings for inbox delivery', () => {
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
