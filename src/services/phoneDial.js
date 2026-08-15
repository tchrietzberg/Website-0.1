'use strict';

const crypto = require('node:crypto');
const https = require('node:https');
const { URL } = require('node:url');

function readSetting(db, key) {
  if (!db) return '';
  try {
    const { getSetting } = require('../db');
    return String(getSetting(db, key, '') || '').trim();
  } catch {
    return '';
  }
}

function twilioAccountSid(db = null) {
  return String(process.env.TWILIO_ACCOUNT_SID || '').trim() || readSetting(db, 'twilio_account_sid');
}

function twilioAuthToken(db = null) {
  return String(process.env.TWILIO_AUTH_TOKEN || '').trim() || readSetting(db, 'twilio_auth_token');
}

function twilioFromNumber(db = null) {
  return String(process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || '').trim()
    || readSetting(db, 'twilio_from_number');
}

function stubDial() {
  const raw = String(process.env.TWILIO_STUB || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function configured(db = null) {
  if (stubDial()) return true;
  return !!(twilioAccountSid(db) && twilioFromNumber(db));
}

function maskSecret(value) {
  const s = String(value || '');
  if (s.length < 8) return s ? '••••' : '';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function status(db = null) {
  const from = twilioFromNumber(db);
  const sid = twilioAccountSid(db);
  const fromEnv = !!(process.env.TWILIO_ACCOUNT_SID && (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER));
  return {
    configured: configured(db),
    stub: stubDial(),
    fromEnv,
    accountSidMasked: sid ? maskSecret(sid) : null,
    fromNumber: from || '',
    fromMasked: from ? `***${from.replace(/\D/g, '').slice(-4)}` : null,
  };
}

function saveConfig(db, actor, input = {}) {
  const { setSetting, audit } = require('../db');
  if (input.accountSid) {
    const sid = String(input.accountSid).trim();
    if (!/^AC[0-9a-fA-F]{32}$/.test(sid)) {
      throw Object.assign(new Error('Twilio account SID should look like ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), { status: 400 });
    }
    setSetting(db, 'twilio_account_sid', sid);
  }
  if (input.fromNumber !== undefined) {
    const raw = String(input.fromNumber || '').trim();
    if (!raw) {
      setSetting(db, 'twilio_from_number', '');
    } else {
      const normalized = normalizePhone(raw);
      if (!normalized) {
        throw Object.assign(new Error('Twilio from number must be a valid phone number'), { status: 400 });
      }
      setSetting(db, 'twilio_from_number', normalized);
    }
  }
  const next = status(db);
  audit(db, {
    actorId: actor?.id,
    action: 'settings.twilio',
    entityType: 'firm_settings',
    entityId: null,
    detail: {
      configured: next.configured,
      accountSidMasked: next.accountSidMasked,
      fromMasked: next.fromMasked,
    },
  });
  return next;
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

function voiceSecret(db = null) {
  return twilioAuthToken(db)
    || String(process.env.INTAKE_PHONE_WEBHOOK_SECRET || '').trim()
    || String(process.env.SESSION_SECRET || '').trim()
    || 'intake-voice-dev-secret';
}

function voiceSig(sessionId, db = null) {
  return crypto.createHmac('sha256', voiceSecret(db)).update(`intake-voice:${sessionId}`).digest('hex').slice(0, 32);
}

function verifyVoiceSig(sessionId, provided, db = null) {
  const expected = voiceSig(sessionId, db);
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function voiceActionUrl(req, sessionId, db = null) {
  return `${publicBaseUrl(req)}/api/intake/phone/voice?sid=${encodeURIComponent(sessionId)}&sig=${encodeURIComponent(voiceSig(sessionId, db))}`;
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

async function placeCall({ to, url, db = null }) {
  if (stubDial()) {
    return { sid: `CA_TEST_${crypto.randomBytes(8).toString('hex')}`, stub: true };
  }
  if (!configured(db)) {
    throw Object.assign(new Error('phone dialing is not configured'), { status: 503 });
  }
  const sid = twilioAccountSid(db);
  const from = twilioFromNumber(db);
  const apiKey = String(process.env.TWILIO_API_KEY || '').trim();
  const apiSecret = String(process.env.TWILIO_API_SECRET || '').trim();
  const username = apiKey || sid;
  const password = apiSecret || twilioAuthToken(db) || '';
  const out = await postForm(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`,
    { To: to, From: from, Url: url, Method: 'POST' },
    { username, password }
  );
  if (!out.sid) {
    throw Object.assign(new Error('phone carrier did not start the call'), { status: 502 });
  }
  return { sid: out.sid, stub: false };
}

function verifyTwilioSignature(req, params, fullUrl, db = null) {
  const token = twilioAuthToken(db);
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
  saveConfig,
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
