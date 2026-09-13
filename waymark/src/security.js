const crypto = require('node:crypto');
const path = require('node:path');
const { getSetting, setSetting, audit } = require('./db');

const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_TTL_MS = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12)) * 3600 * 1000;
const MAX_BODY_BYTES = Math.max(4096, Number(process.env.MAX_BODY_BYTES || 1_000_000));
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = Math.max(3, Number(process.env.LOGIN_MAX_ATTEMPTS || 10));
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const loginAttempts = new Map();

function isProduction() {
  return IS_PROD;
}

function liveDomainConfigured() {
  const origin = String(process.env.PUBLIC_ORIGIN || '').trim();
  return /^https:\/\//i.test(origin);
}

function cookieOnlyAuth() {
  if (process.env.COOKIE_ONLY_AUTH === '0') return false;
  if (process.env.COOKIE_ONLY_AUTH === '1') return true;
  return isProduction() || liveDomainConfigured();
}

function googleMapsApiKey() {
  const key = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
  return key || null;
}

function strictOriginEnforcement() {
  if (process.env.STRICT_ORIGIN_CHECK === '0') return false;
  if (process.env.STRICT_ORIGIN_CHECK === '1') return true;
  return isProduction() || liveDomainConfigured() || Boolean(String(process.env.ALLOWED_ORIGINS || '').trim());
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket?.remoteAddress || 'unknown';
}

function requestIsSecure(req) {
  if (process.env.FORCE_SECURE_COOKIES === '1') return true;
  if (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https') {
    return true;
  }
  return false;
}

function sessionCookieOptions(req = null) {
  const secure =
    process.env.FORCE_SECURE_COOKIES === '1'
    || isProduction()
    || liveDomainConfigured()
    || (req ? requestIsSecure(req) : false);
  return {
    httpOnly: true,
    sameSite: (liveDomainConfigured() || isProduction()) ? 'Strict' : 'Lax',
    secure,
    path: '/',
    maxAgeSec: Math.floor(SESSION_TTL_MS / 1000),
  };
}

function requireSessionSecret() {
  const fromEnv = String(process.env.SESSION_SECRET || '').trim();
  if (fromEnv) return fromEnv;
  if (IS_PROD) throw new Error('SESSION_SECRET is required when NODE_ENV=production');
  return null;
}

function sessionSecret(db) {
  const env = requireSessionSecret();
  if (env) return env;
  let stored = getSetting(db, 'session_secret', '');
  if (!stored || stored.length < 32) {
    stored = crypto.randomBytes(48).toString('base64url');
    setSetting(db, 'session_secret', stored);
  }
  return stored;
}

function hashPassword(password) {
  const pwd = String(password || '');
  if (pwd.length < 10) throw new Error('password must be at least 10 characters');
  if (pwd.length > 200) throw new Error('password too long');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pwd, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(val); }
    catch { out[key] = val; }
  }
  return out;
}

function cookieHeader(name, value, {
  maxAgeSec = null,
  httpOnly = true,
  secure = false,
  sameSite = 'Lax',
  path = '/',
} = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) c += '; HttpOnly';
  if (secure || IS_PROD || liveDomainConfigured()) c += '; Secure';
  if (maxAgeSec != null) c += `; Max-Age=${maxAgeSec}`;
  return c;
}

function sessionSetCookie(token, req) {
  const opts = sessionCookieOptions(req);
  return cookieHeader('session', token, {
    maxAgeSec: opts.maxAgeSec,
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
    path: opts.path,
  });
}

function clearCookie(name, { secure = false } = {}) {
  return cookieHeader(name, '', { maxAgeSec: 0, secure, httpOnly: true });
}

function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

