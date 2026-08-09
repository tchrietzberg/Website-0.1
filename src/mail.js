const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const { getSetting, setSetting, audit } = require('./db');

/** In-memory outbox when SMTP/Resend is not configured (tests / local dev). */
const outbox = [];

function clearOutbox() {
  outbox.length = 0;
}

function getOutbox() {
  return outbox.slice();
}

function appendLogFile(entry) {
  try {
    const root = path.join(__dirname, '..');
    const dir = path.join(root, 'data');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'mail-outbox.jsonl'),
      `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`,
      'utf8'
    );
  } catch {
    // best-effort logging only
  }
}

function maskSecret(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 6) return '••••';
  return `${s.slice(0, 2)}••••${s.slice(-2)}`;
}

/** Resolve delivery config: product env → Microsoft Graph → optional admin override. */
function resolveMailConfig(db = null) {
  const envResend = String(process.env.RESEND_API_KEY || '').trim();
  const envFrom = String(process.env.SMTP_FROM || process.env.MAIL_FROM || '').trim();
  if (envResend) {
    return {
      provider: 'resend',
      source: 'env',
      apiKey: envResend,
      from: envFrom || 'Firm Billing <onboarding@resend.dev>',
      configured: true,
    };
  }

  const envHost = String(process.env.SMTP_HOST || '').trim();
  if (envHost) {
    const port = Number(process.env.SMTP_PORT || 587);
    return {
      provider: 'smtp',
      source: 'env',
      host: envHost,
      port,
      secure: process.env.SMTP_SECURE === '1' || port === 465,
      user: String(process.env.SMTP_USER || '').trim() || null,
      pass: String(process.env.SMTP_PASS || ''),
      from: envFrom || 'noreply@firm.example',
      configured: true,
    };
  }

  // Zero firm-admin setup: use the Microsoft account already connected for OneDrive.
  if (db) {
    try {
      const msAuth = require('./services/msAuth');
      if (msAuth.isConnected(db)) {
        const account = getSetting(db, 'ms_account_label', '') || 'Microsoft account';
        return {
          provider: 'microsoft',
          source: 'microsoft',
          from: account,
          configured: true,
        };
      }
    } catch {
      // msAuth unavailable during early boot — ignore
    }

    const resendKey = getSetting(db, 'resend_api_key', '');
    const from = getSetting(db, 'smtp_from', '') || 'noreply@firm.example';
    if (resendKey) {
      return {
        provider: 'resend',
        source: 'settings',
        apiKey: resendKey,
        from,
        configured: true,
      };
    }
    const host = getSetting(db, 'smtp_host', '');
    if (host) {
      const port = Number(getSetting(db, 'smtp_port', '587') || 587);
      const secureSetting = getSetting(db, 'smtp_secure', '');
      return {
        provider: 'smtp',
        source: 'settings',
        host,
        port,
        secure: secureSetting === '1' || port === 465,
        user: getSetting(db, 'smtp_user', '') || null,
        pass: getSetting(db, 'smtp_pass', '') || '',
        from,
        configured: true,
      };
    }
  }

  return {
    provider: 'log',
    source: 'none',
    from: envFrom || 'noreply@firm.example',
    configured: false,
  };
}

function mailStatus(db) {
  const cfg = resolveMailConfig(db);
  if (!cfg.configured) {
    return {
      configured: false,
      provider: 'log',
      source: 'none',
      from: cfg.from,
      setupHint: 'microsoft',
      message: 'Connect Microsoft under OneDrive settings to send invite and login emails automatically — no SMTP setup.',
    };
  }
  if (cfg.provider === 'microsoft') {
    return {
      configured: true,
      provider: 'microsoft',
      source: 'microsoft',
      from: cfg.from,
      message: `Emails send automatically via Microsoft (${cfg.from}).`,
    };
  }
  if (cfg.provider === 'resend') {
    return {
      configured: true,
      provider: 'resend',
      source: cfg.source,
      from: cfg.from,
      apiKeyMasked: maskSecret(cfg.apiKey),
      message: `Emails send automatically via Resend.`,
    };
  }
  return {
    configured: true,
    provider: 'smtp',
    source: cfg.source,
    from: cfg.from,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user || '',
    passConfigured: Boolean(cfg.pass),
    message: `Emails send via SMTP ${cfg.host}:${cfg.port}.`,
  };
}

