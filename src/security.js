const crypto = require('node:crypto');
const { getSetting, setSetting, audit } = require('./db');

const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_TTL_MS = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12)) * 3600 * 1000;
const MAX_BODY_BYTES = Math.max(4096, Number(process.env.MAX_BODY_BYTES || 1_000_000));
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = Math.max(3, Number(process.env.LOGIN_MAX_ATTEMPTS || 10));
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const loginAttempts = new Map(); // ip -> { count, resetAt }
const authEmailAttempts = new Map(); // ip -> { count, resetAt }
const AUTH_EMAIL_MAX_ATTEMPTS = Math.max(3, Number(process.env.AUTH_EMAIL_MAX_ATTEMPTS || 10));

function isProduction() {
  return IS_PROD;
}

/** True when PUBLIC_ORIGIN is an https live domain (go-live signal). */
function liveDomainConfigured() {
  const origin = String(process.env.PUBLIC_ORIGIN || '').trim();
  return /^https:\/\//i.test(origin);
}

/**
 * Cookie-only auth: disable Bearer + sessionStorage token fallback.
 * On by default in production or when a live https PUBLIC_ORIGIN is set.
 */
function cookieOnlyAuth() {
  if (process.env.COOKIE_ONLY_AUTH === '0') return false;
  if (process.env.COOKIE_ONLY_AUTH === '1') return true;
  return isProduction() || liveDomainConfigured();
}

/** Enforce Origin/Referer against ALLOWED_ORIGINS / PUBLIC_ORIGIN for mutating requests. */
function strictOriginEnforcement() {
  if (process.env.STRICT_ORIGIN_CHECK === '0') return false;
  if (process.env.STRICT_ORIGIN_CHECK === '1') return true;
  return isProduction() || liveDomainConfigured() || Boolean(String(process.env.ALLOWED_ORIGINS || '').trim());
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

function publicSecurityConfig() {
  return {
    cookieOnlyAuth: cookieOnlyAuth(),
    mfaAvailable: true,
    liveDomain: liveDomainConfigured(),
    production: isProduction(),
  };
}

/** Avoid leaking internal errors to browsers on live/production. */
function clientErrorPayload(err, fallback = 'Request failed') {
  const status = Number(err && err.status) || 500;
  const code = err && err.code;
  if (status < 500 && err && err.message) {
    return {
      error: code || 'error',
      message: String(err.message).slice(0, 300),
      ...(err.errors ? { errors: err.errors } : {}),
    };
  }
  if (isProduction() || liveDomainConfigured()) {
    return { error: 'server_error', message: fallback };
  }
  return {
    error: code || 'error',
    message: (err && err.message) || fallback,
    ...(err && err.errors ? { errors: err.errors } : {}),
  };
}

function requireSessionSecret() {
  const fromEnv = String(process.env.SESSION_SECRET || '').trim();
  if (fromEnv) return fromEnv;
  if (IS_PROD) {
    throw new Error('SESSION_SECRET is required when NODE_ENV=production');
  }
  return null;
}

/** Dev fallback: persist a random secret in firm_settings so sessions survive restarts. */
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
  const N = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  let actual;
  try {
    actual = crypto.scryptSync(String(password), salt, expected.length, { N, r: 8, p: 1 });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
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

/** Build Set-Cookie for a new session using live-domain-aware defaults. */
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

function ensureSessionTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }
}

function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

function createSession(db, userId, req) {
  ensureSessionTables(db);
  purgeExpiredSessions(db);
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const expires = now + SESSION_TTL_MS;
  db.prepare(`
    INSERT INTO sessions(token, user_id, csrf_token, expires_at, last_seen_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    token,
    userId,
    csrf,
    expires,
    now,
    clientIp(req),
    String(req.headers['user-agent'] || '').slice(0, 240)
  );
  return { token, csrf, expiresAt: expires };
}

function destroySession(db, token) {
  if (!token) return;
  ensureSessionTables(db);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function destroyUserSessions(db, userId) {
  ensureSessionTables(db);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function readSession(db, token) {
  if (!token) return null;
  ensureSessionTables(db);
  const row = db.prepare(`
    SELECT s.token, s.user_id, s.csrf_token, s.expires_at, s.last_seen_at,
           u.id, u.email, u.name, u.role, u.active
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (!row.active) {
    destroySession(db, token);
    return null;
  }
  if (Number(row.expires_at) < Date.now()) {
    destroySession(db, token);
    return null;
  }
  // Sliding expiration
  const now = Date.now();
  const expires = now + SESSION_TTL_MS;
  db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token = ?')
    .run(now, expires, token);
  return {
    token: row.token,
    csrf: row.csrf_token,
    expiresAt: expires,
    user: { id: row.id, email: row.email, name: row.name, role: row.role },
  };
}

function getSessionToken(req) {
  const cookies = parseCookies(req);
  if (cookies.session) return cookies.session;
  // Bearer fallback is disabled for live/production cookie-only mode.
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
    return { ok: true, remaining: LOGIN_MAX_ATTEMPTS };
  }
  if (row.count >= LOGIN_MAX_ATTEMPTS) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((row.resetAt - now) / 1000),
    };
  }
  return { ok: true, remaining: LOGIN_MAX_ATTEMPTS - row.count };
}

