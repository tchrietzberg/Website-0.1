'use strict';

const crypto = require('node:crypto');
const https = require('node:https');
const { URL } = require('node:url');

function twilioAccountSid() {
  return String(process.env.TWILIO_ACCOUNT_SID || '').trim();
}

function twilioAuthToken() {
  return String(process.env.TWILIO_AUTH_TOKEN || '').trim();
}

function twilioFromNumber() {
  return String(process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || '').trim();
}

function stubDial() {
  const raw = String(process.env.TWILIO_STUB || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function configured() {
  if (stubDial()) return true;
  return !!(twilioAccountSid() && twilioAuthToken() && twilioFromNumber());
}

function status() {
  const from = twilioFromNumber();
  return {
    configured: configured(),
    stub: stubDial(),
    fromMasked: from ? `***${from.replace(/\D/g, '').slice(-4)}` : null,
  };
}

function normalizePhone(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sayText(value) {
  return escapeXml(String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500));
}

function gatherTwiml(say, actionUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" timeout="7" speechTimeout="auto" action="${escapeXml(actionUrl)}" method="POST">
    <Say voice="Polly.Joanna">${sayText(say)}</Say>
  </Gather>
  <Redirect method="POST">${escapeXml(actionUrl)}</Redirect>
</Response>`;
}

function hangupTwiml(say) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${sayText(say)}</Say>
  <Hangup/>
</Response>`;
}

function publicBaseUrl(req) {
  const env = String(process.env.PUBLIC_ORIGIN || process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
  if (env) return env;
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'localhost:3000').split(',')[0].trim();
  const proto = String(req?.headers?.['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${host}`;
}

function voiceSecret() {
  return twilioAuthToken()
    || String(process.env.INTAKE_PHONE_WEBHOOK_SECRET || '').trim()
    || String(process.env.SESSION_SECRET || '').trim()
    || 'intake-voice-dev-secret';
}

function voiceSig(sessionId) {
  return crypto.createHmac('sha256', voiceSecret()).update(`intake-voice:${sessionId}`).digest('hex').slice(0, 32);
}

function verifyVoiceSig(sessionId, provided) {
  const expected = voiceSig(sessionId);
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function voiceActionUrl(req, sessionId) {
  return `${publicBaseUrl(req)}/api/intake/phone/voice?sid=${encodeURIComponent(sessionId)}&sig=${encodeURIComponent(voiceSig(sessionId))}`;
}

function postForm(urlString, fields, { username, password } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = new URLSearchParams(fields).toString();
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    };
    if (username) {
      headers.Authorization = `Basic ${Buffer.from(`${username}:${password || ''}`).toString('base64')}`;
    }
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
        if (res.statusCode >= 400) {
          const err = new Error((json && (json.message || json.error)) || 'phone carrier rejected the call');
          err.status = 502;
          err.detail = json && json.code ? { code: json.code } : null;
          reject(err);
          return;
        }
        resolve(json || {});
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function placeCall({ to, url }) {
  if (stubDial()) {
    return { sid: `CA_TEST_${crypto.randomBytes(8).toString('hex')}`, stub: true };
  }
  if (!configured()) {
    throw Object.assign(new Error('phone dialing is not configured'), { status: 503 });
  }
  const sid = twilioAccountSid();
  const from = twilioFromNumber();
  const out = await postForm(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`,
    { To: to, From: from, Url: url, Method: 'POST' },
    { username: sid, password: twilioAuthToken() }
  );
  if (!out.sid) {
    throw Object.assign(new Error('phone carrier did not start the call'), { status: 502 });
  }
  return { sid: out.sid, stub: false };
}

function verifyTwilioSignature(req, params, fullUrl) {
  const token = twilioAuthToken();
  if (!token) return stubDial();
  const header = String(req?.headers?.['x-twilio-signature'] || '');
  if (!header) return stubDial();
  const keys = Object.keys(params || {}).sort();
  let data = String(fullUrl || '');
  for (const key of keys) data += key + String(params[key] ?? '');
  const expected = crypto.createHmac('sha1', token).update(data).digest('base64');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  configured,
  status,
  stubDial,
  normalizePhone,
  gatherTwiml,
  hangupTwiml,
  publicBaseUrl,
  voiceSig,
  verifyVoiceSig,
  voiceActionUrl,
  placeCall,
  verifyTwilioSignature,
};