function saveMailConfig(db, actor, input = {}) {
  const provider = String(input.provider || 'smtp').trim();
  if (provider === 'resend') {
    if (input.resendApiKey != null && String(input.resendApiKey).trim()) {
      setSetting(db, 'resend_api_key', String(input.resendApiKey).trim());
    }
    if (input.smtpFrom != null) setSetting(db, 'smtp_from', String(input.smtpFrom || '').trim());
    // Clear SMTP host so Resend wins when reading settings
    if (input.clearSmtp) {
      setSetting(db, 'smtp_host', '');
      setSetting(db, 'smtp_user', '');
      setSetting(db, 'smtp_pass', '');
    }
  } else {
    if (input.smtpHost != null) setSetting(db, 'smtp_host', String(input.smtpHost || '').trim());
    if (input.smtpPort != null) setSetting(db, 'smtp_port', String(Number(input.smtpPort) || 587));
    if (input.smtpSecure != null) setSetting(db, 'smtp_secure', input.smtpSecure ? '1' : '0');
    if (input.smtpUser != null) setSetting(db, 'smtp_user', String(input.smtpUser || '').trim());
    if (input.smtpPass != null && String(input.smtpPass).trim()) {
      setSetting(db, 'smtp_pass', String(input.smtpPass));
    }
    if (input.smtpFrom != null) setSetting(db, 'smtp_from', String(input.smtpFrom || '').trim());
    if (input.clearResend) setSetting(db, 'resend_api_key', '');
  }

  audit(db, {
    actorId: actor?.id || null,
    action: 'settings.mail_saved',
    entityType: 'settings',
    entityId: null,
    detail: { provider },
  });
  return mailStatus(db);
}

function smtpConfigured(db = null) {
  return resolveMailConfig(db).configured;
}

function mailFrom(db = null) {
  return resolveMailConfig(db).from;
}

class SmtpSession {
  constructor(socket) {
    this.socket = socket;
    this.buf = '';
  }

  write(line) {
    this.socket.write(`${line}\r\n`);
  }

  async readReply() {
    for (;;) {
      const idx = this.buf.indexOf('\n');
      if (idx === -1) {
        const chunk = await new Promise((resolve, reject) => {
          const onData = (c) => {
            cleanup();
            resolve(c);
          };
          const onError = (err) => {
            cleanup();
            reject(err);
          };
          const cleanup = () => {
            this.socket.off('data', onData);
            this.socket.off('error', onError);
          };
          this.socket.on('data', onData);
          this.socket.on('error', onError);
        });
        this.buf += chunk.toString('utf8');
        continue;
      }
      let end = 0;
      let complete = false;
      while (end < this.buf.length) {
        const nl = this.buf.indexOf('\n', end);
        if (nl === -1) break;
        const line = this.buf.slice(end, nl).replace(/\r$/, '');
        end = nl + 1;
        if (/^\d{3} /.test(line)) {
          complete = true;
          break;
        }
      }
      if (!complete) continue;
      const reply = this.buf.slice(0, end);
      this.buf = this.buf.slice(end);
      const lines = reply.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      const code = Number(last.slice(0, 3));
      return { code, text: reply.trim() };
    }
  }

  async expect(codes) {
    const allowed = Array.isArray(codes) ? codes : [codes];
    const { code, text } = await this.readReply();
    if (!allowed.includes(code)) throw new Error(`SMTP unexpected reply: ${text}`);
    return code;
  }
}

function connectSocket({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    if (secure) {
      const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true }, () => {
        socket.off('error', onError);
        resolve(socket);
      });
      socket.on('error', onError);
      return;
    }
    const socket = net.connect({ host, port }, () => {
      socket.off('error', onError);
      resolve(socket);
    });
    socket.on('error', onError);
  });
}