function recordLoginFailure(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const row = loginAttempts.get(ip);
  if (!row || row.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  row.count += 1;
}

function clearLoginFailures(req) {
  loginAttempts.delete(clientIp(req));
}

function checkAuthEmailRateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const row = authEmailAttempts.get(ip);
  if (!row || row.resetAt < now) {
    authEmailAttempts.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return { ok: true, remaining: AUTH_EMAIL_MAX_ATTEMPTS };
  }
  if (row.count >= AUTH_EMAIL_MAX_ATTEMPTS) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((row.resetAt - now) / 1000),
    };
  }
  return { ok: true, remaining: AUTH_EMAIL_MAX_ATTEMPTS - row.count };
}

function recordAuthEmailAttempt(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const row = authEmailAttempts.get(ip);
  if (!row || row.resetAt < now) {
    authEmailAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  row.count += 1;
}

function allowedOrigins() {
  const raw = String(process.env.ALLOWED_ORIGINS || '').trim();
  if (!raw) return null;
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function publicOrigin(req) {
  const proto = requestIsSecure(req) || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https')
    ? 'https'
    : 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    // Non-browser clients / same-origin navigations may omit Origin
    const referer = req.headers.referer || req.headers.referrer;
    if (!referer) return true;
    try {
      const refOrigin = new URL(referer).origin;
      const allow = allowedOrigins();
      if (allow) return allow.has(refOrigin);
      return refOrigin === publicOrigin(req);
    } catch {
      return false;
    }
  }
  const allow = allowedOrigins();
  if (allow) return allow.has(origin);
  return origin === publicOrigin(req);
}

function assertCsrf(req, session) {
  if (!session) return false;
  const header = req.headers['x-csrf-token'];
  if (!header || typeof header !== 'string') return false;
  const a = Buffer.from(String(header));
  const b = Buffer.from(String(session.csrf));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function securityHeaders(req, { isHtml = false } = {}) {
  // Keep production strict. Non-prod allows unsafe-eval so hosted previews/devtools
  // that inject tooling do not break auth landing pages with CSP eval errors.
  const scriptSrc = IS_PROD
    ? "script-src 'self'"
    : "script-src 'self' 'unsafe-eval'";
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' data:",
      "connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com",
      'frame-src https://*.sharepoint.com https://onedrive.live.com https://*.onedrive.com',
      "object-src 'none'",
    ].join('; '),
  };
  if (IS_PROD || process.env.FORCE_HSTS === '1' || liveDomainConfigured() || requestIsSecure(req)) {
    const preload = (IS_PROD || liveDomainConfigured() || process.env.HSTS_PRELOAD === '1')
      ? '; preload'
      : '';
    headers['Strict-Transport-Security'] = `max-age=31536000; includeSubDomains${preload}`;
  }
  if (isHtml) {
    headers['Cache-Control'] = 'no-store';
  }
  return headers;
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

function safeStaticPath(publicRoot, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = pathResolveUnder(publicRoot, decoded === '/' ? '/index.html' : decoded);
  return file;
}

function pathResolveUnder(root, urlPath) {
  const path = require('node:path');
  const normalized = path.normalize(path.join(root, urlPath));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (normalized !== root && !normalized.startsWith(rootWithSep)) return null;
  return normalized;
}

function oauthRedirectUri(req) {
  const allow = allowedOrigins();
  const origin = publicOrigin(req);
  if (allow && !allow.has(origin)) {
    throw Object.assign(new Error('Host is not in ALLOWED_ORIGINS'), { code: 'BAD_ORIGIN' });
  }
  if (process.env.PUBLIC_ORIGIN) {
    return `${String(process.env.PUBLIC_ORIGIN).replace(/\/$/, '')}/api/onedrive/oauth/callback`;
  }
  return `${origin}/api/onedrive/oauth/callback`;
}

function auditLogin(db, actorId, ok, detail, req = null) {
  audit(db, {
    actorId: actorId || null,
    action: ok ? 'auth.login' : 'auth.login_failed',
    entityType: 'session',
    entityId: null,
    detail,
    req,
    ip: detail && detail.ip,
  });
}

module.exports = {
  IS_PROD,
  isProduction,
  liveDomainConfigured,
  cookieOnlyAuth,
  strictOriginEnforcement,
  sessionCookieOptions,
  publicSecurityConfig,
  clientErrorPayload,
  sessionSecret,
  hashPassword,
  verifyPassword,
  ensureSessionTables,
  createSession,
  destroySession,
  destroyUserSessions,
  readSession,
  getSessionToken,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  checkAuthEmailRateLimit,
  recordAuthEmailAttempt,
  assertSameOrigin,
  assertCsrf,
  securityHeaders,
  parseBodyLimited,
  cookieHeader,
  clearCookie,
  sessionSetCookie,
  requestIsSecure,
  clientIp,
  safeStaticPath,
  oauthRedirectUri,
  publicOrigin,
  auditLogin,
  SESSION_TTL_MS,
  MAX_BODY_BYTES,
};
