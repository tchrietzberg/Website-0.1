const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const { getSetting, setSetting, audit } = require('./db');

/** In-memory outbox when SMTP/Resend is not configured (tests / local dev). */
const outbox = [];

/**
 * Outbound email stays off until a live domain is configured.
 * Set OUTBOUND_EMAIL=1 (or true/yes) to enable real delivery.
 */
function outboundEmailEnabled() {
  const raw = String(process.env.OUTBOUND_EMAIL || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

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

function extractEmailAddress(from) {
  const s = String(from || '').trim();
  const angled = s.match(/<([^>]+)>/);
  if (angled) return angled[1].trim();
  return s;
}

function formatFromAddress(email, name) {
  const addr = String(email || '').trim();
  const display = String(name || '').trim();
  if (!addr) return display || 'noreply@firm.example';
  if (!display) return addr;
  if (addr.includes('<')) return addr;
  return `${display} <${addr}>`;
}

function storedFrom(db, fallback = 'noreply@firm.example') {
  const email = (db && getSetting(db, 'smtp_from', '')) || '';
  const name = (db && getSetting(db, 'smtp_from_name', '')) || '';
  if (!email && !name) return fallback;
  return formatFromAddress(email || fallback, name || 'Chrono');
}

/** Resolve delivery config: product env → Microsoft Graph → optional admin override. */
function resolveMailConfig(db = null) {
  const envResend = String(process.env.RESEND_API_KEY || '').trim();
  const envFrom = String(process.env.SMTP_FROM || process.env.MAIL_FROM || '').trim();
  const envFromName = String(process.env.SMTP_FROM_NAME || process.env.MAIL_FROM_NAME || '').trim();
  if (envResend) {
    return {
      provider: 'resend',
      source: 'env',
      apiKey: envResend,
      from: formatFromAddress(envFrom || 'onboarding@resend.dev', envFromName || 'Chrono'),
      fromEmail: extractEmailAddress(envFrom || 'onboarding@resend.dev'),
      fromName: envFromName || 'Chrono',
      configured: true,
    };
  }

  const envHost = String(process.env.SMTP_HOST || '').trim();
  if (envHost) {
    const port = Number(process.env.SMTP_PORT || 587);
    const from = formatFromAddress(envFrom || 'noreply@firm.example', envFromName || 'Chrono');
    return {
      provider: 'smtp',
      source: 'env',
      host: envHost,
      port,
      secure: process.env.SMTP_SECURE === '1' || port === 465,
      user: String(process.env.SMTP_USER || '').trim() || null,
      pass: String(process.env.SMTP_PASS || ''),
      from,
      fromEmail: extractEmailAddress(from),
      fromName: envFromName || 'Chrono',
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
          fromEmail: account,
          fromName: 'Chrono',
          configured: true,
        };
      }
    } catch {
      // msAuth unavailable during early boot — ignore
    }

    const resendKey = getSetting(db, 'resend_api_key', '');
    const from = storedFrom(db, 'onboarding@resend.dev');
    if (resendKey) {
      return {
        provider: 'resend',
        source: 'settings',
        apiKey: resendKey,
        from,
        fromEmail: extractEmailAddress(from),
        fromName: getSetting(db, 'smtp_from_name', '') || 'Chrono',
        configured: true,
      };
    }
    const host = getSetting(db, 'smtp_host', '');
    if (host) {
      const port = Number(getSetting(db, 'smtp_port', '587') || 587);
      const secureSetting = getSetting(db, 'smtp_secure', '');
      const smtpFrom = storedFrom(db, 'noreply@firm.example');
      return {
        provider: 'smtp',
        source: 'settings',
        host,
        port,
        secure: secureSetting === '1' || port === 465,
        user: getSetting(db, 'smtp_user', '') || null,
        pass: getSetting(db, 'smtp_pass', '') || '',
        from: smtpFrom,
        fromEmail: extractEmailAddress(smtpFrom),
        fromName: getSetting(db, 'smtp_from_name', '') || 'Chrono',
        configured: true,
      };
    }
  }

  return {
    provider: 'log',
    source: 'none',
    from: envFrom || 'noreply@firm.example',
    fromEmail: extractEmailAddress(envFrom || 'noreply@firm.example'),
    fromName: envFromName || 'Chrono',
    configured: false,
  };
}