function startTls(socket, host) {
  return new Promise((resolve, reject) => {
    const upgraded = tls.connect({ socket, servername: host, rejectUnauthorized: true }, () => {
      resolve(upgraded);
    });
    upgraded.on('error', reject);
  });
}

async function smtpSend({ host, port, secure, user, pass, from, to, subject, text }) {
  let socket = await connectSocket({ host, port: Number(port), secure: !!secure });
  let session = new SmtpSession(socket);
  try {
    await session.expect(220);
    session.write('EHLO localhost');
    await session.expect(250);

    if (!secure && process.env.SMTP_STARTTLS !== '0') {
      session.write('STARTTLS');
      await session.expect(220);
      socket = await startTls(socket, host);
      session = new SmtpSession(socket);
      session.write('EHLO localhost');
      await session.expect(250);
    }

    if (user) {
      session.write('AUTH LOGIN');
      await session.expect(334);
      session.write(Buffer.from(user).toString('base64'));
      await session.expect(334);
      session.write(Buffer.from(pass || '').toString('base64'));
      await session.expect(235);
    }

    session.write(`MAIL FROM:<${from}>`);
    await session.expect(250);
    session.write(`RCPT TO:<${to}>`);
    await session.expect([250, 251]);
    session.write('DATA');
    await session.expect(354);
    const payload = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject.replace(/[\r\n]+/g, ' ')}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      text.replace(/\r?\n/g, '\r\n'),
      '.',
    ].join('\r\n');
    socket.write(`${payload}\r\n`);
    await session.expect(250);
    session.write('QUIT');
  } finally {
    try { socket.end(); } catch { /* ignore */ }
  }
}

async function resendSend({ apiKey, from, to, subject, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.message || body.error || res.statusText || 'Resend request failed';
    throw new Error(msg);
  }
  return body;
}

/**
 * Send a plain-text email.
 * Priority: product Resend/SMTP env → connected Microsoft account → optional settings → local log.
 */
async function sendMail({ to, subject, text, db = null, allowLog = true } = {}) {
  const cfg = resolveMailConfig(db);
  const msg = {
    to: String(to || '').trim().toLowerCase(),
    from: cfg.from,
    subject: String(subject || '').trim(),
    text: String(text || ''),
  };
  if (!msg.to || !msg.to.includes('@')) throw new Error('valid recipient email required');
  if (!msg.subject) throw new Error('subject required');

  if (!cfg.configured) {
    if (!allowLog) {
      const err = new Error(
        'Connect Microsoft under Settings (OneDrive) to send email automatically — no SMTP setup needed.'
      );
      err.code = 'MAIL_NOT_CONFIGURED';
      throw err;
    }
    outbox.push(msg);
    appendLogFile(msg);
    if (process.env.MAIL_LOG !== '0') {
      console.info(`[mail:log] to=${msg.to} subject=${msg.subject}`);
    }
    return {
      ok: false,
      mode: 'log',
      message: 'Connect Microsoft under Settings to send email automatically.',
    };
  }

  try {
    if (cfg.provider === 'microsoft') {
      const msAuth = require('./services/msAuth');
      await msAuth.sendMailGraph(db, {
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
      });
      return { ok: true, mode: 'microsoft', source: 'microsoft' };
    }
    if (cfg.provider === 'resend') {
      await resendSend({
        apiKey: cfg.apiKey,
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
      });
      return { ok: true, mode: 'resend', source: cfg.source };
    }
    await smtpSend({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      user: cfg.user,
      pass: cfg.pass,
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    });
    return { ok: true, mode: 'smtp', source: cfg.source };
  } catch (e) {
    const err = new Error(`Email send failed: ${e.message}`);
    err.code = e.code || 'MAIL_SEND_FAILED';
    err.cause = e;
    throw err;
  }
}

module.exports = {
  sendMail,
  smtpConfigured,
  mailFrom,
  mailStatus,
  saveMailConfig,
  resolveMailConfig,
  getOutbox,
  clearOutbox,
};
