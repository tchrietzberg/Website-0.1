const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
require('./loadEnv').loadEnvFile();
const { openDb, migrate, DEFAULT_DB, audit } = require('./db');
const security = require('./security');
const places = require('./places');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(res, status, body, req = null, extraHeaders = {}) {
  const data = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    ...(req ? security.securityHeaders(req) : {}),
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(data);
}

function text(res, status, body, type, req) {
  const headers = {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    ...(req ? security.securityHeaders(req) : {}),
  };
  res.writeHead(status, headers);
  res.end(body);
}

function serveStatic(req, res) {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  const file = security.safeStaticPath(PUBLIC, urlPath);
  if (!file) return text(res, 403, 'forbidden', 'text/plain; charset=utf-8', req);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };
  const body = fs.readFileSync(file);
  const headers = {
    ...security.securityHeaders(req),
    'Content-Type': types[ext] || 'application/octet-stream',
  };
  const base = path.basename(file);
  if (ext === '.html') headers['Cache-Control'] = 'no-store';
  else if (base === 'sw.js') {
    headers['Cache-Control'] = 'no-cache, must-revalidate';
    headers['Service-Worker-Allowed'] = '/';
  } else if (ext === '.js' || ext === '.css' || ext === '.webmanifest') {
    headers['Cache-Control'] = 'no-cache, must-revalidate';
  } else if (ext === '.png') {
    headers['Cache-Control'] = 'public, max-age=86400';
  }
  res.writeHead(200, headers);
  res.end(body);
  return true;
}

function currentSession(db, req) {
  return security.readSession(db, security.getSessionToken(req));
}

function requireUser(db, req, res) {
  const session = currentSession(db, req);
  if (!session) {
    json(res, 401, { error: 'sign in required' }, req);
    return null;
  }
  req.session = session;
  return session.user;
}

function requireCsrf(req, res, session) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  if (!security.assertCsrf(req, session)) {
    json(res, 403, { error: 'invalid_csrf', message: 'Missing or invalid CSRF token' }, req);
    return false;
  }
  if (security.strictOriginEnforcement()) {
    if (!security.assertSameOrigin(req)) {
      json(res, 403, { error: 'invalid_origin', message: 'Cross-origin request blocked' }, req);
      return false;
    }
  } else if (req.headers.origin && !security.assertSameOrigin(req)) {
    if (String(process.env.ALLOWED_ORIGINS || '').trim()) {
      json(res, 403, { error: 'invalid_origin', message: 'Cross-origin request blocked' }, req);
      return false;
    }
  }
  return true;
}

function authPayload(session, user) {
  const body = { user, csrf: session.csrf };
  if (!security.cookieOnlyAuth()) body.token = session.token;
  return body;
}

function issueSession(res, req, db, userRow) {
  const session = security.createSession(db, userRow.id, req);
  security.auditLogin(db, userRow.id, true, { email: userRow.email, ip: security.clientIp(req) }, req);
  const user = { id: userRow.id, email: userRow.email, name: userRow.name };
  return json(res, 200, authPayload(session, user), req, {
    'Set-Cookie': security.sessionSetCookie(session.token, req),
  });
}