function mailStatus(db) {
  const cfg = resolveMailConfig(db);
  const savedKey = db ? getSetting(db, 'resend_api_key', '') : '';
  const savedFrom = db ? getSetting(db, 'smtp_from', '') : '';
  const savedFromName = db ? getSetting(db, 'smtp_from_name', '') : '';
  const outboundEnabled = outboundEmailEnabled();
  const base = {
    hasApiKey: Boolean(savedKey || (cfg.provider === 'resend' && cfg.apiKey)),
    fromName: savedFromName || cfg.fromName || 'Chrono',
    fromAddress: savedFrom || cfg.fromEmail || '',
    outboundEnabled,
  };
  if (!outboundEnabled) {
    return {
      ...base,
      configured: false,
      provider: 'deferred',
      source: 'none',
      from: cfg.from,
      setupHint: 'domain',
      message: 'Outbound email is deferred until a live domain is ready. Use copyable invite and reset links instead.',
    };
  }
  if (!cfg.configured) {
    return {
      ...base,
      configured: false,
      provider: 'log',
      source: 'none',
      from: cfg.from,
      setupHint: 'resend',
      message: 'Paste a Resend API key below (or connect Microsoft) so invite and login emails reach Gmail and other inboxes.',
    };
  }
  if (cfg.provider === 'microsoft') {
    return {
      ...base,
      configured: true,
      provider: 'microsoft',
      source: 'microsoft',
      from: cfg.from,
      message: `Emails send via Microsoft (${cfg.from}) to Gmail and other inboxes.`,
    };
  }
  if (cfg.provider === 'resend') {
    return {
      ...base,
      configured: true,
      provider: 'resend',
      source: cfg.source,
      from: cfg.from,
      apiKeyMasked: maskSecret(cfg.apiKey),
      message: 'Emails send via Resend to Gmail, Outlook, and other inboxes.',
    };
  }
  return {
    ...base,
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
  const apiKey = input.resendApiKey ?? input.apiKey;
  const from = input.smtpFrom ?? input.from;
  const fromName = input.fromName ?? input.smtpFromName;
  if (provider === 'resend') {
    if (apiKey != null && String(apiKey).trim()) {
      setSetting(db, 'resend_api_key', String(apiKey).trim());
    }
    if (from != null) setSetting(db, 'smtp_from', String(from || '').trim());
    if (fromName != null) setSetting(db, 'smtp_from_name', String(fromName || '').trim());
    // Clear SMTP host so Resend wins when reading settings
    if (input.clearSmtp !== false) {
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
    if (from != null) setSetting(db, 'smtp_from', String(from || '').trim());
    if (fromName != null) setSetting(db, 'smtp_from_name', String(fromName || '').trim());
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build simple multipart-friendly HTML from plain text (links become clickable). */
function textToHtml(text) {
  const escaped = escapeHtml(text);
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#0b5fff;text-decoration:underline">$1</a>'
  );
  const body = withLinks.replace(/\r?\n/g, '<br>\n');
  return [
    '<!DOCTYPE html><html><body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;">',
    `<p style="margin:0 0 1rem 0">${body}</p>`,
    '</body></html>',
  ].join('');
}

async function smtpSend({ host, port, secure, user, pass, from, to, subject, text, html }) {
  let socket = await connectSocket({ host, port: Number(port), secure: !!secure });
  let session = new SmtpSession(socket);
  const envelopeFrom = extractEmailAddress(from);
  const htmlBody = html || textToHtml(text);
  const boundary = `firmbilling_${Date.now().toString(36)}`;
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

    session.write(`MAIL FROM:<${envelopeFrom}>`);
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
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      text.replace(/\r?\n/g, '\r\n'),
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      htmlBody.replace(/\r?\n/g, '\r\n'),
      `--${boundary}--`,
      '.',
    ].join('\r\n');
    socket.write(`${payload}\r\n`);
    await session.expect(250);
    session.write('QUIT');
  } finally {
    try { socket.end(); } catch { /* ignore */ }
  }
}

async function resendSend({ apiKey, from, to, subject, text, html }) {
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
      html: html || textToHtml(text),
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
 * Send email (text + HTML) to any inbox (Gmail, Outlook, etc.).
 * Priority: product Resend/SMTP env → connected Microsoft account → optional settings → local log.
 */
async function sendMail({ to, subject, text, html = null, db = null, allowLog = true } = {}) {
  const cfg = resolveMailConfig(db);
  const plain = String(text || '');
  const htmlBody = html || (plain ? textToHtml(plain) : null);
  const msg = {
    to: String(to || '').trim().toLowerCase(),
    from: cfg.from,
    subject: String(subject || '').trim(),
    text: plain,
    html: htmlBody,
  };
  if (!msg.to || !msg.to.includes('@')) throw new Error('valid recipient email required');
  if (!msg.subject) throw new Error('subject required');

  if (!outboundEmailEnabled()) {
    if (!allowLog) {
      const err = new Error(
        'Outbound email is deferred until a live domain is ready. Share invite or reset links directly.'
      );
      err.code = 'MAIL_DEFERRED';
      throw err;
    }
    outbox.push(msg);
    appendLogFile(msg);
    if (process.env.MAIL_LOG !== '0') {
      console.info(`[mail:deferred] to=${msg.to} subject=${msg.subject}`);
    }
    return {
      ok: false,
      mode: 'deferred',
      message: 'Outbound email is deferred until a live domain is ready. Share the link directly.',
    };
  }

  if (!cfg.configured) {
    if (!allowLog) {
      const err = new Error(
        'Email is not configured. Save a Resend API key in Settings → Email, or connect Microsoft under OneDrive.'
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
      message: 'Save a Resend API key in Settings → Email (or connect Microsoft) to deliver to inboxes.',
    };
  }

  try {
    if (cfg.provider === 'microsoft') {
      const msAuth = require('./services/msAuth');
      await msAuth.sendMailGraph(db, {
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
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
        html: msg.html,
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
      html: msg.html,
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
  outboundEmailEnabled,
  smtpConfigured,
  mailFrom,
  mailStatus,
  saveMailConfig,
  resolveMailConfig,
  getOutbox,
  clearOutbox,
};