function createSession(db, userId, req) {
  purgeExpiredSessions(db);
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const expires = now + SESSION_TTL_MS;
  db.prepare(`
    INSERT INTO sessions(token, user_id, csrf_token, expires_at, last_seen_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    token, userId, csrf, expires, now, clientIp(req),
    String(req.headers['user-agent'] || '').slice(0, 240)
  );
  return { token, csrf, expiresAt: expires };
}

function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function readSession(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.token, s.user_id, s.csrf_token, s.expires_at,
           u.id, u.email, u.name, u.active
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (!row.active || Number(row.expires_at) < Date.now()) {
    destroySession(db, token);
    return null;
  }
  const now = Date.now();
  const expires = now + SESSION_TTL_MS;
  db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token = ?')
    .run(now, expires, token);
  return {
    token: row.token,
    csrf: row.csrf_token,
    expiresAt: expires,
    user: { id: row.id, email: row.email, name: row.name },
  };
}

function getSessionToken(req) {
  const cookies = parseCookies(req);
  if (cookies.session) return cookies.session;
  if (cookieOnlyAuth()) return null;
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

function checkLoginRateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const row = loginAttempts.get(ip);
  if (!row || row.resetAt < now) {
    loginAttempts.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return { ok: true };
  }
  if (row.count >= LOGIN_MAX_ATTEMPTS) {
    return { ok: false, retryAfterSec: Math.ceil((row.resetAt - now) / 1000) };
  }
  return { ok: true };
}

function recordLoginFailure(req) {
  const ip = clientIp(req);
  const now = Date.now();
  let row = loginAttempts.get(ip);
  if (!row || row.resetAt < now) row = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  row.count += 1;
  loginAttempts.set(ip, row);
}

function clearLoginFailures(req) {
  loginAttempts.delete(clientIp(req));
}

function allowedOrigins() {
  const raw = String(process.env.ALLOWED_ORIGINS || process.env.PUBLIC_ORIGIN || '').trim();
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    const referer = String(req.headers.referer || '');
    if (!referer) return !strictOriginEnforcement();
    try {
      return allowedOrigins().includes(new URL(referer).origin)
        || new URL(referer).origin === `http://${req.headers.host}`
        || new URL(referer).origin === `https://${req.headers.host}`;
    } catch {
      return false;
    }
  }
  const allow = allowedOrigins();
  if (allow.length) return allow.includes(origin);
  return origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
}

function assertCsrf(req, session) {
  const header = req.headers['x-csrf-token'];
  if (!header || typeof header !== 'string' || !session?.csrf) return false;
  const a = Buffer.from(String(header));
  const b = Buffer.from(String(session.csrf));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function securityHeaders(req) {
  const google = Boolean(googleMapsApiKey());
  const scriptSrc = [
    IS_PROD && !google ? "script-src 'self'" : "script-src 'self' 'unsafe-eval'",
    google ? 'https://maps.googleapis.com https://maps.gstatic.com' : '',
  ].filter(Boolean).join(' ');
  const imgSrc = [
    "img-src 'self' data: blob:",
    'https://tile.openstreetmap.org',
    'https://a.tile.openstreetmap.org',
    'https://b.tile.openstreetmap.org',
    'https://c.tile.openstreetmap.org',
    google ? 'https://maps.gstatic.com https://maps.googleapis.com https://*.googleapis.com https://*.ggpht.com https://*.google.com https://*.googleusercontent.com' : '',
  ].filter(Boolean).join(' ');
  const connectSrc = [
    "connect-src 'self'",
    google ? 'https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com' : '',
  ].filter(Boolean).join(' ');
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      scriptSrc,
      google
        ? "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
        : "style-src 'self' 'unsafe-inline'",
      google ? "font-src 'self' https://fonts.gstatic.com" : "font-src 'self'",
      imgSrc,
      connectSrc,
      "manifest-src 'self'",
      google ? "worker-src 'self' blob:" : "worker-src 'self'",
      "object-src 'none'",
    ].join('; '),
  };
  if (IS_PROD || process.env.FORCE_HSTS === '1' || liveDomainConfigured() || requestIsSecure(req)) {
    const preload = (IS_PROD || liveDomainConfigured() || process.env.HSTS_PRELOAD === '1')
      ? '; preload'
      : '';
    headers['Strict-Transport-Security'] = `max-age=31536000; includeSubDomains${preload}`;
  }
  return headers;
}

function clientErrorPayload(err, fallback = 'Request failed') {
  const status = Number(err && err.status) || 500;
  const code = err && err.code;
  if (status < 500 && err && err.message) {
    return { error: code || 'error', message: String(err.message).slice(0, 300) };
  }
  if (isProduction() || liveDomainConfigured()) {
    return { error: 'server_error', message: fallback };
  }
  return { error: code || 'error', message: (err && err.message) || fallback };
}

function parseBodyLimited(req, { limit = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('request body too large'), { code: 'PAYLOAD_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function pathResolveUnder(root, urlPath) {
  const normalized = path.normalize(path.join(root, urlPath));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (normalized !== root && !normalized.startsWith(rootWithSep)) return null;
  return normalized;
}

function safeStaticPath(publicRoot, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  return pathResolveUnder(publicRoot, decoded === '/' ? '/index.html' : decoded);
}

function auditLogin(db, actorId, ok, detail, req = null) {
  audit(db, {
    actorId,
    action: ok ? 'auth.login' : 'auth.login_failed',
    entityType: 'session',
    detail,
    req,
  });
}

module.exports = {
  isProduction,
  liveDomainConfigured,
  cookieOnlyAuth,
  googleMapsApiKey,
  strictOriginEnforcement,
  sessionCookieOptions,
  sessionSecret,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  readSession,
  getSessionToken,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  assertSameOrigin,
  assertCsrf,
  securityHeaders,
  clientErrorPayload,
  parseBodyLimited,
  clearCookie,
  sessionSetCookie,
  requestIsSecure,
  clientIp,
  safeStaticPath,
  auditLogin,
};