function createServer(db = openDb()) {
  migrate(db);
  security.sessionSecret(db);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const { pathname } = url;

      if (req.method === 'OPTIONS') return json(res, 204, {}, req);

      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        if (serveStatic(req, res) !== false) return;
        return text(res, 404, 'not found', 'text/plain; charset=utf-8', req);
      }

      if (req.method === 'GET' && pathname === '/api/security-config') {
        return json(res, 200, {
          cookieOnlyAuth: security.cookieOnlyAuth(),
          liveDomain: security.liveDomainConfigured(),
          production: security.isProduction(),
          googleMapsApiKey: security.googleMapsApiKey(),
        }, req);
      }

      if (req.method === 'POST' && pathname === '/api/signup') {
        const limit = security.checkLoginRateLimit(req);
        if (!limit.ok) {
          return json(res, 429, {
            error: 'rate_limited',
            message: 'Too many attempts. Try again later.',
          }, req, { 'Retry-After': String(limit.retryAfterSec) });
        }
        const body = await security.parseBodyLimited(req);
        const email = String(body.email || '').trim().toLowerCase();
        const name = String(body.name || '').trim().slice(0, 80);
        const password = String(body.password || '');
        if (!EMAIL_RE.test(email)) {
          return json(res, 400, { error: 'invalid_email', message: 'Enter a valid email' }, req);
        }
        if (name.length < 2) {
          return json(res, 400, { error: 'invalid_name', message: 'Name must be at least 2 characters' }, req);
        }
        try {
          const passwordHash = security.hashPassword(password);
          const ins = db.prepare(
            'INSERT INTO users(email, name, password_hash) VALUES (?, ?, ?)'
          ).run(email, name, passwordHash);
          const userRow = db.prepare('SELECT id, email, name FROM users WHERE id = ?')
            .get(Number(ins.lastInsertRowid));
          audit(db, {
            actorId: userRow.id,
            action: 'auth.signup',
            entityType: 'user',
            entityId: userRow.id,
            req,
          });
          security.clearLoginFailures(req);
          return issueSession(res, req, db, userRow);
        } catch (e) {
          if (String(e.message || '').includes('UNIQUE')) {
            return json(res, 409, { error: 'email_taken', message: 'That email is already registered' }, req);
          }
          return json(res, 400, security.clientErrorPayload(e, 'Could not create account'), req);
        }
      }

      if (req.method === 'POST' && pathname === '/api/login') {
        const limit = security.checkLoginRateLimit(req);
        if (!limit.ok) {
          return json(res, 429, {
            error: 'rate_limited',
            message: 'Too many sign-in attempts. Try again later.',
          }, req, { 'Retry-After': String(limit.retryAfterSec) });
        }
        const body = await security.parseBodyLimited(req);
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const row = db.prepare(
          'SELECT id, email, name, password_hash FROM users WHERE lower(email) = ? AND active = 1'
        ).get(email);
        const ok = row && security.verifyPassword(password, row.password_hash);
        if (!ok) {
          security.recordLoginFailure(req);
          security.auditLogin(db, row?.id || null, false, { email, ip: security.clientIp(req) }, req);
          return json(res, 401, { error: 'invalid_credentials', message: 'Invalid email or password' }, req);
        }
        security.clearLoginFailures(req);
        return issueSession(res, req, db, row);
      }

      if (req.method === 'POST' && pathname === '/api/logout') {
        const token = security.getSessionToken(req);
        const session = security.readSession(db, token);
        if (session && !security.assertCsrf(req, session) && req.headers.origin && !security.assertSameOrigin(req)) {
          return json(res, 403, { error: 'invalid_origin' }, req);
        }
        security.destroySession(db, token);
        const secure = security.sessionCookieOptions(req).secure;
        return json(res, 200, { ok: true }, req, {
          'Set-Cookie': security.clearCookie('session', { secure }),
        });
      }

      if (req.method === 'GET' && pathname === '/api/me') {
        const session = currentSession(db, req);
        if (!session) return json(res, 200, { user: null, csrf: null }, req);
        return json(res, 200, { user: session.user, csrf: session.csrf }, req);
      }

      const user = requireUser(db, req, res);
      if (!user) return;
      if (!requireCsrf(req, res, req.session)) return;

      if (req.method === 'GET' && pathname === '/api/places') {
        return json(res, 200, places.listMyPlaces(db, user.id), req);
      }
      if (req.method === 'GET' && pathname === '/api/places/landmarks') {
        return json(res, 200, { landmarks: places.listLandmarks() }, req);
      }
      if (req.method === 'POST' && pathname === '/api/places/pins') {
        const body = await security.parseBodyLimited(req);
        try {
          if (body.landmarkKey) {
            return json(res, 201, places.checkInLandmark(db, user, body.landmarkKey, req), req);
          }
          return json(res, 201, places.dropPin(db, user, body, req), req);
        } catch (e) {
          const status = e.status || 400;
          return json(res, status, security.clientErrorPayload(e, 'Could not drop pin'), req);
        }
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/places\/\d+$/)) {
        const placeId = Number(pathname.split('/')[3]);
        try {
          return json(res, 200, places.getPlace(db, user.id, placeId), req);
        } catch (e) {
          return json(res, e.status || 400, security.clientErrorPayload(e, 'Place unavailable'), req);
        }
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/places\/\d+\/messages$/)) {
        const placeId = Number(pathname.split('/')[3]);
        const afterId = Number(url.searchParams.get('afterId') || 0);
        try {
          return json(res, 200, places.listMessages(db, user.id, placeId, afterId), req);
        } catch (e) {
          return json(res, e.status || 400, security.clientErrorPayload(e, 'Chat unavailable'), req);
        }
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/places\/\d+\/messages$/)) {
        const placeId = Number(pathname.split('/')[3]);
        const body = await security.parseBodyLimited(req);
        try {
          return json(res, 201, places.postMessage(db, user, placeId, body, req), req);
        } catch (e) {
          return json(res, e.status || 400, security.clientErrorPayload(e, 'Could not send message'), req);
        }
      }

      return json(res, 404, { error: 'not found' }, req);
    } catch (err) {
      if (err.code === 'PAYLOAD_TOO_LARGE') {
        return json(res, 413, { error: 'payload_too_large', message: 'Request body too large' }, req);
      }
      const status = err.status || 500;
      if (status >= 500) console.error('[pinpoint]', err && err.stack ? err.stack : err);
      json(res, status >= 400 ? status : 500, security.clientErrorPayload(err, 'Request failed'), req);
    }
  });

  return server;
}

if (require.main === module) {
  const db = openDb(DEFAULT_DB);
  migrate(db);
  const server = createServer(db);
  const bindHost = process.env.BIND_HOST || '0.0.0.0';
  server.listen(PORT, bindHost, () => {
    console.log(`Pinpoint listening on http://${bindHost}:${PORT}`);
    console.log(`DB: ${DEFAULT_DB}`);
  });
}

module.exports = { createServer };
