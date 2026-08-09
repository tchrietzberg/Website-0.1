const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');

/** In-memory outbox when SMTP is not configured (tests / local dev). */
const outbox = [];

function smtpConfigured() {
  return Boolean(String(process.env.SMTP_HOST || '').trim());
}

function mailFrom() {
  return String(process.env.SMTP_FROM || process.env.MAIL_FROM || 'noreply@firm.example').trim();
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
      // Collect full multi-line reply
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

/**
 * Send a plain-text email. Without SMTP_HOST, messages go to the in-memory outbox
 * and data/mail-outbox.jsonl.
 */
async function sendMail({ to, subject, text }) {
  const msg = {
    to: String(to || '').trim().toLowerCase(),
    from: mailFrom(),
    subject: String(subject || '').trim(),
    text: String(text || ''),
  };
  if (!msg.to || !msg.to.includes('@')) throw new Error('valid recipient email required');
  if (!msg.subject) throw new Error('subject required');

  if (!smtpConfigured()) {
    outbox.push(msg);
    appendLogFile(msg);
    if (process.env.MAIL_LOG !== '0') {
      console.info(`[mail:log] to=${msg.to} subject=${msg.subject}`);
    }
    return { ok: true, mode: 'log' };
  }

  const port = Number(process.env.SMTP_PORT || 587);
  await smtpSend({
    host: String(process.env.SMTP_HOST).trim(),
    port,
    secure: process.env.SMTP_SECURE === '1' || port === 465,
    user: String(process.env.SMTP_USER || '').trim() || null,
    pass: String(process.env.SMTP_PASS || ''),
    from: msg.from,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
  });
  return { ok: true, mode: 'smtp' };
}

module.exports = {
  sendMail,
  smtpConfigured,
  mailFrom,
  getOutbox,
  clearOutbox,
};
